/* Simple offline cache. Bump CACHE when you change core files. */
const CACHE = "songbook-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./songs.js",
  "./chords.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      const network = fetch(e.request).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
