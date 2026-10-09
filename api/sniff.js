// Vercel serverless function: POST /api/sniff
//   { message }                       -> text check
//   { image: "data:image/jpeg;base64,..." , mode?: "screenshot" | "watch" } -> screenshot / screen check
// Set GROQ_API_KEY in Vercel > Project > Settings > Environment Variables.
// Optional: GROQ_MODEL (text, default openai/gpt-oss-120b), GROQ_VISION_MODEL (images, default qwen/qwen3.8-27b).
// Images are sent to Groq for this one check and never stored.

const SYSTEM = `You are Sniff, a scam-detection expert focused on India and global fraud (UPI, KYC, digital arrest, courier fee, task jobs, investment/crypto, romance, phishing, look-alike domains, remote-access, family impersonation). Analyse the user's message, link or phone number. Respond ONLY with JSON: {"verdict":"SCAM|SUSPICIOUS|LOOKS_SAFE","score":0-100,"scam_type":string,"red_flags":[{"title":string,"explanation":string,"quote":string}],"what_to_do":[string],"summary":string}. "quote" must be an exact substring of the message or "". Be decisive; never call a message safe if it asks for money, OTP, or a login via a link under pressure, or if a domain imitates a known brand. Write "summary" as one short plain sentence a non-technical person understands.`;

const VISION = (mode) => `You are Sniff, a scam-detection expert for India and worldwide (UPI, KYC, digital arrest, courier fee, task jobs, investment/crypto, romance, phishing, fake payment requests, look-alike domains, remote-access apps, family impersonation).
${mode === "watch"
    ? "This image is a live frame of the user's computer screen. Look at what is on screen right now: messages, emails, chats, web pages, address bars, pop-ups, payment or login pages. If nothing on screen is a message, link, login, download or payment request worth judging (for example a code editor, a video, a document), set \"nothing_to_check\": true and verdict LOOKS_SAFE."
    : "This image is a screenshot the user shared: usually an SMS, WhatsApp chat, email, web page, social post or payment request."}
Read all the text in the image carefully, including sender names, numbers, links and the browser address bar. Then decide whether the user should click, reply, pay or log in.
Respond ONLY with JSON, no other text:
{"verdict":"SCAM|SUSPICIOUS|LOOKS_SAFE","score":0-100,"scam_type":string,"red_flags":[{"title":string,"explanation":string,"quote":string}],"what_to_do":[string],"summary":string,"extracted_text":string,"shown":"SMS|WhatsApp|email|web page|payment request|social media|other","nothing_to_check":boolean}
Rules: "extracted_text" is the important text you read (max 1500 characters), copied exactly. "quote" must be an exact substring of extracted_text or "". "summary" is one short plain sentence a non-technical person understands, saying what it is and whether to click. At most 4 red_flags and 4 what_to_do items, each short. Be decisive: never call it safe if it asks for money, an OTP, a PIN, a login through a link under time pressure, a fee to receive something, a remote-access app, or if a website address imitates a known brand (for example sbi-kyc-update.xyz or paypa1.com).`;

const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const VISION_MODELS = () =>
  [process.env.GROQ_VISION_MODEL, "qwen/qwen3.8-27b", "meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"].filter(
    (m, i, a) => m && a.indexOf(m) === i
  );

function parseJSON(s) {
  if (!s) throw new Error("empty");
  try { return JSON.parse(s); } catch (_) {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error("no JSON");
}

async function groq(key, body) {
  const r = await fetch(GROQ, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

async function checkImage(key, image, mode) {
  const content = [
    { type: "text", text: VISION(mode) },
    { type: "image_url", image_url: { url: image } },
  ];
  let last = { status: 0, text: "" };
  for (const model of VISION_MODELS()) {
    // Fast instruct mode first; drop optional parameters if a model rejects them
    const variants = [
      { reasoning_effort: "none", response_format: { type: "json_object" } },
      { response_format: { type: "json_object" } },
      {},
    ];
    for (const extra of variants) {
      const r = await groq(key, { model, temperature: 0.2, max_completion_tokens: 1400, messages: [{ role: "user", content }], ...extra });
      if (r.ok) {
        try {
          const data = JSON.parse(r.text);
          const out = parseJSON(data.choices[0].message.content);
          out.model = model;
          return { out };
        } catch (_) {
          last = { status: 502, text: "unreadable model reply" };
          continue;
        }
      }
      last = r;
      if (r.status === 429 || r.status === 401 || r.status === 413) return { err: r };
      const t = r.text.toLowerCase();
      // Unknown, retired or not-permitted model: try the next model
      if (r.status === 404 || /model_not_found|decommission|does not exist|not found|model_permission|not have access/.test(t)) break;
      // Otherwise (a parameter this model doesn't take, or json validation), try the next variant
    }
  }
  return { err: last };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Screenshot or screen frame
  if (body.image) {
    const image = String(body.image);
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image.slice(0, 40))) return res.status(400).json({ error: "image must be a base64 data URL" });
    if (image.length > 1_600_000) return res.status(413).json({ error: "image too large (max about 1 MB)" });
    const mode = body.mode === "watch" ? "watch" : "screenshot";
    try {
      const { out, err } = await checkImage(key, image, mode);
      if (err) return res.status(err.status === 429 ? 429 : 502).json({ error: err.status === 429 ? "busy" : "upstream", status: err.status, detail: String(err.text || "").slice(0, 300) });
      return res.status(200).json(out);
    } catch (e) {
      return res.status(502).json({ error: "failed", detail: String(e).slice(0, 200) });
    }
  }

  const message = String(body.message || "").slice(0, 4000);
  if (!message.trim()) return res.status(400).json({ error: "empty message" });

  try {
    const r = await fetch(GROQ, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: message },
        ],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "upstream", status: r.status, detail: detail.slice(0, 300) });
    }
    const data = await r.json();
    const out = JSON.parse(data.choices[0].message.content);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "failed", detail: String(e).slice(0, 200) });
  }
}
