-- Employees and printed sign-in slips for the Command Center.
-- Run once: npx wrangler d1 execute az-jewelry-store --remote --file migrations/0003_employee_slips.sql
ALTER TABLE staff ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE staff ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE staff ADD COLUMN can_price INTEGER NOT NULL DEFAULT 1;
ALTER TABLE staff ADD COLUMN revoked_at TEXT;
CREATE TABLE IF NOT EXISTS staff_links (
    token_hash TEXT PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff (id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE INDEX IF NOT EXISTS staff_links_staff ON staff_links (staff_id);
