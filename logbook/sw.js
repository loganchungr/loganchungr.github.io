/* Keeps Logbook's own files on the device, so it opens without a connection. Entries and photos are kept by the app
   itself (store.js); requests to GitHub pass straight through. Each file is fetched fresh when there's a connection. */
const CACHE = "logbook-3";
const SHELL = ["./", "index.html", "app.css", "app.js", "md.js", "github.js", "dropbox.js", "store.js", "marked.min.js", "manifest.webmanifest", "icon-180.png", "icon-512.png"];

self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if(e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if(r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
});
