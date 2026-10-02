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
