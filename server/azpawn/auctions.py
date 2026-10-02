"""The A-Z Auction Block: bids are decided here, never in the browser.

Rules:
- the first bid must be at least the starting price; every later bid must
  beat the current high bid by at least the increment for that price level;
- a bid in the final EXTENSION window pushes the close out so nobody can win
  by sniping in the last second;
- only approved bidders may bid, and a bidder cannot outbid themself;
- when the clock runs out the highest bid wins, provided it meets the
  reserve (if any); otherwise the item goes back to the shop.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .db import transaction

# Bids in the last two minutes extend the auction to two minutes from the bid.
EXTENSION = timedelta(minutes=2)

# (up to this current price in cents, minimum raise in cents)
_INCREMENTS = (
    (100_00, 5_00),
    (500_00, 10_00),
    (1_000_00, 25_00),
    (5_000_00, 50_00),
)
_TOP_INCREMENT = 100_00


class BidRejected(ValueError):
    """A bid that the rules do not allow; the message is safe to show the bidder."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse(text: str) -> datetime:
    moment = datetime.fromisoformat(text)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def increment_for(current_cents: int) -> int:
    for ceiling, step in _INCREMENTS:
        if current_cents < ceiling:
            return step
    return _TOP_INCREMENT


@dataclass(frozen=True)
class Standing:
    high_cents: int | None
    high_bidder_id: int | None
    bid_count: int
    minimum_next_cents: int


def standing(conn: sqlite3.Connection, auction: sqlite3.Row) -> Standing:
    top = conn.execute(
        "SELECT amount_cents, bidder_id FROM bids WHERE auction_id = ? ORDER BY amount_cents DESC, id ASC LIMIT 1",
        (auction["id"],),
    ).fetchone()
    count = conn.execute("SELECT COUNT(*) FROM bids WHERE auction_id = ?", (auction["id"],)).fetchone()[0]
    if top is None:
        return Standing(None, None, 0, auction["start_cents"])
    high = top["amount_cents"]
    return Standing(high, top["bidder_id"], count, high + increment_for(high))


def settle_due(conn: sqlite3.Connection, now: datetime | None = None) -> None:
    """Open auctions whose start has come and close those whose time is up."""
    now = now or utcnow()
    stamp = iso(now)
    with transaction(conn):
        conn.execute(
            "UPDATE auctions SET status = 'live' WHERE status = 'scheduled' AND starts_at <= ? AND ends_at > ?",
            (stamp, stamp),
        )
        due = conn.execute(
            "SELECT * FROM auctions WHERE status IN ('scheduled', 'live') AND ends_at <= ?", (stamp,)
        ).fetchall()
        for auction in due:
            state = standing(conn, auction)
            reserve = auction["reserve_cents"]
            met = state.high_cents is not None and (reserve is None or state.high_cents >= reserve)
            conn.execute(
                "UPDATE auctions SET status = 'ended', winner_bidder_id = ?, final_cents = ?, reserve_met = ? WHERE id = ?",
                (state.high_bidder_id if met else None, state.high_cents, int(met), auction["id"]),
            )
            if auction["item_id"] is not None:
                # A winner holds the item for payment; otherwise it returns to the shop floor.
                conn.execute(
                    "UPDATE items SET status = ?, updated_at = ? WHERE id = ? AND status = 'auction'",
                    ("reserved" if met else "live", stamp, auction["item_id"]),
                )


def place_bid(
    conn: sqlite3.Connection,
    auction_id: int,
    bidder_id: int,
    amount_cents: int,
    now: datetime | None = None,
) -> Standing:
    now = now or utcnow()
    settle_due(conn, now)
    with transaction(conn):
        bidder = conn.execute("SELECT status FROM bidders WHERE id = ?", (bidder_id,)).fetchone()
        if bidder is None or bidder["status"] != "approved":
            raise BidRejected("Your bidder account is waiting for approval by the shop.")
        auction = conn.execute("SELECT * FROM auctions WHERE id = ?", (auction_id,)).fetchone()
        if auction is None:
            raise BidRejected("That auction does not exist.")
        if auction["status"] != "live":
            raise BidRejected("This auction is not open for bidding.")
        ends = parse(auction["ends_at"])
        if now >= ends:
            raise BidRejected("This auction has closed.")
        state = standing(conn, auction)
        if state.high_bidder_id == bidder_id:
            raise BidRejected("You already have the high bid.")
        if amount_cents < state.minimum_next_cents:
            raise BidRejected(f"The minimum bid is ${state.minimum_next_cents / 100:,.2f}.")
        conn.execute(
            "INSERT INTO bids (auction_id, bidder_id, amount_cents, created_at) VALUES (?, ?, ?, ?)",
            (auction_id, bidder_id, amount_cents, iso(now)),
        )
        if ends - now < EXTENSION:
            conn.execute("UPDATE auctions SET ends_at = ? WHERE id = ?", (iso(now + EXTENSION), auction_id))
        return standing(conn, auction)


def public_view(conn: sqlite3.Connection, auction: sqlite3.Row, viewer_id: int | None = None) -> dict:
    """What anyone may see: never a bidder's name, email or phone."""
    state = standing(conn, auction)
    reserve = auction["reserve_cents"]
    view = {
        "id": auction["id"],
        "title": auction["title"],
        "description": auction["description"],
        "image": auction["image"],
        "status": auction["status"],
        "starts_at": auction["starts_at"],
        "ends_at": auction["ends_at"],
        "start_cents": auction["start_cents"],
        "high_cents": state.high_cents,
        "bid_count": state.bid_count,
        "minimum_next_cents": state.minimum_next_cents,
        "has_reserve": reserve is not None,
        "reserve_met": reserve is None or (state.high_cents is not None and state.high_cents >= reserve),
    }
    if viewer_id is not None:
        view["you_are_high"] = state.high_bidder_id == viewer_id
        if auction["status"] == "ended":
            view["you_won"] = auction["winner_bidder_id"] == viewer_id
    return view
