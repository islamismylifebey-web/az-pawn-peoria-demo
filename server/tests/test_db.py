import sqlite3

from fastapi.testclient import TestClient

from azpawn import db
from azpawn.app import create_app


# Frozen auctions DDL from before PR #2 added settled_at. Do not derive this
# from db.SCHEMA: the fixture must continue to represent an existing database.
PRE_SETTLEMENT_AUCTIONS_SCHEMA = """
CREATE TABLE auctions (
    id INTEGER PRIMARY KEY,
    item_id INTEGER REFERENCES items(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    start_cents INTEGER NOT NULL CHECK (start_cents > 0),
    reserve_cents INTEGER,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
    winner_bidder_id INTEGER REFERENCES bidders(id),
    final_cents INTEGER,
    reserve_met INTEGER,
    created_at TEXT NOT NULL
);
"""


def test_startup_upgrades_legacy_auctions_without_losing_data(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    path = data_dir / "azpawn.sqlite3"
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.executescript(PRE_SETTLEMENT_AUCTIONS_SCHEMA)
        conn.execute(
            "INSERT INTO auctions (id, title, description, start_cents, reserve_cents, "
            "starts_at, ends_at, created_at) VALUES (42, 'Legacy Watch', 'Keep this lot', "
            "10000, 15000, '2999-01-01T12:00:00+00:00', '2999-01-02T12:00:00+00:00', "
            "'2026-10-01T12:00:00+00:00')"
        )
        original = dict(conn.execute("SELECT * FROM auctions WHERE id = 42").fetchone())
        assert "settled_at" not in original

    # create_app invokes db.init on the pre-change file, just as production does.
    app = create_app(data_dir=data_dir, secure_cookies=False)
    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"ok": True, "mode": "live"}
        response = client.get("/api/auctions")
        assert response.status_code == 200
        assert response.json()[0]["title"] == "Legacy Watch"

    conn = db.connect(path)
    try:
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(auctions)")]
        assert columns.count("settled_at") == 1
        upgraded = dict(conn.execute("SELECT * FROM auctions WHERE id = 42").fetchone())
        assert upgraded == {**original, "settled_at": None}
        conn.execute("UPDATE auctions SET settled_at = '2026-10-04T12:00:00+00:00' WHERE id = 42")
    finally:
        conn.close()

    # Re-running initialization must neither duplicate the column nor reset it.
    db.init(path)
    conn = db.connect(path)
    try:
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(auctions)")]
        assert columns.count("settled_at") == 1
        assert dict(conn.execute("SELECT * FROM auctions WHERE id = 42").fetchone()) == {
            **original, "settled_at": "2026-10-04T12:00:00+00:00"
        }
    finally:
        conn.close()
