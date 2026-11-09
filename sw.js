// Offline cache for the installed app: serve what we have, refresh it in the background.
const CACHE = "ivb-v9";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/app.css",
  "assets/app.js",
  "assets/theme.js",
  "assets/favicon.svg",
  "assets/favicon-32.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "assets/apple-touch-icon.png",
  "assets/fonts/hind-latin-400-normal.woff2",
  "assets/fonts/hind-latin-500-normal.woff2",
  "assets/fonts/hind-latin-600-normal.woff2",
  "assets/fonts/teko-latin-500-normal.woff2",
  "assets/fonts/teko-latin-600-normal.woff2",
  "assets/fonts/ibm-plex-mono-latin-500-normal.woff2",
  "assets/fonts/ibm-plex-mono-latin-600-normal.woff2",
  "lib/network.js",
  "lib/finder.js",
  "lib/planner.js",
  "lib/own.js",
  "lib/schedule.js",
  "lib/booking.js",
  "lib/polyline.js",
  "vendor/d3.ivb.min.js",
  "data/stations.json",
  "data/routes.json",
  "data/timetables.json",
  "data/places.json",
  "data/circuits.json",
  "data/events.json",
  "data/india.geo.json",
  "data/shapes.json",
];
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    }),
  );
});
