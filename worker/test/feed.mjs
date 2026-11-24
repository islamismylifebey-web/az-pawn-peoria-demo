// Pledge price feed test against `wrangler dev --local`. Reads PLEDGE_FEED_SECRET from .dev.vars.
// Signs exactly as Pledge's feed_push does: sha256=HMAC(secret, timestamp + "." + body).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const secret = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/PLEDGE_FEED_SECRET=(\S+)/)[1];

const post = async (obj, { key = secret, ts = Math.floor(Date.now() / 1000), raw } = {}) => {
  const body = raw ?? JSON.stringify(obj);
  const sig = "sha256=" + createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
  const r = await fetch(BASE + "/api/pledge/feed", { method: "POST", body,
    headers: { "content-type": "application/json", "x-pledge-timestamp": String(ts), "x-pledge-signature": sig } });
  return { status: r.status, data: await r.json() };
};
const jar = {};
const staff = async (path, { method = "GET", json } = {}) => {
  const headers = { "x-az-request": "1", cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") };
  if (json) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: json ? JSON.stringify(json) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (v) jar[k] = v; }
  return { status: r.status, data: await r.json() };
};
const pub = async () => (await (await fetch(BASE + "/api/items")).json());

let items = await pub();
const [a, b, c2] = items.filter(i => i.price_cents > 0).slice(0, 3);
const ask = items.find(i => i.price_cents === 0);
let r;

// security
r = await post({ items: [{ sku: a.sku, dynamic_cents: 1 }] }, { key: "wrong" }); assert.equal(r.status, 401, "bad key refused");
r = await post({ items: [{ sku: a.sku, dynamic_cents: 1 }] }, { ts: Math.floor(Date.now() / 1000) - 900 }); assert.equal(r.status, 401, "old timestamp refused");
r = await fetch(BASE + "/api/pledge/feed", { method: "POST", body: "{}" }); assert.equal(r.status, 401, "unsigned refused");

// a push
const at = new Date().toISOString();
r = await post({ v: 1, at, items: [
  { sku: a.sku, dynamic_cents: a.price_cents + 500, why: "demand up" },
  { sku: ask.sku, dynamic_cents: 12345 },
  { sku: "NO-SUCH-SKU", dynamic_cents: 100 },
  { sku: b.sku, dynamic_cents: -5 },
  { sku: c2.sku, dynamic_cents: 99.5 },
] });
assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.matched, 2); assert.deepEqual(r.data.rejected, [3, 4]);
items = await pub();
const get = sku => items.find(i => i.sku === sku);
assert.equal(get(a.sku).price_cents, a.price_cents + 500, "dynamic price shown");
assert.equal(get(a.sku).price_source, "market");
assert.equal(get(ask.sku).price_cents, 12345, "ask-for-price item gets the dynamic price");
assert.equal(get(b.sku).price_cents, b.price_cents, "bad value ignored");
assert.equal(JSON.stringify(get(a.sku)).includes("demand up"), false, "note stays staff-only");

// replay
r = await post(null, { raw: JSON.stringify({ v: 1, at, items: [{ sku: a.sku, dynamic_cents: 1 }] }) });
const again = await post(null, { raw: JSON.stringify({ v: 1, at, items: [{ sku: a.sku, dynamic_cents: 1 }] }) });
assert.equal(again.data.duplicate, true, "replayed body ignored");
await post({ v: 1, at, items: [{ sku: a.sku, dynamic_cents: a.price_cents + 500 }] });

// Gary's lock wins
r = await staff("/api/staff/login", { method: "POST", json: { username: "smoketest", password: "smoke-test-password" } }); assert.equal(r.status, 200);
r = await staff(`/api/staff/items/${a.id}`, { method: "PATCH", json: { price: 77.77 } }); assert.equal(r.status, 200);
assert.equal(r.data.price_locked, true); assert.equal(r.data.price_source, "locked");
await post({ v: 1, items: [{ sku: a.sku, dynamic_cents: 1 }], n: Date.now() });
items = await pub(); assert.equal(get(a.sku).price_cents, 7777, "locked price beats dynamic");
r = await staff(`/api/staff/items/${a.id}`, { method: "PATCH", json: { locked: false } });
items = await pub(); assert.equal(get(a.sku).price_cents, 1, "unlocked shows dynamic again");

// order charges the shown price
r = await fetch(BASE + "/api/orders", { method: "POST", headers: { "x-az-request": "1", "content-type": "application/json" },
  body: JSON.stringify({ name: "Feed Test", phone: "3095550100", email: "t@example.com", item_ids: [ask.id] }) });
const o = await r.json(); assert.equal(r.status, 201, JSON.stringify(o)); assert.equal(o.total_cents, 12345, "order uses dynamic price");

// clearing
await post({ v: 1, items: [{ sku: a.sku, dynamic_cents: null }], n: Date.now() });
items = await pub(); assert.equal(get(a.sku).price_cents, 7777, "cleared dynamic falls back to the set price");

r = await staff("/api/staff/feed"); assert.equal(r.status, 200); assert.ok(r.data.recent.length >= 3);
console.log("feed test: all passed");
