-- Adds Pledge's dynamic price and Gary's price lock to an existing store database.
-- Run once: npx wrangler d1 execute az-jewelry-store --remote --file migrations/0002_dynamic_price.sql
ALTER TABLE items ADD COLUMN price_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN dynamic_cents INTEGER;
ALTER TABLE items ADD COLUMN dynamic_at TEXT;
ALTER TABLE items ADD COLUMN dynamic_note TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN pledge_item TEXT;
CREATE INDEX IF NOT EXISTS items_pledge_item ON items (pledge_item);
CREATE TABLE IF NOT EXISTS feed_log (
    digest TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    items INTEGER NOT NULL,
    matched INTEGER NOT NULL
);
