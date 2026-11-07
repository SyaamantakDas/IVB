// Offline cache for the installed app: serve what we have, refresh it in the background.
const CACHE = "ivb-v7";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "assets/app.css", "assets/app.js", "assets/favicon.svg", "assets/favicon-32.png", "assets/icon-192.png", "assets/icon-512.png",
  "assets/icon-maskable-512.png", "assets/apple-touch-icon.png",
  "lib/network.js", "lib/finder.js", "lib/planner.js", "lib/own.js", "lib/schedule.js", "lib/booking.js", "lib/polyline.js", "vendor/d3.min.js",
  "data/stations.json", "data/routes.json", "data/timetables.json", "data/places.json",
  "data/circuits.json", "data/events.json", "data/india.geo.json", "data/shapes.json",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!ours && !fonts) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req);
    const fresh = fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
