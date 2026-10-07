"""The A-Z Pawn web server: storefront, auction block, intake and Command Center API."""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Iterator, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import auctions, db
from .auctions import BidRejected, iso, utcnow
from .images import BadImage, save_photo
from .security import (
    Throttle,
    create_session,
    end_session,
    hash_password,
    session_user,
    verify_password,
)

# The storefront files served at the site root; nothing else in the repository is.
SITE_FILES = ("index.html", "owner.html", "app.js", "owner.js", "styles.css", "owner.css")
# Every state-changing API call must carry this header. Browsers will not add a
# custom header to a cross-site request without a CORS preflight, which this
# server never grants, so a forged form on another site cannot act as a user.
REQUEST_HEADER = "x-az-request"
STAFF_COOKIE = "az_staff"
BIDDER_COOKIE = "az_bidder"
MAX_PHOTOS = 6
CATEGORIES = ("Jewelry", "Electronics", "Tools", "Gaming", "Music", "Collectibles", "Other")


def _cents(value: float) -> int:
    return int(round(value * 100))


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# NOTE: every model with a min_length'd name/phone strips BEFORE validation,
# so "  " fails instead of passing and being stored as "".
# (field_validator with mode="before" on each model below.)


class BidderRegistration(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=200)
    phone: str = Field(min_length=7, max_length=30)
    password: str = Field(min_length=8, max_length=200)

    _strip = field_validator("name", "phone", mode="before")

    @_strip
    @classmethod
    def _strip_fields(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def looks_like_email(cls, value: str) -> str:
        value = value.strip()
        if not _EMAIL.match(value):
            raise ValueError("Please enter a valid email address.")
        return value


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class BidIn(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)


class OrderIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=7, max_length=30)
    email: str = Field(default="", max_length=200)
    fulfillment: Literal["pickup", "ship"] = "pickup"
    notes: str = Field(default="", max_length=1000)
    item_ids: list[int] = Field(min_length=1, max_length=20)

    _strip = field_validator("name", "phone", mode="before")

    @_strip
    @classmethod
    def _strip_fields(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class StatusIn(BaseModel):
    status: str


class ItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    category: str | None = None
    price: float | None = Field(default=None, ge=0, le=1_000_000)
    condition: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=4000)
    badge: str | None = Field(default=None, max_length=30)
    ship: bool | None = None
    status: Literal["draft", "live", "reserved", "sold", "hidden"] | None = None
    available_on: date | None = None

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("category")
    @classmethod
    def known_category(cls, value: str | None) -> str | None:
        if value is not None and value not in CATEGORIES:
            raise ValueError(f"category must be one of {', '.join(CATEGORIES)}")
        return value


class AuctionIn(BaseModel):
    item_id: int
    start: float = Field(gt=0, le=1_000_000)
    reserve: float | None = Field(default=None, gt=0, le=1_000_000)
    hours: float = Field(default=72, ge=1, le=24 * 14)
    starts_in_hours: float = Field(default=0, ge=0, le=24 * 30)


def _item_view(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "sku": row["sku"],
        "name": row["name"],
        "category": row["category"],
        "price_cents": row["price_cents"],
        "condition": row["condition"],
        "description": row["description"],
        "badge": row["badge"],
        "image": row["image"],
        "ship": bool(row["ship"]),
    }


def _staff_item_view(row: sqlite3.Row) -> dict:
    view = _item_view(row)
    view.update(status=row["status"], available_on=row["available_on"], created_at=row["created_at"])
    return view


def _next_sku(conn: sqlite3.Connection, category: str) -> str:
    prefix = {"Jewelry": "JWL", "Electronics": "ELC", "Tools": "TOL", "Gaming": "GAM", "Music": "MUS",
              "Collectibles": "COL"}.get(category, "OTH")
    count = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    while True:
        count += 1
        sku = f"AZ-{prefix}-{1000 + count}"
        if conn.execute("SELECT 1 FROM items WHERE sku = ?", (sku,)).fetchone() is None:
            return sku


def create_app(
    data_dir: Path | None = None,
    site_root: Path | None = None,
    secure_cookies: bool | None = None,
    trust_proxy: bool | None = None,
) -> FastAPI:
    data_dir = Path(data_dir or os.environ.get("AZ_DATA_DIR", "data")).resolve()
    site_root = Path(site_root or os.environ.get("AZ_SITE_ROOT", Path(__file__).resolve().parents[2])).resolve()
    if secure_cookies is None:
        secure_cookies = os.environ.get("AZ_SECURE_COOKIES", "1") != "0"
    if trust_proxy is None:
        trust_proxy = os.environ.get("AZ_TRUST_PROXY", "0") == "1"
    db_path = data_dir / "azpawn.sqlite3"
    media_dir = data_dir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    db.init(db_path)
    throttle = Throttle()

    app = FastAPI(title="A-Z Pawn", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.db_path = db_path

    @app.middleware("http")
    async def require_request_header(request: Request, call_next):
        if (
            request.url.path.startswith("/api/")
            and request.method not in ("GET", "HEAD", "OPTIONS")
            and request.headers.get(REQUEST_HEADER) != "1"
        ):
            return JSONResponse({"detail": "Missing request header."}, status_code=403)
        return await call_next(request)

    def get_db() -> Iterator[sqlite3.Connection]:
        conn = db.connect(db_path)
        try:
            yield conn
        finally:
            conn.close()

    def client_ip(request: Request) -> str:
        if trust_proxy:
            forwarded = request.headers.get("x-forwarded-for", "")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def limit(request: Request, action: str, count: int, window: float) -> None:
        if not throttle.allow(f"{action}:{client_ip(request)}", count, window):
            raise HTTPException(429, "Too many attempts. Please wait a few minutes and try again.")

    def set_cookie(response: Response, name: str, token: str, kind: str) -> None:
        max_age = 12 * 3600 if kind == "staff" else 30 * 24 * 3600
        response.set_cookie(name, token, max_age=max_age, httponly=True, secure=secure_cookies, samesite="lax", path="/")

    def staff_id(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> int:
        user = session_user(conn, "staff", request.cookies.get(STAFF_COOKIE))
        if user is None:
            raise HTTPException(401, "Please sign in.")
        return user

    def bidder_id(request: Request, conn: sqlite3.Connection) -> int | None:
        return session_user(conn, "bidder", request.cookies.get(BIDDER_COOKIE))

    # ------------------------------------------------------------- public

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "mode": "live"}

    @app.get("/api/items")
    def list_items(conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
        today = date.today().isoformat()
        rows = conn.execute(
            "SELECT * FROM items WHERE status = 'live' AND (available_on IS NULL OR available_on <= ?) "
            "ORDER BY created_at DESC, id DESC",
            (today,),
        ).fetchall()
        return [_item_view(row) for row in rows]

    @app.get("/api/auctions")
    def list_auctions(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
        auctions.settle_due(conn)
        viewer = bidder_id(request, conn)
        recent = iso(utcnow() - timedelta(days=3))
        rows = conn.execute(
            "SELECT * FROM auctions WHERE status IN ('scheduled', 'live') OR (status = 'ended' AND ends_at >= ?) "
            "ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, ends_at ASC",
            (recent,),
        ).fetchall()
        return [auctions.public_view(conn, row, viewer) for row in rows]

    @app.post("/api/inquiries", status_code=201)
    async def create_inquiry(
        request: Request,
        kind: Literal["sell", "pawn", "video"] = Form(...),
        name: str = Form(...),
        phone: str = Form(...),
        email: str = Form("", max_length=200),
        item: str = Form("", max_length=200),
        condition: str = Form("", max_length=40),
        notes: str = Form("", max_length=2000),
        photos: list[UploadFile] = File(default_factory=list),
        conn: sqlite3.Connection = Depends(get_db),
    ) -> dict:
        limit(request, "inquiry", 6, 3600)
        # Strip BEFORE length checks: FastAPI's min_length runs on the raw
        # value, so "  " would pass and be stored as an empty string.
        name, phone = name.strip(), phone.strip()
        if not 2 <= len(name) <= 80:
            raise HTTPException(400, "Please enter your name.")
        if not 7 <= len(phone) <= 30:
            raise HTTPException(400, "Please enter a phone number we can reach you at.")
        uploads = [photo for photo in photos if photo.filename]
        if len(uploads) > MAX_PHOTOS:
            raise HTTPException(400, f"Please send at most {MAX_PHOTOS} photos.")
        saved = []
        try:
            for photo in uploads:
                saved.append(save_photo(await photo.read(), media_dir, "inquiries"))
        except BadImage as exc:
            # A batch is all-or-nothing: remove anything already written so a
            # failed upload leaves no orphaned customer photos on disk.
            for rel in saved:
                try:
                    (media_dir / rel.removeprefix("/media/")).unlink()
                except OSError:
                    pass
            raise HTTPException(400, str(exc)) from exc
        conn.execute(
            "INSERT INTO inquiries (kind, name, phone, email, item, condition, notes, photos, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (kind, name, phone, email.strip(), item.strip(), condition.strip(), notes.strip(),
             json.dumps(saved), iso(utcnow())),
        )
        return {"ok": True}

    @app.post("/api/orders", status_code=201)
    def create_order(order: OrderIn, request: Request, conn: sqlite3.Connection = Depends(get_db)) -> dict:
        limit(request, "order", 5, 3600)
        ids = sorted(set(order.item_ids))
        # Same predicate the storefront uses: live AND past any holding period.
        # Checked inside the transaction so a crafted cart cannot reserve an
        # item whose available_on is still in the future.
        today = date.today().isoformat()
        with db.transaction(conn):
            rows = conn.execute(
                f"SELECT * FROM items WHERE id IN ({','.join('?' * len(ids))})", ids
            ).fetchall()
            found = {row["id"]: row for row in rows}
            unavailable = [
                i for i in ids
                if i not in found
                or found[i]["status"] != "live"
                or (found[i]["available_on"] is not None and found[i]["available_on"] > today)
            ]
            if unavailable:
                raise HTTPException(409, "Some items in your cart were just sold or reserved. Please refresh.")
            if order.fulfillment == "ship" and any(not found[i]["ship"] for i in ids):
                raise HTTPException(400, "Some items are local pickup only.")
            total = sum(found[i]["price_cents"] for i in ids)
            stamp = iso(utcnow())
            cursor = conn.execute(
                "INSERT INTO orders (name, phone, email, fulfillment, notes, total_cents, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (order.name.strip(), order.phone.strip(), order.email.strip(), order.fulfillment,
                 order.notes.strip(), total, stamp),
            )
            for i in ids:
                conn.execute(
                    "INSERT INTO order_lines (order_id, item_id, name, price_cents) VALUES (?, ?, ?, ?)",
                    (cursor.lastrowid, i, found[i]["name"], found[i]["price_cents"]),
                )
                conn.execute("UPDATE items SET status = 'reserved', updated_at = ? WHERE id = ?", (stamp, i))
        return {"ok": True, "order_id": cursor.lastrowid, "total_cents": total}

    # ------------------------------------------------------------- bidders

    @app.post("/api/bidders/register", status_code=201)
    def register_bidder(body: BidderRegistration, request: Request, conn: sqlite3.Connection = Depends(get_db)) -> dict:
        limit(request, "register", 5, 3600)
        email = body.email.lower()
        if conn.execute("SELECT 1 FROM bidders WHERE email = ?", (email,)).fetchone():
            raise HTTPException(409, "That email already has a bidder account. Please sign in.")
        conn.execute(
            "INSERT INTO bidders (name, email, phone, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (body.name.strip(), email, body.phone.strip(), hash_password(body.password), iso(utcnow())),
        )
        return {"ok": True, "status": "pending"}

    @app.post("/api/bidders/login")
    def bidder_login(body: Login, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)) -> dict:
        limit(request, "bidder-login", 10, 900)
        row = conn.execute("SELECT * FROM bidders WHERE email = ?", (body.username.lower().strip(),)).fetchone()
        if row is None or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(401, "Email or password is incorrect.")
        if row["status"] == "blocked":
            raise HTTPException(403, "This bidder account is not active. Please call the store.")
        set_cookie(response, BIDDER_COOKIE, create_session(conn, "bidder", row["id"]), "bidder")
        return {"name": row["name"], "status": row["status"]}

    @app.post("/api/bidders/logout")
    def bidder_logout(request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)) -> dict:
        end_session(conn, request.cookies.get(BIDDER_COOKIE))
        response.delete_cookie(BIDDER_COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/bidders/me")
    def bidder_me(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> dict:
        user = bidder_id(request, conn)
        if user is None:
            return {"signed_in": False}
        row = conn.execute("SELECT name, status FROM bidders WHERE id = ?", (user,)).fetchone()
        return {"signed_in": True, "name": row["name"], "status": row["status"]}

    @app.post("/api/auctions/{auction_id}/bids")
    def bid(auction_id: int, body: BidIn, request: Request, conn: sqlite3.Connection = Depends(get_db)) -> dict:
        user = bidder_id(request, conn)
        if user is None:
            raise HTTPException(401, "Please sign in to bid.")
        limit(request, "bid", 30, 60)
        try:
            auctions.place_bid(conn, auction_id, user, _cents(body.amount))
        except BidRejected as exc:
            raise HTTPException(409, str(exc)) from exc
        row = conn.execute("SELECT * FROM auctions WHERE id = ?", (auction_id,)).fetchone()
        return auctions.public_view(conn, row, user)

    # ------------------------------------------------------------- staff

    @app.post("/api/staff/login")
    def staff_login(body: Login, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)) -> dict:
        limit(request, "staff-login", 8, 900)
        row = conn.execute("SELECT * FROM staff WHERE username = ?", (body.username.strip(),)).fetchone()
        if row is None or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(401, "Username or password is incorrect.")
        set_cookie(response, STAFF_COOKIE, create_session(conn, "staff", row["id"]), "staff")
        return {"username": row["username"]}

    @app.post("/api/staff/logout")
    def staff_logout(request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)) -> dict:
        end_session(conn, request.cookies.get(STAFF_COOKIE))
        response.delete_cookie(STAFF_COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/staff/me")
    def staff_me(user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> dict:
        row = conn.execute("SELECT username FROM staff WHERE id = ?", (user,)).fetchone()
        return {"username": row["username"]}

    @app.get("/api/staff/summary")
    def summary(user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> dict:
        auctions.settle_due(conn)

        def count(sql: str) -> int:
            return conn.execute(sql).fetchone()[0]

        return {
            "new_inquiries": count("SELECT COUNT(*) FROM inquiries WHERE status = 'new'"),
            "open_orders": count("SELECT COUNT(*) FROM orders WHERE status IN ('requested', 'confirmed', 'ready')"),
            "live_items": count("SELECT COUNT(*) FROM items WHERE status = 'live'"),
            "live_auctions": count("SELECT COUNT(*) FROM auctions WHERE status = 'live'"),
            "pending_bidders": count("SELECT COUNT(*) FROM bidders WHERE status = 'pending'"),
            "aging_items": conn.execute(
                "SELECT COUNT(*) FROM items WHERE status = 'live' AND created_at <= ?",
                (iso(utcnow() - timedelta(days=85)),),
            ).fetchone()[0],
        }

    @app.get("/api/staff/items")
    def staff_items(user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
        rows = conn.execute("SELECT * FROM items ORDER BY created_at DESC, id DESC").fetchall()
        return [_staff_item_view(row) for row in rows]

    @app.post("/api/staff/items", status_code=201)
    async def create_item(
        name: str = Form(...),
        category: str = Form(...),
        price: float = Form(..., ge=0, le=1_000_000),
        condition: str = Form("Good", max_length=40),
        description: str = Form("", max_length=4000),
        badge: str = Form("", max_length=30),
        ship: bool = Form(False),
        publish: bool = Form(False),
        available_on: date | None = Form(None),
        photo: UploadFile | None = File(None),
        user: int = Depends(staff_id),
        conn: sqlite3.Connection = Depends(get_db),
    ) -> dict:
        if category not in CATEGORIES:
            raise HTTPException(400, f"Category must be one of {', '.join(CATEGORIES)}.")
        name = name.strip()
        if not 2 <= len(name) <= 120:
            raise HTTPException(400, "Item name must be 2-120 characters.")
        image = ""
        if photo is not None and photo.filename:
            try:
                image = save_photo(await photo.read(), media_dir, "items")
            except BadImage as exc:
                raise HTTPException(400, str(exc)) from exc
        stamp = iso(utcnow())
        with db.transaction(conn):
            sku = _next_sku(conn, category)
            cursor = conn.execute(
                "INSERT INTO items (sku, name, category, price_cents, condition, description, badge, image, ship, "
                "status, available_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (sku, name, category, _cents(price), condition, description.strip(), badge.strip(), image,
                 int(ship), "live" if publish else "draft", available_on.isoformat() if available_on else None,
                 stamp, stamp),
            )
        row = conn.execute("SELECT * FROM items WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _staff_item_view(row)

    @app.patch("/api/staff/items/{item_id}")
    def update_item(item_id: int, patch: ItemPatch, user: int = Depends(staff_id),
                    conn: sqlite3.Connection = Depends(get_db)) -> dict:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "No such item.")
        if row["status"] == "auction" and patch.status is not None:
            raise HTTPException(409, "This item is on the auction block; cancel the auction first.")
        changes: dict[str, object] = {}
        for field in ("name", "category", "condition", "description", "badge", "status"):
            value = getattr(patch, field)
            if value is not None:
                changes[field] = value.strip() if isinstance(value, str) else value
        if patch.price is not None:
            changes["price_cents"] = _cents(patch.price)
        if patch.ship is not None:
            changes["ship"] = int(patch.ship)
        if "available_on" in patch.model_fields_set:
            changes["available_on"] = patch.available_on.isoformat() if patch.available_on else None
        if changes:
            changes["updated_at"] = iso(utcnow())
            assignments = ", ".join(f"{column} = ?" for column in changes)
            conn.execute(f"UPDATE items SET {assignments} WHERE id = ?", (*changes.values(), item_id))
        return _staff_item_view(conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone())

    @app.post("/api/staff/items/{item_id}/photo")
    async def replace_photo(item_id: int, photo: UploadFile = File(...), user: int = Depends(staff_id),
                            conn: sqlite3.Connection = Depends(get_db)) -> dict:
        if conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone() is None:
            raise HTTPException(404, "No such item.")
        try:
            image = save_photo(await photo.read(), media_dir, "items")
        except BadImage as exc:
            raise HTTPException(400, str(exc)) from exc
        conn.execute("UPDATE items SET image = ?, updated_at = ? WHERE id = ?", (image, iso(utcnow()), item_id))
        return _staff_item_view(conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone())

    @app.get("/api/staff/inquiries")
    def staff_inquiries(user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
        rows = conn.execute("SELECT * FROM inquiries ORDER BY id DESC LIMIT 500").fetchall()
        return [{**dict(row), "photos": json.loads(row["photos"])} for row in rows]

    @app.patch("/api/staff/inquiries/{inquiry_id}")
    def update_inquiry(inquiry_id: int, body: StatusIn, user: int = Depends(staff_id),
                       conn: sqlite3.Connection = Depends(get_db)) -> dict:
        if body.status not in ("new", "reviewing", "invited", "declined", "done"):
            raise HTTPException(400, "Unknown status.")
        if conn.execute("UPDATE inquiries SET status = ? WHERE id = ?", (body.status, inquiry_id)).rowcount == 0:
            raise HTTPException(404, "No such inquiry.")
        return {"ok": True}

    @app.get("/api/staff/orders")
    def staff_orders(user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
        rows = conn.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 500").fetchall()
        result = []
        for row in rows:
            lines = conn.execute(
                "SELECT item_id, name, price_cents FROM order_lines WHERE order_id = ?", (row["id"],)
            ).fetchall()
            result.append({**dict(row), "lines": [dict(line) for line in lines]})
        return result

    @app.patch("/api/staff/orders/{order_id}")
    def update_order(order_id: int, body: StatusIn, user: int = Depends(staff_id),
                     conn: sqlite3.Connection = Depends(get_db)) -> dict:
        if body.status not in ("requested", "confirmed", "ready", "completed", "cancelled"):
            raise HTTPException(400, "Unknown status.")
        with db.transaction(conn):
            row = conn.execute("SELECT status FROM orders WHERE id = ?", (order_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "No such order.")
            if row["status"] in ("completed", "cancelled"):
                raise HTTPException(409, "This order is already closed.")
            conn.execute("UPDATE orders SET status = ? WHERE id = ?", (body.status, order_id))
            item_status = {"completed": "sold", "cancelled": "live"}.get(body.status)
            if item_status:
                conn.execute(
                    "UPDATE items SET status = ?, updated_at = ? WHERE status = 'reserved' AND id IN "
                    "(SELECT item_id FROM order_lines WHERE order_id = ?)",
                    (item_status, iso(utcnow()), order_id),
                )
        return {"ok": True}

    @app.get("/api/staff/auctions")
    def staff_auctions(user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
        auctions.settle_due(conn)
        rows = conn.execute("SELECT * FROM auctions ORDER BY id DESC LIMIT 200").fetchall()
        result = []
        for row in rows:
            view = auctions.public_view(conn, row)
            view["reserve_cents"] = row["reserve_cents"]
            view["item_id"] = row["item_id"]
            view["final_cents"] = row["final_cents"]
            view["settled_at"] = row["settled_at"]
            winner = None
            if row["winner_bidder_id"] is not None:
                found = conn.execute(
                    "SELECT name, email, phone FROM bidders WHERE id = ?", (row["winner_bidder_id"],)
                ).fetchone()
                winner = dict(found) if found else None
            view["winner"] = winner
            result.append(view)
        return result

    @app.post("/api/staff/auctions", status_code=201)
    def create_auction(body: AuctionIn, user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> dict:
        if body.reserve is not None and body.reserve < body.start:
            raise HTTPException(400, "The reserve cannot be below the starting bid.")
        now = utcnow()
        starts = now + timedelta(hours=body.starts_in_hours)
        ends = starts + timedelta(hours=body.hours)
        with db.transaction(conn):
            item = conn.execute("SELECT * FROM items WHERE id = ?", (body.item_id,)).fetchone()
            if item is None:
                raise HTTPException(404, "No such item.")
            if item["status"] not in ("live", "draft", "hidden"):
                raise HTTPException(409, f"This item is {item['status']} and cannot go to auction.")
            # Held items stay hidden until their release date — creating the
            # auction would expose them through /api/auctions immediately.
            if item["available_on"] is not None and item["available_on"] > date.today().isoformat():
                raise HTTPException(409, "This item is still in its holding period and cannot go to auction yet.")
            cursor = conn.execute(
                "INSERT INTO auctions (item_id, title, description, image, start_cents, reserve_cents, starts_at, "
                "ends_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (item["id"], item["name"], item["description"], item["image"], _cents(body.start),
                 _cents(body.reserve) if body.reserve is not None else None, iso(starts), iso(ends),
                 "live" if body.starts_in_hours == 0 else "scheduled", iso(now)),
            )
            conn.execute("UPDATE items SET status = 'auction', updated_at = ? WHERE id = ?", (iso(now), item["id"]))
        row = conn.execute("SELECT * FROM auctions WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return auctions.public_view(conn, row)

    @app.post("/api/staff/auctions/{auction_id}/settle")
    def settle_auction(auction_id: int, user: int = Depends(staff_id),
                       conn: sqlite3.Connection = Depends(get_db)) -> dict:
        """Complete an ended auction: the winner's item goes to sold (payment
        collected in person), an item with no winner returns to the store."""
        auctions.settle_due(conn)
        with db.transaction(conn):
            row = conn.execute("SELECT * FROM auctions WHERE id = ?", (auction_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "No such auction.")
            if row["status"] != "ended":
                raise HTTPException(409, "Only an ended auction can be settled.")
            if row["settled_at"] is not None:
                raise HTTPException(409, "This auction is already settled.")
            stamp = iso(utcnow())
            if row["item_id"] is not None:
                if row["winner_bidder_id"] is not None:
                    conn.execute(
                        "UPDATE items SET status = 'sold', updated_at = ? WHERE id = ? AND status = 'reserved'",
                        (stamp, row["item_id"]),
                    )
                else:
                    conn.execute(
                        "UPDATE items SET status = 'live', updated_at = ? WHERE id = ? AND status = 'reserved'",
                        (stamp, row["item_id"]),
                    )
            conn.execute("UPDATE auctions SET settled_at = ? WHERE id = ?", (stamp, auction_id))
        return {"ok": True}

    @app.post("/api/staff/auctions/{auction_id}/cancel")
    def cancel_auction(auction_id: int, user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> dict:
        with db.transaction(conn):
            row = conn.execute("SELECT * FROM auctions WHERE id = ?", (auction_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "No such auction.")
            if row["status"] not in ("scheduled", "live"):
                raise HTTPException(409, "Only an open or scheduled auction can be cancelled.")
            conn.execute("UPDATE auctions SET status = 'cancelled' WHERE id = ?", (auction_id,))
            if row["item_id"] is not None:
                conn.execute(
                    "UPDATE items SET status = 'live', updated_at = ? WHERE id = ? AND status = 'auction'",
                    (iso(utcnow()), row["item_id"]),
                )
        return {"ok": True}

    @app.get("/api/staff/bidders")
    def staff_bidders(user: int = Depends(staff_id), conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
        rows = conn.execute(
            "SELECT id, name, email, phone, status, created_at FROM bidders ORDER BY id DESC LIMIT 500"
        ).fetchall()
        return [dict(row) for row in rows]

    @app.patch("/api/staff/bidders/{bidder}")
    def update_bidder(bidder: int, body: StatusIn, user: int = Depends(staff_id),
                      conn: sqlite3.Connection = Depends(get_db)) -> dict:
        if body.status not in ("pending", "approved", "blocked"):
            raise HTTPException(400, "Unknown status.")
        if conn.execute("UPDATE bidders SET status = ? WHERE id = ?", (body.status, bidder)).rowcount == 0:
            raise HTTPException(404, "No such bidder.")
        if body.status == "blocked":
            conn.execute("DELETE FROM sessions WHERE kind = 'bidder' AND user_id = ?", (bidder,))
        return {"ok": True}

    # ------------------------------------------------------------- site

    # Only item photos are public. Inquiry photos belong to the sign-in-only
    # Command Center — random filenames are not an authorization boundary.
    (media_dir / "items").mkdir(parents=True, exist_ok=True)
    app.mount("/media/items", StaticFiles(directory=media_dir / "items"), name="item-media")

    @app.get("/media/inquiries/{name}")
    def inquiry_photo(name: str, user: int = Depends(staff_id)) -> FileResponse:
        # staff_id runs first: no session, no photo — even for made-up names.
        safe = Path(name).name
        path = media_dir / "inquiries" / safe
        if not path.is_file():
            raise HTTPException(404, "No such photo.")
        return FileResponse(path, media_type="image/jpeg")

    @app.get("/")
    def home() -> FileResponse:
        return FileResponse(site_root / "index.html")

    for name in SITE_FILES:
        def serve(name: str = name) -> FileResponse:
            return FileResponse(site_root / name)

        app.add_api_route(f"/{name}", serve, methods=["GET"], include_in_schema=False)

    return app

