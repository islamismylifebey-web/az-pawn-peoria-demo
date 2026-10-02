// A-Z Jewelry & Swap Shop storefront.
// Live mode: inventory, auctions, orders and inquiries go through the store's
// own server (/api). Demo mode: when no server answers (the static GitHub
// Pages preview), the presentation data below is shown and nothing is sent.

const DEMO_PRODUCTS=[
{id:1,name:"14K Gold Diamond Ring",category:"Jewelry",price:649.00,condition:"Excellent",badge:"Featured",sku:"AZ-JWL-1042",ship:true,img:"https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=82",desc:"Pre-owned 14K yellow-gold diamond ring. Professionally cleaned for presentation. Final specifications and stone details to be verified before live sale."},
{id:2,name:"Apple MacBook Pro 13-inch",category:"Electronics",price:499.95,condition:"Good",badge:"Tested",sku:"AZ-ELC-2231",ship:true,img:"https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=82",desc:"Pre-owned MacBook Pro demonstration listing. Includes charger. Battery, storage and model-year details are sample content."},
{id:3,name:"DeWalt 20V MAX Drill Kit",category:"Tools",price:89.95,condition:"Good",badge:"Shop Pick",sku:"AZ-TOL-1844",ship:true,img:"https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=900&q=82",desc:"Cordless drill kit with battery and charger. Demo listing represents the type of tool inventory the store could publish from a simple photo-and-price intake."},
{id:4,name:"Sony PlayStation 5 Console",category:"Gaming",price:379.95,condition:"Excellent",badge:"Popular",sku:"AZ-GAM-3019",ship:true,img:"https://images.unsplash.com/photo-1607853202273-797f1c22a38e?auto=format&fit=crop&w=900&q=82",desc:"PlayStation 5 demonstration inventory with controller. Live system would include testing notes, serial tracking and exact included accessories."},
{id:5,name:"Fender-Style Electric Guitar",category:"Music",price:269.00,condition:"Good",badge:"Local Find",sku:"AZ-MUS-1477",ship:false,img:"https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=82",desc:"Pre-owned electric guitar. Local-pickup demo item. Live listing would include make, model, setup condition and amplifier/accessory details."},
{id:6,name:"Vintage Mechanical Wristwatch",category:"Jewelry",price:289.00,condition:"Very Good",badge:"Vintage",sku:"AZ-JWL-1190",ship:true,img:"https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=900&q=82",desc:"Vintage-style mechanical watch demonstration listing. Authentication, service history and specifications would be documented before a live sale."},
{id:7,name:"Canon DSLR Camera Body",category:"Electronics",price:319.95,condition:"Good",badge:"Tested",sku:"AZ-ELC-2288",ship:true,img:"https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=82",desc:"Pre-owned DSLR camera body demonstration listing. Live item page would show shutter count, included battery/charger and lens compatibility."},
{id:8,name:"Milwaukee Power Tool Set",category:"Tools",price:229.95,condition:"Good",badge:"Value",sku:"AZ-TOL-1903",ship:false,img:"https://images.unsplash.com/photo-1530124566582-a618bc2615dc?auto=format&fit=crop&w=900&q=82",desc:"Multi-tool demonstration set. Local pickup shown for the demo. Exact battery count, charger and model numbers would be captured at intake."},
{id:9,name:"Nintendo Switch Bundle",category:"Gaming",price:219.95,condition:"Good",badge:"Bundle",sku:"AZ-GAM-3061",ship:true,img:"https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?auto=format&fit=crop&w=900&q=82",desc:"Nintendo Switch demo bundle with dock and controllers. Live listings would track serial number, accessories and test results."},
{id:10,name:"Acoustic Guitar",category:"Music",price:149.95,condition:"Good",badge:"Fresh In",sku:"AZ-MUS-1511",ship:false,img:"https://images.unsplash.com/photo-1525201548942-d8732f6617a0?auto=format&fit=crop&w=900&q=82",desc:"Pre-owned acoustic guitar demonstration listing with local pickup. Live description would include brand, model and cosmetic notes."},
{id:11,name:"Vintage Typewriter",category:"Collectibles",price:129.00,condition:"Fair",badge:"Collectible",sku:"AZ-COL-0881",ship:false,img:"https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=900&q=82",desc:"Vintage typewriter demonstration item. Auction or fixed-price sale could be chosen automatically based on inventory age and owner approval."},
{id:12,name:"Silver Coin Collection",category:"Collectibles",price:399.00,condition:"Mixed",badge:"Collection",sku:"AZ-COL-0914",ship:true,img:"https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=900&q=82",desc:"Sample collectible coin lot for presentation purposes. Live listings would require exact grading, weight, composition and authentication information."}
];
const DEMO_AUCTIONS=[
{id:"A-201",title:"Vintage Railroad Pocket Watch",high_cents:18500,bid_count:12,hours:7,start_cents:15000,minimum_next_cents:19500,image:"https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=900&q=82",status:"live"},
{id:"A-202",title:"Estate Jewelry Mixed Lot",high_cents:32500,bid_count:18,hours:19,start_cents:25000,minimum_next_cents:33500,image:"https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=82",status:"live"},
{id:"A-203",title:"Vintage Camera Collection",high_cents:24000,bid_count:9,hours:31,start_cents:20000,minimum_next_cents:25000,image:"https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?auto=format&fit=crop&w=900&q=82",status:"live"}
].map(a=>({...a,ends_at:new Date(Date.now()+a.hours*3600e3).toISOString()}));

let live=false;
let products=[],auctions=[],bidder={signed_in:false};
let cart=[];try{cart=JSON.parse(localStorage.getItem("azCart")||"[]").filter(Number.isInteger)}catch{cart=[]}
let query="",category="All",sort="featured";
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const cents=c=>money((c||0)/100);
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function api(path,options={}){
 const {json,...rest}=options;
 const init={credentials:"same-origin",...rest,headers:{"x-az-request":"1",...(rest.headers||{})}};
 if(json!==undefined){init.body=JSON.stringify(json);init.headers["content-type"]="application/json"}
 const response=await fetch(path,init);
 let data=null;try{data=await response.json()}catch{}
 if(!response.ok){const detail=data&&data.detail;throw new Error(typeof detail==="string"?detail:Array.isArray(detail)?detail.map(d=>d.msg).join("; "):"Something went wrong. Please try again.")}
 return data;
}

async function detectMode(){
 try{const r=await fetch("/api/health",{cache:"no-store"});live=r.ok&&(await r.json()).mode==="live"}catch{live=false}
 $(".demo-banner").hidden=live;
 document.body.classList.toggle("demo-mode",!live);
}
async function loadProducts(){
 if(!live){products=DEMO_PRODUCTS;return}
 const items=await api("/api/items");
 products=items.map(p=>({id:p.id,name:p.name,category:p.category,price:p.price_cents/100,condition:p.condition,badge:p.badge,sku:p.sku,ship:p.ship,img:p.image,desc:p.description}));
}
async function loadAuctions(){
 if(!live){auctions=DEMO_AUCTIONS;return}
 auctions=await api("/api/auctions");
}
async function loadBidder(){
 if(!live)return;
 try{bidder=await api("/api/bidders/me")}catch{bidder={signed_in:false}}
 renderBidderBar();
}

function renderProducts(){
 let list=products.filter(p=>(category==="All"||p.category===category)&&(!query||(`${p.name} ${p.category} ${p.sku}`).toLowerCase().includes(query.toLowerCase())));
 if(sort==="low")list.sort((a,b)=>a.price-b.price);
 if(sort==="high")list.sort((a,b)=>b.price-a.price);
 $("#productGrid").innerHTML=list.length?list.map(p=>`
 <article class="product-card">
  ${p.badge?`<span class="badge">${esc(p.badge)}</span>`:""}
  <img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">
  <div class="product-body">
   <small>${esc(p.category)} · ${esc(p.condition)}</small>
   <h3>${esc(p.name)}</h3>
   <div class="price">${money(p.price)}</div>
   <div class="product-actions"><button data-view="${p.id}">Details</button><button class="buy" data-add="${p.id}">Add to cart</button></div>
  </div>
 </article>`).join(""):`<div class="empty-state">${products.length?"No items match that search.":"New inventory is on the way. Check back soon or call the store."}</div>`;
 document.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>addToCart(+b.dataset.add));
 document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>openProduct(+b.dataset.view));
}
function populateFilters(){
 const select=$("#categoryFilter");select.querySelectorAll("option:not([value=All])").forEach(o=>o.remove());
 [...new Set(products.map(p=>p.category))].forEach(c=>select.insertAdjacentHTML("beforeend",`<option value="${esc(c)}">${esc(c)}</option>`));
 select.value=[...select.options].some(o=>o.value===category)?category:"All";
}

function saveCart(){try{localStorage.setItem("azCart",JSON.stringify(cart))}catch{}}
function addToCart(id){
 const p=products.find(x=>x.id===id);if(!p)return;
 if(!cart.includes(id))cart.push(id);
 saveCart();renderCart();showToast(`${p.name} added to cart`);
}
function removeFromCart(id){cart=cart.filter(x=>x!==id);saveCart();renderCart()}
function cartProducts(){return cart.map(id=>products.find(p=>p.id===id)).filter(Boolean)}
function renderCart(){
 // Items that sold or left the store since they were added drop out of the cart.
 const before=cart.length;cart=cart.filter(id=>products.some(p=>p.id===id));if(cart.length!==before)saveCart();
 const items=cartProducts();
 $("#cartCount").textContent=items.length;
 $("#cartItems").innerHTML=items.map(p=>`<div class="cart-line"><img src="${esc(p.img)}" alt=""><div><strong>${esc(p.name)}</strong><small>${money(p.price)} · ${p.ship?"Ship or pickup":"Local pickup"}</small></div><button data-remove="${p.id}">Remove</button></div>`).join("")||"<p>Your cart is empty.</p>";
 $("#cartTotal").textContent=money(items.reduce((s,p)=>s+p.price,0));
 document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>removeFromCart(+b.dataset.remove));
}
function openCart(){renderCart();$("#cartDrawer").classList.add("open");$("#overlay").classList.add("show");$("#cartDrawer").setAttribute("aria-hidden","false")}
function closeCart(){$("#cartDrawer").classList.remove("open");$("#overlay").classList.remove("show");$("#cartDrawer").setAttribute("aria-hidden","true")}

function openModal(html){$("#modalContent").innerHTML=html;$("#modal").classList.add("show")}
function closeModal(){$("#modal").classList.remove("show")}
function openProduct(id){
 const p=products.find(x=>x.id===id);if(!p)return;
 openModal(`<div class="modal-product"><img src="${esc(p.img)}" alt="${esc(p.name)}"><div><span class="eyebrow">${esc(p.category)} · ${esc(p.condition)}</span><h2>${esc(p.name)}</h2><div class="price">${money(p.price)}</div><p>${esc(p.desc)}</p><p><strong>SKU:</strong> ${esc(p.sku)}<br><strong>Fulfillment:</strong> ${p.ship?"Shipping or local pickup":"Local pickup"}</p><button class="btn primary full" id="modalAdd">Add to cart</button></div></div>`);
 $("#modalAdd").onclick=()=>{addToCart(id);closeModal()};
}

function checkout(){
 const items=cartProducts();
 if(!items.length){showToast("Your cart is empty");return}
 if(!live){simpleModal("Checkout preview","In the live store, this reserves the items for the customer and the shop calls them to arrange payment and pickup or shipping.");return}
 const canShip=items.every(p=>p.ship),total=items.reduce((s,p)=>s+p.price,0);
 closeCart();
 openModal(`<form class="modal-form" id="orderForm"><span class="eyebrow">Reserve your items</span><h2>${items.length} item${items.length>1?"s":""} · ${money(total)}</h2>
 <p>We hold these items for you and call to arrange payment. Nothing is charged online.</p>
 <label>Name<input required name="name" minlength="2" maxlength="80" autocomplete="name"></label>
 <label>Phone<input required name="phone" minlength="7" maxlength="30" autocomplete="tel"></label>
 <label>Email (optional)<input name="email" type="email" maxlength="200" autocomplete="email"></label>
 <label>How would you like it?<select name="fulfillment"><option value="pickup">Pick up at the store</option>${canShip?'<option value="ship">Ship to me</option>':""}</select></label>
 <label>Notes<textarea name="notes" rows="2" maxlength="1000"></textarea></label>
 <p class="form-error" id="orderError" role="alert"></p>
 <button class="btn primary full">Reserve items</button></form>`);
 $("#orderForm").onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.target),button=e.target.querySelector("button");button.disabled=true;
  try{
   const result=await api("/api/orders",{method:"POST",json:{name:f.get("name"),phone:f.get("phone"),email:f.get("email")||"",fulfillment:f.get("fulfillment"),notes:f.get("notes")||"",item_ids:items.map(p=>p.id)}});
   cart=[];saveCart();await loadProducts();populateFilters();renderProducts();renderCart();
   simpleModal("Items reserved",`Thank you, ${esc(f.get("name"))}. Request #${result.order_id} is in. The shop will call you at ${esc(f.get("phone"))} to arrange payment and ${f.get("fulfillment")==="ship"?"shipping":"pickup"}.`);
  }catch(err){$("#orderError").textContent=err.message;button.disabled=false}
 };
}

// ---------------------------------------------------------------- auctions

function timeLeft(endsAt){
 const ms=new Date(endsAt)-Date.now();
 if(ms<=0)return "Closed";
 const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),sec=s%60;
 return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m ${sec}s`;
}
function auctionFlag(a){
 if(a.status==="ended")return a.you_won?"You won this lot":"";
 if(a.you_are_high)return "You're the high bidder";
 return "";
}
function renderAuctions(){
 const grid=$("#auctionGrid");
 if(!auctions.length){grid.innerHTML='<div class="empty-state">No auctions are running right now. New items go on the block regularly.</div>';return}
 grid.innerHTML=auctions.map(a=>{
  const current=a.high_cents??a.start_cents,flag=auctionFlag(a),clock=a.status==="scheduled"?a.starts_at:a.ends_at;
  const reserve=a.has_reserve?(a.reserve_met?" · reserve met":" · reserve not met"):"";
  return `<article class="auction-card"><img src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy"><div class="auction-body">
  <div class="auction-stats"><span>Lot ${esc(a.id)}</span><span>${a.bid_count} bid${a.bid_count===1?"":"s"}</span></div>
  <h3>${esc(a.title)}</h3><small>${a.status==="ended"?(a.high_cents?"Final bid":"No bids"):a.high_cents?"Current bid":"Starting bid"}${reserve}</small>
  <div class="auction-price">${cents(current)}</div>
  <div class="auction-stats"><span>${a.status==="scheduled"?"Opens in":a.status==="ended"?"Status":"Closes in"}</span><strong ${a.status==="ended"?"":`data-ends="${esc(clock)}"`}>${a.status==="ended"?"Closed":timeLeft(clock)}</strong></div>
  ${flag?`<div class="auction-flag">${esc(flag)}</div>`:""}
  <button data-bid="${esc(a.id)}" ${a.status!=="live"?"disabled":""}>${a.status==="live"?"Place bid":a.status==="ended"?"Bidding closed":"Not open yet"}</button></div></article>`}).join("");
 document.querySelectorAll("[data-bid]").forEach(b=>b.onclick=()=>openBid(b.dataset.bid));
}
function tickCountdowns(){document.querySelectorAll("[data-ends]").forEach(el=>el.textContent=timeLeft(el.dataset.ends))}

function renderBidderBar(){
 const bar=$("#bidderBar");
 if(!live){bar.innerHTML="";return}
 if(bidder.signed_in){
  bar.innerHTML=`<span>Bidding as <strong>${esc(bidder.name)}</strong>${bidder.status==="pending"?" · awaiting approval":""}</span><button class="btn outline" id="bidderLogout">Sign out</button>`;
  $("#bidderLogout").onclick=async()=>{try{await api("/api/bidders/logout",{method:"POST"})}catch{}bidder={signed_in:false};renderBidderBar();await refreshAuctions()};
 }else{
  bar.innerHTML=`<button class="btn outline" id="bidderSignIn">Bidder sign in / register</button>`;
  $("#bidderSignIn").onclick=()=>openBidderForms();
 }
}
function openBidderForms(after){
 openModal(`<div class="modal-tabs"><button class="active" data-pane="signin">Sign in</button><button data-pane="register">Create bidder account</button></div>
 <form class="modal-form" id="signinForm"><label>Email<input required type="email" name="email" autocomplete="email"></label><label>Password<input required type="password" name="password" autocomplete="current-password"></label><p class="form-error" role="alert"></p><button class="btn primary full">Sign in</button></form>
 <form class="modal-form" id="registerForm" hidden><p>The shop approves bidder accounts before the first bid, usually within a business day.</p>
 <label>Full name<input required name="name" minlength="2" maxlength="80" autocomplete="name"></label><label>Email<input required type="email" name="email" autocomplete="email"></label>
 <label>Phone<input required name="phone" minlength="7" maxlength="30" autocomplete="tel"></label><label>Password (8+ characters)<input required type="password" name="password" minlength="8" autocomplete="new-password"></label>
 <label class="check"><input required type="checkbox"> I agree that a winning bid is a commitment to buy, with payment and pickup arranged with the shop.</label>
 <p class="form-error" role="alert"></p><button class="btn primary full">Create account</button></form>`);
 document.querySelectorAll(".modal-tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".modal-tabs button").forEach(x=>x.classList.toggle("active",x===b));$("#signinForm").hidden=b.dataset.pane!=="signin";$("#registerForm").hidden=b.dataset.pane!=="register"});
 $("#signinForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);
  try{await api("/api/bidders/login",{method:"POST",json:{username:f.get("email"),password:f.get("password")}});await loadBidder();await refreshAuctions();closeModal();showToast("Signed in");if(after)after()}
  catch(err){e.target.querySelector(".form-error").textContent=err.message}};
 $("#registerForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);
  try{await api("/api/bidders/register",{method:"POST",json:{name:f.get("name"),email:f.get("email"),phone:f.get("phone"),password:f.get("password")}});
   await api("/api/bidders/login",{method:"POST",json:{username:f.get("email"),password:f.get("password")}});await loadBidder();closeModal();
   simpleModal("Account created","Thanks for registering. The shop will approve your bidder account shortly, and you can bid as soon as it is approved.")}
  catch(err){e.target.querySelector(".form-error").textContent=err.message}};
}
function openBid(id){
 const a=auctions.find(x=>String(x.id)===String(id));if(!a)return;
 if(!live){
  openModal(`<span class="eyebrow">A-Z Auction Block · Preview</span><h2>${esc(a.title)}</h2><p>Current bid: <strong>${cents(a.high_cents)}</strong></p><p>In the live store, approved bidders bid here, every bid is checked by the shop's server, and late bids extend the clock so nobody gets sniped.</p><button class="btn primary full" id="simpleClose">Close</button>`);
  $("#simpleClose").onclick=closeModal;return;
 }
 if(!bidder.signed_in){openBidderForms(()=>openBid(id));return}
 const min=a.minimum_next_cents/100;
 openModal(`<form class="modal-form" id="bidForm"><span class="eyebrow">A-Z Auction Block · Lot ${esc(a.id)}</span><h2>${esc(a.title)}</h2>
 ${a.description?`<p>${esc(a.description)}</p>`:""}
 <p>${a.high_cents?`Current bid <strong>${cents(a.high_cents)}</strong> · `:""}Minimum bid <strong>${money(min)}</strong> · closes in <strong data-ends="${esc(a.ends_at)}">${timeLeft(a.ends_at)}</strong></p>
 ${bidder.status!=="approved"?'<p class="form-error">Your bidder account is waiting for approval by the shop.</p>':""}
 <label>Your bid (USD)<input id="bidAmount" type="number" step="0.01" min="${min}" value="${min.toFixed(2)}" required></label>
 <p class="form-error" role="alert" id="bidError"></p><button class="btn primary full">Place bid</button>
 <p><small>A winning bid is a commitment to buy. A bid in the final two minutes extends the auction by two minutes.</small></p></form>`);
 $("#bidForm").onsubmit=async e=>{e.preventDefault();const amount=parseFloat($("#bidAmount").value),button=e.target.querySelector("button");button.disabled=true;
  try{await api(`/api/auctions/${encodeURIComponent(a.id)}/bids`,{method:"POST",json:{amount}});await refreshAuctions();closeModal();showToast(`Bid of ${money(amount)} placed — you're the high bidder`)}
  catch(err){$("#bidError").textContent=err.message;button.disabled=false;await refreshAuctions()}};
}
async function refreshAuctions(){try{await loadAuctions();renderAuctions()}catch{}}

// ---------------------------------------------------------------- inquiries

async function sendInquiry(form,kind){
 const data=new FormData(form);data.set("kind",kind);
 for(const [key,value] of [...data.entries()])if(value instanceof File&&!value.name)data.delete(key);
 await api("/api/inquiries",{method:"POST",body:data});
}
function inquiryForm(kind,title,intro){
 openModal(`<form class="modal-form" id="inquiryForm"><span class="eyebrow">A-Z Jewelry & Swap Shop</span><h2>${esc(title)}</h2><p>${esc(intro)}</p>
 <label>Name<input required name="name" minlength="2" maxlength="80" autocomplete="name"></label>
 <label>Phone<input required name="phone" minlength="7" maxlength="30" autocomplete="tel"></label>
 <label>What is the item?<input name="item" maxlength="200" ${kind!=="video"?"required":""}></label>
 <label>Photos (up to 6)<input name="photos" type="file" accept="image/*" multiple></label>
 <label>Notes<textarea name="notes" rows="3" maxlength="2000" placeholder="${kind==="video"?"Good times to reach you":"Brand, model, accessories, condition"}"></textarea></label>
 <p class="form-error" role="alert"></p><button class="btn primary full">Send</button>
 <small>Any regulated pawn transaction is completed in person through the shop's approved process.</small></form>`);
 $("#inquiryForm").onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector("button");button.disabled=true;
  try{if(live)await sendInquiry(e.target,kind);closeModal();simpleModal("Request sent",live?"Thanks — the shop has your request and will call you back.":"Preview only: in the live store this request goes straight to the shop's Command Center.")}
  catch(err){e.target.querySelector(".form-error").textContent=err.message;button.disabled=false}};
}

function showToast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2800)}
function simpleModal(title,body,button="Close"){
 openModal(`<span class="eyebrow">A-Z Jewelry & Swap Shop</span><h2>${esc(title)}</h2><p>${body}</p><button class="btn primary full" id="simpleClose">${esc(button)}</button>`);$("#simpleClose").onclick=closeModal;
}
function chatReply(q){
 const x=q.toLowerCase();
 if(x.includes("hour")||x.includes("open"))return "We're open Monday–Friday 9 AM–5 PM and Saturday 9 AM–3 PM. Closed Sunday.";
 if(x.includes("address")||x.includes("where"))return "A-Z Jewelry & Swap Shop is at 414 SW Adams St, Peoria, IL 61602.";
 if(x.includes("auction")||x.includes("bid"))return "Open the Auction Block and create a bidder account. Once the shop approves it you can bid, and late bids extend the clock so nobody gets sniped.";
 if(x.includes("pawn")||x.includes("loan"))return "Start with photos and item details online. Any regulated pawn transaction is completed in the store.";
 if(x.includes("sell"))return "Use the Sell to A-Z form to send photos, condition and contact details. Staff will follow up.";
 const match=products.find(p=>x.includes(p.category.toLowerCase())||x.includes(p.name.split(" ")[0].toLowerCase()));
 if(match)return `I found ${match.name} at ${money(match.price)}. Use the store search or browse ${match.category} to see it.`;
 return "I can help with store hours, location, inventory, auctions, selling an item, or the pawn inquiry process.";
}

$("#searchForm").addEventListener("submit",e=>{e.preventDefault();query=$("#searchInput").value.trim();renderProducts();$("#shop").scrollIntoView({behavior:"smooth"})});
$("#categoryFilter").onchange=e=>{category=e.target.value;renderProducts()};
$("#sortFilter").onchange=e=>{sort=e.target.value;renderProducts()};
document.querySelectorAll(".category-strip button").forEach(b=>b.onclick=()=>{category=b.dataset.category;$("#categoryFilter").value=category;renderProducts();$("#shop").scrollIntoView({behavior:"smooth"})});
$("#cartButton").onclick=openCart;$("#closeCart").onclick=closeCart;$("#overlay").onclick=closeCart;
$("#checkoutBtn").onclick=checkout;
$("#modalClose").onclick=closeModal;$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
$("#sellForm").addEventListener("submit",async e=>{e.preventDefault();const button=e.target.querySelector("button");button.disabled=true;
 try{if(live)await sendInquiry(e.target,"sell");e.target.reset();showToast(live?"Thanks — your inquiry is in. The shop will call you.":"Preview only: inquiry not sent")}
 catch(err){showToast(err.message)}finally{button.disabled=false}});
$("#pawnInquiryBtn").onclick=()=>inquiryForm("pawn","Start a pawn inquiry","Tell us about the item and send a few photos. Staff will review it and let you know the next step.");
$("#videoBtn").onclick=()=>inquiryForm("video","Request a video call","Leave your number and what you'd like to show us. Staff will send a private video link.");
$("#aiButton").onclick=()=>$("#chatPanel").classList.toggle("open");$("#closeChat").onclick=()=>$("#chatPanel").classList.remove("open");
$("#chatForm").addEventListener("submit",e=>{e.preventDefault();const inp=$("#chatInput"),q=inp.value.trim();if(!q)return;$("#chatLog").insertAdjacentHTML("beforeend",`<div class="user">${esc(q)}</div>`);inp.value="";setTimeout(()=>{$("#chatLog").insertAdjacentHTML("beforeend",`<div class="bot">${esc(chatReply(q))}</div>`);$("#chatLog").scrollTop=$("#chatLog").scrollHeight},250)});

(async function start(){
 await detectMode();
 try{await loadProducts()}catch{products=[]}
 populateFilters();renderProducts();renderCart();
 await loadBidder();
 await refreshAuctions();
 setInterval(tickCountdowns,1000);
 // Keep bids current while the page is open.
 if(live)setInterval(()=>{if(!document.hidden)refreshAuctions()},15000);
})();
