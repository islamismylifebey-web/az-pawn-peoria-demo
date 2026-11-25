"use strict";
/* A-Z Jewelry & Swap storefront. Built by GALOR WebWorks.
   Live mode talks to the store's server on Cloudflare; preview mode (opened
   without the server) browses inventory.json and sends nothing. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = c => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((c || 0) / 100);
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const PER_PAGE = 12;
const state = { live: false, stripe: false, items: [], auctions: [], me: null, cart: [], sort: "featured" };

async function api(path, opts = {}) {
  const init = { credentials: "same-origin", ...opts, headers: { "x-az-request": "1", ...(opts.headers || {}) } };
  if (opts.json) { init.body = JSON.stringify(opts.json); init.headers["content-type"] = "application/json"; init.method = init.method || "POST"; }
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.detail ? (typeof data.detail === "string" ? data.detail : "Please check the form.") : "Something went wrong."), { status: r.status });
  return data;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3800); }
try { state.cart = JSON.parse(localStorage.getItem("az_cart") || "[]"); } catch { state.cart = []; }
function saveCart() { try { localStorage.setItem("az_cart", JSON.stringify(state.cart)); } catch {} $("#cartCount").textContent = state.cart.length; }

/* ---------------------------------------------------------------- departments
   A department is what a shopper walks up to in the store; each has aisles.
   Departments with nothing online yet still show, with a "tell us what you
   want" request, because the shop has far more on the floor than online. */
const DEPTS = [
  { slug: "jewelry", name: "Jewelry", cats: ["Jewelry"], cover: ["ring003", "ring009", "ring057"], aisles: [
    ["rings", "Rings", i => /ring/.test(key(i))], ["bracelets", "Bracelets & chains", i => /brac|chain/.test(key(i))], ["earrings", "Earrings", i => /earr/.test(key(i))]] },
  { slug: "gaming", name: "Gaming", cats: ["Gaming"], cover: ["ps-cod", "wii-play", "ps-madden"], aisles: [
    ["consoles", "Consoles & controllers", i => /ps5|pslot|xsx|xone|xbctrl|horisw|zapper|ultraracer|dsedge/.test(key(i))],
    ["playstation", "PlayStation games", i => /^ps-|^ps3-/.test(key(i))], ["wii", "Wii games", i => /^wii-/.test(key(i))],
    ["nintendo-ds", "Nintendo DS games", i => /^ds\d/.test(key(i))], ["retro", "Retro & classic", i => /snes|gc-|tony|nes/.test(key(i))]] },
  { slug: "electronics", name: "Electronics", cats: ["Electronics"], cover: [], aisles: [] },
  { slug: "tools", name: "Tools", cats: ["Tools"], cover: [], aisles: [], icon: "tools",
    blurb: "Drills, saws, impact drivers, compressors and hand tools from brands you know. Stock changes every day." },
  { slug: "music", name: "Musical instruments", cats: ["Music"], cover: [], aisles: [], icon: "music",
    blurb: "Guitars, basses, amps, keyboards and drums. Come play it before you buy it." },
  { slug: "clothing", name: "Clothing & bags", cats: ["Clothing"], cover: [], aisles: [], icon: "bags",
    blurb: "Designer handbags, purses, jackets and shoes, checked by the shop before they go on the rack." },
  { slug: "collectibles", name: "Collectibles", cats: ["Collectibles"], cover: ["slotcarousel", "slotantique", "train"], aisles: [
    ["slot-machines", "Slot machines", i => /slot/.test(key(i))], ["other", "Other collectibles", i => !/slot/.test(key(i))]] },
  { slug: "bikes", name: "Bikes", cats: ["Bikes"], cover: ["bike"], aisles: [] },
  { slug: "home", name: "Home & HVAC", cats: ["HVAC", "Other"], cover: ["coil", "ac"], aisles: [] },
];
// Always shown on the home page and menu, even with nothing listed online yet.
const ALWAYS = new Set(["jewelry", "tools", "music", "clothing"]);
function key(i) { return (i.image || "").split("/").pop().split(".")[0].toLowerCase(); }
const deptOf = i => DEPTS.find(d => d.cats.includes(i.category));
const inDept = d => state.items.filter(i => d.cats.includes(i.category));
const shown = d => ALWAYS.has(d.slug) || inDept(d).length > 0;
function coversFor(d) {
  const list = inDept(d), out = [];
  d.cover.forEach(k => { const it = list.find(i => key(i).startsWith(k) && !out.includes(i)); if (it) out.push(it); });
  for (const it of list) { if (out.length >= Math.min(3, list.length)) break; if (!out.includes(it)) out.push(it); }
  return out.slice(0, 3);
}

/* Line art for departments with nothing photographed yet and for the
   made-to-order jewelry categories. Drawn here, so no outside photos are used. */
const ART = {
  tools: `<path d="M14 50 40 24m0 0 6-6 8 8-6 6m-8-8 8 8M18 46l-6 6 4 4 6-6"/><path d="M46 52 28 34m-8-14a8 8 0 0 1 10-10l-5 5 4 4 5-5a8 8 0 0 1-10 10"/>`,
  music: `<path d="M24 46V16l26-6v30"/><circle cx="18" cy="46" r="6"/><circle cx="44" cy="40" r="6"/><path d="M24 24l26-6"/>`,
  bags: `<path d="M14 24h36l-3 30H17z"/><path d="M24 24v-4a8 8 0 0 1 16 0v4"/><path d="M14 32h36"/>`,
  engagement: `<circle cx="32" cy="40" r="14"/><path d="M26 26 32 16l6 10z"/><path d="M26 26h12M29 21h6"/>`,
  band: `<ellipse cx="32" cy="36" rx="18" ry="16"/><ellipse cx="32" cy="36" rx="13" ry="11"/><path d="M14 36c2 4 8 7 18 7s16-3 18-7"/>`,
  earrings: `<circle cx="20" cy="18" r="3"/><circle cx="44" cy="18" r="3"/><path d="M20 21v6M44 21v6"/><path d="M14 34l6-7 6 7-6 10z"/><path d="M38 34l6-7 6 7-6 10z"/>`,
  bracelet: `<ellipse cx="32" cy="34" rx="22" ry="12"/><g>${[0, 1, 2, 3, 4, 5, 6, 7].map(n => { const a = n / 8 * 6.283; return `<circle cx="${(32 + 22 * Math.cos(a)).toFixed(1)}" cy="${(34 + 12 * Math.sin(a)).toFixed(1)}" r="2.6"/>`; }).join("")}</g>`,
  necklace: `<path d="M12 12c4 18 12 26 20 26s16-8 20-26"/><path d="M28 38l4 6 4-6-4-4z"/><path d="M32 44v2"/><circle cx="32" cy="50" r="4"/>`,
  diamond: `<path d="M14 26 22 16h20l8 10-18 24z"/><path d="M14 26h36M22 16l4 10 6-10 6 10 4-10M26 26l6 24 6-24"/>`,
};
const artSVG = k => `<svg class="art" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="g-${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c4"/><stop offset=".45" stop-color="#f2b949"/><stop offset="1" stop-color="#b8771a"/></linearGradient></defs><g fill="none" stroke="url(#g-${k})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ART[k]}</g></svg>`;

const CUSTOM = [
  { k: "engagement", name: "Engagement rings", piece: "Engagement ring", note: "Solitaire, halo, three-stone or your own design" },
  { k: "band", name: "Wedding bands", piece: "Wedding band", note: "Plain, diamond, men's and women's" },
  { k: "earrings", name: "Earrings", piece: "Earrings", note: "Studs, hoops, drops and huggies" },
  { k: "bracelet", name: "Bracelets", piece: "Bracelet", note: "Tennis, bangles, links and cuffs" },
  { k: "necklace", name: "Necklaces & pendants", piece: "Necklace or pendant", note: "Chains, pendants and tennis necklaces" },
  { k: "diamond", name: "Loose lab-grown diamonds", piece: "Loose lab-grown diamond", note: "Pick the shape and size, set it your way" },
];

/* ---------------------------------------------------------------- boot */
async function boot() {
  try { const h = await (await fetch("/api/health", { cache: "no-store" })).json(); state.live = h.mode === "live"; } catch { state.live = false; }
  if (state.live) {
    try {
      const [items, cfg] = await Promise.all([api("/api/items"), api("/api/config")]);
      state.items = items; state.stripe = cfg.stripe;
      try { state.me = await api("/api/bidders/me"); } catch {}
    } catch { state.live = false; }
  }
  if (!state.live) {
    $("#demoBanner").hidden = false;
    state.items = await (await fetch("inventory/inventory.json")).json();
  }
  $("#statItems").textContent = state.items.length + "+";
  renderNav(); renderDepts(); renderFeatured(); renderCustom(); saveCart();
  route();
  await loadAuctions();
  setInterval(loadAuctions, 10000);
  setInterval(tickClocks, 1000);
  await handleStripeReturn();
}

/* ---------------------------------------------------------------- home */
const priceTag = i => i.price_cents ? `<span class="price">${money(i.price_cents)}</span>` : `<span class="price ask">Ask for price</span>`;
const cardHTML = i => `
  <article class="card reveal" data-id="${i.id}" tabindex="0">
    ${i.badge ? `<span class="badge">${esc(i.badge)}</span>` : ""}
    <div class="ph"><img loading="lazy" src="${esc(i.image)}" alt="${esc(i.name)}"></div>
    <div class="info"><div class="cat">${esc((deptOf(i) || {}).name || i.category)}</div><h3>${esc(i.name)}</h3>${priceTag(i)}</div>
    <span class="shine"></span>
  </article>`;

function renderNav() {
  $("#navDepts").innerHTML = DEPTS.filter(shown).map(d => `<a href="#/shop/${d.slug}" data-dept="${d.slug}">${esc(d.name)}</a>`).join("");
}
function renderDepts() {
  const tiles = DEPTS.filter(shown).map(d => ({ d, list: inDept(d), covers: coversFor(d) }));
  $("#deptGrid").innerHTML = tiles.map(({ d, list, covers }) => `
    <a class="dept reveal dept-${d.slug}${covers.length ? "" : " dept-art"}" href="#/shop/${d.slug}">
      ${covers.length ? `<div class="fan n${covers.length}">${covers.map(c => `<img loading="lazy" src="${esc(c.image)}" alt="">`).join("")}</div>`
        : `<div class="art-wrap">${artSVG(d.icon || "diamond")}</div>`}
      <div class="label"><h3>${esc(d.name)}</h3><small><span>${list.length ? `${list.length} ${list.length === 1 ? "item" : "items"}` : "In the shop now"}</span><span>Shop →</span></small></div>
    </a>`).join("") + `
    <div class="dept call reveal dept-call">
      <h3 style="font:600 28px/1 var(--serif)">Don't see it?</h3>
      <p>We get new pieces every day, and not everything makes it online. Tell us what you want.</p>
      <a class="btn btn-ghost small" href="tel:3096374531">Call the shop</a>
    </div>`;
  observe();
}
// Hand-picked for the front window: the best jewelry and the big-ticket electronics.
const FEATURED = ["ring010", "ring011", "ring048", "ring015", "ring003", "ps5lot", "slotantique", "ring057", "brac", "xsx"];
function renderFeatured() {
  const picked = [];
  FEATURED.forEach(k => { const it = state.items.find(i => key(i).startsWith(k) && !picked.includes(i)); if (it) picked.push(it); });
  $("#featuredRail").innerHTML = picked.map(cardHTML).join("");
  observe();
}
const customTile = c => `
  <button class="ctile reveal" data-custom="${esc(c.piece)}">
    <span class="art-wrap">${artSVG(c.k)}</span>
    <b>${esc(c.name)}</b><small>${esc(c.note)}</small><em>Available to order →</em>
  </button>`;
function renderCustom() { $("#customGrid").innerHTML = CUSTOM.map(customTile).join(""); observe(); }

/* ---------------------------------------------------------------- router
   #/            home
   #/custom      made-to-order jewelry
   #/shop        everything, with department filters
   #/shop/gaming one department, ?aisle=&q=&p= */
function parseRoute() {
  const h = location.hash || "#/";
  if (!h.startsWith("#/")) return { view: "home", anchor: h.slice(1) };
  const [path, query = ""] = h.slice(2).split("?");
  const parts = path.split("/").filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  if (parts[0] === "shop") return { view: "shop", dept: parts[1] || "", aisle: params.aisle || "", q: params.q || "", p: Math.max(1, Number(params.p) || 1) };
  if (parts[0] === "custom") return { view: "home", anchor: "custom" };
  return { view: "home" };
}
function shopURL(r, change = {}) {
  const n = { ...r, ...change };
  const qs = new URLSearchParams();
  if (n.aisle) qs.set("aisle", n.aisle);
  if (n.q) qs.set("q", n.q);
  if (n.p > 1) qs.set("p", n.p);
  const s = qs.toString();
  return `#/shop${n.dept ? "/" + n.dept : ""}${s ? "?" + s : ""}`;
}
let lastView = null;
function trk(n, p, v) { try { window.galor && window.galor.track(n, p, v); } catch (e) {} }
function route() {
  const r = parseRoute();
  trk(r.view === "shop" ? "shop_view" : "home_view", { dept: r.dept || "", q: (r.q || "").slice(0, 60) });
  $("#nav").classList.remove("open");
  document.querySelectorAll("dialog[open]").forEach(d => d.close()); // a page change closes any open form
  $$("#nav a").forEach(a => a.classList.toggle("on", r.view === "shop" && (a.dataset.dept === r.dept || (!r.dept && a.getAttribute("href") === "#/shop"))));
  if (r.view === "shop") {
    $("#home").hidden = true; $("#shopView").hidden = false;
    renderShop(r);
    if (lastView !== "shop" || r._top !== false) scrollTo({ top: 0, behavior: lastView === "shop" ? "smooth" : "auto" });
  } else {
    $("#home").hidden = false; $("#shopView").hidden = true;
    if (r.anchor) { const el = document.getElementById(r.anchor); if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), lastView === "shop" ? 30 : 0); }
    else if (lastView === "shop") scrollTo({ top: 0 });
  }
  lastView = r.view;
}
addEventListener("hashchange", route);

/* ---------------------------------------------------------------- shop page */
// Rings whose shop photo still shows the case fabric or a tag go after the clean ones.
const ROUGH_PHOTO = /^ring0(16|21|26|29|62|63|64|76|77|78|79|81)/;
function featureRank(i) {
  const k = key(i);
  if (ROUGH_PHOTO.test(k)) return 2;
  if (/^ring/.test(k)) return 0;
  if (/ps5|pslot|xsx|xone|slot|bike/.test(k)) return 1;
  if (/^brac|earr/.test(k)) return 2;
  if (i.category === "Gaming") return 4;
  return 3;
}
function wantedHTML(dept) {
  return `<form class="quote wanted" id="wantedForm" data-dept="${esc(dept ? dept.name : "")}">
    <h3>Tell us what you're after</h3>
    <p>The shop gets new ${esc(dept ? dept.name.toLowerCase() : "pieces")} every day and most never make it online. Leave your number and we'll call when it's in.</p>
    <label>What are you looking for?<input name="item" required maxlength="160" placeholder="${dept && dept.slug === "music" ? "Fender Strat, bass amp, keyboard…" : dept && dept.slug === "clothing" ? "Coach bag, leather jacket, Jordans…" : "DeWalt impact driver, Milwaukee kit…"}"></label>
    <div class="row2"><label>Your name<input name="name" required maxlength="80"></label><label>Phone<input name="phone" required maxlength="30" inputmode="tel"></label></div>
    <button class="btn btn-gold" type="submit">Call me when it's in</button>
    <p class="form-msg" role="status"></p></form>`;
}
function renderShop(r) {
  const dept = DEPTS.find(d => d.slug === r.dept) || null;
  const aisle = dept && dept.aisles.find(a => a[0] === r.aisle);
  let list = dept ? inDept(dept) : state.items.slice();
  if (aisle) list = list.filter(aisle[2]);
  const q = r.q.trim().toLowerCase();
  if (q) list = list.filter(i => (i.name + " " + i.description + " " + i.category + " " + ((deptOf(i) || {}).name || "")).toLowerCase().includes(q));
  const priced = i => i.price_cents > 0;
  if (state.sort === "low") list = list.filter(priced).sort((a, b) => a.price_cents - b.price_cents).concat(list.filter(i => !priced(i)));
  else if (state.sort === "high") list = list.filter(priced).sort((a, b) => b.price_cents - a.price_cents).concat(list.filter(i => !priced(i)));
  else if (state.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => featureRank(a) - featureRank(b) || a.id - b.id);

  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const p = Math.min(r.p, pages);
  const page = list.slice((p - 1) * PER_PAGE, p * PER_PAGE);

  const title = q && !dept ? `Results for “${r.q}”` : aisle ? aisle[1] : dept ? dept.name : "All departments";
  $("#shopTitle").textContent = title;
  $("#shopCount").textContent = list.length ? `${list.length} ${list.length === 1 ? "item" : "items"}${pages > 1 ? ` · page ${p} of ${pages}` : ""}` : "";
  $("#shopSearch").placeholder = dept ? `Search ${dept.name.toLowerCase()}` : "Search everything";
  if (document.activeElement !== $("#shopSearch")) $("#shopSearch").value = r.q;
  $("#sort").value = state.sort;

  $("#crumbs").innerHTML = `<a href="#/">Home</a><span>/</span><a href="#/shop">Shop</a>` +
    (dept ? `<span>/</span><a href="#/shop/${dept.slug}">${esc(dept.name)}</a>` : "") + (aisle ? `<span>/</span>${esc(aisle[1])}` : "");

  const intro = $("#deptIntro");
  if (dept && dept.slug === "jewelry" && !aisle && !q) {
    intro.hidden = false;
    intro.innerHTML = `<div class="intro-band"><div><p class="eyebrow">Not in the case? We'll order it.</p><h3>Lab-grown diamonds and fine jewelry, any shape, size or budget</h3></div><button class="btn btn-gold small" data-custom="">Start a custom order</button></div>`;
  } else if (dept && dept.blurb && !q) {
    intro.hidden = false;
    intro.innerHTML = `<div class="intro-band"><span class="art-wrap">${artSVG(dept.icon)}</span><div><h3>${esc(dept.name)} at A-Z</h3><p>${esc(dept.blurb)}</p></div><a class="btn btn-ghost small" href="tel:3096374531">Call the shop</a></div>`;
  } else { intro.hidden = true; intro.innerHTML = ""; }

  const deptLinks = DEPTS.filter(shown).map(d =>
    `<a href="${shopURL({ dept: d.slug, q: r.q, p: 1 })}" class="${dept === d ? "on" : ""}">${esc(d.name)}<b>${inDept(d).length}</b></a>`).join("");
  const aisleLinks = dept && dept.aisles.length ? dept.aisles.map(a => {
    const n = inDept(dept).filter(a[2]).length; if (!n) return "";
    return `<a href="${shopURL(r, { aisle: aisle && aisle[0] === a[0] ? "" : a[0], p: 1 })}" class="${aisle && aisle[0] === a[0] ? "on" : ""}">${esc(a[1])}<b>${n}</b></a>`;
  }).join("") : "";
  $("#side").innerHTML =
    (aisleLinks ? `<div><h4>${esc(dept.name)}</h4><div class="group"><a href="${shopURL(r, { aisle: "", p: 1 })}" class="${!aisle ? "on" : ""}">All ${esc(dept.name.toLowerCase())}<b>${inDept(dept).length}</b></a>${aisleLinks}</div></div>` : "") +
    (dept && dept.slug === "jewelry" ? `<div><h4>Made to order</h4><div class="group">${CUSTOM.map(c => `<a href="#/custom" data-custom="${esc(c.piece)}">${esc(c.name)}</a>`).join("")}</div></div>` : "") +
    `<div><h4>Departments</h4><div class="group"><a href="${shopURL({ dept: "", q: r.q, p: 1 })}" class="${!dept ? "on" : ""}">All<b>${state.items.length}</b></a>${deptLinks}</div></div>`;

  $("#grid").innerHTML = page.length ? page.map(cardHTML).join("") : wantedHTML(dept);

  if (pages > 1) {
    const nums = [];
    for (let n = 1; n <= pages; n++) if (n === 1 || n === pages || Math.abs(n - p) <= 1) nums.push(n); else if (nums[nums.length - 1] !== "…") nums.push("…");
    $("#pager").innerHTML = (p > 1 ? `<a href="${shopURL(r, { p: p - 1 })}" aria-label="Previous page">‹</a>` : "") +
      nums.map(n => n === "…" ? `<span>…</span>` : `<a href="${shopURL(r, { p: n })}" class="${n === p ? "on" : ""}">${n}</a>`).join("") +
      (p < pages ? `<a href="${shopURL(r, { p: p + 1 })}" aria-label="Next page">›</a>` : "");
  } else $("#pager").innerHTML = "";
  observe();
}
function openItem(id) {
  const i = state.items.find(x => String(x.id) === String(id)); if (!i) return;
  const inCart = state.cart.includes(i.id);
  $("#itemDetail").innerHTML = `
    <img src="${esc(i.image)}" alt="${esc(i.name)}">
    <p class="eyebrow">${esc((deptOf(i) || {}).name || i.category)} · ${esc(i.condition || "Pre-owned")}</p>
    <h3>${esc(i.name)}</h3>
    <p>${esc(i.description)}</p>
    <p style="font-size:22px">${priceTag(i)}</p>
    <div class="hero-cta">
      <button class="btn btn-gold" data-add="${i.id}" ${inCart ? "disabled" : ""}>${inCart ? "On your list" : "Hold it for me"}</button>
      <a class="btn btn-ghost" href="tel:3096374531">Ask about it</a>
    </div>`;
  $("#itemModal").showModal();
}
function openCustom(piece) {
  const f = $("#customForm"); $("#customMsg").textContent = "";
  if (piece) $("#customPiece").value = piece;
  $("#customModal").showModal();
  trk("custom_open", { piece: piece || "" });
}

function openCart() {
  const lines = state.cart.map(id => state.items.find(i => i.id === id)).filter(Boolean);
  const total = lines.reduce((s, i) => s + (i.price_cents || 0), 0);
  $("#cartBody").innerHTML = lines.length ? `
    <h3>Your hold list</h3>
    <p>We'll set these aside and call you. You pay when you pick up.</p>
    ${lines.map(i => `<div class="cart-line"><img src="${esc(i.image)}" alt=""><div>${esc(i.name)}<br>${priceTag(i)}</div><button data-remove="${i.id}" aria-label="Remove">×</button></div>`).join("")}
    <p style="margin-top:12px">Listed total: <b class="price">${money(total)}</b>${lines.some(i => !i.price_cents) ? " + items priced in store" : ""}</p>
    <form id="holdForm">
      <input name="name" placeholder="Your name" required minlength="2">
      <input name="phone" placeholder="Phone" required minlength="7" inputmode="tel">
      <input name="email" type="email" placeholder="Email (optional)">
      <button class="btn btn-gold">Hold these for pickup</button>
    </form>` : `<h3>Your hold list is empty</h3><p>Tap any item and choose “Hold it for me”.</p>`;
  $("#cartModal").showModal();
}

/* Photos are shrunk to 1600px JPEGs in the browser before upload: faster on a
   phone, and the re-encode drops the camera's location data. */
async function shrinkPhoto(file) {
  if (!file || !file.size || !/^image\//.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, "image/jpeg", 0.85));
    return blob ? new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}
async function sendInquiry(fd) {
  const photos = fd.getAll("photos").filter(f => f && f.size);
  fd.delete("photos");
  for (const f of photos.slice(0, 6)) fd.append("photos", await shrinkPhoto(f));
  const r = await fetch("/api/inquiries", { method: "POST", body: fd, headers: { "x-az-request": "1" } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Please check the form.");
}

/* ---------------------------------------------------------------- auctions */
async function loadAuctions() {
  if (!state.live) { state.auctions = []; renderAuctions(); return; }
  try {
    const fresh = await api("/api/auctions");
    const prev = Object.fromEntries(state.auctions.map(a => [a.id, a.high_cents]));
    state.auctions = fresh;
    renderAuctions(prev);
  } catch {}
}
function left(ends) {
  const ms = new Date(ends) - Date.now(); if (ms <= 0) return ["Closed", false];
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const p = n => String(n).padStart(2, "0");
  return [d ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(sec)}`, ms < 3.6e6];
}
function tickClocks() { $$(".clock[data-ends]").forEach(c => { const [t, hot] = left(c.dataset.ends); c.textContent = t; c.classList.toggle("hot", hot); }); }
function lotStatus(a) {
  if (a.status === "ended") {
    if (a.you_won) return a.paid ? `<p class="tag you">You won. Paid, thank you! Pick up at the shop.</p>`
      : `<p class="tag you">You won at ${money(a.high_cents)}!</p><button class="btn btn-gold" data-pay="${a.id}">Pay now</button>`;
    return `<p class="tag">Closed${a.high_cents ? " at " + money(a.high_cents) : ""}.</p>`;
  }
  if (a.status === "scheduled") return `<p class="tag">Opens soon.</p>`;
  const you = a.you_are_high ? `<p class="tag you">You're the high bidder.</p>` : "";
  return `${you}<button class="btn btn-gold" data-bid="${a.id}">${a.you_are_high ? "Raise your bid" : "Place a bid"} · ${money(a.minimum_next_cents)}+</button>`;
}
function renderAuctions(prev = {}) {
  const grid = $("#auctionGrid");
  // "Live now" and the red dots only while a lot is actually open for bids
  const liveNow = state.auctions.some(a => a.status === "live");
  document.body.classList.toggle("no-live", !liveNow);
  const eb = $("#auctionEyebrow");
  if (eb) eb.lastChild.textContent = liveNow ? " Live now" : state.auctions.length ? " Coming up" : " Opening soon";
  if (!state.auctions.length) { grid.innerHTML = `<p class="empty">New lots are being photographed. Check back soon, or call to ask what's coming up.</p>`; return; }
  grid.innerHTML = state.auctions.map(a => `
    <article class="lot" data-lot="${a.id}">
      <div class="stage"><img src="${esc(a.image)}" alt="${esc(a.title)}"><span class="clock" data-ends="${esc(a.ends_at)}">${left(a.ends_at)[0]}</span></div>
      <div class="body">
        <h3>${esc(a.title)}</h3>
        <div class="nums ${prev[a.id] !== undefined && prev[a.id] !== a.high_cents ? "flash" : ""}">
          <div><small>High bid</small><b>${a.high_cents ? money(a.high_cents) : "—"}</b></div>
          <div><small>Bids</small><b>${a.bid_count}</b></div>
          <div><small>Est. value</small><b>${a.estimate_cents ? money(a.estimate_cents) : "—"}</b></div>
        </div>
        <p class="tag">${a.high_cents ? "" : "Opening bid " + money(a.start_cents) + " · "}Security hold ${money(a.deposit_cents)}${a.has_reserve && !a.reserve_met ? " · Reserve not met" : ""}</p>
        ${lotStatus(a)}
      </div>
    </article>`).join("");
}

/* bid flow: account -> security hold -> bid */
function openBid(id) {
  const a = state.auctions.find(x => String(x.id) === String(id)); if (!a) return;
  const body = $("#bidBody");
  if (!state.live) {
    body.innerHTML = `<h3>${esc(a.title)}</h3><p>This is the preview. On the live site you'd sign in, place a ${money(a.deposit_cents)} security hold, then bid.</p>`;
  } else if (!state.me || !state.me.signed_in) {
    body.innerHTML = `
      <h3>Bid on ${esc(a.title)}</h3>
      <div class="tabs"><button class="chip on" data-tab="new">New bidder</button><button class="chip" data-tab="old">I have an account</button></div>
      <form id="regForm" data-lot="${a.id}">
        <input name="name" placeholder="Full name" required minlength="2">
        <input name="email" type="email" placeholder="Email" required>
        <input name="phone" placeholder="Phone" required minlength="7" inputmode="tel">
        <input name="password" type="password" placeholder="Make a password (8+ characters)" required minlength="8">
        <button class="btn btn-gold">Create account and continue</button>
      </form>
      <form id="loginForm" data-lot="${a.id}" hidden>
        <input name="username" type="email" placeholder="Email" required>
        <input name="password" type="password" placeholder="Password" required>
        <button class="btn btn-gold">Sign in</button>
      </form>`;
  } else if (state.stripe && !a.you_have_hold) {
    body.innerHTML = `
      <h3>One step before you bid</h3>
      <p>To keep the bidding honest, we place a security hold on your card. You only get charged if you win and never pay.</p>
      <div class="hold-box">Hold for this item: <b>${money(a.deposit_cents)}</b> (10% of the ${money(a.estimate_cents || a.start_cents)} estimate, $10 minimum). Released when the auction closes if you don't win, or when you pay for your win.</div>
      <button class="btn btn-gold" data-hold="${a.id}">Place hold with card</button>`;
  } else {
    body.innerHTML = `
      <h3>${esc(a.title)}</h3>
      <p>High bid ${a.high_cents ? money(a.high_cents) : "none yet"} · minimum next bid <b class="price">${money(a.minimum_next_cents)}</b></p>
      ${state.stripe ? "" : `<div class="hold-box">Card holds switch on once the shop connects its Stripe account.</div>`}
      <form id="bidForm" data-lot="${a.id}">
        <div class="bid-row"><input name="amount" type="number" step="1" min="${a.minimum_next_cents / 100}" value="${Math.ceil(a.minimum_next_cents / 100)}" required inputmode="decimal">
        <button class="btn btn-gold">Bid</button></div>
      </form>`;
  }
  $("#bidModal").open || $("#bidModal").showModal();
}

async function handleStripeReturn() {
  const u = new URL(location.href);
  const dep = u.searchParams.get("deposit"), paid = u.searchParams.get("paid");
  if (!dep && !paid) return;
  history.replaceState(null, "", location.pathname + "#auction");
  try {
    if (dep) { const r = await api("/api/deposits/confirm", { json: { session_id: dep } }); toast(r.held ? "Hold placed. You can bid now." : "We couldn't confirm the hold yet. Try again in a moment."); }
    if (paid) { const r = await api("/api/payments/confirm", { json: { session_id: paid } }); toast(r.paid ? "Paid! Your item will be ready for pickup." : "Payment not confirmed yet."); }
  } catch (e) { toast(e.message); }
  await loadAuctions();
}

/* ---------------------------------------------------------------- events */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-id],[data-add],[data-remove],[data-bid],[data-hold],[data-pay],[data-tab],[data-close],[data-kind],[data-custom]");
  if (!t) return;
  if (t.dataset.close !== undefined) return t.closest("dialog").close();
  if (t.dataset.custom !== undefined) { e.preventDefault(); return openCustom(t.dataset.custom); }
  if (t.dataset.add) { state.cart.push(Number(t.dataset.add)); saveCart(); t.disabled = true; t.textContent = "On your list"; toast("Added to your hold list"); return; }
  if (t.dataset.remove) { state.cart = state.cart.filter(x => x !== Number(t.dataset.remove)); saveCart(); openCart(); return; }
  if (t.dataset.bid) return openBid(t.dataset.bid);
  if (t.dataset.tab) { $$(".tabs .chip").forEach(c => c.classList.toggle("on", c === t)); $("#regForm").hidden = t.dataset.tab !== "new"; $("#loginForm").hidden = t.dataset.tab !== "old"; return; }
  if (t.dataset.kind) { const r = $(`input[name=kind][value=${t.dataset.kind}]`); if (r) r.checked = true; return; }
  if (t.dataset.hold || t.dataset.pay) {
    t.disabled = true;
    try {
      const r = await api(`/api/auctions/${t.dataset.hold || t.dataset.pay}/${t.dataset.hold ? "deposit" : "pay"}`, { method: "POST" });
      if (r.url) location.href = r.url; else { await loadAuctions(); openBid(t.dataset.hold); }
    } catch (err) { toast(err.message); t.disabled = false; }
    return;
  }
  if (t.dataset.id) openItem(t.dataset.id);
});
$("#cartBtn").onclick = openCart;
$("#menuBtn").onclick = () => $("#nav").classList.toggle("open");
// nav-close: picking a link on a phone closes the menu
$("#nav").addEventListener("click", e => { if (e.target.closest("a")) $("#nav").classList.remove("open"); });
$("#topSearch").onsubmit = e => { e.preventDefault(); const q = e.target.q.value.trim(); location.hash = shopURL({ dept: "", aisle: "", q, p: 1 }); e.target.q.blur(); };
let qTimer;
$("#shopSearch").oninput = e => { clearTimeout(qTimer); qTimer = setTimeout(() => { const r = parseRoute(); history.replaceState(null, "", shopURL(r, { q: e.target.value.trim(), p: 1 })); renderShop(parseRoute()); }, 200); };
$("#sort").onchange = e => { state.sort = e.target.value; const r = parseRoute(); history.replaceState(null, "", shopURL(r, { p: 1 })); renderShop(parseRoute()); };
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches(".card")) openItem(e.target.dataset.id); });
document.addEventListener("submit", async e => {
  const f = e.target; if (!["regForm", "loginForm", "bidForm", "holdForm", "quoteForm", "customForm", "wantedForm"].includes(f.id)) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(f));
  const btn = f.querySelector("button[type=submit],button:not([type])"); if (btn) btn.disabled = true;
  const msg = f.querySelector(".form-msg");
  try {
    if (!state.live) throw new Error("Preview mode: nothing was sent.");
    if (f.id === "regForm") {
      await api("/api/bidders/register", { json: data });
      await api("/api/bidders/login", { json: { username: data.email, password: data.password } });
      state.me = await api("/api/bidders/me"); trk("bidder_signup", { lot: f.dataset.lot }); await loadAuctions(); openBid(f.dataset.lot);
    } else if (f.id === "loginForm") {
      await api("/api/bidders/login", { json: data }); state.me = await api("/api/bidders/me"); await loadAuctions(); openBid(f.dataset.lot);
    } else if (f.id === "bidForm") {
      await api(`/api/auctions/${f.dataset.lot}/bids`, { json: { amount: Number(data.amount) } });
      trk("bid", { lot: f.dataset.lot }, Number(data.amount));
      toast(`Bid of ${money(Math.round(Number(data.amount) * 100))} placed. You're the high bidder.`);
      $("#bidModal").close(); await loadAuctions();
    } else if (f.id === "holdForm") {
      await api("/api/orders", { json: { ...data, fulfillment: "pickup", item_ids: state.cart } });
      trk("hold", { items: state.cart.length });
      state.cart = []; saveCart(); $("#cartModal").close(); toast("Done. The shop will call you when it's set aside.");
    } else if (f.id === "quoteForm") {
      await sendInquiry(new FormData(f));
      trk("quote_request"); f.reset(); msg.textContent = "Got it. We'll call you with a number.";
    } else if (f.id === "customForm") {
      const fd = new FormData(f);
      fd.set("kind", "custom");
      fd.set("item", `${data.piece} · ${data.metal} · ${data.stone} · ${data.shape}`.slice(0, 200));
      fd.set("notes", [data.size && `Size: ${data.size}`, data.budget && `Budget: ${data.budget}`, data.extra].filter(Boolean).join("\n").slice(0, 2000));
      ["piece", "metal", "stone", "shape", "size", "budget", "extra"].forEach(k => fd.delete(k));
      await sendInquiry(fd);
      trk("custom_request", { piece: data.piece });
      f.reset(); msg.textContent = "Got it. The shop will call you with options and a price.";
    } else if (f.id === "wantedForm") {
      const fd = new FormData(f);
      fd.set("kind", "wanted");
      if (f.dataset.dept) fd.set("notes", `Department: ${f.dataset.dept}`);
      await sendInquiry(fd);
      trk("wanted_request", { dept: f.dataset.dept });
      f.reset(); msg.textContent = "Got it. We'll call you when it comes in.";
    }
  } catch (err) {
    if (err.status === 402) { await loadAuctions(); openBid(f.dataset.lot); }
    toast(err.message); if (msg) msg.textContent = err.message;
  } finally { if (btn) btn.disabled = false; }
});

/* ---------------------------------------------------------------- motion */
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
document.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse") return;
  const c = e.target.closest && e.target.closest(".card,.dept,.ctile"); if (!c) return;
  const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const k = c.classList.contains("card") ? 12 : 8;
  c.style.transform = `rotateY(${(x - .5) * k}deg) rotateX(${(.5 - y) * k}deg) translateZ(6px)`;
  c.style.setProperty("--mx", x * 100 + "%"); c.style.setProperty("--my", y * 100 + "%");
});
document.addEventListener("pointerout", e => { const c = e.target.closest && e.target.closest(".card,.dept,.ctile"); if (c && !c.contains(e.relatedTarget)) c.style.transform = ""; });
const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -40px" }) : null;
function observe() { $$(".reveal:not(.in)").forEach(el => io ? io.observe(el) : el.classList.add("in")); }

(function heroDepth() {
  const img = $("#heroMedia img"); if (!img || reduceMotion) return;
  let tx = 0, ty = 0, x = 0, y = 0;
  addEventListener("pointermove", e => { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; });
  addEventListener("deviceorientation", e => { if (e.gamma == null) return; tx = Math.max(-1, Math.min(1, e.gamma / 30)) * .5; ty = Math.max(-1, Math.min(1, (e.beta - 45) / 30)) * .5; });
  (function loop() {
    x += (tx - x) * .06; y += (ty - y) * .06;
    if (!$("#home").hidden) img.style.transform = `perspective(1200px) rotateY(${x * -7}deg) rotateX(${y * 5}deg) scale(1.06) translate3d(${x * -16}px,${y * -10}px,0)`;
    requestAnimationFrame(loop);
  })();
})();

(function sparkle() {
  const cv = $("#sparkle"); if (!cv || reduceMotion) return;
  const ctx = cv.getContext("2d"); let w, h, dpr;
  const glints = [];
  function size() { dpr = Math.min(devicePixelRatio || 1, 2); w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  size(); addEventListener("resize", size);
  function spawn() {
    const media = $("#heroMedia").getBoundingClientRect(), box = cv.getBoundingClientRect();
    const left = media.left - box.left, top = media.top - box.top;
    glints.push({ x: left + media.width * (.15 + Math.random() * .75), y: top + media.height * (.08 + Math.random() * .62),
      life: 0, max: 50 + Math.random() * 60, size: 6 + Math.random() * 16 });
  }
  (function frame() {
    requestAnimationFrame(frame);
    if ($("#home").hidden || scrollY > innerHeight) return;
    ctx.clearRect(0, 0, w, h);
    if (glints.length < 14 && Math.random() < .2) spawn();
    for (let n = glints.length - 1; n >= 0; n--) {
      const g = glints[n]; g.life++;
      const t = g.life / g.max, a = Math.sin(t * Math.PI), s = g.size * (.4 + a * .8);
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(t * .6); ctx.globalCompositeOperation = "lighter";
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.4);
      grd.addColorStop(0, `rgba(255,248,225,${a})`); grd.addColorStop(.25, `rgba(255,214,130,${a * .55})`); grd.addColorStop(1, "rgba(255,170,40,0)");
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(0, 0, s * 1.4, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,250,235,${a * .9})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-s * 2.2, 0); ctx.lineTo(s * 2.2, 0); ctx.moveTo(0, -s * 2.2); ctx.lineTo(0, s * 2.2); ctx.stroke();
      ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.moveTo(s, -s); ctx.lineTo(-s, s); ctx.stroke();
      ctx.restore();
      if (g.life >= g.max) glints.splice(n, 1);
    }
  })();
})();

boot();
