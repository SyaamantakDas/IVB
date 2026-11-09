// Fetches India's railway lines from OpenStreetMap (© OpenStreetMap contributors, ODbL),
// tile by tile so that each Overpass query stays small, and writes them to osm/rail.json.
// Usage: node tools/fetch-osm-rail.mjs   (run by .github/workflows/osm-rail.yml)
//
// It keeps open lines and the crossovers that join them, and leaves out sidings, yards, spurs and
// industrial, military and heritage lines. It keeps only the tags that tools/build-shapes.mjs reads:
// gauge (Vande Bharats run on broad gauge only), usage and the line's name.
// The tiles are plain boxes, so they take in lines over the border too; build-shapes.mjs drops those,
// because a query clipped to India's outline is too slow for the public Overpass servers.
import { writeFileSync, mkdirSync } from "node:fs";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const UA = "IVB-track-shapes/1.0 (+https://github.com/SyaamantakDas/IVB)";
const STEP = 3; // degrees
const KEEP = ["gauge", "usage", "name", "railway:traffic_mode"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(q) {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: "data=" + encodeURIComponent(q),
        });
        if (res.ok) return await res.json();
        console.log(`  ${url}: ${res.status}`);
      } catch (e) {
        console.log(`  ${url}: ${e.message}`);
      }
      await sleep(5000);
    }
    await sleep(30000 * (attempt + 1));
  }
  throw new Error("Overpass did not answer");
}

const ways = new Map();
let tiles = 0;
for (let s = 6; s < 37; s += STEP) {
  for (let w = 68; w < 98; w += STEP) {
    const bbox = `${s},${w},${s + STEP},${w + STEP}`;
    const q = `[out:json][timeout:300];way["railway"="rail"]["service"!~"^(siding|yard|spur)$"]["usage"!~"^(industrial|military|tourism)$"](${bbox});out geom;`;
    const d = await query(q);
    let n = 0;
    for (const el of d.elements || []) {
      if (el.type !== "way" || ways.has(el.id)) continue;
      const tags = {};
      for (const k of KEEP) if (el.tags && el.tags[k]) tags[k] = el.tags[k];
      if (el.tags && el.tags.service) tags.service = el.tags.service;
      ways.set(el.id, {
        id: el.id,
        tags,
        nodes: el.nodes,
        geometry: el.geometry.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]),
      });
      n++;
    }
    tiles++;
    console.log(`tile ${bbox}: ${n} new ways (${ways.size} in all)`);
    await sleep(1500);
  }
}
mkdirSync("osm", { recursive: true });
writeFileSync(
  "osm/rail.json",
  JSON.stringify({
    source: "© OpenStreetMap contributors, ODbL 1.0",
    fetched: new Date().toISOString(),
    ways: [...ways.values()],
  }),
);
console.log(`${tiles} tiles, ${ways.size} ways`);
