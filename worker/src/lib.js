// Shared helpers for the A-Z store Worker: errors, time, passwords, sessions,
// throttling, photo cleaning and Stripe. Copyright GALOR WebWorks.

export class HttpError extends Error {
  constructor(status, detail) { super(detail); this.status = status; this.detail = detail; }
}
export const fail = (status, detail) => { throw new HttpError(status, detail); };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

// ------------------------------------------------------------------ time
// Same text format the store has always stored: 2026-11-24T16:00:00+00:00
export const iso = (d = new Date()) => d.toISOString().slice(0, 19) + "+00:00";
export const parseIso = s => new Date(s);
export const addHours = (d, h) => new Date(d.getTime() + h * 3600e3);
// "Today" for holding periods is the shop's own day in Peoria.
export function shopToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ------------------------------------------------------------------ bytes
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const unhex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
export const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256Hex(text) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))); }
function b64url(bytes) { let s = ""; bytes.forEach(b => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function safeEqual(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

// ------------------------------------------------------------------ passwords
// PBKDF2-SHA256 (Workers cap PBKDF2 at 100,000 rounds). Only the hash is stored.
const ROUNDS = 100000;
async function pbkdf2(password, salt, rounds) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ROUNDS}$${hex(salt)}$${await pbkdf2(password, salt, ROUNDS)}`;
}
export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const rounds = Number(parts[1]);
  if (!(rounds > 0 && rounds <= ROUNDS)) return false;
  return safeEqual(await pbkdf2(password, unhex(parts[2]), rounds), parts[3]);
}

// ------------------------------------------------------------------ sessions
const LIFETIME_H = { staff: 12, bidder: 30 * 24 };
export async function createSession(db, kind, userId, hours = LIFETIME_H[kind]) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare("INSERT INTO sessions (token_hash, kind, user_id, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), kind, userId, iso(addHours(new Date(), hours))).run();
  return token;
}
export async function sessionUser(db, kind, token) {
  if (!token) return null;
  const row = await db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND kind = ?")
    .bind(await sha256Hex(token), kind).first();
  if (!row || row.expires_at <= iso()) return null;
  return row.user_id;
}
export async function endSession(db, token) {
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}
export function cookies(request) {
  const out = {};
  (request.headers.get("cookie") || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
export function setCookie(name, token, kind, secure = true, hours = LIFETIME_H[kind]) {
  const maxAge = hours * 3600;
  return `${name}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export const clearCookie = (name, secure = true) => `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

// ------------------------------------------------------------------ throttle
export async function allow(db, key, limit, windowSec) {
  const now = Date.now();
  const row = await db.prepare("SELECT COUNT(*) AS n FROM throttle WHERE key = ? AND at > ?").bind(key, now - windowSec * 1000).first();
  if (row.n >= limit) return false;
  await db.prepare("INSERT INTO throttle (key, at) VALUES (?, ?)").bind(key, now).run();
  return true;
}

// ------------------------------------------------------------------ photos
// Uploads are checked by their bytes, capped at 10 MB, and stripped of
// metadata (camera EXIF, including GPS location) before they are stored.
export const MAX_UPLOAD = 10 * 1024 * 1024;
export class BadImage extends Error {}

function kindOf(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}
function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function stripJpeg(b) {
  // Keep SOI, APP0 (JFIF) and everything from the first non-APP/COM marker on.
  const parts = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xd9 || m === 0xda) break;                 // EOI / start of scan: image data follows
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new BadImage("That file is not a photo we can read.");
    const isMeta = (m >= 0xe1 && m <= 0xef) || m === 0xfe; // APP1-APP15 and comments
    if (!isMeta) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (i >= b.length) throw new BadImage("That file is not a photo we can read.");
  parts.push(b.subarray(i));
  return concat(parts);
}
function stripPng(b) {
  const drop = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);
  const parts = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = new DataView(b.buffer, b.byteOffset + i, 4).getUint32(0);
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    const end = i + 12 + len;
    if (end > b.length) throw new BadImage("That file is not a photo we can read.");
    if (!drop.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return concat(parts);
}
function stripWebp(b) {
  const parts = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(...b.subarray(i, i + 4));
    const len = new DataView(b.buffer, b.byteOffset + i + 4, 4).getUint32(0, true);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) throw new BadImage("That file is not a photo we can read.");
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (type === "VP8X") chunk[8] &= ~0x0c;            // clear the EXIF and XMP flags
      parts.push(chunk);
    }
    i = end;
  }
  const body = concat(parts), head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  return concat([head, body]);
}
export function cleanPhoto(buf) {
  const b = new Uint8Array(buf);
  if (b.length > MAX_UPLOAD) throw new BadImage("Each photo must be under 10 MB.");
  const kind = kindOf(b);
  if (!kind) throw new BadImage("Please send a JPEG, PNG or WebP photo.");
  const clean = kind === "jpg" ? stripJpeg(b) : kind === "png" ? stripPng(b) : stripWebp(b);
  return { bytes: clean, ext: kind, type: kind === "jpg" ? "image/jpeg" : `image/${kind}` };
}
export async function savePhoto(env, file, folder) {
  const { bytes, ext, type } = cleanPhoto(await file.arrayBuffer());
  const name = `${randomHex(12)}.${ext}`;
  await env.MEDIA.put(`${folder}/${name}`, bytes, { httpMetadata: { contentType: type } });
  return `/media/${folder}/${name}`;
}

// ------------------------------------------------------------------ Stripe
// Called with plain fetch; the shop's own key lives in the Worker secret
// AZ_STRIPE_SECRET_KEY. With no key the store runs without card holds.
export const stripeEnabled = env => Boolean((env.AZ_STRIPE_SECRET_KEY || "").trim());
function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, n) => (typeof x === "object" ? formEncode(x, `${key}[${n}]`, out) : out.push([`${key}[${n}]`, String(x)])));
    else if (typeof v === "object") formEncode(v, key, out);
    else out.push([key, String(v)]);
  }
  return out;
}
export async function stripe(env, method, path, params) {
  const init = { method, headers: { authorization: `Bearer ${env.AZ_STRIPE_SECRET_KEY.trim()}` } };
  let url = `https://api.stripe.com/v1/${path}`;
  if (params) {
    const body = new URLSearchParams(formEncode(params)).toString();
    if (method === "GET") url += `?${body}`;
    else { init.body = body; init.headers["content-type"] = "application/x-www-form-urlencoded"; }
  }
  const r = await fetch(url, init);
  const data = await r.json();
  if (!r.ok) throw new Error((data.error && data.error.message) || "Stripe request failed");
  return data;
}
