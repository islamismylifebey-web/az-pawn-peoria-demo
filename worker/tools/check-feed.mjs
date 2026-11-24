// Live check of the Pledge price feed: one signed push for a SKU that does not exist
// (changes no item), one unsigned push (must be refused), and the public item list.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const BASE = process.argv[2] || "https://azpawn.galorweb.works";
const secret = readFileSync(new URL("../.pledge-feed-secret", import.meta.url), "utf8").trim();
const body = JSON.stringify({ v: 1, at: new Date().toISOString(), items: [{ sku: "CHECK-NO-SUCH-ITEM", dynamic_cents: 100 }] });
const ts = String(Math.floor(Date.now() / 1000));
const sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
let r = await fetch(BASE + "/api/pledge/feed", { method: "POST", body, headers: { "content-type": "application/json", "x-pledge-timestamp": ts, "x-pledge-signature": sig } });
console.log("signed push:", r.status, await r.text());
r = await fetch(BASE + "/api/pledge/feed", { method: "POST", body, headers: { "content-type": "application/json" } });
console.log("unsigned push:", r.status, await r.text());
const items = await (await fetch(BASE + "/api/items")).json();
const by = items.reduce((m, i) => (m[i.price_source] = (m[i.price_source] || 0) + 1, m), {});
console.log("live items:", items.length, JSON.stringify(by), "sample:", JSON.stringify(items.find(i => i.price_cents > 0)));
