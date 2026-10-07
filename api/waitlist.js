// POST /api/waitlist { email }
// Saves the email as a Resend contact (so you can email everyone a Broadcast on launch day)
// and sends a "you're on the list" confirmation.
// Vercel env vars: RESEND_API_KEY (required), RESEND_FROM (e.g. "Sniff <hello@yourdomain.com>"),
// RESEND_SEGMENT_ID (optional: put waitlist contacts in one segment).

const json = (res, code, body) => res.status(code).json(body);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  const key = process.env.RESEND_API_KEY;
  if (!key) return json(res, 500, { error: "RESEND_API_KEY not set" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254)
    return json(res, 400, { error: "invalid email" });

  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const contact = { email, unsubscribed: false, properties: { source: "sniff-waitlist" } };
  if (process.env.RESEND_SEGMENT_ID) contact.segments = [{ id: process.env.RESEND_SEGMENT_ID }];
  let r = await fetch("https://api.resend.com/contacts", { method: "POST", headers, body: JSON.stringify(contact) });
  if (!r.ok && r.status !== 409) {
    // retry without custom properties (they must be pre-created in Resend)
    delete contact.properties;
    r = await fetch("https://api.resend.com/contacts", { method: "POST", headers, body: JSON.stringify(contact) });
  }
  const already = r.status === 409;
  if (!r.ok && !already) {
    const detail = (await r.text()).slice(0, 300);
    return json(res, 502, { error: "could not save", detail });
  }

  if (!already) {
    const from = process.env.RESEND_FROM || "Sniff <onboarding@resend.dev>";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [email],
        subject: "You're on the Sniff Pro early access list",
        html: `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:32px;color:#111">
<h1 style="font-weight:400;font-size:28px;margin:0 0 12px">You're on the list.</h1>
<p style="font-family:system-ui,sans-serif;color:#555;line-height:1.6">Thanks for joining Sniff Pro early access. We'll email you the day it launches, along with your early-supporter offer.</p>
<p style="font-family:system-ui,sans-serif;color:#555;line-height:1.6">Until then, keep checking suspicious messages free on Sniff. Never share an OTP, UPI PIN or screen with anyone who contacts you first.</p>
<p style="font-family:system-ui,sans-serif;color:#999;font-size:12px;margin-top:32px">If you've lost money to a scam in India, call 1930 or report at cybercrime.gov.in.</p></div>`,
      }),
    }).catch(() => {});
  }
  return json(res, 200, { ok: true, already });
}
