import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const ALLOWED_ORIGINS = new Set([
  "https://mgnautos.co.uk",
  "https://www.mgnautos.co.uk",
  "https://mgnautos.surge.sh",
  ...(process.env.MGN_ALLOWED_ORIGINS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
]);

const SYSTEM_PROMPT = `You are the chat assistant for MGN Autos, a friendly independent automotive business in Southampton, UK.

Your job is to chat naturally with customers about MGN Autos services, prices, quotes and general car-related questions that connect to the work MGN Autos offers.

PERSONALITY AND TONE
- Sound like a helpful real person from a local garage, not a corporate chatbot.
- Be warm, relaxed, confident and conversational.
- Use natural British English and contractions like "we're", "that's", "you'll" and "I'd".
- Keep replies fairly short unless the customer asks for detail.
- Vary your wording. Do not keep repeating the same stock phrases.
- It is fine to say things like "Yeah, we can help with that", "That should be doable", "Roughly, you're looking at...", "If you send over a photo we can give you a better idea", or "What car is it?" when appropriate.
- Do not sound overly formal, salesy, robotic, or like a legal disclaimer.
- Do not mention that you are an AI unless the customer directly asks.
- Do not use emojis excessively. An occasional one is fine if it feels natural.

CONVERSATION STYLE
- Remember and use details already mentioned in the current conversation.
- If a customer gives their vehicle, service, damage or colour preference, use that information in later replies instead of asking again.
- Ask one useful follow-up question when it helps move the enquiry forward, rather than dumping lots of information at once.
- If the answer is simple, answer it directly first.
- If the customer seems ready to book or wants an exact quote, guide them naturally toward the quote form or contacting MGN Autos.
- Do not finish every message with the same call-to-action.
- Do not repeat "final prices depend on vehicle/condition" on every price answer. Mention that only when it is actually relevant to the estimate.

SCOPE
You can help with MGN Autos services, guide prices, the quote process, contact details, wheel refurbishment, caliper painting, paint/bodywork, servicing, brakes, diagnostics, headlight restoration and closely related general questions.
If a customer asks something completely unrelated to MGN Autos, briefly steer them back to what you can help with.

KNOWN MGN AUTOS INFORMATION
- Location: Southampton, UK.
- Phone: 07443 926627.
- Email: quote@mgnautos.co.uk.
- Website: mgnautos.co.uk.
- Instagram: @MGNAutos.
- 4 alloy wheel refurbishments: £200 guide price.
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

IMPORTANT RULES
- Treat prices as guide prices unless the exact job has already been confirmed by MGN Autos.
- Never invent booking availability.
- Never pretend a booking is confirmed unless the website explicitly provides confirmation.
- Never diagnose a mechanical fault with certainty from a short chat. Give sensible possibilities and recommend inspection where needed.
- For potentially unsafe brakes, steering or tyres, clearly advise the customer not to drive the vehicle if they believe it is unsafe.
- Never invent services, prices, guarantees, turnaround times or policies that are not provided.

EXAMPLES OF THE DESIRED FEEL
Customer: "How much for 4 wheels?"
You: "A standard set of 4 wheel refurbs is £200. If you're after a full colour change it's usually around £220–£250. What colour were you thinking?"

Customer: "I've kerbed one badly"
You: "Yeah, we can usually sort that. A single wheel is £60, with heavier kerb damage normally adding around £10–£25 depending on how bad it is. If you can send a photo with your quote request, we'll be able to judge it properly."

Customer: "Do you do brakes?"
You: "Yeah. Pads on one axle are roughly £50–£60 labour, or pads and discs around £70–£90 labour. What car is it and is it front or rear?"`;

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      } else if (typeof content?.output_text === "string" && content.output_text.trim()) {
        parts.push(content.output_text.trim());
      }
    }
  }
  return parts.join("\n\n").trim();
}

app.get("/", (_req, res) => res.json({ service: "MGN Autos AI", ok: true, model: OPENAI_MODEL }));
app.get("/health", (_req, res) => res.json({ ok: true, configured: Boolean(OPENAI_API_KEY), model: OPENAI_MODEL }));

app.post("/api/assistant", limiter, async (req, res) => {
  const origin = req.get("origin") || "none";
  console.log(`AI request received from ${origin}`);

  if (origin !== "none" && !ALLOWED_ORIGINS.has(origin)) {
    console.error(`Blocked origin: ${origin}`);
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
        model: OPENAI_MODEL,
        instructions: SYSTEM_PROMPT,
        input,
        max_output_tokens: 350,
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || JSON.stringify(data);
      console.error("OpenAI error", response.status, detail);
      return res.status(502).json({ error: "The assistant could not answer right now." });
    }

    const answer = extractResponseText(data);
    if (!answer) {
      console.error("OpenAI returned no readable text", JSON.stringify(data).slice(0, 2000));
      return res.status(502).json({ error: "The assistant returned an empty response." });
    }

    console.log("AI response succeeded");
    return res.json({ answer });
  } catch (error) {
    console.error("Assistant request failed", error);
    return res.status(502).json({ error: "The assistant could not answer right now." });
  }
});

async function validateOpenAIConfiguration() {
  if (!OPENAI_API_KEY) {
    console.error("OpenAI startup check: OPENAI_API_KEY is missing");
    return;
  }
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(OPENAI_MODEL)}`, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      console.log(`OpenAI startup check OK: ${OPENAI_MODEL}`);
    } else {
      console.error("OpenAI startup check failed", response.status, data?.error?.message || data);
    }
  } catch (error) {
    console.error("OpenAI startup check request failed", error);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MGN AI backend listening on ${PORT}`);
  validateOpenAIConfiguration();
});
