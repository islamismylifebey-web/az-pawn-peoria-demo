"""Command-line tasks: create staff accounts, load the demo inventory, run the server.

    python -m azpawn.manage add-staff <username>
    python -m azpawn.manage seed-demo
    python -m azpawn.manage serve --port 8080
"""
from __future__ import annotations

import argparse
import getpass
import os
import re
import sys
from datetime import timedelta
from pathlib import Path

from . import db
from .auctions import iso, utcnow
from .security import hash_password

USERNAME = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")

# The presentation inventory, kept so a fresh install looks like the demo until
# real items are entered. Images are the same stock photos the demo used.
DEMO_ITEMS = [
    ("14K Gold Diamond Ring", "Jewelry", 649.00, "Excellent", "Featured", True, "photo-1605100804763-247f67b3557e",
     "Pre-owned 14K yellow-gold diamond ring, professionally cleaned."),
    ("Apple MacBook Pro 13-inch", "Electronics", 499.95, "Good", "Tested", True, "photo-1517336714731-489689fd1ca8",
     "Pre-owned MacBook Pro with charger."),
    ("DeWalt 20V MAX Drill Kit", "Tools", 89.95, "Good", "Shop Pick", True, "photo-1504148455328-c376907d081c",
     "Cordless drill kit with battery and charger."),
    ("Sony PlayStation 5 Console", "Gaming", 379.95, "Excellent", "Popular", True, "photo-1607853202273-797f1c22a38e",
     "PlayStation 5 with controller."),
    ("Fender-Style Electric Guitar", "Music", 269.00, "Good", "Local Find", False, "photo-1510915361894-db8b60106cb1",
     "Pre-owned electric guitar. Local pickup."),
    ("Vintage Mechanical Wristwatch", "Jewelry", 289.00, "Very Good", "Vintage", True, "photo-1524805444758-089113d48a6d",
     "Vintage-style mechanical watch."),
]
DEMO_AUCTIONS = [
    ("Vintage Railroad Pocket Watch", 150.00, None, 30, "photo-1524592094714-0f0654e20314"),
    ("Estate Jewelry Mixed Lot", 250.00, 400.00, 48, "photo-1515562141207-7a88fb7ce338"),
    ("Vintage Camera Collection", 200.00, None, 72, "photo-1452780212940-6f5c0d14d848"),
]


def _photo(photo_id: str) -> str:
    return f"https://images.unsplash.com/{photo_id}?auto=format&fit=crop&w=900&q=82"


def _db_path(args: argparse.Namespace) -> Path:
    return Path(args.data_dir).resolve() / "azpawn.sqlite3"


def add_staff(args: argparse.Namespace) -> int:
    if not USERNAME.match(args.username):
        print("Username: 3-40 letters, digits, dot, dash or underscore.", file=sys.stderr)
        return 2
    password = os.environ.get("AZ_STAFF_PASSWORD") or getpass.getpass("Password (12+ characters): ")
    if len(password) < 12:
        print("Use at least 12 characters.", file=sys.stderr)
        return 2
    path = _db_path(args)
    db.init(path)
    conn = db.connect(path)
    try:
        conn.execute(
            "INSERT INTO staff (username, password_hash, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash",
            (args.username, hash_password(password), iso(utcnow())),
        )
    finally:
        conn.close()
    print(f"Staff account {args.username} is ready.")
    return 0


def seed_demo(args: argparse.Namespace) -> int:
    path = _db_path(args)
    db.init(path)
    conn = db.connect(path)
    try:
        if conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]:
            print("Items already exist; demo inventory not loaded.")
            return 0
        now = utcnow()
        stamp = iso(now)
        prefixes = {"Jewelry": "JWL", "Electronics": "ELC", "Tools": "TOL", "Gaming": "GAM", "Music": "MUS"}
        for index, (name, category, price, condition, badge, ship, photo, description) in enumerate(DEMO_ITEMS):
            conn.execute(
                "INSERT INTO items (sku, name, category, price_cents, condition, description, badge, image, ship, "
                "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)",
                (f"AZ-{prefixes[category]}-{1001 + index}", name, category, round(price * 100), condition,
                 description, badge, _photo(photo), int(ship), stamp, stamp),
            )
        for title, start, reserve, hours, photo in DEMO_AUCTIONS:
            conn.execute(
                "INSERT INTO auctions (title, image, start_cents, reserve_cents, starts_at, ends_at, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 'live', ?)",
                (title, _photo(photo), round(start * 100), round(reserve * 100) if reserve else None, stamp,
                 iso(now + timedelta(hours=hours)), stamp),
            )
    finally:
        conn.close()
    print("Demo inventory and auctions loaded.")
    return 0


def serve(args: argparse.Namespace) -> int:
    import uvicorn

    os.environ.setdefault("AZ_DATA_DIR", args.data_dir)
    uvicorn.run("azpawn.app:create_app", factory=True, host=args.host, port=args.port, proxy_headers=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default=os.environ.get("AZ_DATA_DIR", "data"))
    commands = parser.add_subparsers(dest="command", required=True)
    staff = commands.add_parser("add-staff", help="create a staff login (or reset its password)")
    staff.add_argument("username")
    commands.add_parser("seed-demo", help="load the presentation inventory into an empty store")
    run = commands.add_parser("serve", help="run the web server")
    run.add_argument("--host", default="127.0.0.1")
    run.add_argument("--port", type=int, default=8080)
    args = parser.parse_args(argv)
    return {"add-staff": add_staff, "seed-demo": seed_demo, "serve": serve}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
