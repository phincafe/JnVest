// Minimal service worker: cache the app shell for offline reads.
// Always pass-through API requests so live data is never stale.
//
// Strategy:
//   - HTML document: network-first. A cached shell can reference asset hashes
//     that no longer exist on the server after a deploy; serving stale HTML
//     then 404'ing on the bundle paints a black page. Cache is fallback only.
//   - Everything else (hashed /assets/*, icons): cache-first. Asset filenames
//     are content-hashed so they're safe to serve from cache indefinitely.

const CACHE = "jnvest-shell-v2";
const SHELL = ["/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // don't cache API
  if (e.request.method !== "GET") return;

  const isDoc =
    e.request.mode === "navigate" || e.request.destination === "document";

  if (isDoc) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((cached) => cached || Response.error())),
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchAndCache = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchAndCache;
    }),
  );
});
