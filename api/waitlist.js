// POST /api/waitlist { email }
// Saves the signup as a Brevo contact (email everyone with a Brevo campaign on launch day)
// and sends a "you're on the list" confirmation.
// Vercel env vars:
//   BREVO_API_KEY (required), BREVO_SENDER_EMAIL (a verified sender in Brevo),
//   BREVO_SENDER_NAME (optional, default "Sniff"), BREVO_LIST_ID (optional number).
// Falls back to Resend (RESEND_API_KEY) if Brevo isn't configured.

const json = (res, code, body) => res.status(code).json(body);

const HTML = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:32px;color:#111">
<h1 style="font-weight:400;font-size:28px;margin:0 0 12px">You're on the list.</h1>
<p style="font-family:system-ui,sans-serif;color:#555;line-height:1.6">Thanks for joining Sniff Pro early access. We'll email you the day it launches, along with your early-supporter offer.</p>
<p style="font-family:system-ui,sans-serif;color:#555;line-height:1.6">Until then, keep checking suspicious messages free on Sniff. Never share an OTP, UPI PIN or your screen with anyone who contacts you first.</p>
<p style="font-family:system-ui,sans-serif;color:#999;font-size:12px;margin-top:32px">Lost money to a scam in India? Call 1930 or report at cybercrime.gov.in.</p></div>`;
const SUBJECT = "You're on the Sniff Pro early access list";

async function viaBrevo(email) {
  const key = process.env.BREVO_API_KEY;
  const headers = { "api-key": key, "Content-Type": "application/json", accept: "application/json" };
  const contact = { email, updateEnabled: false };
  if (process.env.BREVO_LIST_ID) contact.listIds = [Number(process.env.BREVO_LIST_ID)];
  const c = await fetch("https://api.brevo.com/v3/contacts", { method: "POST", headers, body: JSON.stringify(contact) });
  let already = false;
  if (!c.ok) {
    const t = await c.text();
    if (c.status === 400 && /duplicate/i.test(t)) already = true;
    else return { error: true, status: c.status, detail: t.slice(0, 300) };
  }
  if (!already) {
    const m = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers,
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME || "Sniff", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email }],
        subject: SUBJECT,
        htmlContent: HTML,
      }),
    });
    if (!m.ok) return { ok: true, already, mail: false, mailStatus: m.status, mailDetail: (await m.text()).slice(0, 300) };
  }
  return { ok: true, already };
}

async function viaResend(email) {
  const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" };
  const r = await fetch("https://api.resend.com/contacts", { method: "POST", headers, body: JSON.stringify({ email, unsubscribed: false }) });
  const already = r.status === 409;
  if (!r.ok && !already) return { error: true, status: r.status, detail: (await r.text()).slice(0, 300) };
  if (!already) {
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers,
      body: JSON.stringify({ from: process.env.RESEND_FROM || "Sniff <onboarding@resend.dev>", to: [email], subject: SUBJECT, html: HTML }),
    }).catch(() => {});
  }
  return { ok: true, already };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254)
    return json(res, 400, { error: "invalid email" });

  try {
    let out;
    if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) out = await viaBrevo(email);
    else if (process.env.RESEND_API_KEY) out = await viaResend(email);
    else return json(res, 500, { error: "no email provider configured" });
    if (out.error) return json(res, 502, { error: "could not save", detail: out.detail });
    return json(res, 200, out);
  } catch (e) {
    return json(res, 502, { error: "failed", detail: String(e).slice(0, 200) });
  }
}
