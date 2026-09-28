const orders=[
{id:"#AZ-1048",customer:"Marcus D.",item:"DeWalt 20V Drill Kit",amount:89.95,fulfillment:"Local pickup",status:"Paid"},
{id:"#AZ-1047",customer:"Tanya R.",item:"14K Gold Diamond Ring",amount:649,fulfillment:"Ship",status:"Processing"},
{id:"#AZ-1046",customer:"Chris M.",item:"Nintendo Switch Bundle",amount:219.95,fulfillment:"Ship",status:"Packed"},
{id:"#AZ-1045",customer:"Jalen B.",item:"Canon DSLR Camera Body",amount:319.95,fulfillment:"Local pickup",status:"Ready"},
{id:"#AZ-1044",customer:"Derrick S.",item:"Vintage Mechanical Wristwatch",amount:289,fulfillment:"Ship",status:"Delivered"},
{id:"#AZ-1043",customer:"Renee P.",item:"Acoustic Guitar",amount:149.95,fulfillment:"Local pickup",status:"Ready"},
{id:"#AZ-1042",customer:"Angela K.",item:"Silver Coin Collection",amount:399,fulfillment:"Ship",status:"Processing"}
];
const inquiries=[
{id:1,name:"James Carter",type:"Sell",item:"John Deere riding mower",condition:"Good",phone:"(309) 555-0148",note:"Runs well. New battery last year. Can send more photos.",priority:"Needs review",img:"https://images.unsplash.com/photo-1599685315640-9ceab2f581ca?auto=format&fit=crop&w=1000&q=82"},
{id:2,name:"Linda Moore",type:"Pawn inquiry",item:"14K gold chain",condition:"Excellent",phone:"(309) 555-0182",note:"Would like to know if this is something you would inspect before I drive over.",priority:"Video helpful",img:"https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1000&q=82"},
{id:3,name:"Anthony Lewis",type:"Sell",item:"Milwaukee tool set",condition:"Good",phone:"(309) 555-0194",note:"Five tools, two batteries, charger and case.",priority:"Ready to invite",img:"https://images.unsplash.com/photo-1530124566582-a618bc2615dc?auto=format&fit=crop&w=1000&q=82"},
{id:4,name:"Sheila Grant",type:"Pawn inquiry",item:"Laptop computer",condition:"Good",phone:"(309) 555-0177",note:"Works. Charger included. Not sure of exact model.",priority:"Needs model number",img:"https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1000&q=82"}
];
const inventory=[
["AZ-JWL-1042","14K Gold Diamond Ring","Jewelry","$649.00","12 days","Store + Web"],
["AZ-ELC-2231","Apple MacBook Pro 13-inch","Electronics","$499.95","18 days","Store + Web"],
["AZ-TOL-1844","DeWalt 20V MAX Drill Kit","Tools","$89.95","9 days","Store + Web"],
["AZ-GAM-3019","Sony PlayStation 5 Console","Gaming","$379.95","5 days","Store + Web"],
["AZ-COL-0881","Vintage Typewriter","Collectibles","$129.00","96 days","Auction candidate"],
["AZ-MUS-1477","Electric Guitar","Music","$269.00","42 days","Store + Web"],
["AZ-JWL-1190","Vintage Mechanical Wristwatch","Jewelry","$289.00","88 days","Auction review"]
];
const auctions=[
{name:"Vintage Railroad Pocket Watch",bid:"$185.00",bids:12,time:"7h 22m"},
{name:"Estate Jewelry Mixed Lot",bid:"$325.00",bids:18,time:"19h 41m"},
{name:"Vintage Camera Collection",bid:"$240.00",bids:9,time:"1d 7h"}
];
const meetings=[
{name:"Linda Moore",item:"14K gold chain",time:"Today · 4:30 PM",status:"Awaiting link"},
{name:"Derrick Harris",item:"Commercial generator",time:"Tomorrow · 10:00 AM",status:"Scheduled"}
];
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);

function switchTab(id){
 document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.id===id));
 document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));
 const label={overview:"Overview",orders:"Orders",inquiries:"Sell / Pawn Inquiries",meetings:"Video Meetings",inventory:"Inventory",auctions:"Auctions"};
 $("#pageTitle").textContent=label[id]||"Owner Command Center";
}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
document.querySelectorAll("[data-tab-jump]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump));

function renderOverview(){
 $("#attentionList").innerHTML=inquiries.slice(0,3).map(i=>`<div class="list-row"><div><strong>${i.name}</strong><span>${i.type} · ${i.item}</span></div><span class="status maroon">${i.priority}</span></div>`).join("");
 $("#recentOrders").innerHTML=orders.slice(0,4).map(o=>`<div class="list-row"><div><strong>${o.id} · ${o.customer}</strong><span>${o.item}</span></div><div><strong>${money(o.amount)}</strong><small>${o.status}</small></div></div>`).join("");
}
function renderOrders(list=orders){
 $("#ordersTable").innerHTML=list.map(o=>`<tr><td><strong>${o.id}</strong></td><td>${o.customer}</td><td>${o.item}</td><td>${money(o.amount)}</td><td>${o.fulfillment}</td><td><span class="status">${o.status}</span></td></tr>`).join("");
}
$("#orderSearch").oninput=e=>{const q=e.target.value.toLowerCase();renderOrders(orders.filter(o=>Object.values(o).join(" ").toLowerCase().includes(q)))};

function renderInquiries(){
 $("#inquiryList").innerHTML=inquiries.map(i=>`<div class="inquiry" data-inquiry="${i.id}"><strong>${i.name}</strong><span>${i.type} · ${i.item}</span><small>${i.priority}</small></div>`).join("");
 document.querySelectorAll("[data-inquiry]").forEach(el=>el.onclick=()=>showInquiry(+el.dataset.inquiry));
}
function showInquiry(id){
 const i=inquiries.find(x=>x.id===id); if(!i)return;
 document.querySelectorAll(".inquiry").forEach(x=>x.classList.toggle("active",+x.dataset.inquiry===id));
 $("#inquiryDetail").innerHTML=`<span class="eyebrow">${i.type}</span><h2>${i.name}</h2><img src="${i.img}" alt="${i.item}"><div class="detail-grid"><div><span>Item</span><strong>${i.item}</strong></div><div><span>Condition</span><strong>${i.condition}</strong></div><div><span>Phone</span><strong>${i.phone}</strong></div><div><span>Status</span><strong>${i.priority}</strong></div></div><p>${i.note}</p><div class="actions"><button data-meet-customer="${i.name}">Create video review</button><button class="secondary" id="inviteStore">Invite to store</button><button class="secondary" id="declineItem">Not interested</button></div>`;
 $("#inquiryDetail").querySelector("[data-meet-customer]").onclick=()=>{switchTab("meetings");$("#meetCustomer").value=i.name;showToast("Customer loaded into video review")};
 $("#inviteStore").onclick=()=>showToast("Demo: customer marked for in-store invitation");
 $("#declineItem").onclick=()=>showToast("Demo: inquiry marked not interested");
}

function buildMeetMessage(){
 const name=$("#meetCustomer").value.trim()||"there";
 const link=$("#meetLink").value.trim();
 const note=$("#meetNote").value.trim();
 if(!link){showToast("Paste the Google Meet link first");return}
 const msg=`Hi ${name}, this is A-Z Jewelry & Swap Shop. We'd like to take a quick live look at your item before asking you to make the trip. Join us here: ${link}${note?"\n\n"+note:""}\n\nThis video review is preliminary. Any final purchase, pawn, loan, testing, or inspection decision is handled through the store's approved process.`;
 $("#customerMessage").textContent=msg;
 showToast("Customer message prepared");
}
$("#prepareMessage").onclick=buildMeetMessage;
$("#copyMessage").onclick=async()=>{const text=$("#customerMessage").textContent;if(!text||text.startsWith("Create a meeting")){showToast("Prepare the message first");return}try{await navigator.clipboard.writeText(text);showToast("Message copied")}catch{showToast("Copy is unavailable in this browser")}};

function renderMeetings(){
 $("#meetingList").innerHTML=meetings.map(m=>`<div class="meeting-card"><div><strong>${m.name} · ${m.item}</strong><small>${m.time}</small></div><span class="status maroon">${m.status}</span></div>`).join("");
}
function renderInventory(){
 $("#inventoryTable").innerHTML=inventory.map(r=>`<tr>${r.map((c,i)=>`<td>${i<2?"<strong>"+c+"</strong>":c}</td>`).join("")}</tr>`).join("");
}
function renderAuctions(){
 $("#auctionList").innerHTML=auctions.map(a=>`<article class="auction-card"><strong>${a.name}</strong><span>${a.bids} bids · closes in ${a.time}</span><div class="bid">${a.bid}</div><button class="nav" style="background:#fff;color:#25282d;border:1px solid #d9dde3" onclick="showToast('Demo auction opened')">Review auction</button></article>`).join("");
}
function showToast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2400)}
$("#quickMeet").onclick=$("#quickMeet2").onclick=()=>switchTab("meetings");
$("#newListing").onclick=()=>showToast("Demo: inventory listing workflow opened");
$("#auctionCandidate").onclick=()=>showToast("2 items are over 85 days old and ready for auction review");

renderOverview();renderOrders();renderInquiries();renderMeetings();renderInventory();renderAuctions();