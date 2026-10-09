// Sniff service worker: offline app shell, network-first for the API, and the share target.
const VERSION = "sniff-v4";
const SHELL = [
  "/",
  "/Sniff.css",
  "/sniff-inline.css",
  "/sniff.js",
  "/assistant.js",
  "/assistant.css",
  "/og.png",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/mark.svg",
  "/logo.svg",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];
const SHARE_CACHE = "sniff-share";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Something shared to Sniff from another app (Android share sheet)
async function handleShare(request) {
  try {
    const fd = await request.formData();
    const img = fd.getAll("image").find((f) => f && typeof f !== "string" && f.size);
    if (img) {
      const c = await caches.open(SHARE_CACHE);
      await c.put("/shared-image", new Response(img, { headers: { "Content-Type": img.type || "image/png", "X-Shared-At": String(Date.now()) } }));
      return Response.redirect("/?shared-image=1", 303);
    }
    const p = new URLSearchParams();
    for (const k of ["title", "text", "url"]) {
      const v = fd.get(k);
      if (typeof v === "string" && v.trim()) p.set(k, v.slice(0, 4000));
    }
    return Response.redirect("/" + (p.toString() ? "?" + p : ""), 303);
  } catch (_) {
    return Response.redirect("/", 303);
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.method === "POST" && url.pathname === "/share-target") {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== "GET") return; // API checks and forms go straight to the network

  // API: network first, a cached copy only for config if offline
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && url.pathname === "/api/config") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } })))
    );
    return;
  }

  // Pages: network first so updates land right away, cached shell when offline
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && url.pathname === "/") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("/", copy)); }
        return res;
      }).catch(() => caches.match("/").then((r) => r || caches.match(req)))
    );
    return;
  }

  // Static files: network first (so HTML and scripts always match), cached copy when offline
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
