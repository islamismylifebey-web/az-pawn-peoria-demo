// Builds seed.sql (the store's items) from an inventory.json file.
// Usage: node tools/build-seed.mjs ../public/inventory/inventory.json > seed.sql
// Prices are copied exactly as they are in the file (0 shows "Ask for price").
// Existing items are kept; only items not yet in the database are added.
import { readFileSync } from "node:fs";

const items = JSON.parse(readFileSync(process.argv[2], "utf8"));
const q = v => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString().slice(0, 19) + "+00:00";
const lines = [];
for (const i of items) {
  const image = "/media/items/" + String(i.image).split("/").pop();
  const cents = Number.isInteger(i.price_cents) ? i.price_cents : Math.round((i.price || 0) * 100);
  const row = [i.id, i.sku, i.name, i.category, cents, i.condition || "Pre-owned", i.description || "", i.badge || "", image, i.ship ? 1 : 0, "live", null, now, now];
  lines.push(`INSERT OR IGNORE INTO items (id, sku, name, category, price_cents, condition, description, badge, image, ship, status, available_on, created_at, updated_at) VALUES (${row.map(q).join(", ")});`);
}
process.stdout.write(lines.join("\n") + "\n");
