// A-Z Jewelry & Swap — store, A-Z Auction Block and Command Center API on
// Cloudflare Workers (D1 database, R2 photo storage). Ported from the store's
// original Python server so the site no longer depends on any home computer.
// Copyright GALOR WebWorks. Licensed for use by A-Z Jewelry & Swap Inc. only.

import {
  HttpError, fail, json, iso, addHours, parseIso, shopToday, hashPassword, verifyPassword,
  createSession, sessionUser, endSession, cookies, setCookie, clearCookie, allow,
  BadImage, savePhoto, stripeEnabled, stripe, randomHex, sha256Hex,
} from "./lib.js";

const STAFF_COOKIE = "az_staff";
const BIDDER_COOKIE = "az_bidder";
const MAX_PHOTOS = 6;
export const CATEGORIES = ["Jewelry", "Electronics", "Tools", "Gaming", "Music", "Clothing", "Collectibles", "Bikes", "HVAC", "Other"];
const SKU_PREFIX = { Jewelry: "JWL", Electronics: "ELC", Tools: "TOL", Gaming: "GAM", Music: "MUS", Clothing: "CLO",
  Collectibles: "COL", Bikes: "BKE", HVAC: "HVC" };
const INQUIRY_KINDS = ["sell", "pawn", "video", "custom", "wanted"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ------------------------------------------------------------------ auctions
const EXTENSION_MS = 2 * 60 * 1000;
const INCREMENTS = [[100_00, 5_00], [500_00, 10_00], [1_000_00, 25_00], [5_000_00, 50_00]];
const incrementFor = c => (INCREMENTS.find(([ceil]) => c < ceil) || [0, 100_00])[1];
const DEPOSIT_RATE = 0.10, DEPOSIT_MINIMUM_CENTS = 10_00;
const depositCents = a => Math.max(DEPOSIT_MINIMUM_CENTS, Math.round((a.estimate_cents || a.reserve_cents || a.start_cents) * DEPOSIT_RATE));

async function standing(db, auction) {
  const top = await db.prepare("SELECT amount_cents, bidder_id FROM bids WHERE auction_id = ? ORDER BY amount_cents DESC, id ASC LIMIT 1").bind(auction.id).first();
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM bids WHERE auction_id = ?").bind(auction.id).first();
  if (!top) return { high: null, highBidder: null, count: 0, minNext: auction.start_cents };
  return { high: top.amount_cents, highBidder: top.bidder_id, count: n, minNext: top.amount_cents + incrementFor(top.amount_cents) };
}

async function settleDue(db, now = new Date()) {
  const stamp = iso(now);
  await db.prepare("UPDATE auctions SET status = 'live' WHERE status = 'scheduled' AND starts_at <= ? AND ends_at > ?").bind(stamp, stamp).run();
  const { results: due } = await db.prepare("SELECT * FROM auctions WHERE status IN ('scheduled', 'live') AND ends_at <= ?").bind(stamp).all();
  for (const a of due) {
    const s = await standing(db, a);
    const met = s.high !== null && (a.reserve_cents === null || s.high >= a.reserve_cents);
    const r = await db.prepare("UPDATE auctions SET status = 'ended', winner_bidder_id = ?, final_cents = ?, reserve_met = ? WHERE id = ? AND status IN ('scheduled', 'live')")
      .bind(met ? s.highBidder : null, s.high, met ? 1 : 0, a.id).run();
    if (r.meta.changes && a.item_id !== null) {
      // A winner holds the item for payment; otherwise it returns to the shop floor.
      await db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE id = ? AND status = 'auction'")
        .bind(met ? "reserved" : "live", stamp, a.item_id).run();
    }
  }
}

async function auctionView(db, a, viewer = null) {
  const s = await standing(db, a);
  const view = {
    id: a.id, title: a.title, description: a.description, image: a.image, status: a.status,
    starts_at: a.starts_at, ends_at: a.ends_at, start_cents: a.start_cents, high_cents: s.high,
    bid_count: s.count, minimum_next_cents: s.minNext, has_reserve: a.reserve_cents !== null,
    estimate_cents: a.estimate_cents, deposit_cents: depositCents(a),
    reserve_met: a.reserve_cents === null || (s.high !== null && s.high >= a.reserve_cents),
  };
  if (viewer !== null) {
    view.you_are_high = s.highBidder === viewer;
    if (a.status === "ended") view.you_won = a.winner_bidder_id === viewer;
  }
  return view;
}

// A statement that fails the whole batch unless `condition` (SQL) is true.
const guard = (db, condition, ...binds) => db.prepare(`INSERT INTO _guard (ok) SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END`).bind(...binds);
const unguard = db => db.prepare("DELETE FROM _guard");
async function guarded(db, statements) {
  try { return await db.batch(statements); }
  catch (e) { if (/CHECK constraint failed/i.test(String(e && e.message))) return null; throw e; }
}

// ------------------------------------------------------------------ payments
const hasHold = async (db, auctionId, bidderId) => !!(await db.prepare("SELECT 1 FROM deposits WHERE auction_id = ? AND bidder_id = ? AND status = 'held'").bind(auctionId, bidderId).first());
const isPaid = async (db, auctionId) => !!(await db.prepare("SELECT 1 FROM auction_payments WHERE auction_id = ? AND status = 'paid'").bind(auctionId).first());

async function releaseHolds(env, auctionId, keepBidderId) {
  const { results } = await env.DB.prepare("SELECT * FROM deposits WHERE auction_id = ? AND status = 'held'").bind(auctionId).all();
  for (const row of results) {
    if (keepBidderId !== null && row.bidder_id === keepBidderId) continue;
    if (stripeEnabled(env) && row.payment_intent) {
      try { await stripe(env, "POST", `payment_intents/${row.payment_intent}/cancel`); } catch { /* already released at Stripe */ }
    }
    await env.DB.prepare("UPDATE deposits SET status = 'released' WHERE id = ?").bind(row.id).run();
  }
}

// ------------------------------------------------------------------ views
// The price a customer sees and pays. Gary's locked price always wins. Otherwise
// Pledge's dynamic price (market, demand and season) is used while it is fresh,
// and the price set in the Command Center is the fallback.
const DYNAMIC_FRESH_MS = 14 * 24 * 3600e3;
const dynamicFresh = r => r.dynamic_cents !== null && r.dynamic_cents !== undefined && r.dynamic_at &&
  Date.now() - Date.parse(r.dynamic_at) <= DYNAMIC_FRESH_MS;
const priceSource = r => (r.price_locked ? "locked" : dynamicFresh(r) ? "dynamic" : "set");
const effectivePrice = r => (priceSource(r) === "dynamic" ? r.dynamic_cents : r.price_cents);
const itemView = r => ({ id: r.id, sku: r.sku, name: r.name, category: r.category, price_cents: effectivePrice(r),
  price_source: priceSource(r) === "dynamic" ? "market" : "shop", price_updated: priceSource(r) === "dynamic" ? r.dynamic_at : null,
  condition: r.condition, description: r.description, badge: r.badge, image: r.image, ship: !!r.ship });
const staffItemView = r => ({ ...itemView(r), status: r.status, available_on: r.available_on, created_at: r.created_at,
  price_source: priceSource(r), set_price_cents: r.price_cents, price_locked: !!r.price_locked,
  dynamic_cents: r.dynamic_cents ?? null, dynamic_at: r.dynamic_at ?? null, dynamic_note: r.dynamic_note || "", pledge_item: r.pledge_item || "" });
const cents = v => Math.round(Number(v) * 100);

// ------------------------------------------------------------------ input helpers
async function body(request) {
  try { const b = await request.json(); if (b && typeof b === "object") return b; } catch { /* fall through */ }
  fail(400, "Please check the form.");
}
const str = (v, max, label, min = 0) => {
  const s = typeof v === "string" ? v.trim() : v === undefined || v === null ? "" : String(v).trim();
  if (s.length < min || s.length > max) fail(400, label);
  return s;
};
const num = (v, { gt, ge, le }, label) => {
  const n = Number(v);
  if (v === "" || v === null || v === undefined || !Number.isFinite(n) || (gt !== undefined && !(n > gt)) || (ge !== undefined && !(n >= ge)) || (le !== undefined && !(n <= le))) fail(400, label);
  return n;
};
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ------------------------------------------------------------------ router
const routes = [];
const on = (method, pattern, handler) => routes.push([method, new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>\\d+)")}$`), handler]);

function makeCtx(request, env) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";
  const jar = cookies(request);
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const extraHeaders = [];
  return {
    request, env, url, db: env.DB, ip, jar, secure, extraHeaders,
    async limit(action, count, windowSec) {
      if (!(await allow(env.DB, `${action}:${ip}`, count, windowSec))) fail(429, "Too many attempts. Please wait a few minutes and try again.");
    },
    // Signed-in staff: Gary (owner) or an employee he signed in with a printed slip.
    // A removed employee is signed out everywhere at once.
    async staffRow() {
      if (this._staff) return this._staff;
      const id = await sessionUser(env.DB, "staff", jar[STAFF_COOKIE]);
      const row = id === null ? null : await env.DB.prepare("SELECT * FROM staff WHERE id = ?").bind(id).first();
      if (!row || row.revoked_at) fail(401, "Please sign in.");
      return (this._staff = row);
    },
    async staff() { return (await this.staffRow()).id; },
    async owner() {
      const row = await this.staffRow();
      if (row.role !== "owner") fail(403, "Only the owner can do that.");
      return row;
    },
    async canPrice() {
      const row = await this.staffRow();
      return row.role === "owner" || !!row.can_price;
    },
    bidder: () => sessionUser(env.DB, "bidder", jar[BIDDER_COOKIE]),
    base: () => (env.AZ_PUBLIC_URL || url.origin).replace(/\/$/, ""),
  };
}

// ---------------------------------------------------------------- public
on("GET", "/api/health", () => json({ ok: true, mode: "live" }));

on("GET", "/api/items", async c => {
  const { results } = await c.db.prepare("SELECT * FROM items WHERE status = 'live' AND (available_on IS NULL OR available_on <= ?) ORDER BY created_at DESC, id DESC").bind(shopToday()).all();
  return json(results.map(itemView));
});

on("GET", "/api/auctions", async c => {
  await settleDue(c.db);
  const viewer = await c.bidder();
  const recent = iso(addHours(new Date(), -72));
  const { results } = await c.db.prepare(
    "SELECT * FROM auctions WHERE status IN ('scheduled', 'live') OR (status = 'ended' AND ends_at >= ?) " +
    "ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, ends_at ASC").bind(recent).all();
  const out = [];
  for (const a of results) {
    const v = await auctionView(c.db, a, viewer);
    v.paid = await isPaid(c.db, a.id);
    if (viewer !== null) v.you_have_hold = await hasHold(c.db, a.id, viewer);
    out.push(v);
  }
  return json(out);
});

on("GET", "/api/config", c => json({ stripe: stripeEnabled(c.env), deposit_rate: DEPOSIT_RATE, deposit_minimum_cents: DEPOSIT_MINIMUM_CENTS }));

on("POST", "/api/auctions/:id/deposit", async (c, p) => {
  const user = await c.bidder();
  if (user === null) fail(401, "Please sign in to bid.");
  if (!stripeEnabled(c.env)) fail(409, "Online card holds switch on once the shop connects Stripe.");
  const a = await c.db.prepare("SELECT * FROM auctions WHERE id = ?").bind(p.id).first();
  if (!a || !["live", "scheduled"].includes(a.status)) fail(409, "This auction is not open.");
  if (await hasHold(c.db, a.id, user)) return json({ ok: true, held: true });
  const bidder = await c.db.prepare("SELECT * FROM bidders WHERE id = ?").bind(user).first();
  const amount = depositCents(a), meta = { kind: "deposit", auction_id: String(a.id), bidder_id: String(bidder.id) };
  const session = await stripe(c.env, "POST", "checkout/sessions", {
    mode: "payment", customer_email: bidder.email,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: {
      name: `Bidder security hold - ${a.title}`, description: "A hold, not a charge. Released if you don't win, or when you pay for your win." } } }],
    payment_intent_data: { capture_method: "manual", metadata: meta }, metadata: meta,
    success_url: `${c.base()}/?deposit={CHECKOUT_SESSION_ID}#auction`, cancel_url: `${c.base()}/#auction`,
  });
  await c.db.prepare("INSERT INTO deposits (auction_id, bidder_id, session_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)").bind(a.id, bidder.id, session.id, amount, iso()).run();
  return json({ ok: true, url: session.url });
});

on("POST", "/api/deposits/confirm", async c => {
  const user = await c.bidder();
  if (user === null || !stripeEnabled(c.env)) fail(401, "Please sign in.");
  const sid = String((await body(c.request)).session_id || "");
  const row = await c.db.prepare("SELECT * FROM deposits WHERE session_id = ? AND bidder_id = ?").bind(sid, user).first();
  if (!row) return json({ held: false });
  if (row.status === "held") return json({ held: true });
  const s = await stripe(c.env, "GET", `checkout/sessions/${encodeURIComponent(sid)}`, { expand: ["payment_intent"] });
  if (s.payment_intent && s.payment_intent.status === "requires_capture") {
    await c.db.prepare("UPDATE deposits SET status = 'held', payment_intent = ? WHERE id = ?").bind(s.payment_intent.id, row.id).run();
    return json({ held: true });
  }
  return json({ held: false });
});

on("POST", "/api/auctions/:id/pay", async (c, p) => {
  const user = await c.bidder();
  if (user === null) fail(401, "Please sign in.");
  if (!stripeEnabled(c.env)) fail(409, "Online payment switches on once the shop connects Stripe. Pay in the store.");
  await settleDue(c.db);
  const a = await c.db.prepare("SELECT * FROM auctions WHERE id = ?").bind(p.id).first();
  if (!a || a.status !== "ended" || a.winner_bidder_id !== user) fail(403, "Only the winner can pay for this item.");
  if (await isPaid(c.db, a.id)) return json({ ok: true, paid: true });
  const bidder = await c.db.prepare("SELECT * FROM bidders WHERE id = ?").bind(user).first();
  const session = await stripe(c.env, "POST", "checkout/sessions", {
    mode: "payment", customer_email: bidder.email,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: a.final_cents, product_data: { name: `A-Z Auction Block win - ${a.title}` } } }],
    metadata: { kind: "win", auction_id: String(a.id), bidder_id: String(bidder.id) },
    success_url: `${c.base()}/?paid={CHECKOUT_SESSION_ID}#auction`, cancel_url: `${c.base()}/#auction`,
  });
  await c.db.prepare("INSERT INTO auction_payments (auction_id, bidder_id, session_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)").bind(a.id, bidder.id, session.id, a.final_cents, iso()).run();
  return json({ ok: true, url: session.url });
});

on("POST", "/api/payments/confirm", async c => {
  const user = await c.bidder();
  if (user === null || !stripeEnabled(c.env)) fail(401, "Please sign in.");
  const sid = String((await body(c.request)).session_id || "");
  const row = await c.db.prepare("SELECT * FROM auction_payments WHERE session_id = ? AND bidder_id = ?").bind(sid, user).first();
  if (!row) return json({ paid: false });
  if (row.status === "paid") return json({ paid: true });
  const s = await stripe(c.env, "GET", `checkout/sessions/${encodeURIComponent(sid)}`);
  if (s.payment_status === "paid") {
    await c.db.prepare("UPDATE auction_payments SET status = 'paid' WHERE id = ?").bind(row.id).run();
    await releaseHolds(c.env, row.auction_id, null);
    return json({ paid: true });
  }
  return json({ paid: false });
});

on("POST", "/api/inquiries", async c => {
  await c.limit("inquiry", 6, 3600);
  let form;
  try { form = await c.request.formData(); } catch { fail(400, "Please check the form."); }
  const kind = String(form.get("kind") || "");
  if (!INQUIRY_KINDS.includes(kind)) fail(400, "Please check the form.");
  const name = str(form.get("name"), 80, "Please enter your name.", 2);
  const phone = str(form.get("phone"), 30, "Please enter a phone number we can reach you at.", 7);
  const email = str(form.get("email"), 200, "Please check your email address.");
  const item = str(form.get("item"), 200, "Please describe the item in 200 characters or less.");
  const condition = str(form.get("condition"), 40, "Please check the condition.");
  const notes = str(form.get("notes"), 2000, "Please keep the notes under 2000 characters.");
  const uploads = form.getAll("photos").filter(f => f && typeof f === "object" && f.name && f.size > 0);
  if (uploads.length > MAX_PHOTOS) fail(400, `Please send at most ${MAX_PHOTOS} photos.`);
  const saved = [];
  try {
    for (const f of uploads) saved.push(await savePhoto(c.env, f, "inquiries"));
  } catch (e) {
    // All-or-nothing: no orphaned customer photos are left behind.
    await Promise.all(saved.map(p => c.env.MEDIA.delete(p.replace(/^\/media\//, ""))));
    if (e instanceof BadImage) fail(400, e.message);
    throw e;
  }
  await c.db.prepare("INSERT INTO inquiries (kind, name, phone, email, item, condition, notes, photos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(kind, name, phone, email, item, condition, notes, JSON.stringify(saved), iso()).run();
  return json({ ok: true }, 201);
});

on("POST", "/api/orders", async c => {
  await c.limit("order", 5, 3600);
  const b = await body(c.request);
  const name = str(b.name, 80, "Please enter your name.", 2);
  const phone = str(b.phone, 30, "Please enter a phone number we can reach you at.", 7);
  const email = str(b.email, 200, "Please check your email address.");
  const notes = str(b.notes, 1000, "Please keep the notes under 1000 characters.");
  const fulfillment = b.fulfillment === undefined ? "pickup" : b.fulfillment;
  if (!["pickup", "ship"].includes(fulfillment)) fail(400, "Please check the form.");
  if (!Array.isArray(b.item_ids) || b.item_ids.length < 1 || b.item_ids.length > 20 || !b.item_ids.every(Number.isInteger)) fail(400, "Please check your cart.");
  const ids = [...new Set(b.item_ids)].sort((x, y) => x - y);
  const marks = ids.map(() => "?").join(",");
  const today = shopToday();
  const { results } = await c.db.prepare(`SELECT * FROM items WHERE id IN (${marks})`).bind(...ids).all();
  const found = Object.fromEntries(results.map(r => [r.id, r]));
  const open = r => r && r.status === "live" && (r.available_on === null || r.available_on <= today);
  if (ids.some(i => !open(found[i]))) fail(409, "Some items in your cart were just sold or reserved. Please refresh.");
  if (fulfillment === "ship" && ids.some(i => !found[i].ship)) fail(400, "Some items are local pickup only.");
  const total = ids.reduce((s, i) => s + effectivePrice(found[i]), 0);
  const stamp = iso();
  const stmts = [
    guard(c.db, `(SELECT COUNT(*) FROM items WHERE id IN (${marks}) AND status = 'live' AND (available_on IS NULL OR available_on <= ?)) = ?`, ...ids, today, ids.length),
    c.db.prepare("INSERT INTO orders (name, phone, email, fulfillment, notes, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(name, phone, email, fulfillment, notes, total, stamp),
    ...ids.map(i => c.db.prepare("INSERT INTO order_lines (order_id, item_id, name, price_cents) VALUES ((SELECT MAX(id) FROM orders), ?, ?, ?)").bind(i, found[i].name, effectivePrice(found[i]))),
    c.db.prepare(`UPDATE items SET status = 'reserved', updated_at = ? WHERE id IN (${marks})`).bind(stamp, ...ids),
    unguard(c.db),
    c.db.prepare("SELECT MAX(id) AS id FROM orders"),
  ];
  const res = await guarded(c.db, stmts);
  if (!res) fail(409, "Some items in your cart were just sold or reserved. Please refresh.");
  return json({ ok: true, order_id: res[res.length - 1].results[0].id, total_cents: total }, 201);
});

// ---------------------------------------------------------------- bidders
on("POST", "/api/bidders/register", async c => {
  await c.limit("register", 5, 3600);
  const b = await body(c.request);
  const name = str(b.name, 80, "Please enter your name.", 2);
  const email = str(b.email, 200, "Please enter a valid email address.").toLowerCase();
  if (!EMAIL.test(email)) fail(400, "Please enter a valid email address.");
  const phone = str(b.phone, 30, "Please enter a phone number we can reach you at.", 7);
  if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 200) fail(400, "Your password needs at least 8 characters.");
  if (await c.db.prepare("SELECT 1 FROM bidders WHERE email = ?").bind(email).first()) fail(409, "That email already has a bidder account. Please sign in.");
  await c.db.prepare("INSERT INTO bidders (name, email, phone, password_hash, status, created_at) VALUES (?, ?, ?, ?, 'approved', ?)")
    .bind(name, email, phone, await hashPassword(b.password), iso()).run();
  return json({ ok: true, status: "approved" }, 201);
});

on("POST", "/api/bidders/login", async c => {
  await c.limit("bidder-login", 10, 900);
  const b = await body(c.request);
  const row = await c.db.prepare("SELECT * FROM bidders WHERE email = ?").bind(String(b.username || "").toLowerCase().trim()).first();
  if (!row || !(await verifyPassword(String(b.password || ""), row.password_hash))) fail(401, "Email or password is incorrect.");
  if (row.status === "blocked") fail(403, "This bidder account is not active. Please call the store.");
  c.extraHeaders.push(["set-cookie", setCookie(BIDDER_COOKIE, await createSession(c.db, "bidder", row.id), "bidder", c.secure)]);
  return json({ name: row.name, status: row.status });
});

on("POST", "/api/bidders/logout", async c => {
  await endSession(c.db, c.jar[BIDDER_COOKIE]);
  c.extraHeaders.push(["set-cookie", clearCookie(BIDDER_COOKIE, c.secure)]);
  return json({ ok: true });
});

on("GET", "/api/bidders/me", async c => {
  const user = await c.bidder();
  if (user === null) return json({ signed_in: false });
  const row = await c.db.prepare("SELECT name, status FROM bidders WHERE id = ?").bind(user).first();
  return json({ signed_in: true, name: row.name, status: row.status });
});

on("POST", "/api/auctions/:id/bids", async (c, p) => {
  const user = await c.bidder();
  if (user === null) fail(401, "Please sign in to bid.");
  await c.limit("bid", 30, 60);
  const amount = cents(num((await body(c.request)).amount, { gt: 0, le: 1_000_000 }, "Please enter a bid amount."));
  const id = Number(p.id);
  if (stripeEnabled(c.env) && !(await hasHold(c.db, id, user))) fail(402, "Place your bidder security hold before bidding on this item.");
  const now = new Date();
  await settleDue(c.db, now);
  const bidder = await c.db.prepare("SELECT status FROM bidders WHERE id = ?").bind(user).first();
  if (!bidder || bidder.status !== "approved") fail(409, "Your bidder account is waiting for approval by the shop.");
  const a = await c.db.prepare("SELECT * FROM auctions WHERE id = ?").bind(id).first();
  if (!a) fail(409, "That auction does not exist.");
  if (a.status !== "live") fail(409, "This auction is not open for bidding.");
  const ends = parseIso(a.ends_at);
  if (now >= ends) fail(409, "This auction has closed.");
  const s = await standing(c.db, a);
  if (s.highBidder === user) fail(409, "You already have the high bid.");
  if (amount < s.minNext) fail(409, `The minimum bid is $${(s.minNext / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`);
  const stamp = iso(now);
  const stmts = [
    // Nobody else bid, and the auction is still open, since we read it.
    guard(c.db, "(SELECT COALESCE(MAX(amount_cents), -1) FROM bids WHERE auction_id = ?) = ? AND (SELECT status FROM auctions WHERE id = ?) = 'live' AND (SELECT ends_at FROM auctions WHERE id = ?) > ?",
      id, s.high === null ? -1 : s.high, id, id, stamp),
    c.db.prepare("INSERT INTO bids (auction_id, bidder_id, amount_cents, created_at) VALUES (?, ?, ?, ?)").bind(id, user, amount, stamp),
    unguard(c.db),
  ];
  // A bid in the last two minutes extends the close: nobody wins by sniping.
  if (ends - now < EXTENSION_MS) stmts.push(c.db.prepare("UPDATE auctions SET ends_at = ? WHERE id = ?").bind(iso(new Date(now.getTime() + EXTENSION_MS)), id));
  if (!(await guarded(c.db, stmts))) fail(409, "Someone just bid. Please check the new high bid and try again.");
  const fresh = await c.db.prepare("SELECT * FROM auctions WHERE id = ?").bind(id).first();
  return json(await auctionView(c.db, fresh, user));
});

// ---------------------------------------------------------------- staff
on("POST", "/api/staff/login", async c => {
  await c.limit("staff-login", 8, 900);
  const b = await body(c.request);
  const row = await c.db.prepare("SELECT * FROM staff WHERE username = ?").bind(String(b.username || "").trim()).first();
  if (!row || row.revoked_at || !(await verifyPassword(String(b.password || ""), row.password_hash))) fail(401, "Username or password is incorrect.");
  c.extraHeaders.push(["set-cookie", setCookie(STAFF_COOKIE, await createSession(c.db, "staff", row.id), "staff", c.secure)]);
  return json({ username: row.username });
});

on("POST", "/api/staff/logout", async c => {
  await endSession(c.db, c.jar[STAFF_COOKIE]);
  c.extraHeaders.push(["set-cookie", clearCookie(STAFF_COOKIE, c.secure)]);
  return json({ ok: true });
});

on("GET", "/api/staff/me", async c => {
  const row = await c.staffRow();
  return json({ username: row.username, name: row.display_name || row.username, role: row.role, can_price: await c.canPrice() });
});

// ---------------------------------------------------------------- employees and sign-in slips
// Gary adds an employee and prints a slip with a one-time sign-in link (as a QR code).
// The link works once, within 24 hours; the employee's device then stays signed in for
// 30 days unless Gary removes them. Only a hash of each link is stored.
const SLIP_HOURS = 24, EMPLOYEE_SESSION_H = 30 * 24;
const employeeView = r => ({ id: r.id, name: r.display_name, can_price: !!r.can_price, active: !r.revoked_at,
  created_at: r.created_at, removed_at: r.revoked_at, last_slip_at: r.last_slip_at || null, slip_used_at: r.slip_used_at || null });
const EMPLOYEE_SQL = "SELECT s.*, (SELECT MAX(created_at) FROM staff_links WHERE staff_id = s.id) AS last_slip_at, " +
  "(SELECT MAX(used_at) FROM staff_links WHERE staff_id = s.id) AS slip_used_at FROM staff s WHERE s.role = 'employee'";

on("GET", "/api/staff/employees", async c => {
  await c.owner();
  const { results } = await c.db.prepare(EMPLOYEE_SQL + " ORDER BY s.revoked_at IS NOT NULL, s.display_name").all();
  return json(results.map(employeeView));
});

on("POST", "/api/staff/employees", async c => {
  await c.owner();
  const b = await body(c.request);
  const name = str(b.name, 60, "Please enter the employee's name (2-60 characters).", 2);
  if (await c.db.prepare("SELECT 1 FROM staff WHERE role = 'employee' AND revoked_at IS NULL AND lower(display_name) = lower(?)").bind(name).first())
    fail(409, "There is already an employee with that name. Print them a new slip instead.");
  const r = await c.db.prepare("INSERT INTO staff (username, password_hash, created_at, role, display_name, can_price) VALUES (?, '!', ?, 'employee', ?, ?)")
    .bind(`employee-${randomHex(6)}`, iso(), name, b.can_price ? 1 : 0).run();
  return json(employeeView(await c.db.prepare(EMPLOYEE_SQL + " AND s.id = ?").bind(r.meta.last_row_id).first()), 201);
});

on("PATCH", "/api/staff/employees/:id", async (c, p) => {
  await c.owner();
  const b = await body(c.request);
  if (b.can_price == null) fail(400, "Nothing to change.");
  const r = await c.db.prepare("UPDATE staff SET can_price = ? WHERE id = ? AND role = 'employee'").bind(b.can_price ? 1 : 0, p.id).run();
  if (!r.meta.changes) fail(404, "No such employee.");
  return json(employeeView(await c.db.prepare(EMPLOYEE_SQL + " AND s.id = ?").bind(p.id).first()));
});

on("POST", "/api/staff/employees/:id/slip", async (c, p) => {
  await c.owner();
  const row = await c.db.prepare("SELECT * FROM staff WHERE id = ? AND role = 'employee' AND revoked_at IS NULL").bind(p.id).first();
  if (!row) fail(404, "No such employee.");
  const token = randomHex(32), now = new Date(), expires = iso(addHours(now, SLIP_HOURS));
  await c.db.batch([
    // a new slip cancels any earlier slip that was not used yet
    c.db.prepare("DELETE FROM staff_links WHERE staff_id = ? AND used_at IS NULL").bind(row.id),
    c.db.prepare("INSERT INTO staff_links (token_hash, staff_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256Hex(token), row.id, iso(now), expires),
  ]);
  return json({ name: row.display_name, url: `${c.base()}/signin#t=${token}`, expires_at: expires }, 201);
});

on("POST", "/api/staff/employees/:id/remove", async (c, p) => {
  await c.owner();
  const r = await c.db.prepare("UPDATE staff SET revoked_at = ? WHERE id = ? AND role = 'employee' AND revoked_at IS NULL").bind(iso(), p.id).run();
  if (!r.meta.changes) fail(404, "No such employee.");
  await c.db.batch([
    c.db.prepare("DELETE FROM sessions WHERE kind = 'staff' AND user_id = ?").bind(p.id),
    c.db.prepare("DELETE FROM staff_links WHERE staff_id = ? AND used_at IS NULL").bind(p.id),
  ]);
  return json({ ok: true });
});

on("POST", "/api/staff/link", async c => {
  await c.limit("staff-link", 10, 900);
  const b = await body(c.request);
  const token = String(b.token || "");
  const bad = "This sign-in slip has expired or was already used. Ask Gary for a new one.";
  if (!/^[0-9a-f]{64}$/.test(token)) fail(400, bad);
  const hash = await sha256Hex(token), now = iso();
  const used = await c.db.prepare("UPDATE staff_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(now, hash, now).run();
  if (!used.meta.changes) fail(401, bad);
  const row = await c.db.prepare("SELECT s.* FROM staff s JOIN staff_links l ON l.staff_id = s.id WHERE l.token_hash = ?").bind(hash).first();
  if (!row || row.revoked_at || row.role !== "employee") fail(401, bad);
  const session = await createSession(c.db, "staff", row.id, EMPLOYEE_SESSION_H);
  c.extraHeaders.push(["set-cookie", setCookie(STAFF_COOKIE, session, "staff", c.secure, EMPLOYEE_SESSION_H)]);
  return json({ name: row.display_name });
});

on("GET", "/api/staff/summary", async c => {
  await c.staff();
  await settleDue(c.db);
  const n = async (sql, ...b) => (await c.db.prepare(sql).bind(...b).first()).n;
  return json({
    new_inquiries: await n("SELECT COUNT(*) AS n FROM inquiries WHERE status = 'new'"),
    open_orders: await n("SELECT COUNT(*) AS n FROM orders WHERE status IN ('requested', 'confirmed', 'ready')"),
    live_items: await n("SELECT COUNT(*) AS n FROM items WHERE status = 'live'"),
    live_auctions: await n("SELECT COUNT(*) AS n FROM auctions WHERE status = 'live'"),
    pending_bidders: await n("SELECT COUNT(*) AS n FROM bidders WHERE status = 'pending'"),
    aging_items: await n("SELECT COUNT(*) AS n FROM items WHERE status = 'live' AND created_at <= ?", iso(addHours(new Date(), -85 * 24))),
  });
});

on("GET", "/api/staff/items", async c => {
  await c.staff();
  const { results } = await c.db.prepare("SELECT * FROM items ORDER BY created_at DESC, id DESC").all();
  return json(results.map(staffItemView));
});

on("POST", "/api/staff/items", async c => {
  await c.staff();
  let form;
  try { form = await c.request.formData(); } catch { fail(400, "Please check the form."); }
  const category = String(form.get("category") || "");
  if (!CATEGORIES.includes(category)) fail(400, `Category must be one of ${CATEGORIES.join(", ")}.`);
  const name = str(form.get("name"), 120, "Item name must be 2-120 characters.", 2);
  const price = num(form.get("price"), { ge: 0, le: 1_000_000 }, "Please enter a price (0 for ask in store).");
  const condition = str(form.get("condition") ?? "Good", 40, "Please check the condition.") || "Good";
  const description = str(form.get("description"), 4000, "The description is too long.");
  const badge = str(form.get("badge"), 30, "The badge is too long.");
  const flag = v => ["true", "on", "1", "yes"].includes(String(v || "").toLowerCase());
  const availableOn = String(form.get("available_on") || "").trim();
  if (availableOn && !isDate(availableOn)) fail(400, "Please check the hold date.");
  const photo = form.get("photo");
  let image = "";
  if (photo && typeof photo === "object" && photo.name && photo.size > 0) {
    try { image = await savePhoto(c.env, photo, "items"); } catch (e) { if (e instanceof BadImage) fail(400, e.message); throw e; }
  }
  const stamp = iso();
  const prefix = SKU_PREFIX[category] || "OTH";
  let count = (await c.db.prepare("SELECT COUNT(*) AS n FROM items").first()).n, sku;
  do { count += 1; sku = `AZ-${prefix}-${1000 + count}`; } while (await c.db.prepare("SELECT 1 FROM items WHERE sku = ?").bind(sku).first());
  // A price Gary types is his price: it is locked, so Pledge's dynamic price does not replace it.
  // 0 means "ask in store" and leaves the item open to the dynamic price.
  const r = await c.db.prepare("INSERT INTO items (sku, name, category, price_cents, price_locked, condition, description, badge, image, ship, status, available_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(sku, name, category, cents(price), cents(price) > 0 && (await c.canPrice()) ? 1 : 0, condition, description, badge, image, flag(form.get("ship")) ? 1 : 0,
      flag(form.get("publish")) ? "live" : "draft", availableOn || null, stamp, stamp).run();
  return json(staffItemView(await c.db.prepare("SELECT * FROM items WHERE id = ?").bind(r.meta.last_row_id).first()), 201);
});

on("PATCH", "/api/staff/items/:id", async (c, p) => {
  await c.staff();
  const row = await c.db.prepare("SELECT * FROM items WHERE id = ?").bind(p.id).first();
  if (!row) fail(404, "No such item.");
  const b = await body(c.request);
  if (row.status === "auction" && b.status !== undefined && b.status !== null) fail(409, "This item is on the auction block; cancel the auction first.");
  const ch = {};
  if (b.name != null) ch.name = str(b.name, 120, "Item name must be 2-120 characters.", 2);
  if (b.category != null) { if (!CATEGORIES.includes(b.category)) fail(400, `category must be one of ${CATEGORIES.join(", ")}`); ch.category = b.category; }
  if (b.condition != null) ch.condition = str(b.condition, 40, "Please check the condition.");
  if (b.description != null) ch.description = str(b.description, 4000, "The description is too long.");
  if (b.badge != null) ch.badge = str(b.badge, 30, "The badge is too long.");
  if (b.status != null) { if (!["draft", "live", "reserved", "sold", "hidden"].includes(b.status)) fail(400, "Unknown status."); ch.status = b.status; }
  if ((b.price != null || b.locked != null) && !(await c.canPrice())) fail(403, "Ask Gary to change prices or locks.");
  if (b.price != null) { ch.price_cents = cents(num(b.price, { ge: 0, le: 1_000_000 }, "Please check the price.")); ch.price_locked = 1; }
  if (b.locked != null) ch.price_locked = b.locked ? 1 : 0;
  if (b.pledge_item != null) ch.pledge_item = str(b.pledge_item, 40, "Please check the Pledge item number.") || null;
  if (b.ship != null) ch.ship = b.ship ? 1 : 0;
  if ("available_on" in b) { if (b.available_on && !isDate(b.available_on)) fail(400, "Please check the hold date."); ch.available_on = b.available_on || null; }
  const keys = Object.keys(ch);
  if (keys.length) {
    ch.updated_at = iso();
    await c.db.prepare(`UPDATE items SET ${Object.keys(ch).map(k => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...Object.values(ch), p.id).run();
  }
  return json(staffItemView(await c.db.prepare("SELECT * FROM items WHERE id = ?").bind(p.id).first()));
});

on("POST", "/api/staff/items/:id/photo", async (c, p) => {
  await c.staff();
  if (!(await c.db.prepare("SELECT 1 FROM items WHERE id = ?").bind(p.id).first())) fail(404, "No such item.");
  let form;
  try { form = await c.request.formData(); } catch { fail(400, "Please choose a photo."); }
  const photo = form.get("photo");
  if (!photo || typeof photo !== "object") fail(400, "Please choose a photo.");
  let image;
  try { image = await savePhoto(c.env, photo, "items"); } catch (e) { if (e instanceof BadImage) fail(400, e.message); throw e; }
  await c.db.prepare("UPDATE items SET image = ?, updated_at = ? WHERE id = ?").bind(image, iso(), p.id).run();
  return json(staffItemView(await c.db.prepare("SELECT * FROM items WHERE id = ?").bind(p.id).first()));
});

on("GET", "/api/staff/inquiries", async c => {
  await c.staff();
  const { results } = await c.db.prepare("SELECT * FROM inquiries ORDER BY id DESC LIMIT 500").all();
  return json(results.map(r => ({ ...r, photos: JSON.parse(r.photos) })));
});

on("PATCH", "/api/staff/inquiries/:id", async (c, p) => {
  await c.staff();
  const { status } = await body(c.request);
  if (!["new", "reviewing", "invited", "declined", "done"].includes(status)) fail(400, "Unknown status.");
  const r = await c.db.prepare("UPDATE inquiries SET status = ? WHERE id = ?").bind(status, p.id).run();
  if (!r.meta.changes) fail(404, "No such inquiry.");
  return json({ ok: true });
});

on("GET", "/api/staff/orders", async c => {
  await c.staff();
  const { results } = await c.db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 500").all();
  const out = [];
  for (const r of results) {
    const lines = (await c.db.prepare("SELECT item_id, name, price_cents FROM order_lines WHERE order_id = ?").bind(r.id).all()).results;
    out.push({ ...r, lines });
  }
  return json(out);
});

on("PATCH", "/api/staff/orders/:id", async (c, p) => {
  await c.staff();
  const { status } = await body(c.request);
  if (!["requested", "confirmed", "ready", "completed", "cancelled"].includes(status)) fail(400, "Unknown status.");
  const row = await c.db.prepare("SELECT status FROM orders WHERE id = ?").bind(p.id).first();
  if (!row) fail(404, "No such order.");
  if (["completed", "cancelled"].includes(row.status)) fail(409, "This order is already closed.");
  const stamp = iso();
  const stmts = [
    guard(c.db, "(SELECT status FROM orders WHERE id = ?) NOT IN ('completed', 'cancelled')", p.id),
    c.db.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(status, p.id),
  ];
  const itemStatus = { completed: "sold", cancelled: "live" }[status];
  if (itemStatus) stmts.push(c.db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE status = 'reserved' AND id IN (SELECT item_id FROM order_lines WHERE order_id = ?)").bind(itemStatus, stamp, p.id));
  stmts.push(unguard(c.db));
  if (!(await guarded(c.db, stmts))) fail(409, "This order is already closed.");
  return json({ ok: true });
});

on("GET", "/api/staff/auctions", async c => {
  await c.staff();
  await settleDue(c.db);
  const { results } = await c.db.prepare("SELECT * FROM auctions ORDER BY id DESC LIMIT 200").all();
  const out = [];
  for (const r of results) {
    const v = await auctionView(c.db, r);
    Object.assign(v, { reserve_cents: r.reserve_cents, item_id: r.item_id, final_cents: r.final_cents, settled_at: r.settled_at });
    v.winner = r.winner_bidder_id !== null ? await c.db.prepare("SELECT name, email, phone FROM bidders WHERE id = ?").bind(r.winner_bidder_id).first() : null;
    out.push(v);
  }
  return json(out);
});

on("POST", "/api/staff/auctions", async c => {
  await c.staff();
  const b = await body(c.request);
  const itemId = num(b.item_id, { gt: 0 }, "Please pick an item.");
  const start = num(b.start, { gt: 0, le: 1_000_000 }, "Please enter a starting bid.");
  const reserve = b.reserve == null || b.reserve === "" ? null : num(b.reserve, { gt: 0, le: 1_000_000 }, "Please check the reserve.");
  const hours = b.hours == null || b.hours === "" ? 72 : num(b.hours, { ge: 1, le: 24 * 7 }, "Auctions run 1 hour to 7 days.");
  const estimate = b.estimate == null || b.estimate === "" ? null : num(b.estimate, { gt: 0, le: 1_000_000 }, "Please check the estimate.");
  const startsIn = b.starts_in_hours == null || b.starts_in_hours === "" ? 0 : num(b.starts_in_hours, { ge: 0, le: 24 * 30 }, "Please check the start time.");
  if (reserve !== null && reserve < start) fail(400, "The reserve cannot be below the starting bid.");
  const item = await c.db.prepare("SELECT * FROM items WHERE id = ?").bind(itemId).first();
  if (!item) fail(404, "No such item.");
  if (!["live", "draft", "hidden"].includes(item.status)) fail(409, `This item is ${item.status} and cannot go to auction.`);
  if (item.available_on !== null && item.available_on > shopToday()) fail(409, "This item is still in its holding period and cannot go to auction yet.");
  const now = new Date(), starts = addHours(now, startsIn), ends = addHours(starts, hours);
  const res = await guarded(c.db, [
    guard(c.db, "(SELECT status FROM items WHERE id = ?) IN ('live', 'draft', 'hidden')", item.id),
    c.db.prepare("INSERT INTO auctions (item_id, title, description, image, start_cents, reserve_cents, starts_at, ends_at, status, created_at, estimate_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(item.id, item.name, item.description, item.image, cents(start), reserve === null ? null : cents(reserve), iso(starts), iso(ends),
        startsIn === 0 ? "live" : "scheduled", iso(now), estimate === null ? null : cents(estimate)),
    c.db.prepare("UPDATE items SET status = 'auction', updated_at = ? WHERE id = ?").bind(iso(now), item.id),
    unguard(c.db),
    c.db.prepare("SELECT * FROM auctions WHERE id = (SELECT MAX(id) FROM auctions)"),
  ]);
  if (!res) fail(409, "This item just changed. Please refresh and try again.");
  return json(await auctionView(c.db, res[res.length - 1].results[0]), 201);
});

on("POST", "/api/staff/auctions/:id/settle", async (c, p) => {
  await c.staff();
  await settleDue(c.db);
  const row = await c.db.prepare("SELECT * FROM auctions WHERE id = ?").bind(p.id).first();
  if (!row) fail(404, "No such auction.");
  if (row.status !== "ended") fail(409, "Only an ended auction can be settled.");
  if (row.settled_at !== null) fail(409, "This auction is already settled.");
  const stamp = iso();
  const stmts = [guard(c.db, "(SELECT settled_at FROM auctions WHERE id = ?) IS NULL", row.id)];
  if (row.item_id !== null) stmts.push(c.db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE id = ? AND status = 'reserved'").bind(row.winner_bidder_id !== null ? "sold" : "live", stamp, row.item_id));
  stmts.push(c.db.prepare("UPDATE auctions SET settled_at = ? WHERE id = ?").bind(stamp, row.id), unguard(c.db));
  if (!(await guarded(c.db, stmts))) fail(409, "This auction is already settled.");
  await releaseHolds(c.env, row.id, row.winner_bidder_id);
  return json({ ok: true });
});

on("POST", "/api/staff/auctions/:id/forfeit", async (c, p) => {
  await c.staff();
  const row = await c.db.prepare("SELECT * FROM auctions WHERE id = ?").bind(p.id).first();
  if (!row || row.winner_bidder_id === null) fail(409, "This auction has no winner.");
  if (await isPaid(c.db, row.id)) fail(409, "The winner already paid.");
  let captured = 0;
  const hold = await c.db.prepare("SELECT * FROM deposits WHERE auction_id = ? AND bidder_id = ? AND status = 'held'").bind(row.id, row.winner_bidder_id).first();
  if (hold && stripeEnabled(c.env)) {
    await stripe(c.env, "POST", `payment_intents/${hold.payment_intent}/capture`);
    await c.db.prepare("UPDATE deposits SET status = 'captured' WHERE id = ?").bind(hold.id).run();
    captured = hold.amount_cents;
  }
  await c.db.prepare("UPDATE bidders SET status = 'blocked' WHERE id = ?").bind(row.winner_bidder_id).run();
  return json({ ok: true, captured_cents: captured });
});

on("POST", "/api/staff/auctions/:id/cancel", async (c, p) => {
  await c.staff();
  const row = await c.db.prepare("SELECT * FROM auctions WHERE id = ?").bind(p.id).first();
  if (!row) fail(404, "No such auction.");
  if (!["scheduled", "live"].includes(row.status)) fail(409, "Only an open or scheduled auction can be cancelled.");
  const stmts = [guard(c.db, "(SELECT status FROM auctions WHERE id = ?) IN ('scheduled', 'live')", row.id),
    c.db.prepare("UPDATE auctions SET status = 'cancelled' WHERE id = ?").bind(row.id)];
  if (row.item_id !== null) stmts.push(c.db.prepare("UPDATE items SET status = 'live', updated_at = ? WHERE id = ? AND status = 'auction'").bind(iso(), row.item_id));
  stmts.push(unguard(c.db));
  if (!(await guarded(c.db, stmts))) fail(409, "Only an open or scheduled auction can be cancelled.");
  return json({ ok: true });
});

on("GET", "/api/staff/bidders", async c => {
  await c.staff();
  const { results } = await c.db.prepare("SELECT id, name, email, phone, status, created_at FROM bidders ORDER BY id DESC LIMIT 500").all();
  return json(results);
});

on("PATCH", "/api/staff/bidders/:id", async (c, p) => {
  await c.staff();
  const { status } = await body(c.request);
  if (!["pending", "approved", "blocked"].includes(status)) fail(400, "Unknown status.");
  const r = await c.db.prepare("UPDATE bidders SET status = ? WHERE id = ?").bind(status, p.id).run();
  if (!r.meta.changes) fail(404, "No such bidder.");
  if (status === "blocked") await c.db.prepare("DELETE FROM sessions WHERE kind = 'bidder' AND user_id = ?").bind(p.id).run();
  return json({ ok: true });
});

// ---------------------------------------------------------------- media
async function media(c, folder, name) {
  if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(name)) fail(404, "No such photo.");
  const obj = await c.env.MEDIA.get(`${folder}/${name}`);
  if (!obj) fail(404, "No such photo.");
  return new Response(obj.body, { headers: {
    "content-type": obj.httpMetadata?.contentType || "image/jpeg",
    "cache-control": folder === "items" ? "public, max-age=86400" : "private, no-store",
    "x-content-type-options": "nosniff",
  } });
}

// ---------------------------------------------------------------- Pledge price feed
// Pledge (the shop's counter system) sends dynamic prices here. Items only:
// no customer, ticket or loan data is accepted or stored. Signed exactly like
// Pledge's market feed: X-Pledge-Signature = sha256=HMAC(secret, timestamp + "." + body).
const FEED_MAX_BYTES = 1_000_000, FEED_MAX_ITEMS = 2000, FEED_SKEW_S = 300, FEED_MAX_CENTS = 10_000_000;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function feedSigned(c, raw) {
  const secret = c.env.PLEDGE_FEED_SECRET;
  if (!secret) fail(503, "The Pledge price feed is not set up yet.");
  const ts = c.request.headers.get("x-pledge-timestamp") || "";
  const sig = c.request.headers.get("x-pledge-signature") || "";
  if (!/^\d{9,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > FEED_SKEW_S) fail(401, "Bad or old timestamp.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = new Uint8Array([...new TextEncoder().encode(ts + "."), ...new Uint8Array(raw)]);
  const want = "sha256=" + hex(await crypto.subtle.sign("HMAC", key, msg));
  if (!sameText(want, sig)) fail(401, "Bad signature.");
  return hex(await crypto.subtle.digest("SHA-256", raw));
}

on("POST", "/api/pledge/feed", async c => {
  const raw = await c.request.arrayBuffer();
  if (raw.byteLength > FEED_MAX_BYTES) fail(413, "Too big. Send at most 2000 items at a time.");
  const digest = await feedSigned(c, raw);
  let b;
  try { b = JSON.parse(new TextDecoder().decode(raw)); } catch { fail(400, "Body must be JSON."); }
  if (!b || typeof b !== "object") fail(400, "Body must be JSON.");
  const items = Array.isArray(b.items) ? b.items : [];
  if (items.length > FEED_MAX_ITEMS) fail(413, "Too many items. Send at most 2000 at a time.");
  if (await c.db.prepare("SELECT 1 FROM feed_log WHERE digest = ?").bind(digest).first()) return json({ ok: true, duplicate: true });
  const stamp = iso();
  const at = typeof b.at === "string" && !Number.isNaN(Date.parse(b.at)) ? iso(new Date(Math.min(Date.parse(b.at), Date.now()))) : stamp;
  const stmts = [], rejected = [];
  for (const [n, it] of items.entries()) {
    const sku = typeof it?.sku === "string" ? it.sku.trim().slice(0, 40) : "";
    const pi = typeof it?.pledge_item === "string" || typeof it?.pledge_item === "number" ? String(it.pledge_item).trim().slice(0, 40) : "";
    const v = it?.dynamic_cents;
    const clear = v === null;
    if ((!sku && !pi) || (!clear && !(Number.isInteger(v) && v >= 0 && v <= FEED_MAX_CENTS))) { rejected.push(n); continue; }
    const note = typeof it.why === "string" ? it.why.trim().slice(0, 200) : "";
    const where = sku ? "sku = ?" : "pledge_item = ?";
    stmts.push(c.db.prepare(`UPDATE items SET dynamic_cents = ?, dynamic_at = ?, dynamic_note = ? WHERE ${where}`)
      .bind(clear ? null : v, clear ? null : at, clear ? "" : note, sku || pi));
  }
  let matched = 0;
  for (let i = 0; i < stmts.length; i += 100) {
    const res = await c.db.batch(stmts.slice(i, i + 100));
    matched += res.reduce((s, r) => s + (r.meta?.changes || 0), 0);
  }
  await c.db.prepare("INSERT INTO feed_log (digest, at, items, matched) VALUES (?, ?, ?, ?)").bind(digest, stamp, items.length, matched).run();
  return json({ ok: true, received: items.length, matched, rejected });
});

on("GET", "/api/staff/feed", async c => {
  await c.staff();
  const { results } = await c.db.prepare("SELECT at, items, matched FROM feed_log ORDER BY at DESC LIMIT 20").all();
  const { n } = await c.db.prepare("SELECT COUNT(*) AS n FROM items WHERE dynamic_cents IS NOT NULL").first();
  return json({ set_up: !!c.env.PLEDGE_FEED_SECRET, items_with_dynamic: n, recent: results });
});

// ---------------------------------------------------------------- entry
export default {
  async fetch(request, env, execCtx) {
    const c = makeCtx(request, env);
    const path = c.url.pathname;
    try {
      if (path.startsWith("/api/")) {
        // Every change must carry this header. A browser will not add it to a
        // cross-site request without a preflight this API never grants.
        // The Pledge feed is the exception: it is a signed server-to-server call.
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && path !== "/api/pledge/feed" && request.headers.get("x-az-request") !== "1") fail(403, "Missing request header.");
        for (const [method, re, handler] of routes) {
          const m = path.match(re);
          if (m && method === request.method) {
            const res = await handler(c, m.groups || {});
            c.extraHeaders.forEach(([k, v]) => res.headers.append(k, v));
            return res;
          }
        }
        fail(404, "Not found.");
      }
      let m = path.match(/^\/media\/items\/([^/]+)$/);
      if (m) return await media(c, "items", m[1]);
      m = path.match(/^\/media\/inquiries\/([^/]+)$/);
      if (m) { await c.staff(); return await media(c, "inquiries", m[1]); }
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ detail: e.detail }, e.status);
      console.error(e && e.stack || e);
      return json({ detail: "Something went wrong. Please try again." }, 500);
    }
  },
  // Every 5 minutes: open and close auctions on time, clear old throttle rows and sessions.
  async scheduled(event, env, execCtx) {
    await settleDue(env.DB);
    await env.DB.prepare("DELETE FROM throttle WHERE at < ?").bind(Date.now() - 24 * 3600e3).run();
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(iso()).run();
    await env.DB.prepare("DELETE FROM staff_links WHERE expires_at < ?").bind(iso(addHours(new Date(), -24 * 30))).run();
    await env.DB.prepare("DELETE FROM feed_log WHERE at < ?").bind(iso(addHours(new Date(), -24 * 7))).run();
  },
};
