from datetime import datetime, timedelta, timezone

import pytest

from azpawn import auctions, db
from azpawn.auctions import BidRejected, increment_for, iso

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def conn(tmp_path):
    path = tmp_path / "t.sqlite3"
    db.init(path)
    conn = db.connect(path)
    yield conn
    conn.close()


def bidder(conn, name, status="approved"):
    return conn.execute(
        "INSERT INTO bidders (name, email, phone, password_hash, status, created_at) VALUES (?, ?, '3095550100', 'x', ?, ?)",
        (name, f"{name}@example.com", status, iso(T0)),
    ).lastrowid


def item(conn, status="auction"):
    return conn.execute(
        "INSERT INTO items (sku, name, category, price_cents, status, created_at, updated_at) "
        "VALUES (?, 'Watch', 'Jewelry', 10000, ?, ?, ?)",
        (f"AZ-T-{conn.execute('SELECT COUNT(*) FROM items').fetchone()[0]}", status, iso(T0), iso(T0)),
    ).lastrowid


def auction(conn, start=100_00, reserve=None, hours=24, item_id=None):
    return conn.execute(
        "INSERT INTO auctions (item_id, title, start_cents, reserve_cents, starts_at, ends_at, status, created_at) "
        "VALUES (?, 'Watch', ?, ?, ?, ?, 'live', ?)",
        (item_id, start, reserve, iso(T0), iso(T0 + timedelta(hours=hours)), iso(T0)),
    ).lastrowid


def row(conn, table, key):
    return conn.execute(f"SELECT * FROM {table} WHERE id = ?", (key,)).fetchone()


def test_increments_rise_with_price():
    assert increment_for(50_00) == 5_00
    assert increment_for(250_00) == 10_00
    assert increment_for(750_00) == 25_00
    assert increment_for(2_000_00) == 50_00
    assert increment_for(9_000_00) == 100_00


def test_first_bid_must_meet_the_start_and_later_bids_the_increment(conn):
    a, b, lot = bidder(conn, "a"), bidder(conn, "b"), auction(conn, start=100_00)
    with pytest.raises(BidRejected, match=r"\$100.00"):
        auctions.place_bid(conn, lot, a, 99_00, T0)
    state = auctions.place_bid(conn, lot, a, 100_00, T0)
    assert (state.high_cents, state.high_bidder_id, state.minimum_next_cents) == (100_00, a, 110_00)
    with pytest.raises(BidRejected, match=r"\$110.00"):
        auctions.place_bid(conn, lot, b, 105_00, T0)
    assert auctions.place_bid(conn, lot, b, 110_00, T0).high_bidder_id == b


def test_only_approved_bidders_bid_and_nobody_outbids_themself(conn):
    lot = auction(conn)
    pending = bidder(conn, "p", status="pending")
    with pytest.raises(BidRejected, match="approval"):
        auctions.place_bid(conn, lot, pending, 100_00, T0)
    a = bidder(conn, "a")
    auctions.place_bid(conn, lot, a, 100_00, T0)
    with pytest.raises(BidRejected, match="already have the high bid"):
        auctions.place_bid(conn, lot, a, 200_00, T0)


def test_a_late_bid_extends_the_close(conn):
    a, b = bidder(conn, "a"), bidder(conn, "b")
    lot = auction(conn, hours=1)
    auctions.place_bid(conn, lot, a, 100_00, T0)
    assert row(conn, "auctions", lot)["ends_at"] == iso(T0 + timedelta(hours=1))
    late = T0 + timedelta(minutes=59, seconds=30)
    auctions.place_bid(conn, lot, b, 110_00, late)
    assert row(conn, "auctions", lot)["ends_at"] == iso(late + auctions.EXTENSION)
    # The original close has passed but the auction is still open.
    auctions.place_bid(conn, lot, a, 120_00, T0 + timedelta(minutes=61))


def test_closing_picks_the_winner_and_holds_the_item(conn):
    a, b = bidder(conn, "a"), bidder(conn, "b")
    goods = item(conn)
    lot = auction(conn, item_id=goods)
    auctions.place_bid(conn, lot, a, 100_00, T0)
    auctions.place_bid(conn, lot, b, 150_00, T0)
    auctions.settle_due(conn, T0 + timedelta(hours=25))
    closed = row(conn, "auctions", lot)
    assert (closed["status"], closed["winner_bidder_id"], closed["final_cents"], closed["reserve_met"]) == (
        "ended", b, 150_00, 1)
    assert row(conn, "items", goods)["status"] == "reserved"
    with pytest.raises(BidRejected, match="not open"):
        auctions.place_bid(conn, lot, a, 500_00, T0 + timedelta(hours=26))


def test_an_unmet_reserve_returns_the_item_to_the_shop(conn):
    a = bidder(conn, "a")
    goods = item(conn)
    lot = auction(conn, start=100_00, reserve=300_00, item_id=goods)
    auctions.place_bid(conn, lot, a, 120_00, T0)
    view = auctions.public_view(conn, row(conn, "auctions", lot))
    assert view["has_reserve"] and not view["reserve_met"]
    assert "reserve_cents" not in view
    auctions.settle_due(conn, T0 + timedelta(hours=25))
    closed = row(conn, "auctions", lot)
    assert closed["winner_bidder_id"] is None and closed["reserve_met"] == 0
    assert row(conn, "items", goods)["status"] == "live"


def test_an_auction_with_no_bids_ends_without_a_winner(conn):
    goods = item(conn)
    lot = auction(conn, item_id=goods)
    auctions.settle_due(conn, T0 + timedelta(hours=25))
    assert row(conn, "auctions", lot)["winner_bidder_id"] is None
    assert row(conn, "items", goods)["status"] == "live"


def test_the_public_view_never_names_bidders(conn):
    a = bidder(conn, "alice")
    lot = auction(conn)
    auctions.place_bid(conn, lot, a, 100_00, T0)
    view = auctions.public_view(conn, row(conn, "auctions", lot), viewer_id=a)
    assert view["you_are_high"] is True
    assert "alice" not in str(view)
