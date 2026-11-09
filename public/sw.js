// TR service worker: çevrimdışı kabuk + bildirimler
const C = "tr-v47";
const SHELL = ["/", "/index.html", "/app.js", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/.netlify/") || u.pathname.startsWith("/__/")) return;
  // Hızlı açılış: önce cihazdaki kopyayı hemen göster, arka planda yenisini indirip sakla.
  // (Yeni sürüm çıkınca bu dosyanın adı değişir; yeni kopya kurulur ve "Yeni sürüm hazır" çıkar.)
  const key = e.request.mode === "navigate" ? "/index.html" : e.request;
  e.respondWith(
    caches.open(C).then((c) => c.match(key).then((hit) => {
      const net = fetch(e.request).then((r) => { if (r.ok && r.type === "basic") c.put(key, r.clone()); return r; }).catch(() => hit || c.match("/index.html"));
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    }))
  );
});

// Bildirim geldiğinde
self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) {}
  const d = p.data || p;
  const title = d.title || (p.notification && p.notification.title) || "TR";
  const body = d.body || (p.notification && p.notification.body) || "Yeni mesaj";
  const conv = d.conv || "";
  e.waitUntil((async () => {
    // Uygulama açık ve o sohbet ekrandaysa bildirim gösterme
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
    const isCall = d.kind === "call";
    await self.registration.showNotification(title, {
      body, tag: isCall ? "tr-call-" + d.call : "tr-" + conv, renotify: true,
      requireInteraction: isCall, vibrate: isCall ? [500, 300, 500, 300, 500, 300, 500] : [200],
      icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
      data: { url: d.url || "/?c=" + encodeURIComponent(conv) },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === location.origin) {
        await w.focus();
        w.postMessage({ type: "open", url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
