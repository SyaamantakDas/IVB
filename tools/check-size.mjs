// Size budgets: fails (exit 1) when a file, or what a first visit downloads, grows past its budget.
// Sizes are gzipped, as GitHub Pages serves them. Raise a budget only on purpose, in the same change.
// Usage: node tools/check-size.mjs
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KB = 1024;
const gz = (f) => (f.endsWith(".woff2") ? readFileSync(join(root, f)).length : gzipSync(readFileSync(join(root, f)), { level: 9 }).length);

const BUDGET = {
  "index.html": 6 * KB, "assets/app.js": 30 * KB, "assets/app.css": 10 * KB, "assets/pages.css": 3 * KB,
  "vendor/d3.ivb.min.js": 30 * KB, "data/timetables.json": 24 * KB, "data/india.geo.json": 66 * KB,
  "data/shapes.json": 80 * KB, "data/stations.json": 10 * KB, "data/routes.json": 8 * KB, "data/places.json": 6 * KB,
  "data/circuits.json": 3 * KB,
};
for (const f of readdirSync(join(root, "lib"))) BUDGET[`lib/${f}`] = 5 * KB;

// what the app needs before it can show the map and answer a search (the track lines come after)
const FIRST = [
  "index.html", "assets/app.css", "assets/app.js", "vendor/d3.ivb.min.js",
  ...readdirSync(join(root, "lib")).map((f) => `lib/${f}`),
  ...["stations", "routes", "timetables", "places", "circuits", "events", "india.geo"].map((f) => `data/${f}.json`),
  "assets/fonts/hind-latin-400-normal.woff2", "assets/fonts/teko-latin-600-normal.woff2",
];
const FIRST_BUDGET = 240 * KB;

let over = 0;
const kb = (n) => (n / KB).toFixed(1).padStart(6) + " KB";
for (const [f, max] of Object.entries(BUDGET)) {
  const n = gz(f), bad = n > max;
  if (bad) over++;
  console.log(`${bad ? "OVER" : "ok  "} ${f.padEnd(26)} ${kb(n)} of ${kb(max)}`);
}
const first = FIRST.reduce((s, f) => s + gz(f), 0);
if (first > FIRST_BUDGET) over++;
console.log(`${first > FIRST_BUDGET ? "OVER" : "ok  "} ${"first visit".padEnd(26)} ${kb(first)} of ${kb(FIRST_BUDGET)}`);
if (over) { console.log(`${over} over budget`); process.exit(1); }
