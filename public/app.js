const $ = (id) => document.getElementById(id);
const OLD_CARD_KEYS = ["cardvault.v02.cards","cardvault.v1.cards","cardvault.cards.v1"];
const CARD_KEY = "cardvault.v10.cards";
const SCAN_KEY = "cardvault.v10.scans";
const THEME_KEY = "cardvault.v10.theme";
const GUEST_KEY = "cardvault.v10.guest";
const MIGRATION_KEY = "cardvault.v10.migrated";
const IDENTIFY_CACHE_PREFIX="cardvault.identify.v140.";
const IDENTIFY_CACHE_TTL=7*24*60*60*1000;
const PORTFOLIO_HISTORY_KEY="cardvault.portfolio.v140.history";
const PROFILE_KEY="cardvault.platform.profile.v200";
const ACTIVITY_KEY="cardvault.platform.activity.v200";
const SHOWCASE_KEY="cardvault.platform.showcase.v200";
const PRICE_FRESH_MS=24*60*60*1000;
const IMAGE_CACHE_PREFIX = "cardvault.v106.image.";

function saveLocalCardImages(card){
  if(!card?.id)return;
  try{
    localStorage.setItem(IMAGE_CACHE_PREFIX+card.id,JSON.stringify({front:card.front||"",back:card.back||""}));
  }catch(err){
    console.warn("Could not cache card images locally:",err);
  }
}

function getLocalCardImages(id){
  try{return JSON.parse(localStorage.getItem(IMAGE_CACHE_PREFIX+id)||"{}")}catch{return {}}
}

function hydrateLocalImages(card){
  const cached=getLocalCardImages(card.id);
  return {
    ...card,
    front:cached.front||card.front||"",
    back:cached.back||card.back||""
  };
}

async function makeCloudThumbnail(dataUrl,maxSide=300,quality=.5){
  if(!dataUrl || !String(dataUrl).startsWith("data:image/")) return "";
  try{
    const img=await loadImage(dataUrl);
    const w0=img.naturalWidth||img.width;
    const h0=img.naturalHeight||img.height;
    const scale=Math.min(1,maxSide/Math.max(w0,h0));
    const w=Math.max(1,Math.round(w0*scale));
    const h=Math.max(1,Math.round(h0*scale));
    const canvas=document.createElement("canvas");
    canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext("2d",{alpha:false});
    if(!ctx)return "";
    ctx.drawImage(img,0,0,w,h);
    return canvas.toDataURL("image/jpeg",quality);
  }catch(err){
    console.warn("Cloud thumbnail failed:",err);
    return "";
  }
}

async function prepareCloudCard(card){
  // Originals stay local for best quality. Tiny thumbnails sync through Firestore.
  const cloud={...card};
  cloud.front=await makeCloudThumbnail(card.front,300,.5);
  cloud.back=await makeCloudThumbnail(card.back,300,.5);

  // Keep a large safety margin below Firestore's document-size limit.
  let approx=new Blob([JSON.stringify(cloud)]).size;
  if(approx>500000){
    cloud.front=await makeCloudThumbnail(card.front,220,.42);
    cloud.back=await makeCloudThumbnail(card.back,220,.42);
    approx=new Blob([JSON.stringify(cloud)]).size;
  }
  if(approx>500000){
    // Final fallback: sync the front thumbnail only instead of failing the save.
    cloud.back="";
  }
  return cloud;
}

const money = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n||0));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let cards = [];
let scans = Number(localStorage.getItem(SCAN_KEY) || 0);
let selectedSport = "";
let currentDetailId = null;
let detailSide = "front";
let frontData = "";
let backData = "";
let selectedMatch = null;
let aiResult = null;
let activeScanId = null;
let savingCard = false;
let pricingState={status:"idle",value:null,low:null,high:null,confidence:null,comps:0,source:"pending"};
const PRICE_CACHE_PREFIX="cardvault.price.v119.";
const PRICE_CACHE_TTL=24*60*60*1000; // 24 hours


async function tinyFingerprint(dataUrl){
  try{
    const img=await loadImage(dataUrl);
    const canvas=document.createElement("canvas");canvas.width=16;canvas.height=16;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,16,16);
    const d=ctx.getImageData(0,0,16,16).data;
    let out="";
    for(let i=0;i<d.length;i+=16){
      const y=Math.round((.2126*d[i]+.7152*d[i+1]+.0722*d[i+2])/16).toString(16);
      out+=y;
    }
    return out;
  }catch{return String(dataUrl?.length||0)}
}
async function stableImageKey(){
  try{
    const input=`${await tinyFingerprint(frontData)}|${await tinyFingerprint(backData)}`;
    const bytes=new TextEncoder().encode(input);
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
  }catch{return `${frontData.length}:${backData.length}`}
}

function readIdentifyCache(key){
  try{
    const v=JSON.parse(localStorage.getItem(IDENTIFY_CACHE_PREFIX+key)||"null");
    if(!v||Date.now()-Number(v.savedAt||0)>IDENTIFY_CACHE_TTL)return null;
    return v.data||null;
  }catch{return null}
}
function writeIdentifyCache(key,data){
  try{localStorage.setItem(IDENTIFY_CACHE_PREFIX+key,JSON.stringify({savedAt:Date.now(),data}))}catch{}
}

function recordPortfolioSnapshot(){
  const total=cards.reduce((s,c)=>s+Number(c.value||0),0);
  let history=[];
  try{history=JSON.parse(localStorage.getItem(PORTFOLIO_HISTORY_KEY)||"[]")}catch{}
  if(!Array.isArray(history))history=[];
  const day=new Date().toISOString().slice(0,10);
  const last=history[history.length-1];
  if(last?.day===day){last.value=total;last.at=Date.now()}
  else history.push({day,value:total,at:Date.now()});
  history=history.slice(-90);
  localStorage.setItem(PORTFOLIO_HISTORY_KEY,JSON.stringify(history));
}
function portfolioHistory(){
  try{
    const v=JSON.parse(localStorage.getItem(PORTFOLIO_HISTORY_KEY)||"[]");
    return Array.isArray(v)?v:[];
  }catch{return []}
}
function priceAgeText(ts){
  if(!ts)return "Not refreshed";
  const diff=Math.max(0,Date.now()-ts);
  const mins=Math.floor(diff/60000);
  if(mins<2)return "Updated just now";
  if(mins<60)return `Updated ${mins}m ago`;
  const hrs=Math.floor(mins/60);
  if(hrs<24)return `Updated ${hrs}h ago`;
  const days=Math.floor(hrs/24);
  return `Updated ${days}d ago`;
}
function pushPriceHistory(card,value,source){
  const arr=Array.isArray(card.priceHistory)?[...card.priceHistory]:[];
  const n=Number(value||0);
  if(!Number.isFinite(n)||n<0)return arr.slice(-30);
  const last=arr[arr.length-1];
  if(!last || Math.abs(Number(last.value)-n)>.001 || Date.now()-Number(last.at||0)>6*60*60*1000){
    arr.push({at:Date.now(),value:n,source:source||""});
  }
  return arr.slice(-30);
}

function priceFingerprint(){
  return [
    $("fPlayer")?.value||"",
    $("fYear")?.value||"",
    $("fSet")?.value||"",
    $("fNumber")?.value||"",
    $("fParallel")?.value||"",
    $("fSerial")?.value||"",
    $("fGrade")?.value||""
  ].map(v=>String(v).trim().toLowerCase()).join("|");
}

function readPriceCache(){
  try{
    const key=priceFingerprint();
    if(!key.replace(/\|/g,""))return null;
    const parsed=JSON.parse(localStorage.getItem(PRICE_CACHE_PREFIX+key)||"null");
    if(!parsed || !parsed.savedAt || Date.now()-parsed.savedAt>PRICE_CACHE_TTL)return null;
    return parsed.data||null;
  }catch{return null}
}

function writePriceCache(data){
  try{
    const key=priceFingerprint();
    if(!key.replace(/\|/g,""))return;
    localStorage.setItem(PRICE_CACHE_PREFIX+key,JSON.stringify({savedAt:Date.now(),data}));
  }catch(err){console.warn("Price cache failed:",err)}
}
function renderPricing(){
  const v=$("marketValue"),m=$("priceMeta"),r=$("priceRange"),c=$("priceConfidence"),b=$("updateValueBtn"),sources=$("priceSources");
  if(!v)return;
  b.disabled=pricingState.status==="loading";
  b.textContent=pricingState.status==="loading"?"Refreshing…":"Live refresh";
  if(sources){sources.innerHTML="";sources.classList.add("hidden")}

  if(pricingState.status==="loading"){
    v.textContent=pricingState.value!=null?`$${Number(pricingState.value).toFixed(2)}`:"Checking…";
    m.textContent="Optional live refresh • cached for 24 hours";
    r.classList.add("hidden");c.classList.add("hidden");return;
  }

  if(pricingState.value!=null){
    v.textContent=`$${Number(pricingState.value).toFixed(2)}`;
    const label=pricingState.source||"Scan estimate";
    m.textContent=`${label}${pricingState.updatedAt?` • ${priceAgeText(pricingState.updatedAt)}`:" • included with scan"}`;
    if(pricingState.low!=null&&pricingState.high!=null){
      r.textContent=`Estimated range $${Number(pricingState.low).toFixed(2)}–$${Number(pricingState.high).toFixed(2)}`;
      r.classList.remove("hidden");
    }else r.classList.add("hidden");
    if(pricingState.confidence){
      c.textContent=`Pricing confidence: ${pricingState.confidence}${pricingState.note?` • ${pricingState.note}`:""}`;
      c.classList.remove("hidden");
    }else c.classList.add("hidden");
    if(sources&&Array.isArray(pricingState.sources)&&pricingState.sources.length){
      pricingState.sources.slice(0,5).forEach((src,i)=>{
        const a=document.createElement("a");a.className="price-source-link";a.href=src.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=src.title||`Source ${i+1}`;sources.appendChild(a)
      });
      sources.classList.remove("hidden");
    }
    return;
  }
  v.textContent="Not priced yet";
  m.textContent="A rough value will come from the same AI scan — no extra request.";
  r.classList.add("hidden");c.classList.add("hidden");
}

async function updateMarketValue(force=false){
  if(!selectedMatch)return toast("Identify a card first");

  if(!force){
    const cached=readPriceCache();
    if(cached){
      pricingState={...cached,status:"ready"};
      $("fValue").value=Number(cached.value).toFixed(2);
      renderPricing();
      return;
    }
    return; // automatic flow never makes a second AI request
  }

  const stale=readPriceCache();
  pricingState={...(stale||pricingState),status:"loading"};
  renderPricing();

  try{
    const payload={
      player:$("fPlayer").value.trim(),team:$("fTeam").value.trim(),sport:$("fSport").value,
      year:$("fYear").value.trim(),set:$("fSet").value.trim(),cardNumber:$("fNumber").value.trim(),
      parallel:$("fParallel").value.trim(),serialNumber:$("fSerial").value.trim(),grade:$("fGrade").value.trim()
    };
    const res=await fetch("/api/price",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const d=await res.json().catch(()=>({}));

    if(res.status===429){
      if(stale){
        pricingState={...stale,status:"ready",note:`${stale.note||""} • Live refresh is cooling down.`};
        $("fValue").value=Number(stale.value).toFixed(2);
        renderPricing();
        toast("Using cached value while live AI cools down.");
        return;
      }
      pricingState={...pricingState,status:"ready",note:"Live refresh is cooling down. Scan estimate kept."};
      renderPricing();
      toast("Live pricing is cooling down — keeping the scan estimate.");
      return;
    }
    if(!res.ok)throw new Error(d.error||`Pricing request failed (${res.status})`);

    pricingState={
      status:"ready",value:d.value,low:d.low,high:d.high,confidence:d.confidence||"Medium",
      comps:d.sources?.length||d.comps||0,source:d.source||"Live AI market estimate",
      sources:d.sources||[],note:d.note||"",updatedAt:Date.now()
    };
    $("fValue").value=Number(d.value).toFixed(2);
    writePriceCache(pricingState);
    renderPricing();
  }catch(e){
    console.error("Pricing error:",e);
    if(stale){
      pricingState={...stale,status:"ready",note:`${stale.note||""} • Refresh unavailable.`};
      $("fValue").value=Number(stale.value).toFixed(2);renderPricing();
    }
    toast("Live refresh unavailable — your current estimate is safe.");
  }
}
let analyzeController = null;
let firebase = null;
let authMode = "guest";
let currentUser = null;
let unsubscribeCards = null;
let currentThemeChoice = localStorage.getItem(THEME_KEY) || "system";
let isNavigatingAuth = false;
let scanMode="single";
let batchSessionCount=0;
let selectedCollection="";
let platformProfile=null,activityLog=[],showcaseIds=[],showcaseDraft=[];
let publicProfiles=[],publicCards=[],selectedPublicProfile=null,profilePhotoDraft="";
let unsubscribePublicProfiles=null,unsubscribePublicCards=null;
let unsubscribeOwnProfile=null;

function setLoginBusy(busy, provider="google"){
  const google=$("googleSignIn");
  const apple=$("appleSignIn");
  const guest=$("guestSignIn");
  if(google){
    google.disabled=busy;
    google.dataset.originalText=google.dataset.originalText||google.innerHTML;
    if(busy && provider==="google") google.innerHTML='<span class="social-mark google-mark">G</span><span>Signing in…</span>';
    else if(!busy && google.dataset.originalText) google.innerHTML=google.dataset.originalText;
  }
  if(apple) apple.disabled=busy || !firebase?.appleEnabled;
  if(guest) guest.disabled=busy;
}

function readLocalCards(){
  let found = [];
  try{ found = JSON.parse(localStorage.getItem(CARD_KEY) || "[]"); }catch{}
  if(!found.length){
    for(const key of OLD_CARD_KEYS){
      try{
        const old = JSON.parse(localStorage.getItem(key) || "[]");
        if(Array.isArray(old) && old.length){ found = old; break; }
      }catch{}
    }
  }
  return dedupeCards(found);
}

function imageIdentity(card){
  const image = String(card.front || "");
  return image ? image.slice(-240) : "";
}

function dedupeCards(input){
  const result=[];
  const seen=new Set();
  const sorted=[...(Array.isArray(input)?input:[])].sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
  for(const c of sorted){
    const fingerprint=[
      String(c.player||"").toLowerCase(),
      String(c.set||c.brand||"").toLowerCase(),
      String(c.number||c.cardNumber||"").toLowerCase(),
      String(c.parallel||"").toLowerCase(),
      imageIdentity(c)
    ].join("|");
    if(fingerprint.endsWith("|") || !imageIdentity(c)){
      result.push(normalizeCard(c));
      continue;
    }
    if(seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    result.push(normalizeCard(c));
  }
  return result.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
}

function normalizeCard(c){
  const history=Array.isArray(c.priceHistory)?c.priceHistory:[];
  return {
    id:c.id || uid(),
    player:c.player || "Unknown card",
    team:c.team || "",
    sport:c.sport || "Other",
    year:String(c.year || ""),
    set:c.set || c.brand || "",
    number:c.number || c.cardNumber || "",
    parallel:c.parallel || "",
    serial:c.serial || c.serialNumber || "",
    grade:c.grade || "Raw",
    paid:Number(c.paid || 0),
    value:Number(c.value || 0),
    rookie:Boolean(c.rookie),
    favorite:Boolean(c.favorite),
    public:Boolean(c.public),
    notes:String(c.notes||""),
    collection:String(c.collection||""),
    tags:Array.isArray(c.tags)?c.tags.map(String):String(c.tags||"").split(",").map(x=>x.trim()).filter(Boolean),
    aiConfidence:Number(c.aiConfidence || c.confidence || 0),
    priceSource:String(c.priceSource||""),
    priceConfidence:String(c.priceConfidence||""),
    priceLow:Number(c.priceLow||0),
    priceHigh:Number(c.priceHigh||0),
    priceNote:String(c.priceNote||""),
    priceUpdatedAt:Number(c.priceUpdatedAt||0),
    priceSources:Array.isArray(c.priceSources)?c.priceSources.slice(0,5):[],
    priceHistory:history.slice(-30).map(x=>({at:Number(x.at||0),value:Number(x.value||0),source:String(x.source||"")})).filter(x=>x.at&&Number.isFinite(x.value)),
    front:c.front || "",
    back:c.back || "",
    createdAt:Number(c.createdAt || Date.now())
  };
}

function saveLocalCards(){
  localStorage.setItem(CARD_KEY,JSON.stringify(cards));
  localStorage.setItem(SCAN_KEY,String(scans));
}

function toast(text){
  $("toast").textContent=text;
  $("toast").classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>$("toast").classList.add("hidden"),2200);
}

function actualTheme(choice){
  if(choice==="system") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return choice;
}
function applyTheme(choice,save=true){
  currentThemeChoice=choice;
  if(save) localStorage.setItem(THEME_KEY,choice);
  document.documentElement.dataset.theme=actualTheme(choice);
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content=actualTheme(choice)==="dark" ? "#090a0d" : "#f4f5f7";
  document.querySelectorAll("[data-theme-choice]").forEach(b=>b.classList.toggle("active",b.dataset.themeChoice===choice));
  if(save && currentUser && firebase?.db){
    firebase.setDoc(firebase.doc(firebase.db,"users",currentUser.uid,"settings","preferences"),{theme:choice},{merge:true}).catch(()=>{});
  }
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if(currentThemeChoice==="system")applyTheme("system",false)});
applyTheme(currentThemeChoice,false);

function showAuthGate(){
  $("authGate").classList.remove("hidden");
  $("appShell").classList.add("hidden");
}
function showApp(){
  $("authGate").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  renderAll();
}
function go(id){
  if(!$(id)) return;
  document.querySelectorAll(".screen").forEach(x=>x.classList.toggle("active",x.id===id));
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.go===id));
  scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>{
  if(b.dataset.go==="details" && !currentDetailId) return;
  go(b.dataset.go);
}));

function accountName(){
  return currentUser?.displayName || currentUser?.email?.split("@")[0] || "Collector";
}
function initials(name){
  const parts=String(name||"C").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0]||"C")+(parts[1]?.[0]||"")).toUpperCase().slice(0,2);
}


function defaultPlatformProfile(){
  const base=accountName(), raw=(currentUser?.email?.split("@")[0]||base||"collector").toLowerCase();
  return {displayName:base,username:raw.replace(/[^a-z0-9_]/g,"").slice(0,20)||"collector",bio:"Building my Card Vault.",favorite:"",photo:"",profilePrivacy:"private",vaultPrivacy:"private",updatedAt:Date.now()};
}
function loadPlatformState(){
  try{platformProfile={...defaultPlatformProfile(),...JSON.parse(localStorage.getItem(PROFILE_KEY)||"{}")}}catch{platformProfile=defaultPlatformProfile()}
  try{activityLog=JSON.parse(localStorage.getItem(ACTIVITY_KEY)||"[]");if(!Array.isArray(activityLog))activityLog=[]}catch{activityLog=[]}
  try{showcaseIds=JSON.parse(localStorage.getItem(SHOWCASE_KEY)||"[]");if(!Array.isArray(showcaseIds))showcaseIds=[]}catch{showcaseIds=[]}
}
function savePlatformLocal(){
  localStorage.setItem(PROFILE_KEY,JSON.stringify(platformProfile||defaultPlatformProfile()));
  localStorage.setItem(ACTIVITY_KEY,JSON.stringify(activityLog.slice(0,40)));
  localStorage.setItem(SHOWCASE_KEY,JSON.stringify(showcaseIds.slice(0,6)));
}
function applyCloudProfileData(data){
  if(!data)return;
  platformProfile={...defaultPlatformProfile(),...platformProfile,...data};
  showcaseIds=Array.isArray(data.showcaseIds)?data.showcaseIds.slice(0,6):showcaseIds;
  savePlatformLocal();
  renderProfile();
  renderShowcase();
}
function profileAvatarHTML(p,name){return p?.photo?`<img src="${p.photo}" alt="">`:esc(initials(name||p?.displayName||"C"))}
function addActivity(type,text){const icon={scan:"✦",favorite:"★",value:"↗",showcase:"▦",profile:"◉",share:"↗"}[type]||"•";activityLog.unshift({id:uid(),type,icon,text:String(text||""),at:Date.now()});activityLog=activityLog.slice(0,40);savePlatformLocal();renderActivity()}
function timeAgo(ts){const m=Math.floor(Math.max(0,Date.now()-Number(ts||0))/60000);if(m<1)return"now";if(m<60)return`${m}m`;const h=Math.floor(m/60);if(h<24)return`${h}h`;return`${Math.floor(h/24)}d`}
function achievementDefinitions(){const total=cards.reduce((s,c)=>s+Number(c.value||0),0);return[
{id:"first",icon:"✦",name:"First Scan",desc:"Add your first card",ok:cards.length>=1},
{id:"ten",icon:"10",name:"10 Cards",desc:"Build a 10-card vault",ok:cards.length>=10},
{id:"fifty",icon:"50",name:"50 Cards",desc:"Build a 50-card vault",ok:cards.length>=50},
{id:"500",icon:"$500",name:"$500 Vault",desc:"Reach $500 value",ok:total>=500},
{id:"1000",icon:"$1K",name:"$1K Vault",desc:"Reach $1,000 value",ok:total>=1000},
{id:"rookie",icon:"RC",name:"Rookie Hunter",desc:"Own 5 rookies",ok:cards.filter(c=>c.rookie).length>=5},
{id:"graded",icon:"10",name:"Graded",desc:"Own 3 graded cards",ok:cards.filter(c=>String(c.grade||"").toLowerCase()!=="raw"&&String(c.grade||"").trim()).length>=3},
{id:"numbered",icon:"#",name:"Numbered",desc:"Own a serialized card",ok:cards.some(c=>String(c.serial||"").trim())},
{id:"multi",icon:"◎",name:"Multi-Sport",desc:"Collect 3 sports",ok:new Set(cards.map(c=>c.sport).filter(Boolean)).size>=3}]}
function unlockedAchievements(){return achievementDefinitions().filter(a=>a.ok)}
function renderAchievements(){const el=$("achievementGrid");if(el)el.innerHTML=achievementDefinitions().map(a=>`<div class="achievement-badge ${a.ok?"unlocked":""}"><span class="achievement-icon">${esc(a.icon)}</span><strong>${esc(a.name)}</strong><small>${esc(a.desc)}</small></div>`).join("")}
function renderActivity(){const el=$("activityFeed");if(!el)return;if(!activityLog.length){el.innerHTML='<p class="muted-copy">Your Card Vault activity will show up here.</p>';return}el.innerHTML=activityLog.slice(0,8).map(a=>`<div class="activity-item"><div class="activity-dot">${esc(a.icon)}</div><div><strong>${esc(a.text)}</strong><span>${esc(a.type)}</span></div><time>${timeAgo(a.at)}</time></div>`).join("")}
function renderShowcase(){const el=$("profileShowcase"),empty=$("showcaseEmpty");if(!el)return;const selected=showcaseIds.map(id=>cards.find(c=>c.id===id)).filter(Boolean);el.innerHTML="";selected.forEach(c=>{const b=document.createElement("button");b.type="button";b.className="showcase-card";b.innerHTML=`<img src="${c.front||"/icons/card-placeholder.svg"}" alt=""><div><strong>${esc(c.player)}</strong><span>${money(c.value)}</span></div>`;b.onclick=()=>openDetails(c.id);el.appendChild(b)});empty?.classList.toggle("hidden",selected.length>0)}
async function compressProfilePhoto(file){const data=await readFileAsDataURL(file),img=await loadImage(data),canvas=document.createElement("canvas");canvas.width=180;canvas.height=180;const ctx=canvas.getContext("2d"),w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,s=Math.max(180/w,180/h),sw=180/s,sh=180/s;ctx.drawImage(img,(w-sw)/2,(h-sh)/2,sw,sh,0,0,180,180);return canvas.toDataURL("image/jpeg",.68)}
function bindProfilePhotoInput(){const input=$("profilePhotoInput");if(!input)return;input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{profilePhotoDraft=await compressProfilePhoto(file);$("profilePhotoLabel").innerHTML=`<img src="${profilePhotoDraft}" alt=""><input id="profilePhotoInput" type="file" accept="image/*">`;bindProfilePhotoInput()}catch{toast("Could not use that photo")}}}
function showProfilePhotoEditor(){const name=platformProfile?.displayName||accountName();$("profilePhotoLabel").innerHTML=profilePhotoDraft?`<img src="${profilePhotoDraft}" alt=""><input id="profilePhotoInput" type="file" accept="image/*">`:`<span id="profilePhotoInitial">${esc(initials(name))}</span><input id="profilePhotoInput" type="file" accept="image/*">`;bindProfilePhotoInput()}
function sanitizeUsername(v){return String(v||"").toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,24)}
async function syncPublicCards(){
  if(!currentUser||!firebase?.db||!platformProfile)return;
  for(const c of cards){
    const ref=firebase.doc(firebase.db,"publicCards",`${currentUser.uid}_${c.id}`);
    if(platformProfile.profilePrivacy==="public"&&platformProfile.vaultPrivacy==="public"&&c.public){
      const cloud=await prepareCardForCloud(c);
      await firebase.setDoc(ref,{...cloud,ownerUid:currentUser.uid,ownerName:platformProfile.displayName,ownerUsername:platformProfile.username,ownerPhoto:platformProfile.photo,sharedAt:Date.now()},{merge:true});
    }else{try{await firebase.deleteDoc(ref)}catch{}}
  }
}
async function syncPlatformProfile(){
  if(!currentUser||!firebase?.db||!platformProfile)return;
  const data={
    uid:currentUser.uid,
    displayName:platformProfile.displayName,
    username:platformProfile.username,
    usernameLower:String(platformProfile.username||"").toLowerCase(),
    bio:platformProfile.bio,
    favorite:platformProfile.favorite,
    photo:platformProfile.photo,
    profilePrivacy:platformProfile.profilePrivacy,
    vaultPrivacy:platformProfile.vaultPrivacy,
    cardCount:cards.length,
    vaultValue:cards.reduce((s,c)=>s+Number(c.value||0),0),
    achievementCount:unlockedAchievements().length,
    showcaseIds:showcaseIds.slice(0,6),
    updatedAt:Date.now()
  };
  await firebase.setDoc(firebase.doc(firebase.db,"users",currentUser.uid,"profile","main"),data,{merge:true});
  if(platformProfile.profilePrivacy==="public"){
    await firebase.setDoc(firebase.doc(firebase.db,"publicProfiles",currentUser.uid),data,{merge:true});
  }else{
    try{await firebase.deleteDoc(firebase.doc(firebase.db,"publicProfiles",currentUser.uid))}catch{}
  }
  await syncPublicCards();
}
function openProfileEdit(){
  const p=platformProfile||defaultPlatformProfile();
  profilePhotoDraft=p.photo||"";
  $("editDisplayName").value=p.displayName||accountName();
  $("editUsername").value=p.username||"";
  $("editFavorite").value=p.favorite||"";
  $("editBio").value=p.bio||"";
  $("editProfilePrivacy").value=p.profilePrivacy||"private";
  $("editVaultPrivacy").value=p.vaultPrivacy||"private";
  showProfilePhotoEditor();
  const modal=$("profileEditModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");
}
function closeProfileEdit(){
  const modal=$("profileEditModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
}
function openShowcase(){
  showcaseDraft=[...showcaseIds];
  renderShowcasePicker();
  const modal=$("showcaseModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");
}
function closeShowcase(){
  const modal=$("showcaseModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
}
function renderShowcasePicker(){const el=$("showcasePicker");if(!el)return;el.innerHTML="";cards.forEach(c=>{const chosen=showcaseDraft.includes(c.id),b=document.createElement("button");b.type="button";b.className="showcase-option"+(chosen?" selected":"");b.innerHTML=`<img src="${c.front||"/icons/card-placeholder.svg"}" alt=""><span>${esc(c.player)}</span>${chosen?'<i class="showcase-check">✓</i>':""}`;b.onclick=()=>{if(chosen)showcaseDraft=showcaseDraft.filter(id=>id!==c.id);else if(showcaseDraft.length<6)showcaseDraft.push(c.id);else{toast("Showcase is limited to 6 cards");return}renderShowcasePicker()};el.appendChild(b)})}
function renderDiscover(){const q=($("discoverSearch")?.value||"").toLowerCase().trim(),profiles=publicProfiles.filter(p=>[p.displayName,p.username,p.bio,p.favorite].join(" ").toLowerCase().includes(q));const pe=$("discoverProfiles");if(pe){pe.innerHTML="";profiles.slice(0,20).forEach(p=>{const b=document.createElement("button");b.type="button";b.className="discover-profile";b.innerHTML=`<div class="discover-avatar">${profileAvatarHTML(p,p.displayName)}</div><div><strong>${esc(p.displayName||"Collector")}</strong><p>@${esc(p.username||"collector")} • ${esc(p.favorite||"Sports cards")}</p></div><em>${Number(p.cardCount||0)} cards</em>`;b.onclick=()=>openPublicProfile(p.uid);pe.appendChild(b)});$("discoverProfilesEmpty")?.classList.toggle("hidden",profiles.length>0)}
const rows=publicCards.filter(c=>[c.player,c.team,c.year,c.set,c.parallel,c.ownerName,c.ownerUsername].join(" ").toLowerCase().includes(q)),ce=$("discoverCards");if(ce){ce.innerHTML="";rows.slice(0,30).forEach(c=>{const b=document.createElement("button");b.type="button";b.className="discover-card";b.innerHTML=`<img src="${c.front||"/icons/card-placeholder.svg"}" alt=""><div><strong>${esc(c.player)}</strong><span>${esc(c.year)} ${esc(c.set)} • @${esc(c.ownerUsername||"collector")}</span></div>`;b.onclick=()=>openPublicProfile(c.ownerUid);ce.appendChild(b)});$("discoverCardsEmpty")?.classList.toggle("hidden",rows.length>0)}}
function openPublicProfile(uidValue){const p=publicProfiles.find(x=>x.uid===uidValue);if(!p)return;selectedPublicProfile=p;$("publicAvatar").innerHTML=profileAvatarHTML(p,p.displayName);$("publicName").textContent=p.displayName||"Collector";$("publicHandle").textContent=`@${p.username||"collector"}`;$("publicBio").textContent=p.bio||"";$("publicFavorite").textContent=`Favorite: ${p.favorite||"—"}`;$("publicCardCount").textContent=Number(p.cardCount||0);$("publicVaultValue").textContent=money(Number(p.vaultValue||0));$("publicAchievementCount").textContent=Number(p.achievementCount||0);const el=$("publicShowcase");el.innerHTML="";(p.showcaseIds||[]).forEach(id=>{const c=publicCards.find(x=>x.ownerUid===uidValue&&x.id===id);if(!c)return;const d=document.createElement("div");d.className="showcase-card";d.innerHTML=`<img src="${c.front||"/icons/card-placeholder.svg"}" alt=""><div><strong>${esc(c.player)}</strong><span>${money(c.value)}</span></div>`;el.appendChild(d)});go("publicProfile")}
function startOwnProfileSubscription(){
  if(!currentUser||!firebase?.db)return;
  try{
    unsubscribeOwnProfile?.();
    const ref=firebase.doc(firebase.db,"users",currentUser.uid,"profile","main");
    unsubscribeOwnProfile=firebase.onSnapshot(ref,snap=>{
      if(!snap.exists())return;
      applyCloudProfileData(snap.data());
    },err=>console.warn("Own profile subscription:",err));
  }catch(err){console.warn("Own profile subscription unavailable:",err)}
}
function startPublicSubscriptions(){if(!currentUser||!firebase?.db)return;try{unsubscribePublicProfiles?.();unsubscribePublicCards?.();unsubscribePublicProfiles=firebase.onSnapshot(firebase.collection(firebase.db,"publicProfiles"),snap=>{publicProfiles=snap.docs.map(d=>({uid:d.id,...d.data()})).filter(p=>p.uid!==currentUser.uid);renderDiscover()},err=>console.warn("Public profiles:",err));unsubscribePublicCards=firebase.onSnapshot(firebase.collection(firebase.db,"publicCards"),snap=>{publicCards=snap.docs.map(d=>d.data()).filter(Boolean);renderDiscover()},err=>console.warn("Public cards:",err))}catch(err){console.warn("Discover unavailable:",err)}}
function renderProfile(){
  if(!platformProfile)loadPlatformState();
  const name=platformProfile?.displayName||accountName();
  $("profileName").textContent=name;$("profileHandle").textContent=`@${platformProfile?.username||"collector"}`;$("profileBio").textContent=platformProfile?.bio||"Building my Card Vault.";$("profileFavorite").textContent=`Favorite: ${platformProfile?.favorite||"—"}`;$("profilePrivacyBadge").textContent=(platformProfile?.profilePrivacy||"private").toUpperCase();$("profileAvatar").innerHTML=profileAvatarHTML(platformProfile,name);$("profileInitial").textContent=initials(name).slice(0,1);$("homeGreeting").textContent=currentUser?`Hey, ${name.split(" ")[0]}`:"My Collection";$("storageMode").textContent=currentUser?"Cloud synced":"This device";$("accountActionBtn").textContent=currentUser?"Sign out":"Sign in";renderShowcase();renderAchievements();renderActivity();
}

function renderValueChart(){
  const svg=$("valueChart");if(!svg)return;
  let hist=portfolioHistory().slice(-30);
  const current=cards.reduce((s,c)=>s+Number(c.value||0),0);

  if(!hist.length)hist=[{value:current,at:Date.now(),day:new Date().toISOString().slice(0,10)}];

  const values=hist.map(x=>Number(x.value||0));
  const max=Math.max(...values,1);
  const min=Math.min(...values,0);
  const range=Math.max(1,max-min);

  const points=values.map((v,i)=>{
    const x=values.length===1?160:(i/(values.length-1))*312+4;
    const y=112-((v-min)/range)*88;
    return [x,y];
  });

  const line=points.map(p=>p.join(",")).join(" ");
  const fill=`4,120 ${line} 316,120`;

  svg.innerHTML=`
    <defs>
      <linearGradient id="vaultFill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity=".30"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line class="chart-grid-line" x1="0" x2="320" y1="26" y2="26"/>
    <line class="chart-grid-line" x1="0" x2="320" y1="68" y2="68"/>
    <line class="chart-grid-line" x1="0" x2="320" y1="110" y2="110"/>
    <polygon points="${fill}" fill="url(#vaultFill)"/>
    <polyline class="chart-line" points="${line}"/>
  `;

  if(points.length){
    const lastPoint=points.at(-1);
    svg.insertAdjacentHTML("beforeend",`
      <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="7" fill="var(--surface)" stroke="var(--accent)" stroke-width="3"/>
      <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="2.5" fill="var(--accent)"/>
    `);
  }

  const first=values[0]||0;
  const last=values.at(-1)||0;
  const delta=last-first;
  const pct=first>0 ? (delta/first)*100 : 0;

  $("historyCurrentValue").textContent=money(last);
  $("chartStart").textContent=money(first);
  $("chartEnd").textContent=money(last);
  $("chartChange").textContent=`${delta>=0?"+":""}${money(delta)}`;
  $("chartChange").style.color=delta<0?"var(--danger)":delta>0?"var(--good)":"var(--muted)";

  const pill=$("historyChangePill");
  pill.className="history-change "+(delta>0?"positive":delta<0?"negative":"neutral");
  if(values.length<2){
    pill.textContent="Tracking starts now";
  }else{
    pill.textContent=`${delta>=0?"▲":"▼"} ${Math.abs(pct).toFixed(1)}% • ${delta>=0?"+":""}${money(delta)}`;
  }

  const startDate=hist[0]?.day ? new Date(hist[0].day+"T12:00:00") : new Date(hist[0]?.at||Date.now());
  const endDate=hist.at(-1)?.day ? new Date(hist.at(-1).day+"T12:00:00") : new Date(hist.at(-1)?.at||Date.now());

  const dateFmt=new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric"});
  $("historyStartLabel").textContent=dateFmt.format(startDate);
  $("historyEndLabel").textContent=values.length>1?dateFmt.format(endDate):"Today";
}
function renderSportBreakdown(){
  const wrap=$("sportBreakdown");if(!wrap)return;
  if(!cards.length){wrap.innerHTML='<p class="muted-copy">Add cards to see your collection mix.</p>';return}
  const groups={};
  cards.forEach(c=>{const k=c.sport||"Other";groups[k]=(groups[k]||0)+Number(c.value||0)});
  const total=Object.values(groups).reduce((a,b)=>a+b,0)||cards.length;
  if(total===cards.length && Object.values(groups).every(v=>v===0)){
    Object.keys(groups).forEach(k=>groups[k]=cards.filter(c=>(c.sport||"Other")===k).length);
  }
  const denom=Object.values(groups).reduce((a,b)=>a+b,0)||1;
  wrap.innerHTML=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([sport,val])=>{
    const pct=Math.round(val/denom*100);
    return `<div class="sport-row"><span>${esc(sport)}</span><div class="sport-bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`;
  }).join("");
}

function cardMovement(c){
  const h=Array.isArray(c.priceHistory)?c.priceHistory:[];
  if(h.length<2)return 0;
  return Number(h.at(-1).value||0)-Number(h[0].value||0);
}
function renderMovers(){
  const eligible=cards.filter(c=>Array.isArray(c.priceHistory)&&c.priceHistory.length>=2);
  const gain=[...eligible].sort((a,b)=>cardMovement(b)-cardMovement(a))[0];
  const lose=[...eligible].sort((a,b)=>cardMovement(a)-cardMovement(b))[0];

  const render=(id,c,type)=>{
    const el=$(id);if(!el)return;
    if(!c){el.className="mover-card empty-mover";el.textContent="No price history yet";el.onclick=null;return}
    const move=cardMovement(c);
    el.className="mover-card";
    el.innerHTML=`<strong>${esc(c.player)}</strong><span class="${move>=0?"up":"down"}">${move>=0?"+":""}${money(move)}</span><span>${esc(cardDescription(c))}</span>`;
    el.onclick=()=>openDetails(c.id);
  };
  render("topGainer",gain,"gain");render("topLoser",lose,"lose");
}
function renderRankings(){
  const aggregate=(key)=>{
    const map={};
    cards.forEach(c=>{
      const k=String(c[key]||"Unknown").trim()||"Unknown";
      map[k]=(map[k]||0)+Number(c.value||0);
    });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);
  };
  const draw=(id,rows)=>{
    const el=$(id);if(!el)return;
    el.innerHTML=rows.length?rows.map(([name,val],i)=>`<div class="rank-row"><i>${i+1}</i><span>${esc(name)}</span><b>${money(val)}</b></div>`).join(""):'<p class="muted-copy">No data yet.</p>';
  };
  draw("topPlayers",aggregate("player"));draw("topSets",aggregate("set"));
}

function listingTitleFor(c){return [c.year,c.set,c.player,c.rookie?"Rookie RC":"",c.parallel&&String(c.parallel).toLowerCase()!=="base"?c.parallel:"",c.number?`#${c.number}`:"",c.grade&&String(c.grade).toLowerCase()!=="raw"?c.grade:""].filter(Boolean).join(" ").replace(/\s+/g," ").trim().slice(0,80)}
function suggestedListPrice(c){const v=Number(c.value||0);return v?Math.max(.99,Math.round(v*1.12*100)/100):0}
function listingDescriptionFor(c,platform="general"){const a=[`${c.player||"Sports card"}${c.team?` — ${c.team}`:""}`,[c.year,c.set].filter(Boolean).join(" "),c.number?`Card #: ${c.number}`:"",c.parallel?`Parallel: ${c.parallel}`:"",c.serial?`Serial: ${c.serial}`:"",c.grade?`Grade/condition: ${c.grade}`:"",c.rookie?"Rookie card (RC)":"",c.notes?`Notes: ${c.notes}`:""] .filter(Boolean);a.push(platform==="ebay"?"Please review photos for exact condition and card details before purchasing.":platform==="facebook"?"Message me if interested. Open to reasonable offers.":"Photos show the exact card included.");return a.join("\n")}
function renderSellingStudio(c){const price=suggestedListPrice(c),profit=price-Number(c.paid||0);$("sellSuggestedPrice").textContent=money(price);$("listingTitle").textContent=listingTitleFor(c)||"Card listing";$("listingDescription").textContent=listingDescriptionFor(c);const b=$("sellMarginBadge");b.className="sell-margin "+(!c.paid?"neutral":profit>=0?"positive":"negative");b.textContent=!c.paid?"No purchase price":`${profit>=0?"+":""}${money(profit)} vs paid`}
async function copyText(text,msg){try{await navigator.clipboard.writeText(text);toast(msg||"Copied")}catch{toast("Could not copy")}}
function stats(){
  const total=cards.reduce((s,c)=>s+Number(c.value||0),0);
  const paid=cards.reduce((s,c)=>s+Number(c.paid||0),0);
  const profit=total-paid;
  const rookies=cards.filter(c=>c.rookie).length;
  const avg=cards.length?total/cards.length:0;
  $("homeValue").textContent=money(total);$("homeCards").textContent=cards.length;$("homeScans").textContent=scans;$("homeRookies").textContent=rookies;
  $("homeProfit").textContent=`${profit>=0?"+":""}${money(profit)}`;$("homeProfit").style.color=profit<0?"#ff9ba1":"";
  $("profileCards").textContent=cards.length;$("profileValue").textContent=money(total);$("profileScans").textContent=scans;
  $("dashPaid").textContent=money(paid);$("dashProfit").textContent=`${profit>=0?"+":""}${money(profit)}`;$("dashProfit").style.color=profit<0?"var(--danger)":"var(--good)";
  $("dashAverage").textContent=money(avg);
  recordPortfolioSnapshot();renderValueChart();renderSportBreakdown();renderMovers();renderRankings();
}

function cardDescription(c){
  return [c.year,c.set,c.number?`#${c.number}`:"",c.parallel].filter(Boolean).join(" • ");
}
function createCardTile(c){
  const btn=document.createElement("button");
  btn.type="button";btn.className="collection-card"+(c.favorite?" favorite-card":"");btn.dataset.cardId=c.id;
  btn.innerHTML=`
    ${c.favorite?'<span class="fav-corner">★</span>':""}<img src="${c.front || "/icons/card-placeholder.svg"}" alt="${esc(c.player)} card">
    <div class="collection-copy">
      <h3>${esc(c.player)}</h3>
      <p>${esc(cardDescription(c))}</p>
      <div class="collection-footer"><strong>${money(c.value)}</strong><small>${esc(c.sport)}</small></div>
    </div>`;
  btn.addEventListener("click",()=>openDetails(c.id));
  return btn;
}
function renderFeatured(){
  const wrap=$("featuredWrap"), el=$("featuredCard");
  if(!cards.length){wrap.classList.add("hidden");return;}
  const top=[...cards].sort((a,b)=>Number(b.value||0)-Number(a.value||0))[0];
  wrap.classList.remove("hidden");
  el.innerHTML=`
    <img src="${top.front || "/icons/card-placeholder.svg"}" alt="${esc(top.player)}">
    <div><h3>${esc(top.player)}</h3><p>${esc(cardDescription(top))}</p></div>
    <strong>${money(top.value)}</strong>`;
  el.onclick=()=>openDetails(top.id);
}
function filteredCards(){
  const q=$("searchBox").value.toLowerCase().trim();
  const gradeMode=$("gradeFilter")?.value||"";
  const favMode=$("favoriteFilter")?.value||"";
  const collectionMode=$("collectionFilter")?.value||"";

  let list=cards.filter(c=>{
    const blob=[c.player,c.team,c.sport,c.year,c.set,c.number,c.parallel,c.grade,c.collection,...(c.tags||[])].join(" ").toLowerCase();
    const raw=String(c.grade||"Raw").trim().toLowerCase()==="raw" || !String(c.grade||"").trim();
    return blob.includes(q)
      && (!selectedSport || c.sport===selectedSport)
      && (!gradeMode || (gradeMode==="raw"?raw:!raw))
      && (!favMode || c.favorite)
      && (!collectionMode || c.collection===collectionMode);
  });

  const sort=$("sortFilter").value;
  if(sort==="value") list.sort((a,b)=>Number(b.value||0)-Number(a.value||0));
  else if(sort==="profit") list.sort((a,b)=>(Number(b.value||0)-Number(b.paid||0))-(Number(a.value||0)-Number(a.paid||0)));
  else if(sort==="player") list.sort((a,b)=>String(a.player).localeCompare(String(b.player)));
  else list.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
  return list;
}
function renderVault(){
  const collectionSelect=$("collectionFilter");
  if(collectionSelect){
    const current=collectionSelect.value;
    const collections=[...new Set(cards.map(c=>c.collection).filter(Boolean))].sort();
    collectionSelect.innerHTML='<option value="">All collections</option>'+collections.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
    if(collections.includes(current))collectionSelect.value=current;
  }
  const list=$("vaultList");list.innerHTML="";
  const filtered=filteredCards();
  list.className="card-grid"+(filtered.length?"":" empty-state");
  if(!filtered.length) list.innerHTML=`<p>${cards.length?"No cards match those filters.":"No cards in your vault yet."}</p>`;
  else filtered.forEach(c=>list.appendChild(createCardTile(c)));

  const recent=$("recentList");recent.innerHTML="";
  recent.className="card-grid"+(cards.length?"":" empty-state");
  if(!cards.length)recent.innerHTML="<p>Your first card will show up here.</p>";
  else [...cards].sort((a,b)=>b.createdAt-a.createdAt).slice(0,4).forEach(c=>recent.appendChild(createCardTile(c)));
  renderFeatured();
}
function renderAll(){stats();renderVault();renderProfile();renderDiscover();}

$("searchBox").addEventListener("input",renderVault);
$("sortFilter").addEventListener("change",renderVault);
$("gradeFilter")?.addEventListener("change",renderVault);
$("favoriteFilter")?.addEventListener("change",renderVault);
$("collectionFilter")?.addEventListener("change",renderVault);
$("sportChips").addEventListener("click",e=>{
  const b=e.target.closest("[data-sport]");if(!b)return;
  selectedSport=b.dataset.sport;
  document.querySelectorAll("[data-sport]").forEach(x=>x.classList.toggle("active",x===b));
  renderVault();
});

function openDetails(id){
  const c=cards.find(x=>x.id===id);if(!c)return;
  currentDetailId=id;detailSide="front";
  $("detailHeader").textContent=c.player;$("detailPlayer").textContent=c.player;$("detailDescription").textContent=cardDescription(c);
  $("detailValue").textContent=money(c.value);$("detailPaid").textContent=money(c.paid);
  const p=Number(c.value)-Number(c.paid);
  $("detailProfit").textContent=`${p>=0?"+":""}${money(p)}`;$("detailProfit").style.color=p<0?"var(--danger)":"var(--good)";
  $("detailConfidence").textContent=c.aiConfidence?`${Math.round(c.aiConfidence)}%`:"—";$("detailRookie").classList.toggle("hidden",!c.rookie);
  $("favoriteCardBtn").textContent=c.favorite?"★":"☆";$("favoriteCardBtn").classList.toggle("active",c.favorite);

  $("dPlayer").value=c.player||"";$("dTeam").value=c.team||"";$("dYear").value=c.year||"";$("dSet").value=c.set||"";
  $("dNumber").value=c.number||"";$("dParallel").value=c.parallel||"";$("dSerial").value=c.serial||"";
  $("dGrade").value=c.grade||"";$("dPaid").value=c.paid||"";$("dValue").value=c.value||"";$("dCollection").value=c.collection||"";$("dTags").value=(c.tags||[]).join(", ");$("dNotes").value=c.notes||"";

  $("detailMarketValue").textContent=money(c.value);
  $("detailPriceMeta").textContent=c.priceUpdatedAt
    ? `${c.priceSource||"AI estimate"} • ${priceAgeText(c.priceUpdatedAt)} • ${c.priceConfidence||"Unknown"} confidence`
    : (c.priceSource||"Scan estimate • included with identification");
  const srcWrap=$("detailPriceSources");srcWrap.innerHTML="";
  (c.priceSources||[]).slice(0,5).forEach((src,i)=>{
    const a=document.createElement("a");a.href=src.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=src.title||`Source ${i+1}`;srcWrap.appendChild(a)
  });
  renderDetailPriceHistory(c);renderSellingStudio(c);
  $("cardPublicToggle").checked=Boolean(c.public);
  renderDetailImage(c);go("details");
}
function renderDetailImage(c){
  $("detailImage").src=detailSide==="back"?(c.back||c.front):(c.front||c.back);
  $("showFrontBtn").classList.toggle("active",detailSide==="front");
  $("showBackBtn").classList.toggle("active",detailSide==="back");
}

function renderDetailPriceHistory(c){
  const svg=$("detailPriceChart"),text=$("detailPriceHistoryText");if(!svg||!text)return;
  const hist=Array.isArray(c.priceHistory)?c.priceHistory.slice(-20):[];
  if(!hist.length){
    svg.innerHTML="";text.textContent="No price history yet. Future value updates will appear here.";return;
  }
  const vals=hist.map(x=>Number(x.value||0));const max=Math.max(...vals,1),min=Math.min(...vals,0),range=Math.max(1,max-min);
  const pts=vals.map((v,i)=>[(vals.length===1?160:(i/(vals.length-1))*314+3),94-((v-min)/range)*80]);
  const line=pts.map(p=>p.join(",")).join(" ");
  svg.innerHTML=`<line class="chart-grid-line" x1="0" x2="320" y1="25" y2="25"/><line class="chart-grid-line" x1="0" x2="320" y1="65" y2="65"/><polyline class="chart-line" points="${line}"/><circle class="chart-dot" cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="4"/>`;
  const delta=vals.at(-1)-vals[0];
  text.textContent=`${hist.length} value update${hist.length===1?"":"s"} • ${delta>=0?"+":""}${money(delta)} since first tracked price`;
}
$("showFrontBtn").addEventListener("click",()=>{detailSide="front";const c=cards.find(x=>x.id===currentDetailId);if(c)renderDetailImage(c)});
$("showBackBtn").addEventListener("click",()=>{detailSide="back";const c=cards.find(x=>x.id===currentDetailId);if(c)renderDetailImage(c)});

async function compactDataUrlForVault(dataUrl,maxSide=520,quality=.62){
  if(!dataUrl || !dataUrl.startsWith("data:image/")) return dataUrl||"";
  try{
    const img=await loadImage(dataUrl);
    const w0=img.naturalWidth||img.width;
    const h0=img.naturalHeight||img.height;
    const scale=Math.min(1,maxSide/Math.max(w0,h0));
    const w=Math.max(1,Math.round(w0*scale));
    const h=Math.max(1,Math.round(h0*scale));
    const canvas=document.createElement("canvas");
    canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext("2d",{alpha:false});
    if(!ctx) return dataUrl;
    ctx.drawImage(img,0,0,w,h);
    return canvas.toDataURL("image/jpeg",quality);
  }catch(err){
    console.warn("Vault image compression failed:",err);
    return dataUrl;
  }
}

async function prepareCardForCloud(card){
  const compact={...card};
  compact.front=await compactDataUrlForVault(card.front,520,.62);
  compact.back=await compactDataUrlForVault(card.back,520,.62);

  // Firestore Native documents have a 1 MiB maximum size. Keep comfortable headroom.
  let approx=new Blob([JSON.stringify(compact)]).size;
  if(approx>850000){
    compact.front=await compactDataUrlForVault(card.front,400,.52);
    compact.back=await compactDataUrlForVault(card.back,400,.52);
    approx=new Blob([JSON.stringify(compact)]).size;
  }
  if(approx>850000){
    // Final safety fallback: retain front image and omit the back image from cloud storage.
    // The card data still saves instead of failing entirely.
    compact.back="";
  }
  return compact;
}

async function persistCard(card){
  card=normalizeCard(card);

  if(currentUser && firebase?.db){
    // Preserve original photos on this device.
    saveLocalCardImages(card);

    // Sync compact front/back thumbnails so the card has images on every device.
    const cloudCard=await prepareCloudCard(card);

    await firebase.setDoc(
      firebase.doc(firebase.db,"users",currentUser.uid,"cards",card.id),
      cloudCard,
      {merge:true}
    );
  }else{
    const index=cards.findIndex(c=>c.id===card.id);
    if(index>=0)cards[index]=card;else cards.unshift(card);
    cards=dedupeCards(cards);
    saveLocalCards();
    renderAll();
  }
}
async function removeCard(id){
  if(currentUser && firebase?.db){
    await firebase.deleteDoc(firebase.doc(firebase.db,"users",currentUser.uid,"cards",id));
  }else{
    cards=cards.filter(c=>c.id!==id);saveLocalCards();renderAll();
  }
}
$("saveDetailBtn").addEventListener("click",async()=>{
  const c=cards.find(x=>x.id===currentDetailId);if(!c)return;
  const btn=$("saveDetailBtn");btn.disabled=true;
  try{
    const newValue=Number($("dValue").value||0);
    const updated={
      ...c,player:$("dPlayer").value.trim()||"Unknown card",team:$("dTeam").value.trim(),year:$("dYear").value.trim(),
      set:$("dSet").value.trim(),number:$("dNumber").value.trim(),parallel:$("dParallel").value.trim(),serial:$("dSerial").value.trim(),
      grade:$("dGrade").value.trim(),paid:Number($("dPaid").value||0),value:newValue,collection:$("dCollection").value.trim(),tags:$("dTags").value.split(",").map(x=>x.trim()).filter(Boolean),public:Boolean($("cardPublicToggle")?.checked),notes:$("dNotes").value.trim()
    };
    if(Math.abs(newValue-Number(c.value||0))>.001)updated.priceHistory=pushPriceHistory(c,newValue,"Manual edit");
    await persistCard(updated);toast("Card updated");openDetails(c.id);
  }catch{toast("Could not save changes");}
  finally{btn.disabled=false}
});
$("favoriteCardBtn").addEventListener("click",async()=>{
  const c=cards.find(x=>x.id===currentDetailId);if(!c)return;
  try{await persistCard({...c,favorite:!c.favorite});openDetails(c.id);toast(c.favorite?"Removed from favorites":"Added to favorites")}catch{toast("Could not update favorite")}
});
$("detailRefreshPriceBtn").addEventListener("click",async()=>{
  const c=cards.find(x=>x.id===currentDetailId);if(!c)return;
  const btn=$("detailRefreshPriceBtn");btn.disabled=true;btn.textContent="Refreshing…";
  try{
    const payload={player:c.player,team:c.team,sport:c.sport,year:c.year,set:c.set,cardNumber:c.number,parallel:c.parallel,serialNumber:c.serial,grade:c.grade};
    const res=await fetch("/api/price",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const d=await res.json().catch(()=>({}));
    if(res.status===429){toast("Live pricing is cooling down. Try again later.");return}
    if(!res.ok)throw new Error(d.error||"Pricing failed");
    const next={...c,value:Number(d.value||c.value),priceLow:Number(d.low||0),priceHigh:Number(d.high||0),priceConfidence:d.confidence||"Low",
      priceSource:d.source||"Live AI market estimate",priceNote:d.note||"",priceSources:d.sources||[],priceUpdatedAt:Date.now()};
    next.priceHistory=pushPriceHistory(c,next.value,next.priceSource);
    await persistCard(next);openDetails(c.id);toast("Value refreshed");
  }catch(e){console.error(e);toast("Live refresh unavailable")}
  finally{btn.disabled=false;btn.textContent="Live refresh"}
});
$("deleteCardBtn").addEventListener("click",async()=>{
  const c=cards.find(x=>x.id===currentDetailId);if(!c)return;
  if(!confirm(`Delete ${c.player} from your Vault?`))return;
  try{await removeCard(c.id);currentDetailId=null;toast("Card deleted");go("vault")}catch{toast("Could not delete card")}
});


async function analyzePhotoQuality(dataUrl){
  try{
    const img=await loadImage(dataUrl);
    const canvas=document.createElement("canvas");
    const max=220,scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
    canvas.width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
    canvas.height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let sum=0,sum2=0,n=0;
    for(let i=0;i<data.length;i+=16){
      const y=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
      sum+=y;sum2+=y*y;n++;
    }
    const mean=sum/n,variance=Math.max(0,sum2/n-mean*mean),contrast=Math.sqrt(variance);
    const aspect=(img.naturalWidth||img.width)/(img.naturalHeight||img.height);
    const portrait=aspect<1;
    let status="Good",cls="quality-good",advice="";
    if(mean<45){status="Too dark";cls="quality-bad";advice="Use brighter, even lighting."}
    else if(mean>225){status="Too bright";cls="quality-warn";advice="Reduce glare or direct light."}
    else if(contrast<28){status="Low detail";cls="quality-warn";advice="Hold the camera steady and focus on the card."}
    else if(!portrait){status="Check framing";cls="quality-warn";advice="A straight portrait photo usually scans best."}
    return {status,cls,advice};
  }catch{return {status:"Usable",cls:"quality-warn",advice:"Make sure the full card is visible."}}
}
async function updateQualityPanel(){
  if(!frontData&&!backData)return;
  $("photoQuality").classList.remove("hidden");
  const results=[];
  if(frontData){
    const q=await analyzePhotoQuality(frontData);$("frontQuality").textContent=q.status;$("frontQuality").className=q.cls;results.push(q);
  }
  if(backData){
    const q=await analyzePhotoQuality(backData);$("backQuality").textContent=q.status;$("backQuality").className=q.cls;results.push(q);
  }
  const issue=results.find(x=>x.advice);
  $("qualityAdvice").textContent=issue?.advice||"Photos look good. You’re ready to identify the card.";
}
function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("Could not read this photo."));r.readAsDataURL(file);
  });
}
function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("This photo format could not be opened."));img.src=src;
  });
}
async function shrinkImage(file){
  if(!file.type.startsWith("image/"))throw new Error("Choose an image file.");
  const original=await readFileAsDataURL(file);
  try{
    const img=await loadImage(original);
    const max=900, scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
    const w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
    const h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)return original;
    ctx.drawImage(img,0,0,w,h);
    return canvas.toDataURL("image/jpeg",.72);
  }catch{return original}
}
function updateScanReady(){
  const ready=Boolean(frontData&&backData);
  $("analyzeBtn").disabled=!ready;
  if(ready){
    $("analysisState").classList.remove("hidden");
    $("analysisSpinner").classList.add("ready");
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
      frontData=data;$("frontImage").src=data;$("frontCapture").classList.add("ready");$("frontCapture").querySelector(".retake").classList.remove("hidden");
    }else{
      backData=data;$("backImage").src=data;$("backCapture").classList.add("ready");$("backCapture").querySelector(".retake").classList.remove("hidden");
    }
    activeScanId=null;selectedMatch=null;aiResult=null;updateScanReady();updateQualityPanel();
  }catch(err){
    $("analysisState").classList.remove("hidden");$("analysisSpinner").classList.remove("ready");
    $("analysisTitle").textContent="Photo couldn't load";$("analysisSub").textContent=err.message;toast(err.message);
  }
}
$("frontFile").addEventListener("change",e=>loadSide("front",e.target.files?.[0]));
$("backFile").addEventListener("change",e=>loadSide("back",e.target.files?.[0]));
document.querySelectorAll(".retake").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();$(b.dataset.replace==="front"?"frontFile":"backFile").click()}));


function setScanMode(mode){
  scanMode=mode;
  document.querySelectorAll("[data-scan-mode]").forEach(b=>b.classList.toggle("active",b.dataset.scanMode===mode));
  $("batchStatus").classList.toggle("hidden",mode!=="batch");
  $("batchCount").textContent=`${batchSessionCount} card${batchSessionCount===1?"":"s"}`;
}
document.querySelectorAll("[data-scan-mode]").forEach(b=>b.addEventListener("click",()=>setScanMode(b.dataset.scanMode)));
$("finishBatchBtn")?.addEventListener("click",()=>{
  scanMode="single";batchSessionCount=0;setScanMode("single");go("vault");toast("Batch session finished");
});
function resetScan(){
  analyzeController?.abort();
  frontData="";backData="";selectedMatch=null;aiResult=null;activeScanId=null;savingCard=false;
  ["front","back"].forEach(side=>{
    $(side+"File").value="";$(side+"Image").src="";$(side+"Capture").classList.remove("ready");$(side+"Capture").querySelector(".retake").classList.add("hidden");
  });
  $("analysisState").classList.add("hidden");$("analysisSpinner").classList.remove("ready");$("photoQuality").classList.add("hidden");
  $("analyzeBtn").disabled=true;$("analyzeLabel").textContent="Identify card";
  $("addVaultBtn").disabled=false;$("saveCardLabel").textContent="Add to Vault";
}
$("resetScanBtn").addEventListener("click",resetScan);

$("analyzeBtn").addEventListener("click",async()=>{
  if(!frontData||!backData||analyzeController)return;
  activeScanId=activeScanId||uid();
  analyzeController=new AbortController();
  const timer=setTimeout(()=>analyzeController?.abort(),50000);
  $("analyzeBtn").disabled=true;$("analyzeLabel").textContent="Analyzing…";
  $("analysisState").classList.remove("hidden");$("analysisSpinner").classList.remove("ready");
  $("analysisTitle").textContent="Analyzing both sides…";$("analysisSub").textContent="Identifying the card and estimating value in one AI request.";

  try{
    const key=await stableImageKey();
    let data=readIdentifyCache(key);
    if(data){
      $("analysisSub").textContent="Loaded a recent result without spending another AI request.";
    }else{
      const res=await fetch("/api/identify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({front:frontData,back:backData}),signal:analyzeController.signal});
      data=await res.json();
      if(!res.ok){
        const err=new Error(data.error||"Could not identify this card.");
        err.status=res.status;
        throw err;
      }
      writeIdentifyCache(key,data);
      scans+=1;localStorage.setItem(SCAN_KEY,String(scans));
    }
    aiResult=data;renderAll();renderMatches(data);go("matches");
  }catch(err){
    const message=err.name==="AbortError"?"The scan took too long. Try again.":err.message;
    $("analysisTitle").textContent=err.status===429?"AI quota is cooling down":"Scan couldn't finish";
    $("analysisSub").textContent=message;
    toast(message);
  }finally{
    clearTimeout(timer);analyzeController=null;$("analyzeBtn").disabled=!(frontData&&backData);$("analyzeLabel").textContent="Identify card";
  }
});
function descriptor(m){return [m.year,m.manufacturer,m.set,m.cardNumber?`#${m.cardNumber}`:"",m.parallel].filter(Boolean).join(" • ")}
function matchCard(m,primary=false){
  const el=document.createElement("article");el.className="match-card";
  const conf=Math.round(Number(m.confidence||0));
  el.innerHTML=`
    <img src="${frontData}" alt="Scanned card">
    <div>
      <div class="match-topline"><span class="match-label">${primary?"BEST MATCH":"POSSIBLE"}</span><span class="match-confidence">${conf}% confidence</span></div>
      <h3>${esc(m.player||"Unknown card")}</h3>
      <p>${esc(descriptor(m))}</p>
      <div class="match-meta">${m.rookie?'<span class="mini-badge">ROOKIE</span>':""}${m.team?`<span class="mini-badge">${esc(m.team)}</span>`:""}${m.serialNumber?`<span class="mini-badge">${esc(m.serialNumber)}</span>`:""}</div>
    </div>
    <button class="match-select" type="button">This is my card</button>`;
  el.querySelector(".match-select").addEventListener("click",()=>selectMatch(m));
  return el;
}
function renderMatches(data){
  $("primaryMatch").innerHTML="";$("primaryMatch").appendChild(matchCard(data.primary,true));
  const alts=(data.alternates||[]).slice(0,3);
  $("alternateWrap").classList.toggle("hidden",!alts.length);
  $("alternateCount").textContent=`${alts.length} match${alts.length===1?"":"es"}`;
  $("alternateMatches").innerHTML="";alts.forEach(x=>$("alternateMatches").appendChild(matchCard(x)));
  const c=Math.round(data.primary.confidence||0);
  $("matchSummary").textContent=c>=88?"Card Vault AI found a strong match. Confirm the exact parallel and card number.":c>=65?"The AI is somewhat uncertain. Compare the alternate matches before saving.":"Low-confidence scan. Check every field carefully or take clearer photos.";
  $("scanWarning").textContent=data.warning||"";
  $("scanWarning").classList.toggle("hidden",!data.warning);
}
function selectMatch(m){
  selectedMatch=m;
  $("confirmFront").src=frontData;$("confirmConfidence").textContent=`${Math.round(m.confidence||0)}% AI match`;
  $("confirmName").textContent=m.player||"Unknown card";$("confirmDescriptor").textContent=descriptor(m);
  $("fPlayer").value=m.player||"";$("fTeam").value=m.team||"";$("fSport").value=m.sport||"Other";$("fYear").value=m.year||"";
  $("fSet").value=[m.manufacturer,m.set].filter(Boolean).join(" ");$("fNumber").value=m.cardNumber||"";$("fParallel").value=m.parallel||"";
  $("fSerial").value=m.serialNumber||"";$("fGrade").value=m.grade||"Raw";$("fPaid").value="";$("fRookie").checked=Boolean(m.rookie);

  const estimate=aiResult?.marketEstimate||{};
  if(Number.isFinite(Number(estimate.value)) && Number(estimate.value)>=0){
    $("fValue").value=Number(estimate.value).toFixed(2);
    pricingState={status:"ready",value:Number(estimate.value),low:Number(estimate.low||estimate.value),high:Number(estimate.high||estimate.value),
      confidence:estimate.confidence||"Low",comps:0,source:"Scan AI estimate",sources:[],note:estimate.note||"Approximate value included with identification.",updatedAt:0};
  }else{
    $("fValue").value="";pricingState={status:"idle",value:null,low:null,high:null,confidence:null,comps:0,source:"pending"};
  }
  renderPricing();go("confirm");
}

$("addVaultBtn").addEventListener("click",async()=>{
  if(savingCard || !selectedMatch || !activeScanId)return;
  savingCard=true;$("addVaultBtn").disabled=true;$("saveCardLabel").textContent="Saving…";
  const card=normalizeCard({
    id:activeScanId,
    front:frontData,back:backData,
    player:$("fPlayer").value.trim()||"Unknown card",team:$("fTeam").value.trim(),sport:$("fSport").value,
    year:$("fYear").value.trim(),set:$("fSet").value.trim(),number:$("fNumber").value.trim(),parallel:$("fParallel").value.trim(),
    serial:$("fSerial").value.trim(),grade:$("fGrade").value.trim()||"Raw",paid:Number($("fPaid").value||0),value:Number($("fValue").value||0),
    rookie:$("fRookie").checked,aiConfidence:Number(selectedMatch.confidence||0),
    priceSource:pricingState.source||"Scan AI estimate",priceConfidence:pricingState.confidence||"",
    priceLow:Number(pricingState.low||0),priceHigh:Number(pricingState.high||0),priceNote:pricingState.note||"",
    priceUpdatedAt:pricingState.updatedAt||Date.now(),priceSources:pricingState.sources||[],
    priceHistory:pushPriceHistory({priceHistory:[]},Number($("fValue").value||0),pricingState.source||"Scan AI estimate"),
    createdAt:Date.now()
  });
  try{
    await persistCard(card);
    addActivity("scan",`Added ${card.player} to the Vault`);
    toast("Added to your Vault");
    if(scanMode==="batch"){
      batchSessionCount+=1;
      resetScan();
      setScanMode("batch");
      go("scan");
      toast(`Saved • ${batchSessionCount} card${batchSessionCount===1?"":"s"} in this batch`);
    }else{
      resetScan();go("home");
    }
  }catch(err){
    console.error("Card save failed:",err);
    const code=String(err?.code||"unknown");
    const message=String(err?.message||"Unknown Firestore error");

    $("analysisState").classList.remove("hidden");
    $("analysisSpinner").classList.remove("ready");
    $("analysisTitle").textContent=`SAVE ERROR: ${code}`;
    $("analysisSub").textContent=message;

    toast(`Save failed: ${code}`);
    setTimeout(()=>alert(`CARD VAULT v1.4.0 SAVE ERROR

Code: ${code}

${message}`),100);

    savingCard=false;
    $("addVaultBtn").disabled=false;
    $("saveCardLabel").textContent="Add to Vault";
  }
});

async function initFirebase(){
  let config;
  try{
    const res=await fetch("/api/config",{cache:"no-store"});
    config=await res.json();
    $("aiMode").textContent=config.aiConfigured?"Ready":"Not configured";
  }catch{
    $("aiMode").textContent="Offline";
    return;
  }

  if(!config.firebaseConfig?.apiKey){
    $("googleSignIn").disabled=true;$("appleSignIn").disabled=true;
    $("authHint").textContent="Google/Apple sign-in needs Firebase setup. Guest mode is ready now.";
    return;
  }

  try{
    const appMod=await import("https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js");
    const authMod=await import("https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js");
    const fsMod=await import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js");
    const app=appMod.initializeApp(config.firebaseConfig);
    const auth=authMod.getAuth(app);
    await authMod.setPersistence(auth, authMod.browserLocalPersistence);
    const db=fsMod.getFirestore(app);
    firebase={...authMod,...fsMod,auth,db,appleEnabled:Boolean(config.appleAuthEnabled)};
    $("appleSignIn").disabled=!firebase.appleEnabled;
    if(!firebase.appleEnabled)$("appleSignIn").title="Apple provider is not configured yet.";

    authMod.onAuthStateChanged(auth,async user=>{
      currentUser=user||null;
      if(user){
        authMode="firebase";
        localStorage.removeItem(GUEST_KEY);
        loadPlatformState();
        await loadUserTheme();
        await startCloudCards();
        startOwnProfileSubscription();
        startPublicSubscriptions();
        showApp();
      }else if(localStorage.getItem(GUEST_KEY)==="1"){
        unsubscribeOwnProfile?.();unsubscribeOwnProfile=null;
        unsubscribePublicProfiles?.();unsubscribePublicProfiles=null;
        unsubscribePublicCards?.();unsubscribePublicCards=null;
        authMode="guest";currentUser=null;cards=readLocalCards();loadPlatformState();showApp();
      }else{
        unsubscribeOwnProfile?.();unsubscribeOwnProfile=null;
        unsubscribePublicProfiles?.();unsubscribePublicProfiles=null;
        unsubscribePublicCards?.();unsubscribePublicCards=null;
        showAuthGate();
      }
      renderProfile();
    });
  }catch(err){
    console.error(err);
    $("googleSignIn").disabled=true;$("appleSignIn").disabled=true;
    $("authHint").textContent="Account setup could not load. Guest mode still works.";
  }
}

function authErrorText(err){
  const code=String(err?.code||"");
  if(code.includes("unauthorized-domain"))return "This Render domain needs to be added to Firebase Authorized domains.";
  if(code.includes("operation-not-allowed"))return "That sign-in provider is not enabled in Firebase yet.";
  if(code.includes("popup-closed"))return "Sign-in was closed.";
  return "Sign-in couldn't finish. Check your Firebase provider setup.";
}
async function providerSignIn(provider, providerName="google"){
  if(!firebase?.auth || isNavigatingAuth)return;
  isNavigatingAuth=true;
  setLoginBusy(true,providerName);

  try{
    // IMPORTANT: Popup only.
    // Firebase redirect auth can fail on Safari/iOS when the auth domain is
    // storage-partitioned from the Render app domain ("missing initial state").
    const result=await firebase.signInWithPopup(firebase.auth,provider);

    if(!result?.user){
      throw new Error("No Firebase user was returned.");
    }

    currentUser=result.user;
    authMode="firebase";
    localStorage.removeItem(GUEST_KEY);

    showApp();
    renderProfile();
    toast(`Signed in as ${accountName()}`);

    try{
      await loadUserTheme();
    }catch(err){
      console.warn("Theme sync failed:",err);
    }

    try{
      await startCloudCards();
    }catch(err){
      console.error("Cloud Vault sync failed:",err);
      cards=readLocalCards();
      renderAll();
      $("storageMode").textContent="Signed in • cloud sync issue";
      toast("Google sign-in worked. Cloud sync needs attention.");
    }
  }catch(err){
    const code=String(err?.code||"");
    console.error("Card Vault sign-in error:",err);

    if(code.includes("popup-blocked")){
      toast("Safari blocked the Google sign-in window. Open Card Vault in Safari and try again.");
    }else if(code.includes("popup-closed-by-user")){
      toast("Google sign-in was closed.");
    }else if(code.includes("cancelled-popup-request")){
      toast("Another sign-in attempt is already open.");
    }else{
      toast(authErrorText(err));
    }
  }finally{
    isNavigatingAuth=false;
    setLoginBusy(false,providerName);
  }
}
$("editProfileBtn")?.addEventListener("click",openProfileEdit);
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    if(!$("profileEditModal")?.classList.contains("hidden"))closeProfileEdit();
    if(!$("showcaseModal")?.classList.contains("hidden"))closeShowcase();
  }
});
document.querySelectorAll("[data-close-profile-edit]").forEach(x=>x.addEventListener("click",closeProfileEdit));
$("manageShowcaseBtn")?.addEventListener("click",openShowcase);
document.querySelectorAll("[data-close-showcase]").forEach(x=>x.addEventListener("click",closeShowcase));
$("saveShowcaseBtn")?.addEventListener("click",async()=>{
  showcaseIds=[...showcaseDraft].slice(0,6);savePlatformLocal();closeShowcase();renderShowcase();addActivity("showcase","Updated profile Showcase");
  try{await syncPlatformProfile();toast("Showcase synced")}catch(e){console.warn(e);toast("Showcase saved locally — cloud sync pending")}
});
$("saveProfileBtn")?.addEventListener("click",async()=>{
  const username=sanitizeUsername($("editUsername").value);
  if(username.length<3){toast("Username needs at least 3 letters or numbers");return}
  platformProfile={...platformProfile,displayName:$("editDisplayName").value.trim()||accountName(),username,favorite:$("editFavorite").value.trim(),bio:$("editBio").value.trim(),photo:profilePhotoDraft||platformProfile?.photo||"",profilePrivacy:$("editProfilePrivacy").value,vaultPrivacy:$("editVaultPrivacy").value,updatedAt:Date.now()};
  savePlatformLocal();renderProfile();closeProfileEdit();addActivity("profile","Updated collector profile");
  try{await syncPlatformProfile();toast("Profile synced")}catch(e){console.warn(e);toast("Profile saved locally — cloud sync pending")}
});
$("discoverSearch")?.addEventListener("input",renderDiscover);
$("cardPublicToggle")?.addEventListener("change",async()=>{const c=cards.find(x=>x.id===currentDetailId);if(!c)return;c.public=$("cardPublicToggle").checked;try{await persistCard(c);await syncPlatformProfile();addActivity("share",`${c.public?"Shared":"Unshared"} ${c.player}`);toast(c.public?"Card is public":"Card is private")}catch(e){console.warn(e);saveLocalCards();toast("Visibility saved locally")}});
$("copyShareLinkBtn")?.addEventListener("click",async()=>{const c=cards.find(x=>x.id===currentDetailId);if(!c)return;if(!c.public){toast("Turn on Public card first");return}const link=`${location.origin}${location.pathname}?card=${encodeURIComponent(c.id)}&owner=${encodeURIComponent(currentUser?.uid||"")}`;try{await navigator.clipboard.writeText(link);toast("Share link copied")}catch{toast("Could not copy link")}});
$("updateValueBtn")?.addEventListener("click",()=>updateMarketValue(true));
renderPricing();
$("copyTitleBtn")?.addEventListener("click",()=>{const c=cards.find(x=>x.id===currentDetailId);if(c)copyText(listingTitleFor(c),"Title copied")});
$("copyListingBtn")?.addEventListener("click",()=>{const c=cards.find(x=>x.id===currentDetailId);if(c)copyText(`${listingTitleFor(c)}\n\n${listingDescriptionFor(c)}\n\nSuggested price: ${money(suggestedListPrice(c))}`,"Listing copied")});
$("copyMarketplaceBtn")?.addEventListener("click",()=>{const c=cards.find(x=>x.id===currentDetailId);if(c)copyText(`${listingTitleFor(c)}\n\n${listingDescriptionFor(c,"facebook")}\n\nPrice: ${money(suggestedListPrice(c))}`,"Facebook draft copied")});
$("copyEbayBtn")?.addEventListener("click",()=>{const c=cards.find(x=>x.id===currentDetailId);if(c)copyText(`${listingTitleFor(c)}\n\n${listingDescriptionFor(c,"ebay")}\n\nSuggested Buy It Now: ${money(suggestedListPrice(c))}`,"eBay draft copied")});

$("googleSignIn").addEventListener("click",()=>{
  if(!firebase)return;
  providerSignIn(new firebase.GoogleAuthProvider(),"google");
});
$("appleSignIn").addEventListener("click",()=>{
  if(!firebase?.appleEnabled){toast("Apple sign-in needs Apple Developer setup first.");return}
  const p=new firebase.OAuthProvider("apple.com");p.addScope("email");p.addScope("name");providerSignIn(p,"apple");
});
$("guestSignIn").addEventListener("click",()=>{
  localStorage.setItem(GUEST_KEY,"1");authMode="guest";currentUser=null;cards=readLocalCards();showApp();
});
$("accountActionBtn").addEventListener("click",async()=>{
  if(currentUser && firebase?.auth){
    await firebase.signOut(firebase.auth);cards=readLocalCards();showAuthGate();
  }else{
    localStorage.removeItem(GUEST_KEY);showAuthGate();
  }
});

async function loadUserTheme(){
  if(!currentUser||!firebase?.db)return;
  try{
    const snap=await firebase.getDoc(firebase.doc(firebase.db,"users",currentUser.uid,"settings","preferences"));
    const choice=snap.exists()?snap.data().theme:null;
    if(["light","dark","system"].includes(choice))applyTheme(choice,false);
  }catch{}
}
async function startCloudCards(){
  unsubscribeCards?.();unsubscribeCards=null;
  if(!currentUser||!firebase?.db)return;
  const col=firebase.collection(firebase.db,"users",currentUser.uid,"cards");
  await migrateLocalToCloud(col);
  unsubscribeCards=firebase.onSnapshot(col,snap=>{
    cards=dedupeCards(snap.docs.map(d=>hydrateLocalImages(normalizeCard({id:d.id,...d.data()}))));
    renderAll();
  },()=>toast("Cloud sync paused"));
}
async function migrateLocalToCloud(col){
  if(localStorage.getItem(MIGRATION_KEY)==="1")return;
  const local=readLocalCards();
  if(!local.length){localStorage.setItem(MIGRATION_KEY,"1");return}
  try{
    const snap=await firebase.getDocs(col);
    if(snap.empty){
      for(const c of local){
        await firebase.setDoc(firebase.doc(firebase.db,"users",currentUser.uid,"cards",c.id),c,{merge:true});
      }
      toast(`${local.length} local card${local.length===1?"":"s"} moved to your account`);
    }
    localStorage.setItem(MIGRATION_KEY,"1");
  }catch{}
}

document.querySelectorAll("[data-theme-choice]").forEach(b=>b.addEventListener("click",()=>applyTheme(b.dataset.themeChoice,true)));
$("clearDataBtn").addEventListener("click",()=>{
  if(!confirm("Clear the guest collection stored on this device?"))return;
  localStorage.removeItem(CARD_KEY);OLD_CARD_KEYS.forEach(k=>localStorage.removeItem(k));
  if(!currentUser){cards=[];renderAll()}toast("Local collection cleared");
});

async function health(){
  try{
    const r=await fetch("/api/health",{cache:"no-store"});const h=await r.json();
    $("aiMode").textContent=h.aiConfigured?"Ready":"Needs API key";
  }catch{$("aiMode").textContent="Offline"}
}

if("serviceWorker" in navigator){
  addEventListener("load",async()=>{
    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
      if("caches" in window){
        const keys=await caches.keys();
        await Promise.all(keys.map(k=>caches.delete(k)));
      }
      console.log("Card Vault v1.0.7: old PWA caches cleared");
    }catch(err){
      console.warn("Could not clear old PWA cache:",err);
    }
  });
}

cards=readLocalCards();
loadPlatformState();
saveLocalCards();
renderAll();
health();
initFirebase();
