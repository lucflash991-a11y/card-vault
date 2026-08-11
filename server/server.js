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
  res.json({version:"2.4.2"});
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
  console.log(`Card Vault v2.4.2 running on port ${port}`);
});
