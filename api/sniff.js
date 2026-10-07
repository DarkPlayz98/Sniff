// Vercel serverless function: POST /api/sniff  { message }
// Set GROQ_API_KEY in Vercel > Project > Settings > Environment Variables.
// Optional: GROQ_MODEL (defaults to openai/gpt-oss-120b).

const SYSTEM = `You are Sniff, a scam-detection expert focused on India and global fraud (UPI, KYC, digital arrest, courier fee, task jobs, investment/crypto, romance, phishing, look-alike domains, remote-access, family impersonation). Analyse the user's message, link or phone number. Respond ONLY with JSON: {"verdict":"SCAM|SUSPICIOUS|LOOKS_SAFE","score":0-100,"scam_type":string,"red_flags":[{"title":string,"explanation":string,"quote":string}],"what_to_do":[string],"summary":string}. "quote" must be an exact substring of the message or "". Be decisive; never call a message safe if it asks for money, OTP, or a login via a link under pressure, or if a domain imitates a known brand.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const message = String((body && body.message) || "").slice(0, 4000);
  if (!message.trim()) return res.status(400).json({ error: "empty message" });

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
