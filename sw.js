/* Service worker: funzionamento offline del guscio dell'app e notifiche push. */
const CACHE = "scadenze-v2";   // cambiando nome si svuota la cache vecchia
const GUSCIO = [
  "./", "./index.html", "./css/stile.css", "./js/app.js", "./js/config.js",
  "./js/supabase.min.js", "./manifest.webmanifest", "./icone/icona-192.png", "./icone/icona-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(GUSCIO)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if(e.request.method !== "GET") return;
  if(url.hostname.endsWith("supabase.co")) return;             // i dati passano sempre dalla rete

  if(url.origin === location.origin){                           // guscio: prima la rete, poi la copia locale
    e.respondWith(
      fetch(e.request)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {  // librerie da CDN
    const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return res;
  })));
});

self.addEventListener("push", e => {
  let d = { titolo:"Attività e Scadenze", corpo:"Hai delle scadenze da controllare." };
  try{ if(e.data) d = Object.assign(d, e.data.json()); }catch(err){ if(e.data) d.corpo = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.titolo, {
    body: d.corpo,
    icon: "icone/icona-192.png",
    badge: "icone/icona-192.png",
    tag: "promemoria-scadenze",
    renotify: true,
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const dest = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(clients.matchAll({ type:"window", includeUncontrolled:true }).then(lista => {
    for(const c of lista){ if("focus" in c) return c.focus(); }
    return clients.openWindow(dest);
  }));
});
