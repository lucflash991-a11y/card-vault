import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "18mb" }));
app.use(express.static("public"));

function parseDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(value || "");
  if (!match) return null;
  return { mimeType: match[1] === "image/jpg" ? "image/jpeg" : match[1], data: match[2] };
}

const matchSchema = {
  type: "object",
  properties: {
    confidence: { type: "number", minimum: 0, maximum: 100 },
    player: { type: "string" },
    team: { type: "string" },
    sport: { type: "string", enum: ["Football","Basketball","Baseball","Hockey","Soccer","Other"] },
    year: { type: "string" },
    manufacturer: { type: "string" },
    set: { type: "string" },
    cardNumber: { type: "string" },
    parallel: { type: "string" },
    serialNumber: { type: "string" },
    rookie: { type: "boolean" },
    grade: { type: "string" },
    evidence: { type: "array", items: { type: "string" } }
  },
  required: ["confidence","player","team","sport","year","manufacturer","set","cardNumber","parallel","serialNumber","rookie","grade","evidence"]
};

const resultSchema = {
  type: "object",
  properties: {
    primary: matchSchema,
    alternates: { type: "array", maxItems: 3, items: matchSchema },
    imageQuality: { type: "string", enum: ["good","usable","poor"] },
    warning: { type: "string" }
  },
  required: ["primary","alternates","imageQuality","warning"]
};

app.post("/api/identify", async (req, res) => {
  try {
    const front = parseDataUrl(req.body?.front);
    const back = parseDataUrl(req.body?.back);

    if (!front || !back) {
      return res.status(400).json({ error: "Two valid card images are required." });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "AI is not configured yet. Add GEMINI_API_KEY in Render." });
    }

    const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const systemInstruction = `
You are Card Vault AI, a sports trading-card identification system.
Analyze BOTH images as the front and back of the SAME physical card.

Identify visible facts only. Use clues including:
player name, team, manufacturer, copyright year, set name, card number,
rookie logo, serial numbering, foil/color/pattern, borders, logos and design.

Return one PRIMARY exact-card match and up to 3 useful ALTERNATES.
Confidence is 0-100 and must mean confidence in the EXACT card/parallel/variation,
not just the player. If the base card is clear but the exact parallel is uncertain,
lower confidence and use alternates for the plausible parallel/variation options.
Never invent a serial number. Use an empty string when unreadable.
If slabbed, grade is the visible slab grade; otherwise grade must be "Raw".
Do not estimate price and do not visually assign a numeric condition grade.
Evidence should contain short visible clues that support each proposed match.
`;

    const body = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [{
        role: "user",
        parts: [
          { text: "Identify this sports trading card using both images. First image is FRONT. Second image is BACK." },
          { inlineData: { mimeType: front.mimeType, data: front.data } },
          { inlineData: { mimeType: back.mimeType, data: back.data } }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: resultSchema
      }
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);
      if (response.status === 429) {
        return res.status(429).json({ error: "Free AI scan limit reached for now. Try again later." });
      }
      return res.status(502).json({ error: "The AI service could not process this scan." });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    if (!text) {
      return res.status(502).json({ error: "The AI returned no card result. Try clearer photos." });
    }

    const parsed = JSON.parse(text);
    parsed.primary.confidence = Math.max(0, Math.min(100, Number(parsed.primary.confidence || 0)));
    parsed.alternates = (parsed.alternates || []).slice(0, 3).map(item => ({
      ...item,
      confidence: Math.max(0, Math.min(100, Number(item.confidence || 0)))
    }));

    res.json(parsed);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Card Vault AI couldn't process this scan. Try clearer photos." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    aiProvider: "Gemini",
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL || "gemini-3-flash-preview"
  });
});

app.use((req, res) => {
  res.sendFile(process.cwd() + "/public/index.html");
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Card Vault running on port ${port}`);
});
