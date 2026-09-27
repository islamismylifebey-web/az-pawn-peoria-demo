const products=[
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

const auctions=[
{id:"A-201",name:"Vintage Railroad Pocket Watch",bid:185,bids:12,hours:7,img:"https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=900&q=82"},
{id:"A-202",name:"Estate Jewelry Mixed Lot",bid:325,bids:18,hours:19,img:"https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=82"},
{id:"A-203",name:"Vintage Camera Collection",bid:240,bids:9,hours:31,img:"https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?auto=format&fit=crop&w=900&q=82"}
];

let cart=JSON.parse(localStorage.getItem("azDemoCart")||"[]");
let query="",category="All",sort="featured";
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const $=s=>document.querySelector(s);

function renderProducts(){
 let list=products.filter(p=>(category==="All"||p.category===category)&&(!query||(`${p.name} ${p.category} ${p.sku}`).toLowerCase().includes(query.toLowerCase())));
 if(sort==="low")list.sort((a,b)=>a.price-b.price);
 if(sort==="high")list.sort((a,b)=>b.price-a.price);
 $("#productGrid").innerHTML=list.length?list.map(p=>`
 <article class="product-card">
  <span class="badge">${p.badge}</span>
  <img src="${p.img}" alt="${p.name}" loading="lazy">
  <div class="product-body">
   <small>${p.category} · ${p.condition}</small>
   <h3>${p.name}</h3>
   <div class="price">${money(p.price)}</div>
   <div class="product-actions"><button data-view="${p.id}">Details</button><button class="buy" data-add="${p.id}">Add to cart</button></div>
  </div>
 </article>`).join(""):'<div class="empty-state">No demo inventory matches that search.</div>';
 document.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>addToCart(+b.dataset.add));
 document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>openProduct(+b.dataset.view));
}

function populateFilters(){
 [...new Set(products.map(p=>p.category))].forEach(c=>$("#categoryFilter").insertAdjacentHTML("beforeend",`<option value="${c}">${c}</option>`));
}
function addToCart(id){
 const p=products.find(x=>x.id===id); if(!p)return;
 const found=cart.find(x=>x.id===id); found?found.qty++:cart.push({id,qty:1});
 localStorage.setItem("azDemoCart",JSON.stringify(cart));renderCart();showToast(`${p.name} added to demo cart`);
}
function removeFromCart(id){cart=cart.filter(x=>x.id!==id);localStorage.setItem("azDemoCart",JSON.stringify(cart));renderCart()}
function renderCart(){
 const count=cart.reduce((s,x)=>s+x.qty,0);$("#cartCount").textContent=count;
 const lines=cart.map(x=>{const p=products.find(y=>y.id===x.id);return p?`<div class="cart-line"><img src="${p.img}" alt=""><div><strong>${p.name}</strong><small>Qty ${x.qty} · ${money(p.price)}</small></div><button data-remove="${p.id}">Remove</button></div>`:""}).join("");
 $("#cartItems").innerHTML=lines||"<p>Your demo cart is empty.</p>";
 $("#cartTotal").textContent=money(cart.reduce((s,x)=>{const p=products.find(y=>y.id===x.id);return s+(p?p.price*x.qty:0)},0));
 document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>removeFromCart(+b.dataset.remove));
}
function openCart(){renderCart();$("#cartDrawer").classList.add("open");$("#overlay").classList.add("show");$("#cartDrawer").setAttribute("aria-hidden","false")}
function closeCart(){$("#cartDrawer").classList.remove("open");$("#overlay").classList.remove("show");$("#cartDrawer").setAttribute("aria-hidden","true")}
function openProduct(id){
 const p=products.find(x=>x.id===id);if(!p)return;
 $("#modalContent").innerHTML=`<div class="modal-product"><img src="${p.img}" alt="${p.name}"><div><span class="eyebrow">${p.category} · ${p.condition}</span><h2>${p.name}</h2><div class="price">${money(p.price)}</div><p>${p.desc}</p><p><strong>SKU:</strong> ${p.sku}<br><strong>Fulfillment:</strong> ${p.ship?"Shipping or local pickup":"Local pickup"}</p><button class="btn primary full" id="modalAdd">Add to demo cart</button></div></div>`;
 $("#modal").classList.add("show");$("#modalAdd").onclick=()=>{addToCart(id);closeModal()};
}
function closeModal(){$("#modal").classList.remove("show")}
function renderAuctions(){
 $("#auctionGrid").innerHTML=auctions.map(a=>`<article class="auction-card"><img src="${a.img}" alt="${a.name}" loading="lazy"><div class="auction-body"><div class="auction-stats"><span>${a.id}</span><span>${a.bids} bids</span></div><h3>${a.name}</h3><small>Current demo bid</small><div class="auction-price">${money(a.bid)}</div><div class="auction-stats"><span>Closes in</span><strong data-countdown="${a.hours}"></strong></div><button data-bid="${a.id}">Place demo bid</button></div></article>`).join("");
 document.querySelectorAll("[data-bid]").forEach(b=>b.onclick=()=>openBid(b.dataset.bid));
 updateCountdowns();
}
function updateCountdowns(){document.querySelectorAll("[data-countdown]").forEach(el=>{const h=+el.dataset.countdown;const m=new Date().getMinutes();el.textContent=`${h}h ${59-m}m`})}
function openBid(id){
 const a=auctions.find(x=>x.id===id);
 $("#modalContent").innerHTML=`<span class="eyebrow">A-Z Auction Block · Demo</span><h2>${a.name}</h2><p>Current demo bid: <strong>${money(a.bid)}</strong></p><label>Enter a demo bid<input id="bidAmount" type="number" min="${a.bid+5}" value="${a.bid+10}" style="width:100%;padding:12px;margin:8px 0 16px"></label><button class="btn primary full" id="submitBid">Place demo bid</button><p><small>No money is collected and no bid is transmitted. Live auctions would require identity, payment and auction-rule integrations.</small></p>`;
 $("#modal").classList.add("show");$("#submitBid").onclick=()=>{showToast("Demo bid recorded locally for presentation");closeModal()};
}
function showToast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
function simpleModal(title,body,button="Close"){
 $("#modalContent").innerHTML=`<span class="eyebrow">A-Z Digital Store</span><h2>${title}</h2><p>${body}</p><button class="btn primary full" id="simpleClose">${button}</button>`;$("#modal").classList.add("show");$("#simpleClose").onclick=closeModal;
}
function chatReply(q){
 const x=q.toLowerCase();
 if(x.includes("hour")||x.includes("open"))return "The demo lists Monday–Friday 9 AM–5 PM, Saturday 9 AM–3 PM, and Sunday closed.";
 if(x.includes("address")||x.includes("where"))return "A-Z Jewelry & Swap Shop is shown at 414 SW Adams St, Peoria, IL 61602.";
 if(x.includes("pawn")||x.includes("loan"))return "You can start with photos and item details online. The demo intentionally keeps any regulated pawn transaction in the store's approved in-person process.";
 if(x.includes("sell"))return "Use the Sell to A-Z form to send photos, condition and contact details. Staff can then ask for more information or invite you in.";
 const match=products.find(p=>x.includes(p.category.toLowerCase())||x.includes(p.name.split(" ")[0].toLowerCase()));
 if(match)return `I found a demo item: ${match.name} at ${money(match.price)}. Use the store search or browse ${match.category} to see it.`;
 return "I can help with store hours, location, demo inventory, auctions, selling an item, or the pawn inquiry process.";
}

$("#searchForm").addEventListener("submit",e=>{e.preventDefault();query=$("#searchInput").value.trim();renderProducts();document.querySelector("#shop").scrollIntoView({behavior:"smooth"})});
$("#categoryFilter").onchange=e=>{category=e.target.value;renderProducts()};
$("#sortFilter").onchange=e=>{sort=e.target.value;renderProducts()};
document.querySelectorAll(".category-strip button").forEach(b=>b.onclick=()=>{category=b.dataset.category;$("#categoryFilter").value=category;renderProducts();$("#shop").scrollIntoView({behavior:"smooth"})});
$("#cartButton").onclick=openCart;$("#closeCart").onclick=closeCart;$("#overlay").onclick=closeCart;
$("#checkoutBtn").onclick=()=>simpleModal("Demo checkout","The presentation storefront is ready for a real payment provider, tax, shipping and inventory connection. Checkout is intentionally non-transactional until the merchant account and permitted product categories are verified.");
$("#modalClose").onclick=closeModal;$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
$("#sellForm").addEventListener("submit",e=>{e.preventDefault();e.target.reset();showToast("Demo sell inquiry captured")});
$("#pawnInquiryBtn").onclick=()=>simpleModal("Start a pawn inquiry","A production version can collect photos, item details and contact information, then route the request to staff. Final terms and regulated steps remain inside the approved store process.");
$("#videoBtn").onclick=()=>simpleModal("Request a video conversation","The production workflow can create a Google Meet or other approved video link after staff decides a virtual review would be useful.");
$("#aiButton").onclick=()=>$("#chatPanel").classList.toggle("open");$("#closeChat").onclick=()=>$("#chatPanel").classList.remove("open");
$("#chatForm").addEventListener("submit",e=>{e.preventDefault();const inp=$("#chatInput"),q=inp.value.trim();if(!q)return;$("#chatLog").insertAdjacentHTML("beforeend",`<div class="user">${q.replace(/[<>]/g,"")}</div>`);inp.value="";setTimeout(()=>{$("#chatLog").insertAdjacentHTML("beforeend",`<div class="bot">${chatReply(q)}</div>`);$("#chatLog").scrollTop=$("#chatLog").scrollHeight},250)});
populateFilters();renderProducts();renderAuctions();renderCart();setInterval(updateCountdowns,60000);