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
  res.json({version:"1.1.8"});
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
const resultSchema={
  type:"object",
  properties:{
    primary:matchSchema,
    alternates:{type:"array",maxItems:3,items:matchSchema},
    imageQuality:{type:"string",enum:["good","usable","poor"]},
    warning:{type:"string"}
  },
  required:["primary","alternates","imageQuality","warning"]
};

function getFirebaseConfig(){
  const raw=process.env.FIREBASE_WEB_CONFIG;
  if(!raw)return null;
  try{return JSON.parse(raw)}catch{return null}
}

app.post("/api/price",async(req,res)=>{
  try{
    const {player="",team="",sport="",year="",set="",cardNumber="",parallel="",serialNumber="",grade=""}=req.body||{};
    if(!player&&!set)return res.status(400).json({error:"Missing card identity"});
    if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:"AI market search is not configured."});

    const model=process.env.GEMINI_MODEL||"gemini-3-flash-preview";
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const exactCard=[year,set,player,cardNumber?`#${cardNumber}`:"",parallel,serialNumber,grade].filter(Boolean).join(" ");
    const prompt=`You are the market-pricing engine for Card Vault, a sports trading-card collection app.\n\nCard to price:\nPlayer: ${player}\nTeam: ${team}\nSport: ${sport}\nYear: ${year}\nSet: ${set}\nCard number: ${cardNumber}\nParallel/variation: ${parallel}\nSerial number: ${serialNumber}\nGrade/condition: ${grade}\n\nSearch the live web for THIS EXACT CARD or the closest legitimate comparables. Prefer eBay evidence when it appears in search, then other reputable card-market sources. Match year, set, card number, parallel, serial numbering, and grade closely. Do not mix raw and graded copies unless unavoidable. Ignore unrelated cards, lots, different parallels, reprints, packs, and extreme outliers. Asking prices are not sold prices, so discount confidence if only asking prices are available. Never invent sales or prices. Produce a conservative fair-market estimate in USD.\n\nReturn ONLY JSON in this shape:\n{"value":18.50,"low":14.00,"high":23.00,"confidence":"High|Medium|Low","note":"short basis for estimate","comparablesUsed":5}\n\nExact-card search phrase: ${exactCard}`;

    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],tools:[{google_search:{}}],generationConfig:{temperature:0.2}})});
    const data=await response.json();
    if(!response.ok){console.error("Gemini pricing error:",response.status,data);if(response.status===429)return res.status(429).json({error:"AI market-search limit reached. Try again later."});return res.status(502).json({error:"AI market search could not run."})}

    const candidate=data?.candidates?.[0];
    let text=candidate?.content?.parts?.map(p=>p.text||"").join("")||"";
    text=text.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim();
    const jsonMatch=text.match(/\{[\s\S]*\}/);
    if(!jsonMatch)return res.status(502).json({error:"AI market estimate returned an unreadable result."});
    const parsed=JSON.parse(jsonMatch[0]);
    const value=Number(parsed.value),low=Number(parsed.low),high=Number(parsed.high);
    if(!Number.isFinite(value)||!Number.isFinite(low)||!Number.isFinite(high)||value<0||low<0||high<0)return res.status(502).json({error:"AI market estimate returned invalid pricing."});

    const chunks=candidate?.groundingMetadata?.groundingChunks||[];const sources=[];const seen=new Set();
    for(const chunk of chunks){const web=chunk?.web;if(!web?.uri||seen.has(web.uri))continue;seen.add(web.uri);sources.push({title:web.title||"Web source",url:web.uri});if(sources.length>=5)break}
    res.json({value:Math.round(value*100)/100,low:Math.round(Math.min(low,high)*100)/100,high:Math.round(Math.max(low,high)*100)/100,confidence:["High","Medium","Low"].includes(parsed.confidence)?parsed.confidence:"Low",note:String(parsed.note||"AI estimate based on current web comparables.").slice(0,220),comps:Number(parsed.comparablesUsed||sources.length||0),source:"AI web estimate",sources});
  }catch(e){console.error("Price endpoint error:",e);res.status(500).json({error:"AI market-pricing engine failed."})}
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
    model:process.env.GEMINI_MODEL||"gemini-3-flash-preview"
  });
});

app.post("/api/identify",scanRateLimit,async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  try{
    const front=parseDataUrl(req.body?.front), back=parseDataUrl(req.body?.back);
    if(!front||!back)return res.status(400).json({error:"Two JPG, PNG, or WebP card images are required."});
    if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:"Card Vault AI is not configured yet."});

    const model=process.env.GEMINI_MODEL||"gemini-3-flash-preview";
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const systemInstruction=`
You are Card Vault AI, a conservative sports trading-card identification system.
The two images are the FRONT and BACK of the SAME physical sports card.

Use visible evidence only: player name, team, manufacturer, logos, copyright text,
set name, year, card number, rookie marks, serial numbering, foil/color/pattern,
borders, inscriptions and design.

Return one PRIMARY exact-card match and up to 3 useful ALTERNATES.
Confidence is 0-100 confidence in the EXACT card including parallel/variation.
Do not give high confidence merely because the player is obvious.
If exact parallel or variation is uncertain, lower confidence and use alternates.
Never invent a serial number. Use an empty string when unreadable.
If a grading slab is visibly present, report the visible slab grade; otherwise grade is "Raw".
Do not estimate price. Do not assign a numeric condition grade from card appearance.
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
        temperature:0.15
      }
    };

    const response=await fetch(endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},
      body:JSON.stringify(body)
    });
    const data=await response.json();

    if(!response.ok){
      console.error("Gemini error",response.status,data);
      if(response.status===429)return res.status(429).json({error:"The AI free-tier limit was reached. Try again later."});
      if(response.status===400)return res.status(502).json({error:"The AI model rejected this scan. Try clearer photos."});
      return res.status(502).json({error:"The AI service could not process this scan."});
    }

    let text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    text=text.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim();
    if(!text)return res.status(502).json({error:"The AI returned no result. Try clearer photos."});

    const parsed=JSON.parse(text);
    parsed.primary.confidence=clampConfidence(parsed.primary?.confidence);
    parsed.alternates=(parsed.alternates||[]).slice(0,3).map(x=>({...x,confidence:clampConfidence(x.confidence)}));
    res.json(parsed);
  }catch(error){
    console.error(error);
    res.status(500).json({error:"Card Vault AI couldn't process this scan. Try clearer photos."});
  }
});

app.use((req,res)=>{
  res.sendFile(process.cwd()+"/public/index.html");
});

app.listen(port,"0.0.0.0",()=>{
  console.log(`Card Vault v1.0 running on port ${port}`);
});
