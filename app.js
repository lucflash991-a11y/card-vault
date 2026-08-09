const $ = (id) => document.getElementById(id);
const OLD_CARD_KEYS = ["cardvault.v02.cards","cardvault.v1.cards","cardvault.cards.v1"];
const CARD_KEY = "cardvault.v10.cards";
const SCAN_KEY = "cardvault.v10.scans";
const THEME_KEY = "cardvault.v10.theme";
const GUEST_KEY = "cardvault.v10.guest";
const MIGRATION_KEY = "cardvault.v10.migrated";

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
let analyzeController = null;
let firebase = null;
let authMode = "guest";
let currentUser = null;
let unsubscribeCards = null;
let currentThemeChoice = localStorage.getItem(THEME_KEY) || "system";
let isNavigatingAuth = false;

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
    aiConfidence:Number(c.aiConfidence || c.confidence || 0),
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

function renderProfile(){
  const name=accountName();
  $("profileName").textContent=name;
  $("profileEmail").textContent=currentUser?.email || "Guest account";
  $("profileAvatar").textContent=initials(name);
  $("profileInitial").textContent=initials(name).slice(0,1);
  $("homeGreeting").textContent=currentUser ? `Hey, ${name.split(" ")[0]}` : "My Collection";
  $("accountModeBadge").textContent=currentUser ? "SIGNED IN" : "GUEST";
  $("storageMode").textContent=currentUser ? "Cloud synced" : "This device";
  $("accountActionBtn").textContent=currentUser ? "Sign out" : "Sign in";
}

function stats(){
  const total=cards.reduce((s,c)=>s+Number(c.value||0),0);
  const paid=cards.reduce((s,c)=>s+Number(c.paid||0),0);
  const profit=total-paid;
  const rookies=cards.filter(c=>c.rookie).length;
  $("homeValue").textContent=money(total);
  $("homeCards").textContent=cards.length;
  $("homeScans").textContent=scans;
  $("homeRookies").textContent=rookies;
  $("homeProfit").textContent=`${profit>=0?"+":""}${money(profit)}`;
  $("homeProfit").style.color=profit<0?"#ff9ba1":"";
  $("profileCards").textContent=cards.length;
  $("profileValue").textContent=money(total);
  $("profileScans").textContent=scans;
}

function cardDescription(c){
  return [c.year,c.set,c.number?`#${c.number}`:"",c.parallel].filter(Boolean).join(" • ");
}
function createCardTile(c){
  const btn=document.createElement("button");
  btn.type="button";btn.className="collection-card";btn.dataset.cardId=c.id;
  btn.innerHTML=`
    <img src="${c.front || "/icons/card-placeholder.svg"}" alt="${esc(c.player)} card">
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
  let list=cards.filter(c=>{
    const blob=[c.player,c.team,c.sport,c.year,c.set,c.number,c.parallel,c.grade].join(" ").toLowerCase();
    return blob.includes(q) && (!selectedSport || c.sport===selectedSport);
  });
  const sort=$("sortFilter").value;
  if(sort==="value") list.sort((a,b)=>Number(b.value||0)-Number(a.value||0));
  else if(sort==="player") list.sort((a,b)=>String(a.player).localeCompare(String(b.player)));
  else list.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
  return list;
}
function renderVault(){
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
function renderAll(){stats();renderVault();renderProfile();}

$("searchBox").addEventListener("input",renderVault);
$("sortFilter").addEventListener("change",renderVault);
$("sportChips").addEventListener("click",e=>{
  const b=e.target.closest("[data-sport]");if(!b)return;
  selectedSport=b.dataset.sport;
  document.querySelectorAll("[data-sport]").forEach(x=>x.classList.toggle("active",x===b));
  renderVault();
});

function openDetails(id){
  const c=cards.find(x=>x.id===id);if(!c)return;
  currentDetailId=id;detailSide="front";
  $("detailHeader").textContent=c.player;
  $("detailPlayer").textContent=c.player;
  $("detailDescription").textContent=cardDescription(c);
  $("detailValue").textContent=money(c.value);
  $("detailPaid").textContent=money(c.paid);
  const p=Number(c.value)-Number(c.paid);
  $("detailProfit").textContent=`${p>=0?"+":""}${money(p)}`;
  $("detailProfit").style.color=p<0?"var(--danger)":"var(--good)";
  $("detailConfidence").textContent=c.aiConfidence?`${Math.round(c.aiConfidence)}%`:"—";
  $("detailRookie").classList.toggle("hidden",!c.rookie);
  $("dGrade").value=c.grade||"";
  $("dPaid").value=c.paid||"";
  $("dValue").value=c.value||"";
  renderDetailImage(c);
  go("details");
}
function renderDetailImage(c){
  $("detailImage").src=detailSide==="back"?(c.back||c.front):(c.front||c.back);
  $("showFrontBtn").classList.toggle("active",detailSide==="front");
  $("showBackBtn").classList.toggle("active",detailSide==="back");
}
$("showFrontBtn").addEventListener("click",()=>{detailSide="front";const c=cards.find(x=>x.id===currentDetailId);if(c)renderDetailImage(c)});
$("showBackBtn").addEventListener("click",()=>{detailSide="back";const c=cards.find(x=>x.id===currentDetailId);if(c)renderDetailImage(c)});

async function persistCard(card){
  card=normalizeCard(card);
  if(currentUser && firebase?.db){
    await firebase.setDoc(firebase.doc(firebase.db,"users",currentUser.uid,"cards",card.id),card,{merge:true});
  }else{
    const index=cards.findIndex(c=>c.id===card.id);
    if(index>=0)cards[index]=card;else cards.unshift(card);
    cards=dedupeCards(cards);saveLocalCards();renderAll();
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
    await persistCard({...c,grade:$("dGrade").value.trim(),paid:Number($("dPaid").value||0),value:Number($("dValue").value||0)});
    toast("Card updated");
    openDetails(c.id);
  }catch{toast("Could not save changes");}
  finally{btn.disabled=false}
});
$("deleteCardBtn").addEventListener("click",async()=>{
  const c=cards.find(x=>x.id===currentDetailId);if(!c)return;
  if(!confirm(`Delete ${c.player} from your Vault?`))return;
  try{await removeCard(c.id);currentDetailId=null;toast("Card deleted");go("vault")}catch{toast("Could not delete card")}
});

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
    const max=1500, scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
    const w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
    const h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)return original;
    ctx.drawImage(img,0,0,w,h);
    return canvas.toDataURL("image/jpeg",.83);
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
    activeScanId=null;selectedMatch=null;aiResult=null;updateScanReady();
  }catch(err){
    $("analysisState").classList.remove("hidden");$("analysisSpinner").classList.remove("ready");
    $("analysisTitle").textContent="Photo couldn't load";$("analysisSub").textContent=err.message;toast(err.message);
  }
}
$("frontFile").addEventListener("change",e=>loadSide("front",e.target.files?.[0]));
$("backFile").addEventListener("change",e=>loadSide("back",e.target.files?.[0]));
document.querySelectorAll(".retake").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();$(b.dataset.replace==="front"?"frontFile":"backFile").click()}));

function resetScan(){
  analyzeController?.abort();
  frontData="";backData="";selectedMatch=null;aiResult=null;activeScanId=null;savingCard=false;
  ["front","back"].forEach(side=>{
    $(side+"File").value="";$(side+"Image").src="";$(side+"Capture").classList.remove("ready");$(side+"Capture").querySelector(".retake").classList.add("hidden");
  });
  $("analysisState").classList.add("hidden");$("analysisSpinner").classList.remove("ready");
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
  $("analysisTitle").textContent="Analyzing both sides…";$("analysisSub").textContent="Reading names, card number, set details, parallels and serial clues.";
  try{
    const res=await fetch("/api/identify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({front:frontData,back:backData}),signal:analyzeController.signal});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||"Could not identify this card.");
    aiResult=data;scans+=1;localStorage.setItem(SCAN_KEY,String(scans));renderAll();renderMatches(data);go("matches");
  }catch(err){
    const message=err.name==="AbortError"?"The scan took too long. Try again.":err.message;
    $("analysisTitle").textContent="Scan couldn't finish";$("analysisSub").textContent=message;toast(message);
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
  $("confirmFront").src=frontData;
  $("confirmConfidence").textContent=`${Math.round(m.confidence||0)}% AI match`;
  $("confirmName").textContent=m.player||"Unknown card";
  $("confirmDescriptor").textContent=descriptor(m);
  $("fPlayer").value=m.player||"";$("fTeam").value=m.team||"";$("fSport").value=m.sport||"Other";$("fYear").value=m.year||"";
  $("fSet").value=[m.manufacturer,m.set].filter(Boolean).join(" ");$("fNumber").value=m.cardNumber||"";$("fParallel").value=m.parallel||"";
  $("fSerial").value=m.serialNumber||"";$("fGrade").value=m.grade||"Raw";$("fPaid").value="";$("fValue").value="";$("fRookie").checked=Boolean(m.rookie);
  go("confirm");
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
    rookie:$("fRookie").checked,aiConfidence:Number(selectedMatch.confidence||0),createdAt:Date.now()
  });
  try{
    await persistCard(card);
    toast("Added to your Vault");
    resetScan();go("home");
  }catch(err){
    toast("Could not save this card");
    savingCard=false;$("addVaultBtn").disabled=false;$("saveCardLabel").textContent="Add to Vault";
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
        await loadUserTheme();
        await startCloudCards();
        showApp();
      }else if(localStorage.getItem(GUEST_KEY)==="1"){
        authMode="guest";currentUser=null;cards=readLocalCards();showApp();
      }else{
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
    cards=dedupeCards(snap.docs.map(d=>normalizeCard({id:d.id,...d.data()})));
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

if("serviceWorker"in navigator){
  let refreshed=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(!refreshed){refreshed=true;location.reload()}});
  addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js").catch(()=>{}));
}

cards=readLocalCards();
saveLocalCards();
renderAll();
health();
initFirebase();
