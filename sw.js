// Offline use for the app and the pages. Online, every file comes from the server, which confirms the browser's
// copy is current; offline, or when the network takes more than four seconds, the copies kept here are used.
// The published pages name their styles and scripts with a version tag (tools/stamp.mjs), and a file is kept
// under its tagged address, so a slow network is never answered with a file of another version.
const CACHE = "ivb-v10";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/app.css",
  "assets/app.js",
  "assets/theme.js",
  "assets/pages.css",
  "assets/logo.svg",
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
const KEEP = new Set(SHELL.map((u) => new URL(u, self.registration.scope).href));
const WAIT = 4000; // ms before a slow network gives way to the copy kept here

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // from the server, not the browser's own cache, so the copies are all of the version just deployed
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
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
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  const url = req.url.split("#")[0].split("?")[0];
  const page = req.mode === "navigate";
  if (!page && !KEEP.has(url)) return; // anything else (the GTFS feed, the sitemap) goes straight to the network
  // a page is kept under its address without the query (the app reads its query itself); a file under its full
  // address, version tag included
  const key = page ? url : req.url;
  // a page is fetched by its address: some browsers refuse to send a page's own request again with other options;
  // and inside an async function, a request the browser refuses becomes a failure to fall back from, not an error
  const fresh = (async () => fetch(page ? req.url : req, { cache: "no-cache" }))();
  // keep the app's files, and the pages visited, for offline use
  e.waitUntil(
    fresh
      .then((res) => {
        if (!res.ok) return null;
        const copy = res.clone(); // now, before the page starts reading the response
        return caches.open(CACHE).then((c) => c.put(key, copy));
      })
      .catch(() => null),
  );
  e.respondWith(
    (async () => {
      const first = await Promise.race([
        fresh.then(
          (res) => res,
          () => "offline",
        ),
        new Promise((r) => setTimeout(r, WAIT, "slow")),
      ]);
      if (first !== "offline" && first !== "slow") return first;
      const same = await caches.match(key);
      if (same) return same;
      if (first === "slow") return fresh; // no copy of this version kept: wait for the network after all
      // offline, and no copy of this version: any copy of the file is better than none
      return (await caches.match(req, { ignoreSearch: true })) || fresh;
    })(),
  );
});
