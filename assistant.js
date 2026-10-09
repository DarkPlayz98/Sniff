/* Sniff on-screen assistant: install prompt, share target intake, clipboard and screenshot checks,
   and desktop "watch my screen" mode. Needs window.SniffUI from the main script. */
(function () {
  "use strict";
  var UI = window.SniffUI;
  if (!UI) return;
  var $ = UI.$, ic = UI.ic, esc = UI.esc, toast = UI.toast, store = UI.store;
  var AVATAR = "/icons/mark.svg";
  var ua = navigator.userAgent || "";
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isMobile = isIOS || /Android|Mobi/i.test(ua);
  var standalone = function () { return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; };

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }

  // ---------- Images: downscale to a small JPEG before sending ----------
  function loadBitmap(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob).catch(function () { return viaImg(blob); });
    return viaImg(blob);
  }
  function viaImg(blob) {
    return new Promise(function (ok, bad) {
      var u = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { ok(im); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); };
      im.onerror = function () { URL.revokeObjectURL(u); bad(new Error("not an image")); };
      im.src = u;
    });
  }
  // Fit inside maxW x maxH, then lower quality until the data URL is under ~1 MB
  function toJPEG(src, w, h, maxW, maxH) {
    var s = Math.min(1, maxW / w, maxH / h), cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    var c = document.createElement("canvas"); c.width = cw; c.height = ch;
    var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch); g.drawImage(src, 0, 0, cw, ch);
    var q = 0.82, url = c.toDataURL("image/jpeg", q);
    while (url.length > 1300000 && q > 0.4) { q -= 0.12; url = c.toDataURL("image/jpeg", q); }
    if (url.length > 1300000) return toJPEG(c, cw, ch, cw * 0.7, ch * 0.7);
    return url;
  }
  function prepImage(blob) {
    return loadBitmap(blob).then(function (bm) {
      var w = bm.width || bm.naturalWidth, h = bm.height || bm.naturalHeight;
      // Phone screenshots are tall: keep width ~1024 so small text stays readable
      return toJPEG(bm, w, h, 1024, 2048);
    });
  }
  function checkBlob(blob) {
    if (!blob || !/^image\//.test(blob.type || "image/")) return toast("That isn't an image");
    UI.tab("sniff");
    prepImage(blob).then(function (url) { UI.checkImage(url); }, function () { toast("Couldn't open that image"); });
  }

  // ---------- Upload a screenshot ----------
  var shotIn = $("#shotIn");
  $("#shotBtn").onclick = function () { shotIn.value = ""; shotIn.click(); };
  shotIn.onchange = function () { var f = shotIn.files && shotIn.files[0]; if (f) checkBlob(f); };

  // Paste an image anywhere (Ctrl+V on a computer), or drop one on the box
  document.addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && /^image\//.test(items[i].type)) { e.preventDefault(); checkBlob(items[i].getAsFile()); return; }
    }
  });
  var box = $(".sn-box");
  ["dragover", "dragenter"].forEach(function (ev) { box.addEventListener(ev, function (e) { if (e.dataTransfer && [].some.call(e.dataTransfer.types || [], function (t) { return t === "Files"; })) { e.preventDefault(); box.classList.add("is-drop"); } }); });
  ["dragleave", "drop"].forEach(function (ev) { box.addEventListener(ev, function () { box.classList.remove("is-drop"); }); });
  box.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) { e.preventDefault(); checkBlob(f); } });

  // ---------- Check what I copied ----------
  function fillAndRun(text) {
    var m = $("#msg"); m.value = text; UI.tab("sniff");
    UI.run();
  }
  $("#pasteBtn").onclick = function () {
    var cb = navigator.clipboard;
    var noAccess = function () { var m = $("#msg"); m.focus(); toast(isMobile ? "Long-press the box and tap Paste" : "Press Ctrl+V to paste"); };
    if (!cb || !window.isSecureContext) return noAccess();
    // A copied screenshot first (where the browser allows it), then text
    var tryImage = function () {
      if (!cb.read) return Promise.reject();
      return cb.read().then(function (items) {
        for (var i = 0; i < items.length; i++) {
          var t = items[i].types.find(function (x) { return /^image\//.test(x); });
          if (t) return items[i].getType(t).then(function (b) { checkBlob(b); return true; });
        }
        return Promise.reject();
      });
    };
    (cb.readText ? cb.readText() : Promise.reject())
      .then(function (t) {
        t = (t || "").trim();
        if (t) return fillAndRun(t.slice(0, 4000));
        return tryImage().catch(function () { toast("Nothing copied yet. Copy a message first."); });
      }, function () { return tryImage().catch(noAccess); });
  };

  // ---------- Things shared to Sniff (share sheet, shortcuts) ----------
  function intake() {
    var p;
    try { p = new URLSearchParams(location.search); } catch (_) { return; }
    var title = (p.get("title") || "").trim(), text = (p.get("text") || "").trim(), url = (p.get("url") || "").trim();
    var img = p.get("shared-image"), action = p.get("action");
    var had = title || text || url || img || action || p.has("source");
    if (!had) return;
    ["title", "text", "url", "shared-image", "action", "source"].forEach(function (k) { p.delete(k); });
    try { history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash); } catch (_) {}
    if (text || url || title) {
      var parts = [];
      if (title && text.indexOf(title) < 0 && url.indexOf(title) < 0) parts.push(title);
      if (text) parts.push(text);
      if (url && text.indexOf(url) < 0) parts.push(url);
      return setTimeout(function () { fillAndRun(parts.join("\n").slice(0, 4000)); }, 150);
    }
    if (img === "1" && "caches" in window) {
      caches.open("sniff-share").then(function (c) {
        return c.match("/shared-image").then(function (r) {
          if (!r) return toast("The shared picture didn't come through. Try Upload a screenshot.");
          return r.blob().then(function (b) { c.delete("/shared-image"); checkBlob(b); });
        });
      }).catch(function () { toast("The shared picture didn't come through. Try Upload a screenshot."); });
      return;
    }
    if (img === "missed") return toast("Open Sniff once more, then share the screenshot again");
    if (action === "paste") { $("#pasteBtn").classList.add("is-hint"); $("#pasteBtn").focus(); }
    if (action === "screenshot") { $("#shotBtn").classList.add("is-hint"); $("#shotBtn").focus(); }
  }
  intake();

  // ---------- Install card ----------
  var deferred = null, slot = $("#install");
  var DISMISS = "sniff_install_dismissed";
  var dismissedRecently = function () { var t = +store.get(DISMISS) || 0; return Date.now() - t < 7 * 864e5; };
  function hideInstall() { slot.innerHTML = ""; }
  function installCard(body, action) {
    if (standalone() || dismissedRecently()) return hideInstall();
    slot.innerHTML = '<div class="sn-talk sn-install">' +
      '<img class="sn-av sn-av--sm" src="' + AVATAR + '" alt="" width="44" height="44" />' +
      '<div class="sn-bubble"><button class="sn-close" type="button" aria-label="Not now">' + ic("x") + "</button>" +
      '<p class="sn-say sn-say--sm">' + (isMobile ? "Add Sniff to your phone" : "Add Sniff to your computer") + "</p>" + body + (action || "") + "</div></div>";
    slot.querySelector(".sn-close").onclick = function () { store.set(DISMISS, String(Date.now())); hideInstall(); };
  }
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferred = e;
    installCard(
      "<p>" + (isMobile ? "Check any message in one tap. Sniff shows up when you tap Share on a message, link or screenshot." : "Check any message in one tap, and keep Sniff one click away.") + "</p>",
      '<button class="x-go sn-install__go" id="installGo" type="button">' + ic("download") + "Install Sniff</button>"
    );
    $("#installGo").onclick = function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function (c) { if (c && c.outcome === "accepted") hideInstall(); deferred = null; });
    };
  });
  window.addEventListener("appinstalled", function () { deferred = null; hideInstall(); toast("Sniff is on your home screen"); });
  // iPhone and iPad: Safari has no install button, so show the steps
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  if (isIOS && !standalone()) {
    installCard(
      isSafari
        ? '<p>Check any message in one tap.</p><ol class="sn-ios"><li>Tap ' + ic("ios-share") + " <b>Share</b> at the bottom of Safari</li><li>Tap <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol>"
        : "<p>Open this page in <b>Safari</b>, tap " + ic("ios-share") + " <b>Share</b>, then <b>Add to Home Screen</b>.</p>"
    );
  }

  // ---------- Watch my screen (Chrome / Edge on a computer) ----------
  var canWatch = !isMobile && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !(window.matchMedia && matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches);
  var watchBtn = $("#watchBtn");
  if (canWatch) {
    watchBtn.hidden = false;
    var cap = document.createElement("p");
    cap.className = "sn-watchnote"; cap.id = "watchNote";
    cap.textContent = "Chrome or Edge on a computer. Sniff looks at your screen every few seconds and floats a warning on top. Frames are checked, never stored.";
    watchBtn.insertAdjacentElement("afterend", cap);
  }

  var GAP = 5000, CAP = 60;
  var W = null;
  var PANEL_CSS = [
    ".sw{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#141414;padding:14px 16px;display:flex;flex-direction:column;gap:8px;min-height:100%;box-sizing:border-box;background:linear-gradient(135deg,#fdf6ee,#eef4f1 55%,#f3eefb)}",
    ".sw *{box-sizing:border-box}",
    ".sw__top{display:flex;align-items:center;gap:10px}",
    ".sw__top img{width:36px;height:36px;border-radius:50%;flex:none;box-shadow:0 0 0 2px #fff}",
    ".sw__top b{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:20px;line-height:1}",
    ".sw__live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#66615b;margin-left:auto}",
    ".sw__live i{width:8px;height:8px;border-radius:50%;background:#2E9A63;animation:swp 1.6s infinite}",
    ".sw.is-paused .sw__live i{background:#aaa;animation:none}",
    "@keyframes swp{50%{opacity:.25}}",
    ".sw__ans{margin:4px 0 0;font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1.1;color:var(--c,#141414)}",
    ".sw__plain{margin:0;font-size:14px;line-height:1.4;color:#3b3833}",
    ".sw__row{display:flex;gap:8px;margin-top:auto;flex-wrap:wrap}",
    ".sw button{font:inherit;font-size:13px;font-weight:600;border-radius:999px;border:1px solid rgba(20,20,20,.12);background:#fff;padding:8px 14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}",
    ".sw button.sw__stop{background:#141414;color:#fff;border-color:#141414}",
    ".sw svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
    ".sw__priv{margin:0;font-size:11px;color:#77716a}",
    ".sw.sn-scam{--c:#C8372F}.sw.sn-sus{--c:#B7741A}.sw.sn-safe{--c:#2E8A5B}",
  ].join("\n");
  var ICONS = {
    stop: '<svg viewBox="0 0 24 24"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>',
    pip: '<svg viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2"/><rect width="8" height="6" x="12" y="12" rx="1"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>',
  };
  (function () { var st = document.createElement("style"); st.textContent = PANEL_CSS; document.head.appendChild(st); })();

  function panelHTML(s) {
    var cls = "sw" + (s.v ? " sn-" + s.v : "") + (s.paused ? " is-paused" : "");
    var pipOK = !!window.documentPictureInPicture && !(W && W.pip);
    var notif = "Notification" in window && Notification.permission === "default";
    return '<div class="' + cls + '">' +
      '<div class="sw__top"><img src="' + AVATAR + '" alt="" /><b>Sniff</b><span class="sw__live"><i></i>' + (s.paused ? "Paused" : "Watching") + "</span></div>" +
      (s.answer ? '<p class="sw__ans">' + esc(s.answer) + "</p>" : "") +
      '<p class="sw__plain">' + esc(s.plain || "") + "</p>" +
      '<div class="sw__row">' +
      (s.paused ? '<button type="button" data-a="resume">' + ICONS.play + "Keep watching</button>" : "") +
      '<button type="button" class="sw__stop" data-a="stop">' + ICONS.stop + "Stop</button>" +
      (pipOK && !s.inPip ? '<button type="button" data-a="pip">' + ICONS.pip + "Float on top</button>" : "") +
      (notif ? '<button type="button" data-a="notify">' + ICONS.bell + "Alert me</button>" : "") +
      "</div>" +
      '<p class="sw__priv">Frames are checked by Sniff AI and never stored.</p></div>';
  }
  function paint() {
    if (!W) return;
    var s = W.state;
    if (W.pip && W.pip.document && W.pip.document.body) {
      W.pip.document.body.innerHTML = panelHTML(Object.assign({ inPip: true }, s));
      wirePanel(W.pip.document.body);
      W.card.hidden = true;
    } else {
      W.card.hidden = false;
      W.card.innerHTML = panelHTML(s);
      wirePanel(W.card);
    }
  }
  function wirePanel(root) {
    [].forEach.call(root.querySelectorAll("[data-a]"), function (b) {
      b.onclick = function () {
        var a = b.getAttribute("data-a");
        if (a === "stop") stopWatch();
        else if (a === "pip") openPip().catch(function () { toast("Couldn't float Sniff on top in this browser"); });
        else if (a === "resume") { W.count = 0; W.state.paused = false; W.state.plain = "Watching your screen again."; W.state.answer = ""; W.state.v = ""; paint(); }
        else if (a === "notify") Notification.requestPermission().then(paint, paint);
      };
    });
  }
  function openPip() {
    if (!window.documentPictureInPicture) return Promise.reject(new Error("no pip"));
    return documentPictureInPicture.requestWindow({ width: 340, height: 250 }).then(function (pw) {
      W.pip = pw;
      var st = pw.document.createElement("style"); st.textContent = PANEL_CSS + "\nhtml,body{margin:0;height:100%}"; pw.document.head.appendChild(st);
      pw.document.title = "Sniff";
      pw.addEventListener("pagehide", function () { if (W) { W.pip = null; paint(); } });
      paint();
    });
  }
  function setState(s) { if (!W) return; W.state = Object.assign({}, W.state, s); paint(); }

  // A tiny greyscale fingerprint of the frame, to skip frames that barely changed
  function signature(src, w, h) {
    var c = W.sigC || (W.sigC = document.createElement("canvas")); c.width = 48; c.height = 27;
    var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h, 0, 0, 48, 27);
    var d = g.getImageData(0, 0, 48, 27).data, out = new Uint8Array(48 * 27);
    for (var i = 0, j = 0; i < d.length; i += 4, j++) out[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    return out;
  }
  function diff(a, b) {
    if (!a || !b) return 255;
    var s = 0; for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }
  function grabFrame() {
    if (W.ic && W.ic.grabFrame) return W.ic.grabFrame().catch(function () { return fromVideo(); });
    return Promise.resolve(fromVideo());
  }
  function fromVideo() {
    var v = W.video;
    if (!v || !v.videoWidth) return null;
    return v;
  }
  function tick() {
    if (!W || W.busy || W.state.paused) return;
    if (Date.now() - W.last < GAP || Date.now() < W.backoff) return;
    W.busy = true;
    grabFrame().then(function (f) {
      if (!W || !f) return;
      var w = f.width || f.videoWidth, h = f.height || f.videoHeight;
      if (!w || !h) return;
      var sig = signature(f, w, h);
      var moving = diff(sig, W.prevSig) > 3; W.prevSig = sig;
      if (moving && W.lastSig) return;              // still scrolling or typing: wait for it to settle
      if (diff(sig, W.lastSig) < 2.5) return;       // same as the last frame we checked
      W.lastSig = sig; W.last = Date.now(); W.count++;
      var url = toJPEG(f, w, h, 1280, 1280);
      if (f.close) try { f.close(); } catch (_) {}
      if (!W.state.v) setState({ plain: "Looking at your screen…" });
      return UI.askImage(url, "watch").then(function (r) {
        if (!W) return;
        var said;
        if (r.nothing) said = { v: "safe", answer: "All clear.", plain: "Nothing risky on your screen right now." };
        else { var p = UI.sayParts(r); said = { v: r.v, answer: p.answer, plain: p.plain }; }
        if (W.count >= CAP) { said.paused = true; said.plain += " Paused to save free checks."; }
        setState(said);
        var key = said.v + "|" + said.plain;
        if (said.v === "scam" && key !== W.alerted) {
          W.alerted = key;
          if ("Notification" in window && Notification.permission === "granted" && (document.hidden || !W.pip)) {
            try { new Notification("Sniff: Don't click", { body: said.plain, icon: "/icons/icon-192.png", tag: "sniff-watch" }); } catch (_) {}
          }
        }
      }, function (e) {
        if (!W) return;
        W.backoff = Date.now() + (e && e.busy ? 30000 : 10000);
        W.lastSig = null;
        setState({ plain: e && e.busy ? "Sniff is busy. Trying again in 30 seconds." : "Couldn't check that frame. Trying again shortly." });
      });
    }).catch(function () {}).then(function () { if (W) W.busy = false; });
  }
  function stopWatch() {
    if (!W) return;
    var w = W; W = null;
    try { w.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
    try { w.worker.terminate(); } catch (_) {}
    clearInterval(w.iv);
    try { w.pip && w.pip.close(); } catch (_) {}
    w.card.remove();
    watchBtn.hidden = false; if ($("#watchNote")) $("#watchNote").hidden = false;
    toast("Sniff stopped watching");
  }
  function startTicker() {
    // A worker timer keeps ticking when this tab is in the background
    try {
      var src = "setInterval(function(){postMessage(1)},1000)";
      var wk = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      wk.onmessage = tick;
      return { worker: wk };
    } catch (_) {
      return { iv: setInterval(tick, 1000) };
    }
  }
  watchBtn.onclick = function () {
    if (W) return;
    navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor", frameRate: { ideal: 2, max: 5 } }, audio: false,
      selfBrowserSurface: "exclude", surfaceSwitching: "include", monitorTypeSurfaces: "include",
    }).then(function (stream) {
      var track = stream.getVideoTracks()[0];
      var card = document.createElement("div"); card.className = "sn-float"; card.setAttribute("role", "status"); document.body.appendChild(card);
      var video = document.createElement("video"); video.muted = true; video.playsInline = true; video.srcObject = stream; video.play().catch(function () {});
      W = { stream: stream, track: track, video: video, card: card, pip: null, busy: false, last: 0, backoff: 0, count: 0, prevSig: null, lastSig: null,
        ic: window.ImageCapture ? new ImageCapture(track) : null, state: { plain: "Watching your screen. Open any message, email or link and I'll tell you if it's safe." } };
      var t = startTicker(); W.worker = t.worker; W.iv = t.iv;
      track.addEventListener("ended", stopWatch);
      watchBtn.hidden = true; if ($("#watchNote")) $("#watchNote").hidden = true;
      paint();
      openPip().catch(function () { /* needs a fresh click: the panel shows a Float on top button */ });
    }, function (e) {
      if (e && e.name === "NotAllowedError") toast("Screen sharing was cancelled");
      else toast("This browser can't share the screen. Try Chrome or Edge on a computer.");
    });
  };
  UI.watch = { start: function () { watchBtn.click(); }, stop: stopWatch, state: function () { return W && W.state; } };
})();
