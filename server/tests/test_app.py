import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from azpawn import db
from azpawn.app import create_app
from azpawn.auctions import iso, utcnow
from azpawn.security import hash_password

H = {"x-az-request": "1"}


@pytest.fixture
def client(tmp_path):
    app = create_app(data_dir=tmp_path / "data", secure_cookies=False)
    conn = db.connect(app.state.db_path)
    conn.execute(
        "INSERT INTO staff (username, password_hash, created_at) VALUES ('owner', ?, ?)",
        (hash_password("correct horse battery"), iso(utcnow())),
    )
    conn.close()
    return TestClient(app)


def staff(client):
    response = client.post("/api/staff/login", json={"username": "owner", "password": "correct horse battery"}, headers=H)
    assert response.status_code == 200
    return client


def photo_bytes(gps=True):
    image = Image.new("RGB", (2400, 1200), "gold")
    buffer = io.BytesIO()
    exif = Image.Exif()
    if gps:
        exif[0x8825] = {2: (40.0, 41.0, 42.0)}  # GPSInfo
    image.save(buffer, "JPEG", exif=exif)
    return buffer.getvalue()


def add_item(client, name="Gold Chain", price="250", publish="true", **extra):
    data = {"name": name, "category": "Jewelry", "price": price, "publish": publish, "ship": "true", **extra}
    response = client.post("/api/staff/items", data=data, files={"photo": ("p.jpg", photo_bytes(), "image/jpeg")}, headers=H)
    assert response.status_code == 201, response.text
    return response.json()


def test_changes_need_the_request_header(client):
    response = client.post("/api/staff/login", json={"username": "owner", "password": "correct horse battery"})
    assert response.status_code == 403


def test_staff_endpoints_need_a_login(client):
    assert client.get("/api/staff/items").status_code == 401
    assert client.post("/api/staff/login", json={"username": "owner", "password": "wrong"}, headers=H).status_code == 401
    staff(client)
    assert client.get("/api/staff/items").status_code == 200
    client.post("/api/staff/logout", headers=H)
    assert client.get("/api/staff/items").status_code == 401


def test_the_store_shows_only_published_items_past_their_hold(client):
    staff(client)
    add_item(client, "Shown")
    add_item(client, "Draft", publish="false")
    add_item(client, "Held", available_on="2999-01-01")
    names = [item["name"] for item in client.get("/api/items").json()]
    assert names == ["Shown"]


def test_item_photos_are_resized_and_lose_their_location(client):
    staff(client)
    created = add_item(client)
    image_path = created["image"]
    assert image_path.startswith("/media/items/")
    stored = client.get(image_path)
    assert stored.status_code == 200
    with Image.open(io.BytesIO(stored.content)) as image:
        assert max(image.size) == 1600
        assert 0x8825 not in image.getexif()


def test_an_inquiry_reaches_the_command_center(client):
    response = client.post(
        "/api/inquiries",
        data={"kind": "sell", "name": "James Carter", "phone": "3095550148", "item": "Riding mower", "notes": "<b>runs</b>"},
        files=[("photos", ("m.jpg", photo_bytes(), "image/jpeg"))],
        headers=H,
    )
    assert response.status_code == 201
    bad = client.post(
        "/api/inquiries",
        data={"kind": "sell", "name": "X Y", "phone": "3095550148"},
        files=[("photos", ("m.jpg", b"not an image", "image/jpeg"))],
        headers=H,
    )
    assert bad.status_code == 400
    staff(client)
    [inquiry] = client.get("/api/staff/inquiries").json()
    assert inquiry["item"] == "Riding mower" and len(inquiry["photos"]) == 1 and inquiry["status"] == "new"
    assert client.patch(f"/api/staff/inquiries/{inquiry['id']}", json={"status": "invited"}, headers=H).status_code == 200


def test_an_order_reserves_items_and_closing_it_settles_them(client):
    staff(client)
    ring, drill = add_item(client, "Ring"), add_item(client, "Drill")
    order = {"name": "Tanya R.", "phone": "3095550199", "item_ids": [ring["id"], drill["id"]]}
    response = client.post("/api/orders", json=order, headers=H)
    assert response.status_code == 201 and response.json()["total_cents"] == 50000
    assert client.get("/api/items").json() == []
    assert client.post("/api/orders", json=order, headers=H).status_code == 409
    order_id = response.json()["order_id"]
    assert client.patch(f"/api/staff/orders/{order_id}", json={"status": "cancelled"}, headers=H).status_code == 200
    assert {item["name"] for item in client.get("/api/items").json()} == {"Ring", "Drill"}
    assert client.patch(f"/api/staff/orders/{order_id}", json={"status": "completed"}, headers=H).status_code == 409


def test_the_full_auction_flow(client, tmp_path):
    staff(client)
    watch = add_item(client, "Railroad Pocket Watch", price="300")
    created = client.post("/api/staff/auctions", json={"item_id": watch["id"], "start": 150, "hours": 24}, headers=H)
    assert created.status_code == 201
    auction_id = created.json()["id"]
    # On the block, the item leaves the store.
    assert client.get("/api/items").json() == []

    bidder = TestClient(client.app)
    signup = {"name": "Derrick S.", "email": "derrick@example.com", "phone": "3095550111", "password": "longpassword"}
    assert bidder.post("/api/bidders/register", json=signup, headers=H).status_code == 201
    assert bidder.post("/api/bidders/login", json={"username": signup["email"], "password": "longpassword"}, headers=H).status_code == 200
    blocked = bidder.post(f"/api/auctions/{auction_id}/bids", json={"amount": 150}, headers=H)
    assert blocked.status_code == 409 and "approval" in blocked.json()["detail"]

    [pending] = client.get("/api/staff/bidders").json()
    client.patch(f"/api/staff/bidders/{pending['id']}", json={"status": "approved"}, headers=H)
    placed = bidder.post(f"/api/auctions/{auction_id}/bids", json={"amount": 150}, headers=H)
    assert placed.status_code == 200 and placed.json()["you_are_high"] is True

    public = TestClient(client.app).get("/api/auctions").json()
    assert public[0]["high_cents"] == 15000 and "derrick" not in json.dumps(public).lower()

    # Fast-forward to the close: staff see the winner's contact details.
    conn = db.connect(client.app.state.db_path)
    conn.execute("UPDATE auctions SET ends_at = ? WHERE id = ?", (iso(utcnow()), auction_id))
    conn.close()
    [closed] = client.get("/api/staff/auctions").json()
    assert closed["status"] == "ended" and closed["winner"]["email"] == "derrick@example.com"


def test_only_the_storefront_files_are_served(client):
    assert client.get("/").status_code == 200
    assert client.get("/owner.js").status_code == 200
    for path in ("/server/azpawn/app.py", "/.git/config", "/README.md", "/data/azpawn.sqlite3", "/media/../azpawn.sqlite3"):
        assert client.get(path).status_code == 404, path


# ---- security regression tests (Copilot review of PR #1, fixed Oct 2026) ----

def test_orders_cannot_bypass_the_holding_period(client):
    staff(client)
    held = add_item(client, "Held Ring", available_on="2999-01-01")
    order = {"name": "Tanya R.", "phone": "3095550199", "item_ids": [held["id"]]}
    assert client.post("/api/orders", json=order, headers=H).status_code == 409


def test_auctions_cannot_take_held_items(client):
    staff(client)
    held = add_item(client, "Held Watch", available_on="2999-01-01")
    response = client.post(
        "/api/staff/auctions", json={"item_id": held["id"], "start": 50, "hours": 24}, headers=H
    )
    assert response.status_code == 409


def test_inquiry_photos_need_a_staff_session(client):
    response = client.post(
        "/api/inquiries",
        data={"kind": "sell", "name": "James Carter", "phone": "3095550148"},
        files=[("photos", ("m.jpg", photo_bytes(), "image/jpeg"))],
        headers=H,
    )
    assert response.status_code == 201
    staff(client)
    [inquiry] = client.get("/api/staff/inquiries").json()
    [photo_path] = inquiry["photos"]
    assert photo_path.startswith("/media/inquiries/")
    stranger = TestClient(client.app)
    assert stranger.get(photo_path).status_code == 401
    # Item photos stay public; the protected route answers 401 before 404.
    item = add_item(client, "Public Ring")
    assert stranger.get(item["image"]).status_code == 200
    assert stranger.get("/media/inquiries/does-not-exist.jpg").status_code == 401


def test_blank_names_are_rejected_not_stored_empty(client):
    for payload in ({"name": "  ", "phone": "3095550148"}, {"name": "James Carter", "phone": "       "}):
        response = client.post("/api/inquiries", data={"kind": "sell", **payload}, headers=H)
        assert response.status_code == 400, payload
    staff(client)
    response = client.post(
        "/api/staff/items", data={"name": "   ", "category": "Jewelry", "price": "10"}, headers=H
    )
    assert response.status_code == 400
    bad_order = {"name": "  ", "phone": "3095550199", "item_ids": [1]}
    assert client.post("/api/orders", json=bad_order, headers=H).status_code == 422


def test_failed_photo_batch_leaves_no_orphans(client, tmp_path):
    response = client.post(
        "/api/inquiries",
        data={"kind": "sell", "name": "James Carter", "phone": "3095550148"},
        files=[
            ("photos", ("a.jpg", photo_bytes(), "image/jpeg")),
            ("photos", ("b.jpg", b"not an image", "image/jpeg")),
        ],
        headers=H,
    )
    assert response.status_code == 400
    inquiries_dir = tmp_path / "data" / "media" / "inquiries"
    left = list(inquiries_dir.iterdir()) if inquiries_dir.exists() else []
    assert left == []


def test_item_patch_validates_names_after_stripping(client):
    staff(client)
    item = add_item(client)
    path = f"/api/staff/items/{item['id']}"
    for name in ("  ", "\t\n", " a "):
        response = client.patch(path, json={"name": name, "price": 1}, headers=H)
        assert response.status_code == 422, response.text
        [stored] = client.get("/api/staff/items").json()
        assert stored["name"] == item["name"]
        assert stored["price_cents"] == item["price_cents"]
    response = client.patch(path, json={"name": "  Silver Chain  "}, headers=H)
    assert response.status_code == 200
    assert response.json()["name"] == "Silver Chain"
    # A name can still be omitted or null when updating another field.
    for patch in ({"price": 100}, {"name": None, "price": 110}):
        response = client.patch(path, json=patch, headers=H)
        assert response.status_code == 200
        assert response.json()["name"] == "Silver Chain"


@pytest.mark.parametrize("endpoint", ["/api/inquiries", "/api/staff/items"])
def test_images_over_25mp_are_rejected_before_decoding(client, endpoint, monkeypatch):
    from azpawn import images

    # Valid 25.005MP PNG: above our cap, below Pillow's warning threshold.
    size = (5001, 5000)
    assert 25_000_000 < size[0] * size[1] < Image.MAX_IMAGE_PIXELS
    buffer = io.BytesIO()
    with Image.new("1", size) as image:
        image.save(buffer, "PNG")
    png = buffer.getvalue()
    assert len(png) < 10_000
    with Image.open(io.BytesIO(png)) as image:
        image.load()  # Prove this is a readable photo, not just a fake header.
        assert image.size == size

    def unexpected_decode(*args, **kwargs):
        pytest.fail("Oversized image reached EXIF transposition / decoding")

    monkeypatch.setattr(images.ImageOps, "exif_transpose", unexpected_decode)
    if endpoint == "/api/staff/items":
        staff(client)
        data = {"name": "Large Photo", "category": "Jewelry", "price": "10"}
        field = "photo"
    else:
        data = {"kind": "sell", "name": "James Carter", "phone": "3095550148"}
        field = "photos"
    response = client.post(
        endpoint,
        data=data,
        files=[(field, ("big.png", png, "image/png"))],
        headers=H,
    )
    assert response.status_code == 400
    assert response.json() == {
        "detail": "That photo is too large (5001x5000). Please use a smaller image."
    }


def test_ended_auctions_settle_to_sold_or_back_to_live(client):
    staff(client)
    watch = add_item(client, "Settle Watch", price="300")
    created = client.post(
        "/api/staff/auctions", json={"item_id": watch["id"], "start": 150, "hours": 1}, headers=H
    )
    auction_id = created.json()["id"]
    conn = db.connect(client.app.state.db_path)
    conn.execute("UPDATE auctions SET ends_at = ? WHERE id = ?", (iso(utcnow()), auction_id))
    conn.close()
    [closed] = client.get("/api/staff/auctions").json()
    assert closed["status"] == "ended" and closed["winner"] is None
    assert client.post(f"/api/staff/auctions/{auction_id}/settle", headers=H).status_code == 200
    statuses = {i["name"]: i["status"] for i in client.get("/api/staff/items").json()}
    assert statuses["Settle Watch"] == "live"
    # Settling twice is a clean 409, not a double state change.
    assert client.post(f"/api/staff/auctions/{auction_id}/settle", headers=H).status_code == 409
