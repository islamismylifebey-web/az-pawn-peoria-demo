// Employee sign-in slip test against `wrangler dev --local` (default http://127.0.0.1:8787).
// Needs the local owner login "smoketest" / "smoke-test-password".
import assert from "node:assert/strict";
const BASE = process.env.BASE || "http://127.0.0.1:8787";

function client() {
  const jar = {};
  return async (path, { method = "GET", json } = {}) => {
    const headers = { "x-az-request": "1" };
    if (Object.keys(jar).length) headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (json) headers["content-type"] = "application/json";
    const r = await fetch(BASE + path, { method, headers, body: json ? JSON.stringify(json) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (v) jar[k] = v; else delete jar[k]; }
    return { status: r.status, data: await r.json().catch(() => null) };
  };
}
const owner = client(), katie = client(), katie2 = client(), anon = client();
const tokenOf = url => url.split("#t=")[1];
let r;

r = await owner("/api/staff/login", { method: "POST", json: { username: "smoketest", password: "smoke-test-password" } }); assert.equal(r.status, 200);
r = await owner("/api/staff/me"); assert.equal(r.data.role, "owner");

// add an employee and print a slip
const name = "Katie " + Date.now();
r = await owner("/api/staff/employees", { method: "POST", json: { name } }); assert.equal(r.status, 201, JSON.stringify(r.data));
const emp = r.data; assert.equal(emp.can_price, false);
r = await owner("/api/staff/employees", { method: "POST", json: { name } }); assert.equal(r.status, 409, "same name twice refused");
r = await owner(`/api/staff/employees/${emp.id}/slip`, { method: "POST" }); assert.equal(r.status, 201);
assert.match(r.data.url, /\/signin#t=[0-9a-f]{64}$/);
const first = tokenOf(r.data.url);
r = await owner(`/api/staff/employees/${emp.id}/slip`, { method: "POST" });
const second = tokenOf(r.data.url);

// the reprint cancels the first slip; the second works once
r = await katie("/api/staff/link", { method: "POST", json: { token: first } }); assert.equal(r.status, 401, "old slip cancelled by reprint");
r = await katie("/api/staff/link", { method: "POST", json: { token: second } }); assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.name, name);
r = await katie2("/api/staff/link", { method: "POST", json: { token: second } }); assert.equal(r.status, 401, "slip works only once");
r = await anon("/api/staff/link", { method: "POST", json: { token: "x" } }); assert.equal(r.status, 400);

// employee rights
r = await katie("/api/staff/me"); assert.equal(r.data.role, "employee"); assert.equal(r.data.can_price, false);
r = await katie("/api/staff/items"); assert.equal(r.status, 200, "employee sees inventory");
const item = r.data[0];
r = await katie(`/api/staff/items/${item.id}`, { method: "PATCH", json: { price: 1 } }); assert.equal(r.status, 403, "no price change without permission");
r = await katie(`/api/staff/items/${item.id}`, { method: "PATCH", json: { locked: true } }); assert.equal(r.status, 403, "no lock change without permission");
r = await katie("/api/staff/employees"); assert.equal(r.status, 403, "employee cannot list staff");
r = await katie("/api/staff/employees", { method: "POST", json: { name: "Sneaky" } }); assert.equal(r.status, 403, "employee cannot add staff");
r = await katie("/api/staff/login", { method: "POST", json: { username: "employee-x", password: "!" } }); assert.equal(r.status, 401);

// Gary allows price changes
r = await owner(`/api/staff/employees/${emp.id}`, { method: "PATCH", json: { can_price: true } }); assert.equal(r.data.can_price, true);
r = await katie(`/api/staff/items/${item.id}`, { method: "PATCH", json: { price: item.set_price_cents / 100 } }); assert.equal(r.status, 200, "price allowed now");

// Gary sees and removes; the employee is signed out at once and old slips die
r = await owner("/api/staff/employees"); assert.ok(r.data.some(e => e.id === emp.id && e.active && e.slip_used_at));
r = await owner(`/api/staff/employees/${emp.id}/slip`, { method: "POST" }); const third = tokenOf(r.data.url);
r = await owner(`/api/staff/employees/${emp.id}/remove`, { method: "POST" }); assert.equal(r.status, 200);
r = await katie("/api/staff/me"); assert.equal(r.status, 401, "removed employee signed out");
r = await katie2("/api/staff/link", { method: "POST", json: { token: third } }); assert.equal(r.status, 401, "removed employee's slip dead");
r = await owner(`/api/staff/employees/${emp.id}/slip`, { method: "POST" }); assert.equal(r.status, 404, "no slip for removed employee");
r = await owner("/api/staff/me"); assert.equal(r.status, 200, "owner still signed in");
console.log("staff slip test: all passed");
