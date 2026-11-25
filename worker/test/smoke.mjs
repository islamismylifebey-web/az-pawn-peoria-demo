// End-to-end smoke test against a running `wrangler dev --local` (default http://127.0.0.1:8787).
// Needs a staff login "smoketest" / "smoke-test-password" made with: node tools/add-staff.mjs smoketest --local
import assert from "node:assert/strict";
const BASE = process.env.BASE || "http://127.0.0.1:8787";

function client() {
  const jar = {};
  return async (path, { method = "GET", json, form, header = true } = {}) => {
    const headers = {};
    if (header) headers["x-az-request"] = "1";
    if (Object.keys(jar).length) headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    let body;
    if (json) { body = JSON.stringify(json); headers["content-type"] = "application/json"; }
    if (form) body = form;
    const r = await fetch(BASE + path, { method, headers, body });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (v) jar[k] = v; else delete jar[k]; }
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, data: ct.includes("json") ? await r.json() : await r.arrayBuffer(), headers: r.headers };
  };
}
// A tiny JPEG with an APP1 (EXIF) segment holding the text GPSLatitude.
function jpegWithExif() {
  const exif = Buffer.from("Exif\0\0GPSLatitude-41.69", "latin1");
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, exif.length + 2]), exif]);
  const app0 = Buffer.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sos = Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x11, 0x22, 0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, sos]);
}

const anon = client(), staff = client(), alice = client(), bob = client();
let r;
r = await anon("/api/items"); assert.equal(r.status, 200); assert.ok(r.data.length > 200, "items listed");
const item = r.data.find(i => i.category === "Jewelry");
r = await anon("/api/orders", { method: "POST", json: {}, header: false }); assert.equal(r.status, 403, "header required");
r = await anon("/api/staff/items"); assert.equal(r.status, 401, "staff only");

// staff
r = await staff("/api/staff/login", { method: "POST", json: { username: "smoketest", password: "wrong-password" } }); assert.equal(r.status, 401);
r = await staff("/api/staff/login", { method: "POST", json: { username: "smoketest", password: "smoke-test-password" } }); assert.equal(r.status, 200, JSON.stringify(r.data));
r = await staff("/api/staff/summary"); assert.equal(r.status, 200); assert.ok(r.data.live_items > 200);
const fd = new FormData();
fd.set("name", "Fender Stratocaster"); fd.set("category", "Music"); fd.set("price", "0"); fd.set("publish", "true");
fd.set("photo", new Blob([jpegWithExif()], { type: "image/jpeg" }), "strat.jpg");
r = await staff("/api/staff/items", { method: "POST", form: fd }); assert.equal(r.status, 201, JSON.stringify(r.data)); assert.match(r.data.sku, /^AZ-MUS-/);
const photo = await anon(r.data.image); assert.equal(photo.status, 200);
assert.ok(!Buffer.from(photo.data).toString("latin1").includes("GPSLatitude"), "EXIF stripped");
r = await staff(`/api/staff/items/${item.id}`, { method: "PATCH", json: { price: 425 } }); assert.equal(r.data.price_cents, 42500);

// auction + bidding
r = await staff("/api/staff/auctions", { method: "POST", json: { item_id: item.id, start: 100, hours: 1, estimate: 400 } }); assert.equal(r.status, 201, JSON.stringify(r.data));
const lot = r.data.id;
for (const [c, email] of [[alice, "alice@example.com"], [bob, "bob@example.com"]]) {
  r = await c("/api/bidders/register", { method: "POST", json: { name: "Test Bidder", email, phone: "3095550100", password: "password123" } }); assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await c("/api/bidders/login", { method: "POST", json: { username: email, password: "password123" } }); assert.equal(r.status, 200);
}
r = await alice(`/api/auctions/${lot}/bids`, { method: "POST", json: { amount: 50 } }); assert.equal(r.status, 409, "below minimum");
r = await alice(`/api/auctions/${lot}/bids`, { method: "POST", json: { amount: 100 } }); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.you_are_high, true);
r = await alice(`/api/auctions/${lot}/bids`, { method: "POST", json: { amount: 200 } }); assert.equal(r.status, 409, "cannot outbid self");
// two bids at once: exactly one wins
const [b1, b2] = await Promise.all([bob(`/api/auctions/${lot}/bids`, { method: "POST", json: { amount: 105 } }), bob(`/api/auctions/${lot}/bids`, { method: "POST", json: { amount: 110 } })]);
assert.equal([b1.status, b2.status].filter(s => s === 200).length, 1, `one concurrent bid wins: ${b1.status} ${b2.status}`);
r = await anon("/api/auctions"); const view = r.data.find(a => a.id === lot); assert.equal(view.bid_count, 2); assert.ok(!("you_are_high" in view));
r = await staff("/api/staff/items"); assert.equal(r.data.find(i => i.id === item.id).status, "auction");
r = await staff(`/api/staff/auctions/${lot}/cancel`, { method: "POST" }); assert.equal(r.status, 200);
r = await staff("/api/staff/items"); assert.equal(r.data.find(i => i.id === item.id).status, "live");

// hold list orders: second order for the same item is refused
const two = (await anon("/api/items")).data.filter(i => i.category === "Gaming").slice(0, 2).map(i => i.id);
const order = { name: "Test Buyer", phone: "3095550101", item_ids: two };
r = await alice("/api/orders", { method: "POST", json: order }); assert.equal(r.status, 201, JSON.stringify(r.data));
const orderId = r.data.order_id;
r = await bob("/api/orders", { method: "POST", json: order }); assert.equal(r.status, 409);
r = await staff(`/api/staff/orders/${orderId}`, { method: "PATCH", json: { status: "cancelled" } }); assert.equal(r.status, 200);
r = await staff(`/api/staff/orders/${orderId}`, { method: "PATCH", json: { status: "completed" } }); assert.equal(r.status, 409);
r = await anon("/api/items"); assert.ok(two.every(id => r.data.some(i => i.id === id)), "items back on the floor");

// custom jewelry request with a photo; inquiry photos are staff-only
const q = new FormData();
q.set("kind", "custom"); q.set("name", "Test Customer"); q.set("phone", "3095550102"); q.set("item", "Engagement ring · White gold · Lab-grown diamond · Oval");
q.append("photos", new Blob([jpegWithExif()], { type: "image/jpeg" }), "idea.jpg");
r = await anon("/api/inquiries", { method: "POST", form: q }); assert.equal(r.status, 201, JSON.stringify(r.data));
r = await staff("/api/staff/inquiries"); const inq = r.data[0]; assert.equal(inq.kind, "custom");
r = await anon(inq.photos[0]); assert.equal(r.status, 401, "inquiry photo hidden from the public");
r = await staff(inq.photos[0]); assert.equal(r.status, 200);
const bad = new FormData(); bad.set("kind", "sell"); bad.set("name", "X Y"); bad.set("phone", "3095550103");
bad.append("photos", new Blob([Buffer.from("<script>alert(1)</script>")], { type: "image/jpeg" }), "x.jpg");
r = await anon("/api/inquiries", { method: "POST", form: bad }); assert.equal(r.status, 400, "non-image refused");

// static site
r = await anon("/"); assert.equal(r.status, 200);
r = await anon("/media/items/ring001.jpg"); assert.equal(r.status, 200);
console.log("smoke test passed");
