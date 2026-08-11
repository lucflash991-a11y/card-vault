import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  next();
});

// Firebase Auth same-site helper proxy.
// Safari blocks the default cross-site firebaseapp.com helper storage.
// Keep these routes BEFORE express.json() so POST bodies can be proxied intact.
async function proxyFirebaseAuth(req,res){
  try{
    const projectId=process.env.FIREBASE_PROJECT_ID || "card-vault-1de81";
    const targetBase=`https://${projectId}.firebaseapp.com`;
    const targetUrl=targetBase + req.originalUrl;

    const headers={};
    for(const [key,value] of Object.entries(req.headers)){
      const lower=key.toLowerCase();
      if(["host","content-length","connection"].includes(lower)) continue;
      if(value!==undefined) headers[key]=value;
    }

    let body;
    if(!["GET","HEAD"].includes(req.method)){
      const chunks=[];
      for await (const chunk of req) chunks.push(chunk);
      body=Buffer.concat(chunks);
    }

    const upstream=await fetch(targetUrl,{
      method:req.method,
      headers,
      body,
      redirect:"manual"
    });

    res.status(upstream.status);

    const passthroughHeaders=[
      "content-type",
      "cache-control",
      "location",
      "set-cookie",
      "content-language"
    ];
    for(const name of passthroughHeaders){
      const value=upstream.headers.get(name);
      if(value) res.setHeader(name,value);
    }

    const buffer=Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  }catch(error){
    console.error("Firebase auth proxy error:",error);
    res.status(502).send("Authentication helper unavailable.");
  }
}

app.all("/__/auth/*splat",proxyFirebaseAuth);
app.all("/__/firebase/init.json",proxyFirebaseAuth);

app.use(express.json({limit:"20mb"}));
app.get("/api/version",(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({version:"3.3.5"});
});

app.use((req,res,next)=>{
  if(req.path==="/" || req.path==="/index.html" || req.path==="/app.js"){
    res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");
  }
  next();
});
app.use(express.static("public",{etag:false,maxAge:0}));

const buckets = new Map();
function scanRateLimit(req,res,next){
  const key=req.ip||req.headers["x-forwarded-for"]||"unknown";
  const now=Date.now(), windowMs=60*60*1000, max=30;
  const recent=(buckets.get(key)||[]).filter(t=>now-t<windowMs);
  if(recent.length>=max)return res.status(429).json({error:"Too many AI scans from this connection. Try again later."});
  recent.push(now);buckets.set(key,recent);next();
}

function parseDataUrl(value){
  const match=/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(value||"");
  if(!match)return null;
  return {mimeType:match[1]==="image/jpg"?"image/jpeg":match[1],data:match[2]};
}
function clampConfidence(value){return Math.max(0,Math.min(100,Number(value||0)))}

const matchSchema={
  type:"object",
  properties:{
    confidence:{type:"number",minimum:0,maximum:100},
    player:{type:"string"},
    team:{type:"string"},
    sport:{type:"string",enum:["Football","Basketball","Baseball","Hockey","Soccer","Other"]},
    year:{type:"string"},
    manufacturer:{type:"string"},
    set:{type:"string"},
    cardNumber:{type:"string"},
    parallel:{type:"string"},
    serialNumber:{type:"string"},
    rookie:{type:"boolean"},
    grade:{type:"string"},
    evidence:{type:"array",items:{type:"string"}}
  },
  required:["confidence","player","team","sport","year","manufacturer","set","cardNumber","parallel","serialNumber","rookie","grade","evidence"]
};
const marketEstimateSchema={
  type:"object",
  properties:{
    value:{type:"number"},
    low:{type:"number"},
    high:{type:"number"},
    confidence:{type:"string",enum:["High","Medium","Low"]},
    note:{type:"string"}
  },
  required:["value","low","high","confidence","note"]
};

const resultSchema={
  type:"object",
  properties:{
    primary:matchSchema,
    alternates:{type:"array",maxItems:3,items:matchSchema},
    marketEstimate:marketEstimateSchema,
    imageQuality:{type:"string",enum:["good","usable","poor"]},
    warning:{type:"string"}
  },
  required:["primary","alternates","marketEstimate","imageQuality","warning"]
};

function getFirebaseConfig(){
  const raw=process.env.FIREBASE_WEB_CONFIG;
  if(!raw)return null;
  try{return JSON.parse(raw)}catch{return null}
}






const comicLookupCache=new Map();
const COMIC_CACHE_MS=24*60*60*1000;

async function gcdJson(url){
  const r=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"CardVault/3.3.1"}});
  if(r.status===429){const e=new Error("Grand Comics Database rate limit reached. Try again later.");e.code=429;throw e}
  if(!r.ok){const e=new Error("Grand Comics Database lookup failed.");e.code=r.status;throw e}
  return await r.json();
}
function gcdIssueId(apiUrl=""){return String(apiUrl).match(/\/api\/issue\/(\d+)/)?.[1]||""}
function parseGcdPrinting(variant=""){
  const m=String(variant).match(/\b(Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\s+Printing\b/i);
  return m?m[0]:"";
}
function normalizeGcdIssue(d={}){
  const seriesName=String(d.series_name||"");
  const cleanSeries=seriesName.replace(/\s*\(\d{4}[^)]*series\)\s*$/i,"").trim();
  const year=String(d.key_date||"").slice(0,4)||String(d.publication_date||"").match(/\b(19|20)\d{2}\b/)?.[0]||"";
  const barcode=String(d.barcode||"").replace(/\D/g,"");
  return {
    id:`gcd-${gcdIssueId(d.api_url)||Date.now()}`,
    gcdId:gcdIssueId(d.api_url),
    gcdUrl:String(d.api_url||""),
    title:cleanSeries||seriesName||"Unknown Comic",
    series:cleanSeries||seriesName,
    issueNumber:String(d.number||String(d.descriptor||"").match(/^[^[]+/)?.[0]?.trim()||""),
    publisher:String(d.indicia_publisher||""),
    year,volume:String(d.volume||""),
    variant:String(d.variant_name||""),
    printing:parseGcdPrinting(d.variant_name||d.descriptor||""),
    coverArtist:String((d.story_set||[]).find(s=>s.type==="cover")?.pencils||""),
    upc:barcode.length>5?barcode.slice(0,-5):barcode,
    supplement:barcode.length>5?barcode.slice(-5):"",
    isbn:String(d.isbn||""),
    image:extractCoverUrlFromGcdData(d),
    description:[d.publication_date,d.variant_name].filter(Boolean).join(" • "),
    value:0,priceSource:"Not priced",priceNote:"GCD metadata verified. Market value has not been estimated.",source:"GCD"
  };
}

function absoluteGcdUrl(v=""){
  v=String(v||"").trim();
  if(!v)return "";
  if(/^https?:\/\//i.test(v))return v;
  if(v.startsWith("//"))return `https:${v}`;
  if(v.startsWith("/"))return `https://www.comics.org${v}`;
  return `https://www.comics.org/${v.replace(/^\/+/,"")}`;
}
function extractCoverUrlFromGcdData(d={}){
  const candidates=[
    d.cover,d.cover_url,d.image,d.image_url,d.thumbnail,d.thumbnail_url,
    d?.cover?.url,d?.cover?.image,d?.cover?.image_url,
    d?.cover_set?.[0]?.url,d?.cover_set?.[0]?.image,d?.cover_set?.[0]?.image_url,
    d?.covers?.[0]?.url,d?.covers?.[0]?.image,d?.covers?.[0]?.image_url
  ].filter(v=>typeof v==="string"&&v.trim());
  return absoluteGcdUrl(candidates[0]||"");
}
async function discoverGcdCoverUrl(gcdId){
  gcdId=String(gcdId||"").replace(/\D/g,"");
  if(!gcdId)return "";

  // First ask the issue API and inspect multiple possible cover fields.
  try{
    const d=await gcdJson(`https://www.comics.org/api/issue/${gcdId}/`);
    const apiCover=extractCoverUrlFromGcdData(d);
    if(apiCover)return apiCover;
  }catch{}

  // Fallback: inspect the public issue page and locate its cover image.
  try{
    const r=await fetch(`https://www.comics.org/issue/${gcdId}/`,{
      headers:{"User-Agent":"CardVault/3.3.2","Accept":"text/html"}
    });
    if(r.ok){
      const h=await r.text();
      const patterns=[
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        /<img[^>]+(?:class=["'][^"']*cover[^"']*["'][^>]+)?src=["']([^"']*(?:cover|covers_by_id)[^"']*)["']/i,
        /src=["']([^"']*covers_by_id[^"']+)["']/i
      ];
      for(const p of patterns){
        const m=h.match(p);
        if(m?.[1])return absoluteGcdUrl(m[1].replace(/&amp;/g,"&"));
      }
    }
  }catch{}
  return "";
}

app.get("/api/comics/cover/:gcdId",async(req,res)=>{
  try{
    const gcdId=String(req.params.gcdId||"").replace(/\D/g,"");
    if(!gcdId)return res.redirect(302,"/icons/card-placeholder.svg");

    const cacheKey=`cover:${gcdId}`;
    const cached=comicLookupCache.get(cacheKey);
    let coverUrl=cached&&Date.now()-cached.savedAt<COMIC_CACHE_MS?cached.data?.url:"";
    if(!coverUrl){
      coverUrl=await discoverGcdCoverUrl(gcdId);
      if(coverUrl)comicLookupCache.set(cacheKey,{savedAt:Date.now(),data:{url:coverUrl}});
    }
    if(!coverUrl)return res.redirect(302,"/icons/card-placeholder.svg");

    const r=await fetch(coverUrl,{
      headers:{
        "User-Agent":"CardVault/3.3.2",
        "Accept":"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer":`https://www.comics.org/issue/${gcdId}/`
      }
    });
    if(!r.ok)return res.redirect(302,"/icons/card-placeholder.svg");

    const ct=r.headers.get("content-type")||"image/jpeg";
    if(!ct.startsWith("image/"))return res.redirect(302,"/icons/card-placeholder.svg");
    const buf=Buffer.from(await r.arrayBuffer());
    res.set("Content-Type",ct);
    res.set("Cache-Control","public, max-age=86400, stale-while-revalidate=604800");
    res.send(buf);
  }catch(err){
    console.error("Comic cover proxy:",err);
    res.redirect(302,"/icons/card-placeholder.svg");
  }
});

async function gcdIssueDetail(apiUrl){
  return normalizeGcdIssue(await gcdJson(apiUrl));
}
async function searchGcdIssues(title,issue,publisher="",year=""){
  const t=encodeURIComponent(String(title).trim()),n=encodeURIComponent(String(issue).trim());
  let url=`https://www.comics.org/api/series/name/${t}/issue/${n}/`;
  if(year)url=`https://www.comics.org/api/series/name/${t}/issue/${n}/year/${encodeURIComponent(year)}/`;
  const listing=await gcdJson(url);
  let rows=Array.isArray(listing.results)?listing.results:[];
  if(publisher){
    const p=publisher.toLowerCase();
    // Listing doesn't always contain publisher, so don't hard-filter yet.
  }
  rows=rows.slice(0,16);
  const details=(await Promise.all(rows.map(async r=>{try{return await gcdIssueDetail(r.api_url)}catch{return null}}))).filter(Boolean);
  if(publisher){
    const p=publisher.toLowerCase();
    const exact=details.filter(x=>x.publisher.toLowerCase().includes(p));
    if(exact.length)return exact;
  }
  return details;
}
app.get("/api/comics/gcd/search",async(req,res)=>{
  try{
    const title=String(req.query.title||"").trim().slice(0,100),issue=String(req.query.issue||"").trim().slice(0,30),publisher=String(req.query.publisher||"").trim().slice(0,60),year=String(req.query.year||"").trim().slice(0,4);
    if(title.length<2||!issue)return res.status(400).json({error:"Title and issue number are required."});
    const key=`gcd:${title}:${issue}:${publisher}:${year}`.toLowerCase(),cached=comicLookupCache.get(key);if(cached&&Date.now()-cached.savedAt<COMIC_CACHE_MS)return res.json({...cached.data,cached:true});
    const items=await searchGcdIssues(title,issue,publisher,year);const payload={items,source:"Grand Comics Database",aiUsed:false};comicLookupCache.set(key,{savedAt:Date.now(),data:payload});res.json(payload)
  }catch(err){console.error("GCD search:",err);res.status(err.code||502).json({error:err.message||"GCD search failed"})}
});
app.get("/api/comics/gcd/barcode",async(req,res)=>{
  try{
    const barcode=String(req.query.barcode||"").replace(/\D/g,""),supp=String(req.query.supplement||"").replace(/\D/g,"").slice(0,5);
    if(barcode.length<8)return res.status(400).json({error:"Invalid barcode"});
    // GCD currently documents title/issue searches, not a public barcode-search endpoint.
    // We therefore use generic product lookup only to obtain title text, then verify
    // every candidate against GCD's own barcode field before returning it.
    let productData;
    try{productData=await upcItemdbJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`)}catch{productData=null}
    const p=productData?.items?.[0];
    if(!p)return res.status(404).json({error:"Barcode captured, but no safe comic match was found. Take a cover photo instead."});
    const title=String(p.title||"").replace(/\b(comic|book|variant|cover)\b/ig," ").replace(/\s+/g," ").trim();
    const issue=String(p.title||"").match(/(?:#|Issue\s*)([0-9A-Za-z.\-]+)/i)?.[1]||"";
    if(!title||!issue)return res.status(404).json({error:"Barcode captured, but it did not provide enough comic identity. Take a cover photo instead."});
    const candidates=await searchGcdIssues(title,issue,String(p.brand||""));
    const full=barcode+supp;
    const verified=candidates.filter(c=>{
      const cfull=(c.upc||"")+(c.supplement||"");
      return cfull===full||(!supp&&c.upc===barcode);
    });
    if(!verified.length)return res.status(404).json({error:"Barcode captured, but GCD could not verify an exact issue. Take a cover photo instead."});
    res.json({items:verified,source:"Grand Comics Database",aiUsed:false})
  }catch(err){console.error("Comic barcode verify:",err);res.status(err.code||502).json({error:err.message||"Barcode verification failed"})}
});

function safeComicImageUrl(v=""){
  v=String(v||"").trim();
  if(!v)return "";
  try{const u=new URL(v);if(!["http:","https:"].includes(u.protocol))return "";return u.toString()}catch{return ""}
}
function metronAuthHeader(){
  const user=String(process.env.METRON_USER||"").trim(),pass=String(process.env.METRON_PASS||"");
  if(user&&pass)return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  const token=String(process.env.METRON_TOKEN||"").trim();
  if(token)return `Token ${token}`;
  return "";
}
async function metronJson(url){
  const auth=metronAuthHeader();if(!auth)return null;
  const r=await fetch(url,{headers:{"Accept":"application/json","Authorization":auth,"User-Agent":"CardVault/3.3.5"}});
  if(r.status===401||r.status===403)return null;
  if(r.status===429){const e=new Error("Metron rate limit reached");e.code=429;throw e}
  if(!r.ok)return null;
  return await r.json();
}
function normalizeMetronIssue(d={}){
  const series=(d.series&&typeof d.series==="object")?d.series:{};
  const publisher=(d.publisher&&typeof d.publisher==="object")?d.publisher:(series.publisher&&typeof series.publisher==="object"?series.publisher:{});
  const imageObj=(d.image&&typeof d.image==="object")?d.image:{},coverObj=(d.cover&&typeof d.cover==="object")?d.cover:{};
  const image=safeComicImageUrl(d.image_url||d.cover_url||d.thumbnail_url||imageObj.original||imageObj.url||imageObj.medium||imageObj.small||coverObj.original||coverObj.url||(typeof d.image==="string"?d.image:"")||(typeof d.cover==="string"?d.cover:"")||d.thumbnail||"");
  const gcdId=String(d.gcd_id||(typeof d.gcd==="object"?d.gcd?.id:d.gcd)||"");
  const raw=String(d.upc||d.barcode||"").replace(/\D/g,"");
  const seriesName=String(series.name||d.series_name||d.title||"Unknown Comic");
  const pubName=String(publisher.name||d.publisher_name||(typeof d.publisher==="string"?d.publisher:"")||"");
  const date=String(d.cover_date||d.store_date||d.date||"");
  const year=date.match(/\b(19|20)\d{2}\b/)?.[0]||String(series.year_began||d.series_year_began||"");
  return {id:`metron-${d.id||Date.now()}`,metronId:String(d.id||""),gcdId,title:seriesName,series:seriesName,issueNumber:String(d.number||d.issue_number||""),publisher:pubName,year,variant:String(d.variant_name||d.variant||d.name_suffix||""),printing:String(d.printing||""),upc:raw.length>5?raw.slice(0,-5):raw,supplement:raw.length>5?raw.slice(-5):"",isbn:String(d.isbn||""),image,description:[d.cover_date,d.store_date,d.variant_name].filter(Boolean).join(" • "),source:"Metron",value:0,priceSource:"Not priced",priceNote:"Metron comic identity verified."};
}
async function searchMetronIssues(title,issue,publisher="",year=""){
  if(!metronAuthHeader())return [];
  title=String(title||"").trim();issue=String(issue||"").trim();publisher=String(publisher||"").trim();year=String(year||"").trim();
  const base=new URLSearchParams();if(title)base.set("series_name",title);if(issue)base.set("number",issue);
  const attempts=[];
  if(year&&publisher){const q=new URLSearchParams(base);q.set("series_year_began",year);q.set("publisher_name",publisher);attempts.push(q)}
  if(year){const q=new URLSearchParams(base);q.set("series_year_began",year);attempts.push(q)}
  if(publisher){const q=new URLSearchParams(base);q.set("publisher_name",publisher);attempts.push(q)}
  attempts.push(new URLSearchParams(base));
  const seen=new Set();
  for(const q of attempts){
    const k=q.toString();if(seen.has(k))continue;seen.add(k);
    const d=await metronJson(`https://metron.cloud/api/issue/?${q}`),rows=Array.isArray(d?.results)?d.results:[];
    if(rows.length)return rows.slice(0,16).map(normalizeMetronIssue);
  }
  return [];
}
async function searchMetronByUpc(fullUpc){
  if(!metronAuthHeader())return [];
  const q=new URLSearchParams({upc:String(fullUpc||"").replace(/\D/g,"")});
  const d=await metronJson(`https://metron.cloud/api/issue/?${q}`),rows=Array.isArray(d?.results)?d.results:[];
  return rows.slice(0,12).map(normalizeMetronIssue);
}
function comicDedupeKey(c={}){
  if(c.gcdId)return `gcd:${c.gcdId}`;
  const title=String(c.title||c.series||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  return `${title}|${String(c.issueNumber||"").toLowerCase()}|${String(c.year||"")}|${String(c.variant||"").toLowerCase()}`;
}
function mergeComicCandidates(...groups){
  const map=new Map();
  for(const c of groups.flat()){
    if(!c)continue;const k=comicDedupeKey(c);const old=map.get(k);
    if(!old){map.set(k,c);continue}
    map.set(k,{...old,...c,image:c.image||old.image,gcdId:c.gcdId||old.gcdId,metronId:c.metronId||old.metronId,source:[old.source,c.source].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(" + ")});
  }
  return [...map.values()];
}
function metadataComicScore(c,det={}){
  let s=40;const reasons=[];
  const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  if(norm(c.issueNumber)===norm(det.issueNumber)){s+=25;reasons.push("issue number")}
  if(det.publisher&&norm(c.publisher).includes(norm(det.publisher))){s+=8;reasons.push("publisher")}
  if(det.year&&String(c.year)===String(det.year)){s+=8;reasons.push("year")}
  const titleWords=String(det.title||"").toLowerCase().split(/\s+/).filter(w=>w.length>2);const ct=String(c.title||"").toLowerCase();
  const hits=titleWords.filter(w=>ct.includes(w)).length;if(titleWords.length){s+=Math.round(15*hits/titleWords.length);if(hits)reasons.push("title")}
  return {score:Math.min(92,s),reason:reasons.length?`Matched ${reasons.join(", ")}`:"Metadata candidate"};
}
async function fetchImageInline(url){
  url=safeComicImageUrl(url);if(!url)return null;
  try{const r=await fetch(url,{headers:{"Accept":"image/*","User-Agent":"CardVault/3.3.5"}});if(!r.ok)return null;const ct=r.headers.get("content-type")||"image/jpeg";if(!ct.startsWith("image/"))return null;const b=Buffer.from(await r.arrayBuffer());if(!b.length||b.length>4_000_000)return null;return {mimeType:ct.split(";")[0],data:b.toString("base64")}}catch{return null}
}
async function resolveCandidateImage(c){
  if(c.gcdId){const u=await discoverGcdCoverUrl(c.gcdId);if(u)return u}
  return safeComicImageUrl(c.image||"");
}
async function visualRankComicCandidates(userImage,candidates,model){
  const picked=[];
  for(const c of candidates.slice(0,10)){
    const url=await resolveCandidateImage(c);const im=url?await fetchImageInline(url):null;
    if(im)picked.push({c,url,im});
    if(picked.length>=7)break;
  }
  const fallback=candidates.map(c=>{const m=metadataComicScore(c,{});return {...c,matchScore:m.score,matchReason:m.reason}});
  if(!picked.length)return fallback;
  try{
    const parts=[{text:`Image 0 is the USER'S photographed comic cover. Images 1-${picked.length} are candidate database covers. Rank how visually likely each candidate is the exact same comic edition/variant/printing as image 0. Compare artwork composition, logo placement, issue/price box, trade dress, characters, colors, variant details, and visible text. Do not reward candidates merely because they are the same series. Return ONLY JSON: {"ranking":[{"candidate":1,"score":95,"reason":"short reason"}]} where score is 0-99.`},{inlineData:{mimeType:userImage.mimeType,data:userImage.data}}];
    picked.forEach((p,i)=>{parts.push({text:`Candidate ${i+1}: ${p.c.title} #${p.c.issueNumber} ${p.c.variant||""} ${p.c.year||""}`});parts.push({inlineData:{mimeType:p.im.mimeType,data:p.im.data}})});
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:{responseMimeType:"application/json",temperature:.05,maxOutputTokens:900}})});
    if(!r.ok)return fallback;
    const d=await r.json();let txt=d?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";txt=txt.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim();const parsed=JSON.parse(txt);const ranking=Array.isArray(parsed.ranking)?parsed.ranking:[];
    const scoreMap=new Map(ranking.map(x=>[Number(x.candidate),{score:Math.max(0,Math.min(99,Number(x.score)||0)),reason:String(x.reason||"Visual comparison").slice(0,140)}]));
    const ranked=picked.map((p,i)=>{const v=scoreMap.get(i+1)||{score:0,reason:"Visual candidate"};return {...p.c,image:p.url||p.c.image,matchScore:v.score,matchReason:v.reason}});
    const used=new Set(picked.map(p=>comicDedupeKey(p.c)));for(const c of candidates){if(!used.has(comicDedupeKey(c))){const m=metadataComicScore(c,{});ranked.push({...c,matchScore:m.score,matchReason:m.reason})}}
    return ranked.sort((a,b)=>(b.matchScore||0)-(a.matchScore||0));
  }catch(err){console.warn("Comic visual rank failed:",err);return fallback}
}
async function strongComicCandidates(det={}){
  const title=String(det.title||"").trim(),issue=String(det.issueNumber||det.issue||"").trim(),publisher=String(det.publisher||"").trim(),year=String(det.year||"").trim();
  let met=[];try{met=await searchMetronIssues(title,issue,publisher,year)}catch(err){console.warn("Metron primary search failed:",err?.message||err)}
  let gcd=[];
  if(met.length<6){try{gcd=await searchGcdIssues(title,issue,publisher,year)}catch{};if(!gcd.length&&year){try{gcd=await searchGcdIssues(title,issue,publisher,"")}catch{}}}
  const merged=mergeComicCandidates(met.map(x=>({...x,source:x.source||"Metron"})),gcd.map(x=>({...x,source:x.source||"GCD"})));
  const ni=String(issue).toLowerCase().replace(/[^a-z0-9]/g,"");
  return merged.map(c=>{let databaseBonus=0;if(c.metronId)databaseBonus+=8;if(c.image)databaseBonus+=6;if(String(c.issueNumber||"").toLowerCase().replace(/[^a-z0-9]/g,"")===ni)databaseBonus+=10;return {...c,databaseBonus}}).sort((a,b)=>(b.databaseBonus||0)-(a.databaseBonus||0)).slice(0,20);
}
app.get("/api/comics/metron-status",async(req,res)=>{
  try{
    if(!metronAuthHeader())return res.status(503).json({ok:false,error:"METRON_USER / METRON_PASS missing"});
    const r=await fetch("https://metron.cloud/api/issue/?series_name=batman&number=1",{headers:{"Accept":"application/json","Authorization":metronAuthHeader(),"User-Agent":"CardVault/3.3.5"}});
    const remaining=r.headers.get("X-RateLimit-Sustained-Remaining")||"";
    if(r.status===401)return res.status(401).json({ok:false,error:"Metron username/password rejected"});
    if(r.status===429)return res.status(429).json({ok:false,error:"Metron rate limit reached",remaining});
    if(!r.ok)return res.status(502).json({ok:false,error:`Metron returned ${r.status}`});
    res.json({ok:true,remaining});
  }catch{res.status(502).json({ok:false,error:"Could not reach Metron"})}
});
app.get("/api/comics/metron-barcode",async(req,res)=>{
  try{
    const main=String(req.query.barcode||"").replace(/\D/g,""),supp=String(req.query.supplement||"").replace(/\D/g,"").slice(0,5);
    if(main.length<8)return res.status(400).json({error:"Invalid barcode"});
    if(!metronAuthHeader())return res.status(503).json({error:"Metron is not configured on Render."});
    if(!supp&&main.length<=14)return res.status(400).json({error:"Enter the 5-digit supplement for an exact comic match."});
    const fulls=[];if(supp){fulls.push(main+supp);if(main.length===13&&main.startsWith("0"))fulls.push(main.slice(1)+supp)}else fulls.push(main);
    for(const full of [...new Set(fulls)]){const rows=await searchMetronByUpc(full);if(rows.length)return res.json({items:rows.map(x=>({...x,matchScore:99,matchReason:"Exact full Metron UPC match"})),source:"Metron exact UPC",fullUpc:full,aiUsed:false})}
    res.status(404).json({error:"Metron has no exact record for that full comic barcode. Try the cover-photo identifier."});
  }catch(err){console.error("Metron barcode:",err);res.status(err.code||502).json({error:err.message||"Metron barcode lookup failed"})}
});

app.get("/api/comics/search-strong",async(req,res)=>{
  try{const title=String(req.query.title||"").trim().slice(0,100),issue=String(req.query.issue||"").trim().slice(0,30),publisher=String(req.query.publisher||"").trim().slice(0,60),year=String(req.query.year||"").trim().slice(0,4);if(title.length<2||!issue)return res.status(400).json({error:"Title and issue number are required."});const items=(await strongComicCandidates({title,issueNumber:issue,publisher,year})).map(c=>{const m=metadataComicScore(c,{title,issueNumber:issue,publisher,year});return {...c,matchScore:m.score,matchReason:m.reason}}).sort((a,b)=>(b.matchScore||0)-(a.matchScore||0));res.json({items,metronConfigured:Boolean(metronAuthHeader()),source:"GCD + Metron when configured",aiUsed:false})}catch(err){console.error("Strong comic search:",err);res.status(502).json({error:"Comic search failed."})}
});

app.post("/api/comics/identify-cover",scanRateLimit,async(req,res)=>{
  try{
    const image=parseDataUrl(req.body?.image);if(!image)return res.status(400).json({error:"Choose a JPG, PNG, or WebP comic cover photo."});
    if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:"Cover identification is not configured. Use title + issue search instead."});
    const models=String(process.env.GEMINI_SCAN_MODELS||"gemini-3.1-flash-lite,gemini-2.5-flash").split(",").map(x=>x.trim()).filter(Boolean);const model=models[0]||"gemini-3.1-flash-lite";
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const prompt=`Identify this physical comic-book FRONT COVER for a comic database search. Return ONLY JSON:
{"title":"most likely canonical series title","issueNumber":"issue number only","publisher":"publisher if visible or confidently known","year":"4 digit publication year if confidently inferable","variantClues":"specific visible cover/variant clues","printing":"printing if visibly stated","alternateTitles":["up to 4 plausible database series-title spellings"],"confidence":0}
Rules:
- Read the actual series masthead/logo, not a story headline.
- Do not invent an issue number.
- Popular Marvel/DC/Image titles may have many series with the same name, so include likely year when possible.
- If a subtitle may or may not be part of the database title, include both forms in alternateTitles.
- confidence is 0-100 for text identity only.`;
    const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt},{inlineData:{mimeType:image.mimeType,data:image.data}}]}],generationConfig:{responseMimeType:"application/json",temperature:.03,maxOutputTokens:650}})});
    const d=await r.json();if(r.status===429)return res.status(429).json({error:"Free AI quota is temporarily exhausted. Use title + issue search instead."});if(!r.ok)return res.status(502).json({error:"Cover reader could not run."});
    let text=d?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";text=text.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim();const detected=JSON.parse(text);
    if(!detected.title||!detected.issueNumber)return res.status(422).json({error:"I could not confidently read the title and issue number. Try a clearer photo or manual search."});
    let candidates=await strongComicCandidates(detected);
    // If exact canonical title produced nothing, try Gemini's alternate title spellings.
    if(candidates.length<3&&Array.isArray(detected.alternateTitles)){
      for(const alt of detected.alternateTitles.slice(0,4)){
        if(!alt||String(alt).toLowerCase()===String(detected.title).toLowerCase())continue;
        try{candidates=mergeComicCandidates(candidates,await strongComicCandidates({...detected,title:alt}))}catch{}
      }
    }
    if(!candidates.length)return res.json({detected,items:[],metronConfigured:Boolean(metronAuthHeader()),source:"Gemini + comic databases"});
    let ranked=await visualRankComicCandidates(image,candidates,model);
    // Blend visual score with metadata sanity so exact issue/year remains meaningful.
    ranked=ranked.map(c=>{const meta=metadataComicScore(c,detected);const visual=Number(c.matchScore||0);const score=visual?Math.round(visual*.78+meta.score*.22):meta.score;return {...c,matchScore:Math.min(99,score),matchReason:c.matchReason||meta.reason}}).sort((a,b)=>(b.matchScore||0)-(a.matchScore||0));
    res.json({detected,items:ranked.slice(0,12),metronConfigured:Boolean(metronAuthHeader()),source:"Gemini visual match + Metron primary + GCD fallback"})
  }catch(err){console.error("Comic cover identify:",err);res.status(500).json({error:"Comic cover identification failed."})}
});

let ebayAppTokenCache={token:"",expiresAt:0};

function ebayConfigured(){
  return Boolean(String(process.env.EBAY_CLIENT_ID||"").trim()&&String(process.env.EBAY_CLIENT_SECRET||"").trim());
}
async function getEbayAppToken(){
  if(!ebayConfigured())throw Object.assign(new Error("eBay Production credentials are not configured."),{code:503});
  if(ebayAppTokenCache.token&&Date.now()<ebayAppTokenCache.expiresAt-5*60*1000)return ebayAppTokenCache.token;

  const clientId=String(process.env.EBAY_CLIENT_ID||"").trim();
  const secret=String(process.env.EBAY_CLIENT_SECRET||"").trim();
  const basic=Buffer.from(`${clientId}:${secret}`).toString("base64");
  const body=new URLSearchParams({
    grant_type:"client_credentials",
    scope:"https://api.ebay.com/oauth/api_scope"
  });
  const r=await fetch("https://api.ebay.com/identity/v1/oauth2/token",{
    method:"POST",
    headers:{
      "Authorization":`Basic ${basic}`,
      "Content-Type":"application/x-www-form-urlencoded"
    },
    body:body.toString()
  });
  const d=await r.json().catch(()=>({}));
  if(r.status===401||r.status===403)throw Object.assign(new Error("eBay rejected the Production Client ID / Client Secret."),{code:401});
  if(!r.ok||!d.access_token)throw Object.assign(new Error(`eBay OAuth failed${d.error_description?`: ${d.error_description}`:"."}`),{code:502});
  const expires=Math.max(300,Number(d.expires_in||7200));
  ebayAppTokenCache={token:d.access_token,expiresAt:Date.now()+expires*1000};
  return d.access_token;
}
function comicPriceQuery({title="",issueNumber="",publisher="",year="",variant="",printing="",grade=""}={}){
  const bits=[year,publisher,title,issueNumber?`#${issueNumber}`:"",variant,printing,"comic"].map(x=>String(x||"").trim()).filter(Boolean);
  return bits.join(" ").replace(/\s+/g," ").slice(0,180);
}
function normPriceText(s=""){return String(s||"").toLowerCase().replace(/[’']/g,"").replace(/[^a-z0-9#.+-]+/g," ").replace(/\s+/g," ").trim()}
function issuePatternMatches(text,issue){
  issue=String(issue||"").trim().replace(/^#/,"");
  if(!issue)return true;
  const t=String(text||"");
  const escIssue=issue.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const patterns=[
    new RegExp(`#\\s*${escIssue}(?![0-9])`,"i"),
    new RegExp(`\\bissue\\s*#?\\s*${escIssue}(?![0-9])`,"i"),
    new RegExp(`\\bno\\.?\\s*${escIssue}(?![0-9])`,"i")
  ];
  return patterns.some(p=>p.test(t));
}
function comicListingScore(item,identity){
  const raw=String(item?.title||"");
  const t=normPriceText(raw);
  let score=0;

  const titleTokens=normPriceText(identity.title).split(" ").filter(x=>x.length>2&&!["the","and","comic","comics"].includes(x));
  const titleHits=titleTokens.filter(x=>t.includes(x)).length;
  if(titleTokens.length)score+=Math.round(38*titleHits/titleTokens.length);
  if(issuePatternMatches(raw,identity.issueNumber))score+=30;
  else score-=22;

  const pubTokens=normPriceText(identity.publisher).split(" ").filter(x=>x.length>2);
  if(pubTokens.some(x=>t.includes(x)))score+=6;
  if(identity.year&&t.includes(String(identity.year)))score+=4;

  const variantTokens=normPriceText(identity.variant).split(" ").filter(x=>x.length>3&&!["cover","variant","edition"].includes(x));
  if(variantTokens.length){
    const vh=variantTokens.filter(x=>t.includes(x)).length;
    score+=Math.min(12,vh*4);
  }

  const printingTokens=normPriceText(identity.printing).split(" ").filter(x=>x.length>2);
  if(printingTokens.some(x=>t.includes(x)))score+=6;

  const rawGrade=normPriceText(identity.grade||"raw");
  const isSlab=/\b(cgc|cbcs|pgx|graded|slab|9\.[0-9]|10\.0)\b/i.test(raw);
  const wantsSlab=rawGrade&&!["raw","ungraded",""].includes(rawGrade);
  if(wantsSlab){
    if(isSlab)score+=8;else score-=8;
  }else if(isSlab)score-=28;

  if(/\b(lot|bundle|set of|reader lot|run of|issues? [0-9]+[-–][0-9]+|complete run)\b/i.test(raw))score-=45;
  if(/\bfacsimile\b/i.test(raw)&&!/facsimile/i.test(identity.variant||identity.printing||""))score-=45;
  if(/\breprint\b/i.test(raw)&&!/reprint/i.test(identity.variant||identity.printing||""))score-=20;
  if(/\bposter|print|art print|signed photo|digital\b/i.test(raw))score-=35;

  return score;
}
function percentile(sorted,p){
  if(!sorted.length)return 0;
  const i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  if(lo===hi)return sorted[lo];
  return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);
}
function roundedMoney(n){return Math.round(Number(n||0)*100)/100}

async function ebayComicMarket(identity){
  const token=await getEbayAppToken();
  const q=comicPriceQuery(identity);
  const params=new URLSearchParams({q,limit:"50",filter:"buyingOptions:{FIXED_PRICE}"});
  const r=await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,{
    headers:{
      "Authorization":`Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID":"EBAY_US",
      "Accept":"application/json"
    }
  });
  const d=await r.json().catch(()=>({}));
  if(r.status===401){
    ebayAppTokenCache={token:"",expiresAt:0};
    throw Object.assign(new Error("eBay authorization expired. Try Refresh again."),{code:401});
  }
  if(r.status===429)throw Object.assign(new Error("eBay API rate limit reached. Try again later."),{code:429});
  if(!r.ok)throw Object.assign(new Error(d?.errors?.[0]?.message||`eBay search failed (${r.status}).`),{code:502});

  const raw=Array.isArray(d.itemSummaries)?d.itemSummaries:[];
  const scored=raw.map(item=>{
    const price=Number(item?.price?.value||0);
    return {item,price,score:comicListingScore(item,identity)};
  }).filter(x=>Number.isFinite(x.price)&&x.price>0&&x.score>=48)
    .sort((a,b)=>b.score-a.score);

  // Keep the strongest matches, then remove severe price outliers.
  let comps=scored.slice(0,24);
  if(comps.length>=5){
    const vals=comps.map(x=>x.price).sort((a,b)=>a-b);
    const q1=percentile(vals,.25),q3=percentile(vals,.75),iqr=q3-q1;
    const lower=Math.max(.5,q1-1.5*iqr),upper=q3+1.5*iqr;
    comps=comps.filter(x=>x.price>=lower&&x.price<=upper);
  }
  if(!comps.length){
    return {value:0,low:0,high:0,median:0,confidence:"Low",comparablesUsed:0,
      note:`No strong live eBay matches found for ${identity.title} #${identity.issueNumber}. Try refining the variant/printing or enter a value manually.`,
      source:"eBay market estimate",query:q};
  }

  const vals=comps.map(x=>x.price).sort((a,b)=>a-b);
  const median=percentile(vals,.5),low=percentile(vals,.25),high=percentile(vals,.75);
  const avgScore=comps.reduce((s,x)=>s+x.score,0)/comps.length;
  let confidence="Low";
  if(comps.length>=8&&avgScore>=68)confidence="High";
  else if(comps.length>=4&&avgScore>=57)confidence="Medium";

  return {
    value:roundedMoney(median),
    median:roundedMoney(median),
    low:roundedMoney(low),
    high:roundedMoney(high),
    confidence,
    comparablesUsed:comps.length,
    note:`Based on ${comps.length} matched live eBay fixed-price listing${comps.length===1?"":"s"}. This is an asking-price market estimate, not confirmed sold history.`,
    source:"eBay market estimate",
    query:q
  };
}

app.get("/api/comics/ebay-status",async(req,res)=>{
  try{
    if(!ebayConfigured())return res.status(503).json({ok:false,error:"EBAY_CLIENT_ID / EBAY_CLIENT_SECRET missing"});
    await getEbayAppToken();
    res.json({ok:true,environment:"production"});
  }catch(err){res.status(err.code||502).json({ok:false,error:err.message||"eBay connection failed"})}
});

app.post("/api/comics/price",async(req,res)=>{
  try{
    const identity={
      title:String(req.body?.title||"").trim(),
      issueNumber:String(req.body?.issueNumber||"").trim(),
      publisher:String(req.body?.publisher||"").trim(),
      year:String(req.body?.year||"").trim(),
      variant:String(req.body?.variant||"").trim(),
      printing:String(req.body?.printing||"").trim(),
      grade:String(req.body?.grade||"Raw").trim(),
      gradingCompany:String(req.body?.gradingCompany||"").trim()
    };
    if(!identity.title||!identity.issueNumber)return res.status(400).json({error:"Missing comic title or issue number."});
    if(!ebayConfigured())return res.status(503).json({error:"eBay Production credentials are not configured in Render."});

    const key=`ebaycomic|${identity.title}|${identity.issueNumber}|${identity.publisher}|${identity.year}|${identity.variant}|${identity.printing}|${identity.grade}`.toLowerCase();
    const cached=priceMemoryCache.get(key);
    if(cached&&Date.now()-cached.savedAt<6*60*60*1000)return res.json({...cached.data,cached:true});

    const result=await ebayComicMarket(identity);
    priceMemoryCache.set(key,{savedAt:Date.now(),data:result});
    res.json(result);
  }catch(err){
    console.error("Comic eBay price:",err);
    res.status(err.code||500).json({error:err.message||"Comic eBay market refresh failed."});
  }
});


const funkoLookupCache=new Map();
const FUNKO_CACHE_MS=24*60*60*1000;

function normalizeUpcItemdbProduct(p={}){
  const offers=Array.isArray(p.offers)?p.offers.filter(o=>Number(o?.price)>0):[];
  const offerPrices=offers.map(o=>Number(o.price)).filter(v=>Number.isFinite(v)&&v>0);
  const lowRecorded=Number(p.lowest_recorded_price||0);
  const highRecorded=Number(p.highest_recorded_price||0);
  let value=0;
  if(offerPrices.length){
    const sorted=offerPrices.slice().sort((a,b)=>a-b);
    value=sorted[Math.floor(sorted.length/2)];
  }else if(Number.isFinite(lowRecorded)&&lowRecorded>0){
    value=lowRecorded;
  }

  const images=Array.isArray(p.images)?p.images.filter(Boolean):[];
  const title=String(p.title||"Unknown Funko");
  const brand=String(p.brand||"Funko");
  const category=String(p.category||"");
  const popMatch=title.match(/(?:POP!?\s*(?:VINYL)?\s*)?(?:NO\.?\s*|#)\s*(\d{1,5})\b/i)
    || title.match(/\bPOP!?\s+(\d{1,5})\b/i);

  let franchise="Funko";
  if(category){
    const parts=category.split(">").map(x=>x.trim()).filter(Boolean);
    franchise=parts[parts.length-1]||"Funko";
  }
  if(/funko/i.test(brand))franchise=franchise==="Funko" ? "Funko" : franchise;

  return {
    upc:String(p.upc||p.ean||p.gtin||""),
    ean:String(p.ean||""),
    title,
    brand,
    franchise,
    category,
    model:String(p.model||""),
    popNumber:String(popMatch?.[1]||""),
    image:String(images[0]||""),
    images,
    description:String(p.description||""),
    value,
    priceLow:Number.isFinite(lowRecorded)&&lowRecorded>0?lowRecorded:0,
    priceHigh:Number.isFinite(highRecorded)&&highRecorded>0?highRecorded:0,
    priceSource:offerPrices.length?"UPCitemdb current offers":"UPCitemdb recorded price",
    offers:offers.slice(0,6).map(o=>({
      merchant:String(o.merchant||o.domain||""),
      price:Number(o.price||0),
      condition:String(o.condition||""),
      availability:String(o.availability||"")
    }))
  };
}

async function upcItemdbJson(url){
  const r=await fetch(url,{
    headers:{
      "Accept":"application/json",
      "Accept-Encoding":"gzip, deflate",
      "User-Agent":"CardVault/3.2.2"
    }
  });
  let data=null;
  try{data=await r.json()}catch{}
  if(r.status===429){
    const err=new Error("Free UPC lookup limit reached for today");
    err.code=429;throw err;
  }
  if(r.status===404){
    const err=new Error("No product found");
    err.code=404;throw err;
  }
  if(!r.ok){
    const err=new Error(data?.message||data?.code||"UPC lookup unavailable");
    err.code=r.status;throw err;
  }
  return data||{};
}

app.get("/api/funko/barcode/:code",async(req,res)=>{
  try{
    let code=String(req.params.code||"").replace(/\D/g,"");
    if(!/^\d{8,14}$/.test(code))return res.status(400).json({error:"Invalid UPC/EAN"});

    const key=`b:${code}`;
    const cached=funkoLookupCache.get(key);
    if(cached&&Date.now()-cached.savedAt<FUNKO_CACHE_MS)return res.json({...cached.data,cached:true});

    // UPCitemdb accepts UPC/EAN/GTIN on its trial lookup endpoint.
    let data;
    try{
      data=await upcItemdbJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`);
    }catch(err){
      // Some scanners return EAN-13 with a leading zero for a UPC-A.
      // Retry the 12-digit UPC form when appropriate.
      if(code.length===13&&code.startsWith("0")){
        const upc12=code.slice(1);
        data=await upcItemdbJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc12)}`);
        code=upc12;
      }else throw err;
    }

    const items=Array.isArray(data.items)?data.items:[];
    if(!items.length)return res.status(404).json({error:"Barcode not found"});

    const products=items.map(normalizeUpcItemdbProduct);
    // Barcode is exact enough that we do NOT reject a result only because
    // its title/brand is imperfect. The user gets the actual database hit.
    const payload={product:products[0],products,source:"UPCitemdb",aiUsed:false};
    funkoLookupCache.set(key,{savedAt:Date.now(),data:payload});
    res.json(payload);
  }catch(err){
    console.error("Funko barcode:",err);
    res.status(err.code||502).json({error:err.message||"Could not reach barcode service"});
  }
});

app.get("/api/funko/search",async(req,res)=>{
  try{
    let q=String(req.query.q||"").trim().slice(0,100);
    if(q.length<2)return res.status(400).json({error:"Search is too short"});

    // Add Funko to a normal character search, but don't require the response
    // itself to literally contain "Funko" because database titles vary.
    const searchPhrase=/funko|pop!/i.test(q)?q:`Funko Pop ${q}`;
    const key=`s:${searchPhrase.toLowerCase()}`;
    const cached=funkoLookupCache.get(key);
    if(cached&&Date.now()-cached.savedAt<FUNKO_CACHE_MS)return res.json({...cached.data,cached:true});

    const url=`https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(searchPhrase)}&type=product&match_mode=0`;
    const data=await upcItemdbJson(url);
    const items=Array.isArray(data.items)?data.items:[];

    // Score likely Funko products first without deleting weaker database hits.
    const scored=items.map(p=>{
      const text=[p.brand,p.title,p.description,p.category].join(" ");
      let score=0;
      if(/funko/i.test(text))score+=5;
      if(/\bpop!?\b/i.test(text))score+=3;
      if(String(p.brand||"").toLowerCase()==="funko")score+=4;
      return {score,p};
    }).sort((a,b)=>b.score-a.score);

    const products=scored.map(x=>normalizeUpcItemdbProduct(x.p)).slice(0,10);
    const payload={products,source:"UPCitemdb",aiUsed:false};
    funkoLookupCache.set(key,{savedAt:Date.now(),data:payload});
    res.json(payload);
  }catch(err){
    console.error("Funko search:",err);
    res.status(err.code||502).json({error:err.message||"Could not reach product search"});
  }
});

const pokemonSearchCache=new Map();
const POKEMON_CACHE_MS=6*60*60*1000;

function pokemonImageUrl(raw){
  if(!raw)return "";
  if(/\.(png|webp|jpg|jpeg)(\?|$)/i.test(raw))return raw;
  return `${raw}/high.webp`;
}
function tcgPlayerVariantPrice(tcg={}){
  const candidates=[];
  for(const [variant,data] of Object.entries(tcg||{})){
    if(!data||typeof data!=="object")continue;
    const market=Number(data.marketPrice);
    const mid=Number(data.midPrice);
    const low=Number(data.lowPrice);
    const high=Number(data.highPrice);
    if(Number.isFinite(market)&&market>0)candidates.push({variant,value:market,low:Number.isFinite(low)?low:market,high:Number.isFinite(high)?high:market});
    else if(Number.isFinite(mid)&&mid>0)candidates.push({variant,value:mid,low:Number.isFinite(low)?low:mid,high:Number.isFinite(high)?high:mid});
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>a.value-b.value);
  return candidates[Math.floor(candidates.length/2)];
}
function normalizeTcgdexPokemon(c){
  const usd=c?.pricing?.tcgplayer?.unit==="USD"?tcgPlayerVariantPrice(c.pricing.tcgplayer):null;
  const variantNames=Object.entries(c?.variants||{}).filter(([,v])=>v===true).map(([k])=>k.replace(/([A-Z])/g," $1").trim());
  return {
    tcgdexId:String(c.id||""),
    name:String(c.name||"Unknown card"),
    localId:String(c.localId||""),
    setId:String(c.set?.id||""),
    setName:String(c.set?.name||""),
    rarity:String(c.rarity||""),
    cardType:String(c.category||""),
    illustrator:String(c.illustrator||""),
    hp:Number(c.hp||0),
    types:Array.isArray(c.types)?c.types:[],
    stage:String(c.stage||""),
    image:pokemonImageUrl(c.image),
    variants:c.variants||{},
    variantsText:variantNames.join(" • "),
    value:Number(usd?.value||0),
    priceLow:Number(usd?.low||0),
    priceHigh:Number(usd?.high||0),
    priceSource:usd?`TCGdex / TCGPlayer ${usd.variant}`:"TCGdex",
    pricingUpdatedAt:Date.now()
  };
}
app.get("/api/pokemon/search",async(req,res)=>{
  try{
    const name=String(req.query.name||"").trim().slice(0,80);
    const number=String(req.query.number||"").trim().replace(/^#/,"").slice(0,30);
    const setName=String(req.query.set||"").trim().slice(0,80);
    if(!name&&!number)return res.status(400).json({error:"Enter a Pokémon/card name or card number."});

    const cacheKey=[name,number,setName].map(x=>x.toLowerCase()).join("|");
    const cached=pokemonSearchCache.get(cacheKey);
    if(cached&&Date.now()-cached.savedAt<POKEMON_CACHE_MS)return res.json({...cached.data,cached:true});

    const params=new URLSearchParams();
    if(name)params.set("name",name);
    if(number)params.set("localId",number);
    params.set("pagination:page","1");
    params.set("pagination:itemsPerPage","30");

    let listResponse=await fetch(`https://api.tcgdex.net/v2/en/cards?${params.toString()}`,{headers:{"Accept":"application/json","User-Agent":"CardVault/3.0.1"}});
    if(!listResponse.ok&&number){
      // Some deployments may not accept localId filtering on the list endpoint.
      const fallback=new URLSearchParams();
      if(name)fallback.set("name",name);
      fallback.set("pagination:page","1");fallback.set("pagination:itemsPerPage","60");
      listResponse=await fetch(`https://api.tcgdex.net/v2/en/cards?${fallback.toString()}`,{headers:{"Accept":"application/json","User-Agent":"CardVault/3.0.1"}});
    }
    if(!listResponse.ok)return res.status(502).json({error:"TCGdex search is temporarily unavailable."});
    let briefs=await listResponse.json();
    if(!Array.isArray(briefs))briefs=[];
    if(number)briefs=briefs.filter(c=>String(c.localId||"").toLowerCase()===number.toLowerCase());
    briefs=briefs.slice(0,24);

    const details=(await Promise.all(briefs.map(async b=>{
      try{
        const r=await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(b.id)}`,{headers:{"Accept":"application/json","User-Agent":"CardVault/3.0.1"}});
        if(!r.ok)return null;
        return await r.json();
      }catch{return null}
    }))).filter(Boolean);

    let rows=details;
    if(setName){
      const needle=setName.toLowerCase();
      rows=rows.filter(c=>String(c.set?.name||"").toLowerCase().includes(needle)||String(c.set?.id||"").toLowerCase().includes(needle));
    }
    const cards=rows.slice(0,20).map(normalizeTcgdexPokemon);
    const data={cards,source:"TCGdex",aiUsed:false};
    pokemonSearchCache.set(cacheKey,{savedAt:Date.now(),data});
    res.json(data);
  }catch(err){
    console.error("Pokemon API search error:",err);
    res.status(502).json({error:"Could not reach TCGdex."});
  }
});

const priceMemoryCache=new Map();
function priceKey(body){
  return [body.player,body.year,body.set,body.cardNumber,body.parallel,body.serialNumber,body.grade].map(v=>String(v||"").trim().toLowerCase()).join("|");
}
app.post("/api/price",async(req,res)=>{
  try{
    const {player="",team="",sport="",year="",set="",cardNumber="",parallel="",serialNumber="",grade=""}=req.body||{};
    if(!player&&!set)return res.status(400).json({error:"Missing card identity"});
    if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:"AI market search is not configured."});

    const key=priceKey(req.body||{});
    const cached=priceMemoryCache.get(key);
    if(cached && Date.now()-cached.savedAt<24*60*60*1000){
      return res.json({...cached.data,cached:true});
    }

    const model=process.env.GEMINI_MODEL||"gemini-3.1-flash-lite";
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const exactCard=[year,set,player,cardNumber?`#${cardNumber}`:"",parallel,serialNumber,grade].filter(Boolean).join(" ");
    const prompt=`You are Card Vault's OPTIONAL live-market refresh tool.
Search the live web for this exact sports card or the closest legitimate comparables.

Player: ${player}
Team: ${team}
Sport: ${sport}
Year: ${year}
Set: ${set}
Card number: ${cardNumber}
Parallel: ${parallel}
Serial: ${serialNumber}
Grade/condition: ${grade}

Prefer eBay evidence when it appears in search, then reputable card-market sources.
Do not mix different parallels, lots, packs, reprints, or obviously different grades.
Asking prices are not sold prices, so reduce confidence if only asking prices are found.
Never invent sales or prices.

Return ONLY JSON:
{"value":18.50,"low":14.00,"high":23.00,"confidence":"High|Medium|Low","note":"short basis for estimate","comparablesUsed":5}

Exact search phrase: ${exactCard}`;

    const response=await fetch(endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},
      body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],tools:[{google_search:{}}],generationConfig:{temperature:0.15}})
    });
    const data=await response.json();
    if(response.status===429)return res.status(429).json({error:"Live AI pricing is cooling down. Your scan estimate is still available."});
    if(!response.ok){
      console.error("Gemini pricing error:",response.status,data);
      return res.status(502).json({error:"Live market refresh could not run."});
    }

    const candidate=data?.candidates?.[0];
    let text=candidate?.content?.parts?.map(p=>p.text||"").join("")||"";
    text=text.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim();
    const jsonMatch=text.match(/\{[\s\S]*\}/);
    if(!jsonMatch)return res.status(502).json({error:"Live market refresh returned an unreadable result."});
    const parsed=JSON.parse(jsonMatch[0]);
    const value=Number(parsed.value),low=Number(parsed.low),high=Number(parsed.high);
    if(!Number.isFinite(value)||!Number.isFinite(low)||!Number.isFinite(high))return res.status(502).json({error:"Live market refresh returned invalid numbers."});

    const chunks=candidate?.groundingMetadata?.groundingChunks||[];
    const sources=[];const seen=new Set();
    for(const chunk of chunks){
      const web=chunk?.web;if(!web?.uri||seen.has(web.uri))continue;seen.add(web.uri);
      sources.push({title:web.title||"Web source",url:web.uri});if(sources.length>=5)break;
    }
    const result={
      value:Math.round(value*100)/100,low:Math.round(Math.min(low,high)*100)/100,high:Math.round(Math.max(low,high)*100)/100,
      confidence:["High","Medium","Low"].includes(parsed.confidence)?parsed.confidence:"Low",
      note:String(parsed.note||"Live AI estimate based on current web comparables.").slice(0,220),
      comps:Number(parsed.comparablesUsed||sources.length||0),source:"Live AI market estimate",sources
    };
    priceMemoryCache.set(key,{savedAt:Date.now(),data:result});
    res.json(result);
  }catch(e){
    console.error("Price endpoint error:",e);
    res.status(500).json({error:"Live market refresh failed."});
  }
});

app.get("/api/config",(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const firebaseConfig=getFirebaseConfig();
  if(firebaseConfig){
    // Same-site auth domain prevents Safari storage-partitioning failures.
    firebaseConfig.authDomain=req.get("host");
  }
  res.json({
    firebaseConfig,
    appleAuthEnabled:String(process.env.APPLE_AUTH_ENABLED||"false").toLowerCase()==="true",
    aiConfigured:Boolean(process.env.GEMINI_API_KEY)
  });
});

app.get("/api/health",(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({
    ok:true,
    aiProvider:"Gemini",
    aiConfigured:Boolean(process.env.GEMINI_API_KEY),
    firebaseConfigured:Boolean(getFirebaseConfig()),
    appleAuthEnabled:String(process.env.APPLE_AUTH_ENABLED||"false").toLowerCase()==="true",
    model:String(process.env.GEMINI_SCAN_MODELS||"gemini-3.1-flash-lite,gemini-2.5-flash")
  });
});

app.post("/api/identify",scanRateLimit,async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  try{
    const front=parseDataUrl(req.body?.front), back=parseDataUrl(req.body?.back);
    if(!front||!back)return res.status(400).json({error:"Two JPG, PNG, or WebP card images are required."});
    if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:"Card Vault AI is not configured yet."});

    const scanModels=String(process.env.GEMINI_SCAN_MODELS||"gemini-3.1-flash-lite,gemini-2.5-flash")
      .split(",").map(x=>x.trim()).filter(Boolean);

    const systemInstruction=`
You are Card Vault AI, a conservative sports trading-card identification system.
The two images are the FRONT and BACK of the SAME physical sports card.

Use visible evidence only: player name, team, manufacturer, logos, copyright text,
set name, year, card number, rookie marks, serial numbering, foil/color/pattern,
borders, inscriptions, card design, grading slab label, grading company, and visible slab grade.

Be especially careful about parallels and variations. Compare border color, foil treatment,
pattern, serial numbering, logos, card-number placement, and back-design details before
claiming an exact match. If a slab is visible, report the grading company/grade in evidence
and use the visible grade. If the card is raw, grade must remain "Raw".

Return one PRIMARY exact-card match and up to 3 useful ALTERNATES.
Confidence is 0-100 confidence in the EXACT card including parallel/variation.
Do not give high confidence merely because the player is obvious.
If exact parallel or variation is uncertain, lower confidence and use alternates.
Never invent a serial number. Use an empty string when unreadable.
If a grading slab is visibly present, report the visible slab grade; otherwise grade is "Raw".
Also provide a ROUGH market estimate for the PRIMARY card in marketEstimate using general card-market knowledge.
This estimate is intentionally approximate and must NOT claim to be live eBay sold data.
Be conservative. Common modern raw base cards should generally be valued modestly.
Widen the low/high range and lower confidence when the exact parallel, grade, or market is uncertain.
Do not assign a numeric condition grade from raw-card appearance.
Evidence should contain brief visible clues supporting each candidate.
If image quality prevents reliable identification, say so in warning.
`;

    const body={
      systemInstruction:{parts:[{text:systemInstruction}]},
      contents:[{
        role:"user",
        parts:[
          {text:"Identify this sports trading card. Image 1 is FRONT. Image 2 is BACK. Return the best exact match plus alternates when useful."},
          {inlineData:{mimeType:front.mimeType,data:front.data}},
          {inlineData:{mimeType:back.mimeType,data:back.data}}
        ]
      }],
      generationConfig:{
        responseMimeType:"application/json",
        responseJsonSchema:resultSchema,
        temperature:0.1,
        maxOutputTokens:1800
      }
    };

    let response=null;
    let data=null;
    let usedModel="";
    let lastStatus=0;

    for(const model of scanModels){
      const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      response=await fetch(endpoint,{
        method:"POST",
        headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},
        body:JSON.stringify(body)
      });
      data=await response.json();
      lastStatus=response.status;
      usedModel=model;

      if(response.ok)break;

      console.warn("Gemini scan model failed",model,response.status,data?.error?.message||"");
      // Only route to the next model for quota/capacity/model-availability failures.
      if(![404,429,503].includes(response.status))break;
    }

    if(!response?.ok){
      console.error("All Gemini scan models failed",lastStatus,data);
      if(lastStatus===429)return res.status(429).json({error:"The free AI quota is temporarily exhausted across the available scan models. Try again after the quota resets."});
      if(lastStatus===400)return res.status(502).json({error:"The AI model rejected this scan. Try clearer photos."});
      return res.status(502).json({error:"The AI scan service is temporarily unavailable."});
    }

    res.setHeader("X-Card-Vault-AI-Model",usedModel);

    let text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    text=text.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim();
    if(!text)return res.status(502).json({error:"The AI returned no result. Try clearer photos."});

    const parsed=JSON.parse(text);
    parsed.primary.confidence=clampConfidence(parsed.primary?.confidence);
    parsed.alternates=(parsed.alternates||[]).slice(0,3).map(x=>({...x,confidence:clampConfidence(x.confidence)}));
    res.json(parsed);
  }catch(error){
    console.error("Identify route crash:",error);
    res.status(500).json({error:"Card Vault AI hit a server error during this scan. Try again; if it repeats, check Render logs."});
  }
});

app.use((req,res)=>{
  res.sendFile(process.cwd()+"/public/index.html");
});

app.listen(port,"0.0.0.0",()=>{
  console.log(`Card Vault v3.3.5 running on port ${port}`);
});
