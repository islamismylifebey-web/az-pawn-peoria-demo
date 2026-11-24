// A-Z Owner Command Center.
// Live mode: staff sign in and every tab reads and changes the store's own
// server. Demo mode (static preview, no server): sample data, nothing saved.

const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((c||0)/100);
const day=iso=>iso?new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";
const ageDays=iso=>Math.max(0,Math.floor((Date.now()-new Date(iso))/86400e3));
let live=false;
const state={summary:{},orders:[],inquiries:[],items:[],auctions:[],bidders:[]};

const ago=d=>new Date(Date.now()-d*86400e3).toISOString();
const DEMO={
 summary:{open_orders:3,new_inquiries:2,live_items:5,aging_items:2,live_auctions:2,pending_bidders:1},
 orders:[
  {id:1048,name:"Marcus D.",phone:"(309) 555-0101",fulfillment:"pickup",total_cents:8995,status:"requested",lines:[{name:"DeWalt 20V Drill Kit"}],created_at:ago(0)},
  {id:1047,name:"Tanya R.",phone:"(309) 555-0102",fulfillment:"ship",total_cents:64900,status:"confirmed",lines:[{name:"14K Gold Diamond Ring"}],created_at:ago(1)},
  {id:1046,name:"Chris M.",phone:"(309) 555-0103",fulfillment:"ship",total_cents:21995,status:"ready",lines:[{name:"Nintendo Switch Bundle"}],created_at:ago(2)}],
 inquiries:[
  {id:1,kind:"sell",name:"James Carter",phone:"(309) 555-0148",item:"John Deere riding mower",condition:"Good",notes:"Runs well. New battery last year.",status:"new",photos:["https://images.unsplash.com/photo-1599685315640-9ceab2f581ca?auto=format&fit=crop&w=1000&q=82"],created_at:ago(0)},
  {id:2,kind:"pawn",name:"Linda Moore",phone:"(309) 555-0182",item:"14K gold chain",condition:"Excellent",notes:"Would like it inspected before I drive over.",status:"new",photos:["https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1000&q=82"],created_at:ago(0)},
  {id:3,kind:"video",name:"Derrick Harris",phone:"(309) 555-0194",item:"Commercial generator",condition:"",notes:"Weekday afternoons.",status:"reviewing",photos:[],created_at:ago(1)}],
 items:[
  {id:1,sku:"AZ-JWL-1042",name:"14K Gold Diamond Ring",price_cents:64900,status:"live",created_at:ago(12)},
  {id:2,sku:"AZ-ELC-2231",name:"Apple MacBook Pro 13-inch",price_cents:49995,status:"live",created_at:ago(18)},
  {id:3,sku:"AZ-COL-0881",name:"Vintage Typewriter",price_cents:12900,status:"live",created_at:ago(96)},
  {id:4,sku:"AZ-JWL-1190",name:"Vintage Mechanical Wristwatch",price_cents:28900,status:"live",created_at:ago(88)},
  {id:5,sku:"AZ-TOL-1844",name:"DeWalt 20V MAX Drill Kit",price_cents:8995,status:"reserved",created_at:ago(9)}],
 auctions:[
  {id:1,title:"Vintage Railroad Pocket Watch",status:"live",high_cents:18500,start_cents:15000,bid_count:12,ends_at:new Date(Date.now()+7*3600e3).toISOString(),has_reserve:false,reserve_met:true,winner:null},
  {id:2,title:"Estate Jewelry Mixed Lot",status:"live",high_cents:32500,start_cents:25000,bid_count:18,ends_at:new Date(Date.now()+19*3600e3).toISOString(),has_reserve:true,reserve_met:false,reserve_cents:40000,winner:null}],
 bidders:[{id:1,name:"Renee P.",email:"renee@example.com",phone:"(309) 555-0177",status:"pending",created_at:ago(0)}]
};

async function api(path,options={}){
 const {json,...rest}=options;
 const init={credentials:"same-origin",...rest,headers:{"x-az-request":"1",...(rest.headers||{})}};
 if(json!==undefined){init.body=JSON.stringify(json);init.headers["content-type"]="application/json"}
 const response=await fetch(path,init);
 let data=null;try{data=await response.json()}catch{}
 if(response.status===401&&!path.endsWith("/login")){showLogin();throw new Error("Please sign in again.")}
 if(!response.ok){const d=data&&data.detail;throw new Error(typeof d==="string"?d:Array.isArray(d)?d.map(x=>x.msg).join("; "):"Something went wrong.")}
 return data;
}
function showToast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
function guard(){if(!live){showToast("Demo only — sign in on the live Command Center to make changes");return false}return true}

function switchTab(id){
 document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.id===id));
 document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));
 const label={overview:"Overview",orders:"Orders",inquiries:"Sell / Pawn Inquiries",meetings:"Video Meetings",inventory:"Inventory",auctions:"Auctions",staff:"Staff"};
 $("#pageTitle").textContent=label[id]||"Owner Command Center";
}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
document.querySelectorAll("[data-tab-jump]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump));

async function load(){
 if(!live){Object.assign(state,structuredClone(DEMO));state.me={role:"owner",can_price:true};state.employees=[];return}
 const me=await api("/api/staff/me");
 const [summary,orders,inquiries,items,auctions,bidders]=await Promise.all(
  ["summary","orders","inquiries","items","auctions","bidders"].map(name=>api(`/api/staff/${name}`)));
 const employees=me.role==="owner"?await api("/api/staff/employees"):[];
 Object.assign(state,{me,summary,orders,inquiries,items,auctions,bidders,employees});
}
function renderAll(){renderOverview();renderOrders();renderInquiries();renderMeetings();renderInventory();renderAuctions();renderBidders();renderStaff()}

// ---- employees and printed sign-in slips (owner only)
const isOwner=()=>state.me&&state.me.role==="owner";
const canPrice=()=>state.me&&state.me.can_price;
function renderStaff(){
 $("#staffNav").hidden=!isOwner();
 if(!isOwner())return;
 $("#staffTable").innerHTML=(state.employees||[]).map(e=>{
  const acts=e.active?[`<button data-slip="${e.id}">Print slip</button>`,`<button class="secondary" data-cp="${e.id}">${e.can_price?"Stop price changes":"Allow price changes"}</button>`,`<button class="secondary" data-remove="${e.id}">Remove</button>`]:[];
  const slip=e.last_slip_at?`${new Date(e.last_slip_at).toLocaleString()}<small>${e.slip_used_at?"used "+new Date(e.slip_used_at).toLocaleString():"not used yet"}</small>`:"None yet";
  return `<tr><td><strong>${esc(e.name)}</strong></td><td>${e.can_price?"Can change":"View only"}</td><td>${slip}</td><td><span class="status${e.active?"":" maroon"}">${e.active?"Active":"Removed"}</span></td><td class="row-actions">${acts.join("")}</td></tr>`}).join("")||'<tr><td colspan="5" class="muted">No employees yet.</td></tr>';
 document.querySelectorAll("[data-slip]").forEach(b=>b.onclick=()=>printSlip(+b.dataset.slip));
 document.querySelectorAll("[data-cp]").forEach(b=>b.onclick=async()=>{
  const e=state.employees.find(x=>x.id===+b.dataset.cp);
  try{await api(`/api/staff/employees/${e.id}`,{method:"PATCH",json:{can_price:!e.can_price}});showToast("Saved");await refresh()}catch(err){showToast(err.message)}});
 document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=async()=>{
  const e=state.employees.find(x=>x.id===+b.dataset.remove);
  if(!confirm(`Remove ${e.name}? They are signed out on every device right away.`))return;
  try{await api(`/api/staff/employees/${e.id}/remove`,{method:"POST"});showToast(`${e.name} removed`);await refresh()}catch(err){showToast(err.message)}});
}
async function printSlip(id){
 if(!guard())return;
 try{
  const s=await api(`/api/staff/employees/${id}/slip`,{method:"POST"});
  const qr=qrcode(0,"M");qr.addData(s.url);qr.make();
  const exp=new Date(s.expires_at).toLocaleString([], {weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  $("#slipPrint").innerHTML=`<h2>A-Z Jewelry &amp; Swap</h2><p>Command Center sign-in</p><div class="who">${esc(s.name)}</div>${qr.createSvgTag({cellSize:4,margin:2,scalable:true})}<p>Scan with your phone camera to sign in.</p><p><b>Works once. Expires ${esc(exp)}.</b></p><small>Keep this slip private. Built by GALOR WebWorks.</small>`;
  document.body.classList.add("printing-slip");
  const done=()=>{document.body.classList.remove("printing-slip");$("#slipPrint").innerHTML="";window.removeEventListener("afterprint",done)};
  window.addEventListener("afterprint",done);
  window.print();
  setTimeout(done,60000);
  await refresh();
 }catch(err){showToast(err.message)}
}
$("#employeeForm").onsubmit=async e=>{
 e.preventDefault();if(!guard())return;
 const f=new FormData(e.target);
 try{const emp=await api("/api/staff/employees",{method:"POST",json:{name:f.get("name"),can_price:f.get("can_price")==="on"}});e.target.reset();await refresh();await printSlip(emp.id)}
 catch(err){showToast(err.message)}
};
async function refresh(){try{await load();renderAll()}catch(err){showToast(err.message)}}

const KIND={sell:"Sell",pawn:"Pawn inquiry",video:"Video request",custom:"Custom jewelry order",wanted:"Looking for"};
function renderOverview(){
 const s=state.summary;
 $("#mOrders").textContent=s.open_orders??0;$("#mInquiries").textContent=s.new_inquiries??0;
 $("#mItems").textContent=s.live_items??0;$("#mAging").textContent=s.aging_items?`${s.aging_items} over 85 days — auction candidates`:"";
 $("#mAuctions").textContent=s.live_auctions??0;$("#mBidders").textContent=s.pending_bidders?`${s.pending_bidders} bidder${s.pending_bidders>1?"s":""} awaiting approval`:"";
 const open=state.inquiries.filter(i=>i.status==="new"||i.status==="reviewing").slice(0,4);
 $("#attentionList").innerHTML=open.map(i=>`<div class="list-row"><div><strong>${esc(i.name)}</strong><span>${esc(KIND[i.kind])} · ${esc(i.item)}</span></div><span class="status maroon">${esc(i.status)}</span></div>`).join("")||'<p class="muted">Nothing waiting. New website requests appear here.</p>';
 $("#recentOrders").innerHTML=state.orders.slice(0,4).map(o=>`<div class="list-row"><div><strong>#${o.id} · ${esc(o.name)}</strong><span>${esc(o.lines.map(l=>l.name).join(", "))}</span></div><div><strong>${money(o.total_cents)}</strong><small>${esc(o.status)}</small></div></div>`).join("")||'<p class="muted">No orders yet.</p>';
}

const ORDER_STATES=["requested","confirmed","ready","completed","cancelled"];
function renderOrders(){
 const q=$("#orderSearch").value.toLowerCase();
 const list=state.orders.filter(o=>!q||`${o.id} ${o.name} ${o.phone} ${o.lines.map(l=>l.name).join(" ")}`.toLowerCase().includes(q));
 $("#ordersTable").innerHTML=list.map(o=>{const closed=o.status==="completed"||o.status==="cancelled";
  return `<tr><td><strong>#${o.id}</strong><small>${day(o.created_at)}</small></td><td>${esc(o.name)}<small><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>${o.email?" · "+esc(o.email):""}</small></td>
  <td>${esc(o.lines.map(l=>l.name).join(", "))}${o.notes?`<small>${esc(o.notes)}</small>`:""}</td><td>${money(o.total_cents)}</td><td>${o.fulfillment==="ship"?"Ship":"Local pickup"}</td>
  <td>${closed?`<span class="status">${esc(o.status)}</span>`:`<select data-order="${o.id}">${ORDER_STATES.map(s=>`<option ${s===o.status?"selected":""}>${s}</option>`).join("")}</select>`}</td></tr>`}).join("")||'<tr><td colspan="6" class="muted">No orders yet. Orders appear when customers reserve items from the store.</td></tr>';
 document.querySelectorAll("[data-order]").forEach(sel=>sel.onchange=async()=>{
  if(!guard()){sel.value=state.orders.find(o=>o.id===+sel.dataset.order).status;return}
  if((sel.value==="completed"||sel.value==="cancelled")&&!confirm(sel.value==="completed"?"Mark paid and collected? The items are marked sold.":"Cancel this order? The items go back on sale.")){renderOrders();return}
  try{await api(`/api/staff/orders/${sel.dataset.order}`,{method:"PATCH",json:{status:sel.value}});showToast(`Order #${sel.dataset.order} → ${sel.value}`);await refresh()}catch(err){showToast(err.message);renderOrders()}});
}
$("#orderSearch").oninput=renderOrders;

let selectedInquiry=null;
function renderInquiries(){
 $("#inquiryList").innerHTML=state.inquiries.map(i=>`<div class="inquiry ${i.id===selectedInquiry?"active":""}" data-inquiry="${i.id}"><strong>${esc(i.name)}</strong><span>${esc(KIND[i.kind])} · ${esc(i.item||"—")}</span><small>${esc(i.status)} · ${day(i.created_at)}</small></div>`).join("")||'<p class="muted">No inquiries yet. Sell, pawn and video requests from the website land here.</p>';
 document.querySelectorAll("[data-inquiry]").forEach(el=>el.onclick=()=>showInquiry(+el.dataset.inquiry));
 if(selectedInquiry)showInquiry(selectedInquiry);
}
function showInquiry(id){
 const i=state.inquiries.find(x=>x.id===id);if(!i)return;selectedInquiry=id;
 document.querySelectorAll(".inquiry").forEach(x=>x.classList.toggle("active",+x.dataset.inquiry===id));
 const photos=i.photos.map(src=>`<a href="${esc(src)}" target="_blank" rel="noreferrer"><img src="${esc(src)}" alt="Customer photo"></a>`).join("");
 $("#inquiryDetail").innerHTML=`<span class="eyebrow">${esc(KIND[i.kind])}</span><h2>${esc(i.name)}</h2>${photos?`<div class="photo-row">${photos}</div>`:'<p class="muted">No photos sent.</p>'}
 <div class="detail-grid"><div><span>Item</span><strong>${esc(i.item||"—")}</strong></div><div><span>Condition</span><strong>${esc(i.condition||"—")}</strong></div><div><span>Phone</span><strong><a href="tel:${esc(i.phone)}">${esc(i.phone)}</a></strong></div><div><span>Status</span><strong>${esc(i.status)}</strong></div></div>
 ${i.notes?`<p>${esc(i.notes)}</p>`:""}
 <div class="actions"><button data-meet-customer>Create video review</button><button class="secondary" data-status="reviewing">Reviewing</button><button class="secondary" data-status="invited">Invited to store</button><button class="secondary" data-status="declined">Not interested</button><button class="secondary" data-status="done">Done</button></div>`;
 $("#inquiryDetail [data-meet-customer]").onclick=()=>{switchTab("meetings");$("#meetCustomer").value=i.name;showToast("Customer loaded into video review")};
 document.querySelectorAll("#inquiryDetail [data-status]").forEach(b=>b.onclick=async()=>{
  if(!guard())return;
  try{await api(`/api/staff/inquiries/${i.id}`,{method:"PATCH",json:{status:b.dataset.status}});showToast(`${i.name}: ${b.dataset.status}`);await refresh()}catch(err){showToast(err.message)}});
}

function buildMeetMessage(){
 const name=$("#meetCustomer").value.trim()||"there",link=$("#meetLink").value.trim(),note=$("#meetNote").value.trim();
 if(!/^https:\/\/meet\.google\.com\/\S+$/.test(link)){showToast("Paste the Google Meet link first");return}
 $("#customerMessage").textContent=`Hi ${name}, this is A-Z Jewelry & Swap Shop. We'd like to take a quick live look at your item before asking you to make the trip. Join us here: ${link}${note?"\n\n"+note:""}\n\nThis video review is preliminary. Any final purchase, pawn, loan, testing, or inspection decision is handled through the store's approved process.`;
 showToast("Customer message prepared");
}
$("#prepareMessage").onclick=buildMeetMessage;
$("#copyMessage").onclick=async()=>{const text=$("#customerMessage").textContent;if(!text||text.startsWith("Create a meeting")){showToast("Prepare the message first");return}try{await navigator.clipboard.writeText(text);showToast("Message copied")}catch{showToast("Copy is unavailable in this browser")}};
function renderMeetings(){
 const requests=state.inquiries.filter(i=>i.kind==="video"&&i.status!=="done"&&i.status!=="declined");
 $("#meetingList").innerHTML=requests.map(m=>`<div class="meeting-card"><div><strong>${esc(m.name)} · ${esc(m.item||"video review")}</strong><small><a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>${m.notes?" · "+esc(m.notes):""}</small></div><button data-meet="${m.id}">Prepare message</button></div>`).join("")||'<p class="muted">No video requests waiting.</p>';
 document.querySelectorAll("[data-meet]").forEach(b=>b.onclick=()=>{const m=state.inquiries.find(x=>x.id===+b.dataset.meet);$("#meetCustomer").value=m.name;$("#meetLink").focus()});
}

// Locked = Gary's own price, always shown. Market = Pledge's dynamic price. Set = the price typed here, used until Pledge sends one.
const PRICE_LABEL={locked:"Locked",dynamic:"Market price from Pledge",set:"Set here"};
const priceCell=i=>`${i.price_cents?money(i.price_cents):"Ask for price"}<small>${PRICE_LABEL[i.price_source]||""}${i.price_source!=="dynamic"&&i.dynamic_cents!=null?` · market ${money(i.dynamic_cents)}`:""}</small>`;
const STATUS_LABEL={draft:"Draft",live:"In store",auction:"On auction",reserved:"Reserved",sold:"Sold",hidden:"Hidden"};
function renderInventory(){
 const q=$("#inventorySearch").value.toLowerCase();
 const list=state.items.filter(i=>!q||`${i.sku} ${i.name}`.toLowerCase().includes(q));
 $("#inventoryTable").innerHTML=list.map(i=>{
  const actions=[];
  if(i.status==="draft"||i.status==="hidden")actions.push(`<button data-item="${i.id}" data-set="live">Publish</button>`);
  if(i.status==="live")actions.push(`<button data-item="${i.id}" data-set="sold">Sold in store</button>`,`<button class="secondary" data-item="${i.id}" data-set="hidden">Hide</button>`,`<button class="secondary" data-auction-item="${i.id}">Auction</button>`);
  if(i.status!=="auction"&&i.status!=="sold"&&canPrice())actions.push(`<button class="secondary" data-price="${i.id}">Price</button>`,`<button class="secondary" data-lock="${i.id}">${i.price_locked?"Unlock price":"Lock price"}</button>`);
  const aging=i.status==="live"&&ageDays(i.created_at)>85;
  return `<tr><td><strong>${esc(i.sku)}</strong></td><td>${esc(i.name)}${i.available_on?`<small>for sale from ${esc(i.available_on)}</small>`:""}</td><td>${priceCell(i)}</td><td>${ageDays(i.created_at)} days${aging?' <span class="status maroon">aging</span>':""}</td><td><span class="status">${STATUS_LABEL[i.status]||esc(i.status)}</span></td><td class="row-actions">${actions.join("")}</td></tr>`}).join("")||'<tr><td colspan="6" class="muted">No items yet. Add the first one above.</td></tr>';
 document.querySelectorAll("[data-set]").forEach(b=>b.onclick=async()=>{
  if(!guard())return;
  const item=state.items.find(i=>i.id===+b.dataset.item);
  if(b.dataset.set==="sold"&&!confirm(`Mark ${item.name} as sold? It leaves the online store.`))return;
  try{await api(`/api/staff/items/${item.id}`,{method:"PATCH",json:{status:b.dataset.set}});showToast(`${item.name}: ${STATUS_LABEL[b.dataset.set]}`);await refresh()}catch(err){showToast(err.message)}});
 document.querySelectorAll("[data-price]").forEach(b=>b.onclick=async()=>{
  if(!guard())return;
  const item=state.items.find(i=>i.id===+b.dataset.price);
  const value=prompt(`Your price for ${item.name} (USD). Saving locks it, so the market price won't change it.`,(item.price_cents/100).toFixed(2));if(value===null)return;
  const price=parseFloat(value);if(!(price>=0)){showToast("Enter a valid price");return}
  try{await api(`/api/staff/items/${item.id}`,{method:"PATCH",json:{price}});showToast("Price locked");await refresh()}catch(err){showToast(err.message)}});
 document.querySelectorAll("[data-lock]").forEach(b=>b.onclick=async()=>{
  if(!guard())return;
  const item=state.items.find(i=>i.id===+b.dataset.lock);
  const locked=!item.price_locked;
  if(!locked&&!confirm(`Unlock ${item.name}? The store will show Pledge's market price when it has one.`))return;
  try{await api(`/api/staff/items/${item.id}`,{method:"PATCH",json:{locked}});showToast(locked?"Price locked":"Price unlocked");await refresh()}catch(err){showToast(err.message)}});
 document.querySelectorAll("[data-auction-item]").forEach(b=>b.onclick=()=>{switchTab("auctions");$("#auctionItem").value=b.dataset.auctionItem;$("#auctionForm [name=start]").focus()});
 renderAuctionPicker();
}
$("#inventorySearch").oninput=renderInventory;
$("#itemForm").onsubmit=async e=>{
 e.preventDefault();if(!guard())return;
 const form=new FormData(e.target),button=e.target.querySelector("button[type=submit]");
 for(const key of ["ship","publish"])if(!form.has(key))form.set(key,"false");
 if(!form.get("available_on"))form.delete("available_on");
 const photo=form.get("photo");if(photo instanceof File&&!photo.name)form.delete("photo");
 button.disabled=true;$("#itemError").textContent="";
 try{const item=await api("/api/staff/items",{method:"POST",body:form});e.target.reset();showToast(`${item.sku} saved${item.status==="live"?" and live in the store":" as a draft"}`);await refresh()}
 catch(err){$("#itemError").textContent=err.message}finally{button.disabled=false}
};

function renderAuctionPicker(){
 const select=$("#auctionItem"),current=select.value;
 const eligible=state.items.filter(i=>["live","draft","hidden"].includes(i.status)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
 select.innerHTML='<option value="">Choose an item…</option>'+eligible.map(i=>`<option value="${i.id}">${esc(i.sku)} · ${esc(i.name)} · ${money(i.price_cents)} · ${ageDays(i.created_at)} days</option>`).join("");
 if([...select.options].some(o=>o.value===current))select.value=current;
}
$("#auctionCandidate").onclick=()=>{
 const aging=state.items.filter(i=>i.status==="live"&&ageDays(i.created_at)>85);
 if(!aging.length){showToast("No items over 85 days old");return}
 $("#auctionItem").value=String(aging[0].id);showToast(`${aging.length} item${aging.length>1?"s":""} over 85 days — oldest selected`);
};
$("#auctionForm").onsubmit=async e=>{
 e.preventDefault();if(!guard())return;
 const f=new FormData(e.target),button=e.target.querySelector("button[type=submit]");
 const body={item_id:+f.get("item_id"),start:parseFloat(f.get("start")),hours:+f.get("hours"),starts_in_hours:+f.get("starts_in_hours")};
 if(f.get("reserve"))body.reserve=parseFloat(f.get("reserve"));
 button.disabled=true;$("#auctionError").textContent="";
 try{await api("/api/staff/auctions",{method:"POST",json:body});e.target.reset();showToast("Auction is on the block");await refresh()}
 catch(err){$("#auctionError").textContent=err.message}finally{button.disabled=false}
};
function timeLeft(iso){const ms=new Date(iso)-Date.now();if(ms<=0)return "closed";const h=Math.floor(ms/3600e3),m=Math.floor(ms%3600e3/60e3);return h>=24?`${Math.floor(h/24)}d ${h%24}h`:`${h}h ${m}m`}
function renderAuctions(){
 $("#auctionList").innerHTML=state.auctions.map(a=>{
  const reserve=a.reserve_cents?` · reserve ${money(a.reserve_cents)} ${a.reserve_met?"met":"not met"}`:"";
  let footer="";
  if(a.status==="live"||a.status==="scheduled")footer=`<span>${a.status==="live"?"closes in "+timeLeft(a.ends_at):"opens in "+timeLeft(a.starts_at)}</span><button class="secondary" data-cancel="${a.id}">Cancel</button>`;
  else if(a.status==="ended")footer=a.settled_at?`<span class="muted">Settled ✓</span>`:a.winner?`<span class="winner">Winner: <strong>${esc(a.winner.name)}</strong> · <a href="tel:${esc(a.winner.phone)}">${esc(a.winner.phone)}</a> · ${esc(a.winner.email)}<br>Collect ${money(a.final_cents)} and arrange pickup.</span><button data-settle="${a.id}">Mark collected</button>`:`<span>${a.bid_count?"Reserve not met":"No bids"} — item is back in the store.</span><button data-settle="${a.id}">Return to store</button>`;
  else footer=`<span>${esc(a.status)}</span>`;
  return `<article class="auction-card"><strong>${esc(a.title)}</strong><span>${a.bid_count} bid${a.bid_count===1?"":"s"} · ${esc(a.status)}${reserve}</span><div class="bid">${money(a.high_cents??a.start_cents)}</div><div class="auction-foot">${footer}</div></article>`}).join("")||'<p class="muted">No auctions yet. Start one above.</p>';
 document.querySelectorAll("[data-cancel]").forEach(b=>b.onclick=async()=>{
  if(!guard())return;
  if(!confirm("Cancel this auction? Bids are discarded and the item goes back in the store."))return;
  try{await api(`/api/staff/auctions/${b.dataset.cancel}/cancel`,{method:"POST"});showToast("Auction cancelled");await refresh()}catch(err){showToast(err.message)}});
 document.querySelectorAll("[data-settle]").forEach(b=>b.onclick=async()=>{
  if(!guard())return;
  if(!confirm("Settle this auction? The winner's item is marked sold (payment collected), or with no winner the item returns to the store."))return;
  try{await api(`/api/staff/auctions/${b.dataset.settle}/settle`,{method:"POST"});showToast("Auction settled");await refresh()}catch(err){showToast(err.message)}});
}
function renderBidders(){
 $("#biddersTable").innerHTML=state.bidders.map(b=>`<tr><td><strong>${esc(b.name)}</strong></td><td>${esc(b.email)}</td><td><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></td><td>${day(b.created_at)}</td><td><span class="status ${b.status==="pending"?"maroon":""}">${esc(b.status)}</span></td>
 <td class="row-actions">${b.status!=="approved"?`<button data-bidder="${b.id}" data-to="approved">Approve</button>`:""}${b.status!=="blocked"?`<button class="secondary" data-bidder="${b.id}" data-to="blocked">Block</button>`:""}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">No bidder accounts yet.</td></tr>';
 document.querySelectorAll("[data-bidder]").forEach(b=>b.onclick=async()=>{
  if(!guard())return;
  try{await api(`/api/staff/bidders/${b.dataset.bidder}`,{method:"PATCH",json:{status:b.dataset.to}});showToast(`Bidder ${b.dataset.to}`);await refresh()}catch(err){showToast(err.message)}});
}

$("#quickMeet").onclick=$("#quickMeet2").onclick=()=>switchTab("meetings");

function showLogin(){$("#shell").hidden=true;$("#loginScreen").hidden=false}
function showShell(){$("#loginScreen").hidden=true;$("#shell").hidden=false}
$("#loginForm").onsubmit=async e=>{
 e.preventDefault();const f=new FormData(e.target);$("#loginError").textContent="";
 try{await api("/api/staff/login",{method:"POST",json:{username:f.get("username"),password:f.get("password")}});e.target.reset();showShell();await refresh()}
 catch(err){$("#loginError").textContent=err.message}
};
$("#signOut").onclick=async()=>{if(!live){showToast("Demo only");return}try{await api("/api/staff/logout",{method:"POST"})}catch{}showLogin()};

(async function start(){
 try{const r=await fetch("/api/health",{cache:"no-store"});live=r.ok&&(await r.json()).mode==="live"}catch{live=false}
 $("#demoBanner").hidden=live;
 if(!live){showShell();await refresh();return}
 try{await api("/api/staff/me");showShell();await refresh()}catch{showLogin()}
 setInterval(()=>{if(!document.hidden&&!$("#shell").hidden)refresh()},60000);
})();
