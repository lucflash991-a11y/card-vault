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
  res.json({version:"3.3.0"});
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

function normalizeComicProduct(p={},extra={}){
  const title=String(p.title||p.name||"Unknown Comic");
  const images=Array.isArray(p.images)?p.images.filter(Boolean):[];
  const offers=Array.isArray(p.offers)?p.offers.filter(o=>Number(o?.price)>0):[];
  const prices=offers.map(o=>Number(o.price)).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  const value=prices.length?prices[Math.floor(prices.length/2)]:Number(p.lowest_recorded_price||0)||0;
  const issueMatch=title.match(/(?:#|Issue\s*)([0-9A-Za-z.\-]+)/i);
  return {
    id:String(extra.id||p.upc||p.ean||p.isbn||`${Date.now()}-${Math.random()}`),
    title,
    series:String(extra.series||title.replace(/\s+#?\d+.*$/,"").trim()),
    issueNumber:String(extra.issueNumber||issueMatch?.[1]||""),
    publisher:String(extra.publisher||p.brand||""),
    year:String(extra.year||""),
    upc:String(extra.upc||p.upc||p.ean||""),
    supplement:String(extra.supplement||""),
    isbn:String(extra.isbn||""),
    image:String(extra.image||images[0]||""),
    description:String(extra.description||p.description||""),
    value,
    priceSource:prices.length?"UPCitemdb current offers":"UPCitemdb product data"
  };
}
async function openLibraryIsbn(isbn){
  const r=await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&jscmd=data&format=json`,{headers:{"Accept":"application/json","User-Agent":"CardVault/3.3.0"}});
  if(!r.ok)return null;const d=await r.json(),b=d[`ISBN:${isbn}`];if(!b)return null;
  return {
    id:`isbn-${isbn}`,title:String(b.title||"Unknown Comic"),series:String(b.title||""),
    issueNumber:"",publisher:String(b.publishers?.[0]?.name||""),year:String(b.publish_date||""),
    upc:"",supplement:"",isbn,image:String(b.cover?.large||b.cover?.medium||b.cover?.small||""),
    description:"Collected edition / graphic novel",value:0,priceSource:"Open Library"
  }
}
app.get("/api/comics/barcode/:code",async(req,res)=>{
  try{
    let code=String(req.params.code||"").replace(/\D/g,""),supplement=String(req.query.supplement||"").replace(/\D/g,"").slice(0,5);
    if(!/^\d{8,14}$/.test(code))return res.status(400).json({error:"Invalid barcode"});
    const key=`b:${code}:${supplement}`,cached=comicLookupCache.get(key);if(cached&&Date.now()-cached.savedAt<COMIC_CACHE_MS)return res.json({...cached.data,cached:true});
    const items=[];

    // ISBN-13/10 first for graphic novels/trades.
    if(code.length===10||code.startsWith("978")||code.startsWith("979")){
      const ol=await openLibraryIsbn(code);if(ol)items.push(ol)
    }

    // UPCitemdb for standard UPC/EAN comic products.
    if(!items.length){
      let data;
      try{data=await upcItemdbJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`)}
      catch(err){
        if(code.length===13&&code.startsWith("0")){code=code.slice(1);data=await upcItemdbJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`)}else throw err
      }
      const rows=Array.isArray(data.items)?data.items:[];
      rows.forEach((p,i)=>items.push(normalizeComicProduct(p,{id:`${code}-${supplement||i}`,upc:code,supplement})))
    }
    if(!items.length)return res.status(404).json({error:"No comic found for that barcode"});
    const payload={items,source:items[0]?.isbn?"Open Library":"UPCitemdb",aiUsed:false};comicLookupCache.set(key,{savedAt:Date.now(),data:payload});res.json(payload)
  }catch(err){console.error("Comic barcode:",err);res.status(err.code||502).json({error:err.message||"Comic barcode lookup failed"})}
});
app.get("/api/comics/search",async(req,res)=>{
  try{
    const title=String(req.query.title||"").trim().slice(0,100),issue=String(req.query.issue||"").trim().slice(0,20),publisher=String(req.query.publisher||"").trim().slice(0,60);
    if(title.length<2)return res.status(400).json({error:"Search is too short"});
    const phrase=[title,issue?`#${issue}`:"",publisher,"comic"].filter(Boolean).join(" ");
    const key=`s:${phrase.toLowerCase()}`,cached=comicLookupCache.get(key);if(cached&&Date.now()-cached.savedAt<COMIC_CACHE_MS)return res.json({...cached.data,cached:true});
    const data=await upcItemdbJson(`https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(phrase)}&type=product&match_mode=0`);
    const rows=Array.isArray(data.items)?data.items:[];
    const items=rows.slice(0,10).map((p,i)=>normalizeComicProduct(p,{id:`search-${p.upc||i}`,issueNumber:issue,publisher:publisher||p.brand||""}));
    const payload={items,source:"UPCitemdb",aiUsed:false};comicLookupCache.set(key,{savedAt:Date.now(),data:payload});res.json(payload)
  }catch(err){console.error("Comic search:",err);res.status(err.code||502).json({error:err.message||"Comic search failed"})}
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
  console.log(`Card Vault v3.3.0 running on port ${port}`);
});
