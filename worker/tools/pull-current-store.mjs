// Copies the current store's stylesheet, hero photo, inventory list and item
// photos from the running store (GALORWORKER5) into ../public for deploying.
// Usage: node tools/pull-current-store.mjs [http://100.88.0.9:8080]
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = (process.argv[2] || "http://100.88.0.9:8080").replace(/\/$/, "");
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

async function get(path) {
  const r = await fetch(SOURCE + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
function put(rel, buf) { const f = join(PUBLIC, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, buf); }

for (const f of ["styles.css", "inventory/hero.jpg", "inventory/hero.webp", "inventory/inventory.json"]) {
  try { put(f, await get("/" + f)); console.log("copied", f); } catch (e) { console.log("skipped", f, e.message); }
}
const items = JSON.parse(readFileSync(join(PUBLIC, "inventory/inventory.json"), "utf8"));
let n = 0, missing = [];
for (const i of items) {
  const name = String(i.image).split("/").pop();
  const rel = `media/items/${name}`;
  if (existsSync(join(PUBLIC, rel)) && process.argv.includes("--keep")) continue;
  try { put(rel, await get(`/media/items/${name}`)); n++; }
  catch { try { put(rel, await get(`/inventory/img/${name}`)); n++; } catch { missing.push(name); } }
}
console.log(`item photos copied: ${n} of ${items.length}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`);
