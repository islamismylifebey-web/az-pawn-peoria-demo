-- A-Z Jewelry & Swap store database (Cloudflare D1).
-- Same tables as the store's original SQLite file, plus two helpers:
-- _guard makes a batch roll back when a condition fails, throttle limits abuse.
-- Copyright GALOR WebWorks. Built for A-Z Jewelry & Swap Inc., Peoria, Illinois.

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    price_locked INTEGER NOT NULL DEFAULT 0,      -- 1 = Gary's price, never replaced by the dynamic one
    dynamic_cents INTEGER,                        -- Pledge's dynamic price (market, demand, season)
    dynamic_at TEXT,
    dynamic_note TEXT NOT NULL DEFAULT '',
    pledge_item TEXT,                             -- Pledge item number, when the item is linked
    condition TEXT NOT NULL DEFAULT 'Good',
    description TEXT NOT NULL DEFAULT '',
    badge TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    ship INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'live', 'auction', 'reserved', 'sold', 'hidden')),
    available_on TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bidders (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('staff', 'bidder')),
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auctions (
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
    settled_at TEXT,
    estimate_cents INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY,
    auction_id INTEGER NOT NULL REFERENCES auctions(id),
    bidder_id INTEGER NOT NULL REFERENCES bidders(id),
    amount_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bids_by_auction ON bids (auction_id, amount_cents DESC);

CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('sell', 'pawn', 'video', 'custom', 'wanted')),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    item TEXT NOT NULL DEFAULT '',
    condition TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    photos TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'reviewing', 'invited', 'declined', 'done')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    fulfillment TEXT NOT NULL CHECK (fulfillment IN ('pickup', 'ship')),
    notes TEXT NOT NULL DEFAULT '',
    total_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'confirmed', 'ready', 'completed', 'cancelled')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_lines (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY,
    auction_id INTEGER NOT NULL REFERENCES auctions(id),
    bidder_id INTEGER NOT NULL REFERENCES bidders(id),
    session_id TEXT NOT NULL UNIQUE,
    payment_intent TEXT,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'released', 'captured')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auction_payments (
    id INTEGER PRIMARY KEY,
    auction_id INTEGER NOT NULL REFERENCES auctions(id),
    bidder_id INTEGER NOT NULL REFERENCES bidders(id),
    session_id TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    created_at TEXT NOT NULL
);

-- A row is inserted (and deleted) inside a batch; inserting 0 fails the
-- CHECK and rolls the whole batch back, so a stale read can never win.
CREATE TABLE IF NOT EXISTS _guard (ok INTEGER NOT NULL CHECK (ok = 1));

CREATE TABLE IF NOT EXISTS throttle (
    key TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS throttle_by_key ON throttle (key, at);

-- Pledge price feed: one row per accepted push, so a replayed push is ignored.
CREATE TABLE IF NOT EXISTS feed_log (
    digest TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    items INTEGER NOT NULL,
    matched INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_pledge_item ON items (pledge_item);
