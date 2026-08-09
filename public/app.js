const $ = (id) => document.getElementById(id);
const CARD_KEY = "cardvault.v02.cards";
const SCAN_KEY = "cardvault.v02.scans";

let cards = JSON.parse(localStorage.getItem(CARD_KEY) || "[]");
let scans = Number(localStorage.getItem(SCAN_KEY) || 0);
let frontData = "";
let backData = "";
let aiResult = null;
let selectedMatch = null;
let deferredPrompt = null;

const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n||0));
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

function go(id){
  document.querySelectorAll(".screen").forEach(x=>x.classList.toggle("active",x.id===id));
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.go===id));
  scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));

function persist(){
  localStorage.setItem(CARD_KEY,JSON.stringify(cards));
  localStorage.setItem(SCAN_KEY,String(scans));
}
function toast(text){
  $("toast").textContent=text;$("toast").classList.remove("hidden");
  setTimeout(()=>$("toast").classList.add("hidden"),1800);
}
function renderStats(){
  const value=cards.reduce((s,c)=>s+Number(c.value||0),0);
  const paid=cards.reduce((s,c)=>s+Number(c.paid||0),0);
  const profit=value-paid;
  const rookies=cards.filter(c=>c.rookie).length;
  $("homeValue").textContent=money(value);
  $("homeCards").textContent=cards.length;
  $("homeScans").textContent=scans;
  if($("homeRookies")) $("homeRookies").textContent=rookies;
  $("homeProfit").textContent=`${profit>=0?"+":""}${money(profit)}`;
  $("profileCards").textContent=cards.length;
  $("profileValue").textContent=money(value);
  $("profileScans").textContent=scans;
}
function collectionCard(c){
  const a=document.createElement("article");a.className="collection-card";
  a.innerHTML=`<img src="${c.front}" alt="${esc(c.player)} card"><div><h3>${esc(c.player||"Unknown")}</h3><p>${esc([c.year,c.set,c.number].filter(Boolean).join(" • "))}</p><footer><b>${money(c.value)}</b><small>${esc(c.sport||"")}</small></footer></div>`;
  return a;
}
function renderVault(){
  renderStats();
  const q=$("searchBox").value.toLowerCase().trim(), sport=$("sportFilter").value;
  const filtered=cards.filter(c=>{
    const blob=[c.player,c.team,c.set,c.number,c.parallel,c.year].join(" ").toLowerCase();
    return blob.includes(q)&&(!sport||c.sport===sport);
  });
  const v=$("vaultList");v.innerHTML="";v.className="cards-grid"+(filtered.length?"":" empty");
  if(!filtered.length)v.innerHTML=`<p>${cards.length?"No cards match that search.":"No cards in your vault yet."}</p>`;
  else filtered.forEach(c=>v.appendChild(collectionCard(c)));

  const r=$("recentList");r.innerHTML="";r.className="cards-grid"+(cards.length?"":" empty");
  if(!cards.length)r.innerHTML="<p>Your first card will show up here.</p>";
  else cards.slice(0,4).forEach(c=>r.appendChild(collectionCard(c)));
}
$("searchBox").addEventListener("input",renderVault);
$("sportFilter").addEventListener("change",renderVault);

function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error("Could not read this photo."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error("Could not open this photo."));
    img.src=src;
  });
}

async function shrinkImage(file){
  // Safari/iPhone-safe path: FileReader -> Image -> canvas.
  const original=await readFileAsDataURL(file);
  try{
    const img=await loadImageElement(original);
    const maxSide=1600;
    const scale=Math.min(1,maxSide/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
    const w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
    const h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const canvas=document.createElement("canvas");
    canvas.width=w;
    canvas.height=h;
    const ctx=canvas.getContext("2d",{alpha:false});
    if(!ctx) return original;
    ctx.drawImage(img,0,0,w,h);
    return canvas.toDataURL("image/jpeg",0.84);
  }catch(err){
    // If compression fails, still use the original photo so scanning can continue.
    return original;
  }
}

function updateAnalyzeState(){
  const ready=Boolean(frontData&&backData);
  $("analyzeBtn").disabled=!ready;
  if(ready){
    $("analysisState").classList.remove("hidden");
    $("analysisTitle").textContent="Both photos are ready";
    $("analysisSub").textContent="Tap Identify card to run Card Vault AI.";
  }else{
    $("analysisState").classList.add("hidden");
  }
}

async function loadSide(side,file){
  if(!file)return;
  try{
    const data=await shrinkImage(file);
    if(side==="front"){
      frontData=data;
      $("frontImage").src=data;
      $("frontCapture").classList.add("ready");
      $("frontCapture").querySelector(".retake").classList.remove("hidden");
    }else{
      backData=data;
      $("backImage").src=data;
      $("backCapture").classList.add("ready");
      $("backCapture").querySelector(".retake").classList.remove("hidden");
    }
    updateAnalyzeState();
  }catch(err){
    $("analysisState").classList.remove("hidden");
    $("analysisTitle").textContent="Photo couldn't load";
    $("analysisSub").textContent=err.message||"Try choosing the photo again.";
    updateAnalyzeState();
  }
}

$("frontFile").addEventListener("change",async e=>{
  await loadSide("front",e.target.files?.[0]);
});
$("backFile").addEventListener("change",async e=>{
  await loadSide("back",e.target.files?.[0]);
});
document.querySelectorAll(".replace-photo").forEach(btn=>btn.addEventListener("click",e=>{
  e.preventDefault();e.stopPropagation();
  $(btn.dataset.replace==="front"?"frontFile":"backFile").click();
}));

$("analyzeBtn").addEventListener("click",async()=>{
  if(!frontData||!backData)return;
  $("analyzeBtn").disabled=true;$("analysisState").classList.remove("hidden");
  $("analysisTitle").textContent="Analyzing both sides…";$("analysisSub").textContent="Reading names, logos, card number, set details and parallel clues.";
  try{
    const res=await fetch("/api/identify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({front:frontData,back:backData})});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||"Could not identify this card.");
    aiResult=data;scans+=1;persist();renderStats();renderMatches(data);go("matches");
  }catch(err){
    $("analysisTitle").textContent="Scan couldn't finish";
    $("analysisSub").textContent=err.message;
    $("analyzeBtn").disabled=false;
  }
});

function confidenceClass(v){return v>=85?"high":v>=65?"medium":"low"}
function cardDescriptor(m){return [m.year,m.manufacturer,m.set,m.cardNumber?`#${m.cardNumber}`:"",m.parallel].filter(Boolean).join(" • ")}
function matchElement(m,primary=false){
  const el=document.createElement("article");el.className="match-card"+(primary?" primary-match":"");
  const conf=Math.round(m.confidence);
  el.innerHTML=`
    <img src="${frontData}" alt="Scanned card front">
    <div>
      <div class="confidence-wrap"><span class="tag">${primary?"BEST MATCH":"POSSIBLE MATCH"}</span><span class="confidence">${conf}% confidence</span></div>
      <h3>${esc(m.player||"Unknown card")}</h3>
      <p>${esc(cardDescriptor(m))}</p>
      <div class="match-tags">${m.rookie?'<span class="tag">ROOKIE</span>':""}${m.team?`<span class="tag">${esc(m.team)}</span>`:""}${m.serialNumber?`<span class="tag">${esc(m.serialNumber)}</span>`:""}</div>
    </div>
    <button class="match-select">This is my card</button>`;
  el.querySelector(".match-select").addEventListener("click",()=>selectMatch(m));
  return el;
}
function renderMatches(data){
  const p=$("primaryMatch");p.innerHTML="";p.appendChild(matchElement(data.primary,true));
  const alts=(data.alternates||[]).filter(a=>a.confidence>0);
  $("alternateWrap").classList.toggle("hidden",!alts.length);$("alternateCount").textContent=`${alts.length} match${alts.length===1?"":"es"}`;
  const list=$("alternateMatches");list.innerHTML="";alts.forEach(a=>list.appendChild(matchElement(a,false)));
  const c=Math.round(data.primary.confidence);
  $("matchSummary").textContent=c>=85?"Card Vault AI found a strong match. Confirm it before saving.":c>=65?"The scan is somewhat uncertain. Compare the possible matches carefully.":"Low-confidence scan. Review every field or scan again with clearer photos.";
}
function selectMatch(m){
  selectedMatch=m;
  $("confirmFront").src=frontData;$("confirmConfidence").textContent=`${Math.round(m.confidence)}% AI match`;
  $("confirmName").textContent=m.player||"Unknown card";$("confirmDescriptor").textContent=cardDescriptor(m);
  $("fPlayer").value=m.player||"";$("fTeam").value=m.team||"";$("fSport").value=m.sport||"Other";
  $("fYear").value=m.year||"";$("fSet").value=[m.manufacturer,m.set].filter(Boolean).join(" ");
  $("fNumber").value=m.cardNumber||"";$("fParallel").value=m.parallel||"";$("fSerial").value=m.serialNumber||"";
  $("fGrade").value=m.grade||"Raw";$("fPaid").value="";$("fValue").value="";$("fRookie").checked=Boolean(m.rookie);
  go("confirm");
}
$("addVaultBtn").addEventListener("click",()=>{
  const card={
    id:crypto.randomUUID?.()||String(Date.now()),front:frontData,back:backData,
    player:$("fPlayer").value.trim(),team:$("fTeam").value.trim(),sport:$("fSport").value,year:$("fYear").value.trim(),
    set:$("fSet").value.trim(),number:$("fNumber").value.trim(),parallel:$("fParallel").value.trim(),serial:$("fSerial").value.trim(),
    grade:$("fGrade").value.trim(),paid:Number($("fPaid").value||0),value:Number($("fValue").value||0),rookie:$("fRookie").checked,
    aiConfidence:selectedMatch?.confidence||0,createdAt:Date.now()
  };
  cards.unshift(card);persist();renderVault();resetScan();go("home");toast("Added to your Vault");
});
function resetScan(){
  frontData="";backData="";aiResult=null;selectedMatch=null;
  ["front","back"].forEach(side=>{
    $(side+"File").value="";$(side+"Image").src="";$(side+"Capture").classList.remove("ready");
    $(side+"Capture").querySelector(".replace-photo").classList.add("hidden");
  });
  $("analysisState").classList.add("hidden");updateAnalyzeState();
}
$("clearData").addEventListener("click",()=>{if(confirm("Delete all Card Vault data saved on this device?")){cards=[];scans=0;persist();renderVault();toast("Local data cleared");}});

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").classList.remove("hidden")});
$("installBtn").addEventListener("click",async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").classList.add("hidden")});
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js"));
renderVault();
