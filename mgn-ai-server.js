import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ALLOWED_ORIGINS = new Set([
  "https://mgnautos.co.uk",
  "https://www.mgnautos.co.uk",
  ...(process.env.MGN_ALLOWED_ORIGINS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
]);

const SYSTEM_PROMPT = `You are the website assistant for MGN Autos, an automotive business in Southampton, UK.

Keep answers concise, friendly and professional. Use British English and £ GBP.
Only answer questions about MGN Autos services, guide prices, the quote process, contact details, and general non-diagnostic explanations of those services. If a user asks something unrelated, politely say you can only help with MGN Autos services and bookings.

Known MGN Autos information:
- Location: Southampton, UK.
- Phone: 07443 926627.
- Email: quote@mgnautos.co.uk.
- Website: mgnautos.co.uk.
- Instagram: @MGNAutos.
- 4 alloy wheel refurbishment: £200 guide price.
- 1 wheel refurb: £60.
- 2 wheels: £110.
- Colour change set of 4: £220–£250.
- Heavy kerb damage: typically +£10–£25 per wheel.
- Wheels + all 4 calipers package: £300.
- Front caliper pair: £70.
- All 4 calipers: £120.
- Brake pads labour, one axle: £50–£60.
- Pads + discs labour, one axle: £70–£90.
- Oil + filter labour only: £40.
- Oil + filter supplied by MGN: £80–£100.
- Air filter: from £20.
- Cabin/pollen filter: from £20.
- Battery replacement: from £25.
- Minor bumper scuff: from £100.
- Wing respray: from £150.
- Bumper respray: from £180.
- Bonnet respray: from £200.
- Full respray: roughly £1,500–£2,000.
- Headlight restoration pair: £60–£80.
- Diagnostics: from £40.

Always make clear these are guide prices and final prices depend on the vehicle, condition, parts, paint/finish and exact work required.
Never claim a booking slot is available unless the website has explicitly provided that information in the conversation.
Never diagnose a fault with certainty. For safety-critical issues like brakes, steering or tyres, advise the user to stop driving if they think the vehicle is unsafe and have it inspected.
If a user wants to proceed, tell them to use the website quote form or contact MGN Autos directly.`;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many assistant messages. Please try again shortly." },
});

app.get("/", (_req, res) => res.json({ service: "MGN Autos AI", ok: true }));
app.get("/health", (_req, res) => res.json({ ok: true, configured: Boolean(OPENAI_API_KEY) }));

app.post("/api/assistant", limiter, async (req, res) => {
  const origin = req.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI assistant is not configured yet." });
  }

  const message = String(req.body?.message || "").trim();
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
  if (!message) return res.status(400).json({ error: "Please enter a question." });
  if (message.length > 700) return res.status(400).json({ error: "That message is too long." });

  const input = history
    .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.slice(0, 1200) }));
  input.push({ role: "user", content: message });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
        instructions: SYSTEM_PROMPT,
        input,
        max_output_tokens: 350,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("OpenAI error", response.status, data?.error?.message || data);
      return res.status(502).json({ error: "The assistant could not answer right now." });
    }

    const answer = String(data?.output_text || "").trim();
    if (!answer) return res.status(502).json({ error: "The assistant returned an empty response." });
    return res.json({ answer });
  } catch (error) {
    console.error("Assistant request failed", error);
    return res.status(502).json({ error: "The assistant could not answer right now." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MGN AI backend listening on ${PORT}`);
});
