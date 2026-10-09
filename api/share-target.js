// Fallback for the PWA share target when the service worker isn't running yet.
// The service worker normally handles POST /share-target itself (it can keep shared screenshots).
// Here we can only carry text and links over, so images get a gentle note instead.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const back = (q) => { res.statusCode = 303; res.setHeader("Location", "/" + (q ? "?" + q : "")); res.end(); };
  if (req.method === "GET") {
    const u = new URL(req.url, "https://x");
    return back(u.searchParams.toString());
  }
  if (req.method !== "POST") return back("");
  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 8 * 1024 * 1024) break; chunks.push(c); }
    const r = new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] || "" } });
    const fd = await r.formData();
    const p = new URLSearchParams();
    for (const k of ["title", "text", "url"]) { const v = fd.get(k); if (typeof v === "string" && v.trim()) p.set(k, v.slice(0, 4000)); }
    const img = fd.get("image");
    if (img && typeof img !== "string" && !p.toString()) p.set("shared-image", "missed");
    return back(p.toString());
  } catch (_) {
    return back("");
  }
}
