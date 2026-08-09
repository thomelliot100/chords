/* Simple offline cache. Bump CACHE when you change core files. */
const CACHE = "songbook-v8";
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

/* pdf.js is ~1.4MB and only used by the importer, so it's fetched separately
   and best-effort: without this, PDF import silently needs a connection the
   first time. Kept out of ASSETS because addAll() is all-or-nothing — a flaky
   fetch of a 1.4MB file would otherwise fail the whole install and leave the
   app with no offline copy at all. */
const EXTRAS = [
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS).then(function () {
        return Promise.all(EXTRAS.map(function (u) {
          return c.add(u).catch(function () { /* picked up at runtime instead */ });
        }));
      });
    })
  );
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

/* Network-first, cache as offline fallback.
   Cache-first meant new songs/features only appeared on the *second* load,
   which is confusing. Online: always current. Offline: last-known copy. */
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (cached) {
        // For page navigations that miss, fall back to the app shell.
        return cached || (e.request.mode === "navigate"
          ? caches.match("./index.html")
          : undefined);
      });
    })
  );
});
