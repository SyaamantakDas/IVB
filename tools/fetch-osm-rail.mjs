// Fetches India's main and branch railway lines from OpenStreetMap (© OpenStreetMap contributors, ODbL),
// tile by tile so that each Overpass query stays small, and writes them to osm/rail.json.
// Usage: node tools/fetch-osm-rail.mjs   (run by .github/workflows/osm-rail.yml)
import { writeFileSync, mkdirSync } from "node:fs";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const UA = "IVB-track-shapes/1.0 (+https://github.com/SyaamantakDas/IVB)";
const STEP = 3; // degrees
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(q) {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
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
    const q = `[out:json][timeout:600];area["ISO3166-1"="IN"][admin_level=2]->.in;way["railway"~"^(rail|construction)$"][!"service"](area.in)(${bbox});out skel geom;`;
    const d = await query(q);
    let n = 0;
    for (const el of d.elements || []) if (el.type === "way" && !ways.has(el.id)) { ways.set(el.id, { id: el.id, nodes: el.nodes, geometry: el.geometry.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]) }); n++; }
    tiles++;
    console.log(`tile ${bbox}: ${n} new ways (${ways.size} in all)`);
    await sleep(1500);
  }
}
mkdirSync("osm", { recursive: true });
writeFileSync("osm/rail.json", JSON.stringify({ source: "© OpenStreetMap contributors, ODbL 1.0", fetched: new Date().toISOString(), ways: [...ways.values()] }));
console.log(`${tiles} tiles, ${ways.size} ways`);
