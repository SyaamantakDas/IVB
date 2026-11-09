// Traces every route along India's railway lines in OpenStreetMap (© OpenStreetMap contributors, ODbL) and writes
//   data/shapes.json  the track between each two stops that follow each other on a route
//   data/routes.json  each route's length by rail (km) and the distance from its first stop to each stop (k)
//
// Usage: node tools/build-shapes.mjs [osm/rail.json.gz] [--tolerance=40] [--dry] [--all] [--out=data]
//   --dry  report only   --all  report every pair   --out  where to write the two files
// The railway lines come from .github/workflows/osm-rail.yml, which keeps them on the osm-data branch:
//   git fetch origin osm-data && mkdir -p osm && git show FETCH_HEAD:osm/rail.json.gz > osm/rail.json.gz
//
// How a line is traced: every point of track within reach of each station is a possible start or end,
// costed at twice its distance from the station, and A* finds the cheapest way along the track between them.
// Broad gauge only; lines marked for freight cost four times as much, and lines outside India ten times,
// so a route never cuts through Bangladesh or along a freight corridor when a passenger line will do.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { encode } from "../lib/polyline.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : dflt;
};
const src = resolve(root, args.find((a) => !a.startsWith("--")) || "osm/rail.json.gz");
const TOL = +opt("tolerance", 40) / 1000; // km: points closer than this to the simplified line are dropped
const DRY = args.includes("--dry"),
  ALL = args.includes("--all");
const OUT = resolve(root, opt("out", "data"));
const STEP = 0.3; // km: long straight stretches get extra points this far apart, so stations can snap to them
const SNAP_W = 2,
  FREIGHT_W = 4,
  ABROAD_W = 10;
const MAX_RATIO = 3; // a traced line longer than this many times the straight line is not used (mountain and city lines reach 2.6)
const GAP_KM = 1.5; // the furthest a loose end of track is joined across a break in the map

const load = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const stations = load("stations.json"),
  routes = load("routes.json");
const geo = load("india.geo.json");
const raw = readFileSync(src);
const osm = JSON.parse((src.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));

const RAD = Math.PI / 180;
function hav(la1, lo1, la2, lo2) {
  const h =
    Math.sin(((la2 - la1) * RAD) / 2) ** 2 +
    Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(((lo2 - lo1) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ---------- India's outline as a grid, so a line over the border can be told apart (with ~5 km to spare)
const G = 0.05,
  GLAT0 = 5,
  GLON0 = 66,
  GROWS = Math.ceil((39 - GLAT0) / G),
  GCOLS = Math.ceil((100 - GLON0) / G);
const inside = new Uint8Array(GROWS * GCOLS);
{
  const edges = [];
  for (const poly of geo.land.coordinates)
    for (const ring of poly) for (let i = 1; i < ring.length; i++) edges.push([ring[i - 1], ring[i]]);
  for (let r = 0; r < GROWS; r++) {
    const y = GLAT0 + (r + 0.5) * G,
      xs = [];
    for (const [[x1, y1], [x2, y2]] of edges) if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    xs.sort((a, b) => a - b);
    let k = 0;
    for (let c = 0; c < GCOLS; c++) {
      const x = GLON0 + (c + 0.5) * G;
      while (k < xs.length && xs[k] < x) k++;
      if (k % 2) inside[r * GCOLS + c] = 1;
    }
  }
  const grown = inside.slice();
  for (let r = 1; r < GROWS - 1; r++)
    for (let c = 1; c < GCOLS - 1; c++) {
      if (inside[r * GCOLS + c]) continue;
      for (let dr = -1; dr <= 1 && !grown[r * GCOLS + c]; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if (inside[(r + dr) * GCOLS + c + dc]) {
            grown[r * GCOLS + c] = 1;
            break;
          }
    }
  inside.set(grown);
}
const inIndia = (la, lo) => {
  const r = Math.floor((la - GLAT0) / G),
    c = Math.floor((lo - GLON0) / G);
  return r >= 0 && c >= 0 && r < GROWS && c < GCOLS && inside[r * GCOLS + c] === 1;
};

// ---------- The track graph
const broadGauge = (g) => {
  if (!g) return true; // no gauge given: most of India's network is broad gauge
  const mm = String(g)
    .split(/[;,]/)
    .map((x) => parseFloat(x))
    .filter((x) => x > 0);
  return !mm.length || mm.some((x) => x >= 1600 && x <= 1700);
};
const freight = (t) => t.usage === "freight" || t["railway:traffic_mode"] === "freight";

const nodeIdx = new Map();
const LAT = [],
  LON = [];
const EA = [],
  EB = [],
  EW = [];
const stats = { ways: 0, skippedGauge: 0, freight: 0, abroad: 0 };
const addNode = (la, lo) => {
  LAT.push(la);
  LON.push(lo);
  return LAT.length - 1;
};
function addEdge(a, b, w) {
  const km = hav(LAT[a], LON[a], LAT[b], LON[b]);
  const pieces = Math.ceil(km / STEP);
  let prev = a;
  for (let p = 1; p <= pieces; p++) {
    const next =
      p === pieces ? b : addNode(LAT[a] + ((LAT[b] - LAT[a]) * p) / pieces, LON[a] + ((LON[b] - LON[a]) * p) / pieces);
    const abroad = !inIndia(LAT[prev], LON[prev]) && !inIndia(LAT[next], LON[next]);
    if (abroad) stats.abroad++;
    EA.push(prev);
    EB.push(next);
    EW.push((km / pieces) * w * (abroad ? ABROAD_W : 1));
    prev = next;
  }
}
for (const way of osm.ways) {
  const t = way.tags || {};
  if (!broadGauge(t.gauge)) {
    stats.skippedGauge++;
    continue;
  }
  stats.ways++;
  const w = freight(t) ? FREIGHT_W : 1;
  if (w > 1) stats.freight++;
  let prev = -1;
  for (let i = 0; i < way.nodes.length; i++) {
    const id = way.nodes[i],
      p = way.geometry[i];
    if (!p) {
      prev = -1;
      continue;
    }
    let k = nodeIdx.get(id);
    if (k === undefined) {
      k = addNode(p[0], p[1]);
      nodeIdx.set(id, k);
    }
    if (prev >= 0 && prev !== k) addEdge(prev, k, w);
    prev = k;
  }
}
const N = LAT.length;
const OFF = new Int32Array(N + 1);
for (let e = 0; e < EA.length; e++) {
  OFF[EA[e] + 1]++;
  OFF[EB[e] + 1]++;
}
for (let i = 0; i < N; i++) OFF[i + 1] += OFF[i];
const TO = new Int32Array(OFF[N]),
  WT = new Float64Array(OFF[N]);
{
  const fill = OFF.slice(0, N);
  for (let e = 0; e < EA.length; e++) {
    TO[fill[EA[e]]] = EB[e];
    WT[fill[EA[e]]++] = EW[e];
    TO[fill[EB[e]]] = EA[e];
    WT[fill[EB[e]]++] = EW[e];
  }
}
EA.length = EB.length = EW.length = 0;

// a grid of 0.01° cells for finding the track near a station
const CELL = 0.01,
  cells = new Map();
const cellKey = (r, c) => r * 100000 + c;
for (let i = 0; i < N; i++) {
  if (OFF[i + 1] === OFF[i]) continue;
  const key = cellKey(Math.floor(LAT[i] / CELL), Math.floor(LON[i] / CELL));
  let a = cells.get(key);
  if (!a) cells.set(key, (a = []));
  a.push(i);
}
function near(la, lo, km) {
  const out = [],
    dr = Math.ceil(km / 1.1) + 1,
    dc = Math.ceil(km / (1.11 * Math.cos(la * RAD))) + 1;
  const r0 = Math.floor(la / CELL),
    c0 = Math.floor(lo / CELL);
  for (let r = r0 - dr; r <= r0 + dr; r++)
    for (let c = c0 - dc; c <= c0 + dc; c++) {
      for (const i of cells.get(cellKey(r, c)) || []) {
        const d = hav(la, lo, LAT[i], LON[i]);
        if (d <= km) out.push([i, d]);
      }
    }
  return out;
}

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(k, v) {
    const K = this.k,
      V = this.v;
    let i = K.length;
    K.push(k);
    V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p];
      V[i] = V[p];
      i = p;
    }
    K[i] = k;
    V[i] = v;
  }
  pop() {
    const K = this.k,
      V = this.v,
      top = [K[0], V[0]],
      k = K.pop(),
      v = V.pop();
    if (K.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= K.length) break;
        if (c + 1 < K.length && K[c + 1] < K[c]) c++;
        if (K[c] >= k) break;
        K[i] = K[c];
        V[i] = V[c];
        i = c;
      }
      K[i] = k;
      V[i] = v;
    }
    return top;
  }
}

// ---------- Breaks in the map
// OpenStreetMap's lines sometimes stop short of each other: two ways that should meet end a few metres apart, or,
// where a bridge or a new alignment is missing, up to a kilometre or so. Each loose end of track is joined to the
// nearest track within GAP_KM that cannot be reached along the track within 5 km. A join over 50 m costs three
// times its length plus 1 km, so it is only used across a real break; the report names every one used.
const GAPS = new Map(),
  GAPKM = new Map();
{
  let joins = 0;
  for (let d = 0; d < N; d++) {
    if (OFF[d + 1] - OFF[d] !== 1) continue;
    const cands = near(LAT[d], LON[d], GAP_KM)
      .filter(([m]) => m !== d)
      .sort((x, y) => x[1] - y[1]);
    if (!cands.length) continue;
    const reach = new Map([[d, 0]]),
      heap = new Heap();
    heap.push(0, d);
    while (heap.size) {
      const [g, n] = heap.pop();
      if (g > 5) break;
      if (g > reach.get(n)) continue;
      for (let e = OFF[n]; e < OFF[n + 1]; e++) {
        const m = TO[e],
          gm = g + WT[e];
        if (gm < (reach.get(m) ?? Infinity)) {
          reach.set(m, gm);
          heap.push(gm, m);
        }
      }
    }
    const far = cands.find(([m]) => !(reach.get(m) <= 5));
    if (!far) continue;
    const [m, km] = far,
      w = km <= 0.05 ? km : km * 3 + 1;
    for (const [x, y] of [
      [d, m],
      [m, d],
    ]) {
      if (!GAPS.has(x)) GAPS.set(x, []);
      GAPS.get(x).push([y, w]);
      GAPKM.set(x + "," + y, km);
    }
    joins++;
  }
  stats.joins = joins;
}

// ---------- A* from the track near one station to the track near the next
const G_ = new Float64Array(N),
  PREV = new Int32Array(N),
  SEEN = new Int32Array(N);
let qid = 0;

function trace(a, b) {
  const A = stations[a],
    B = stations[b];
  const straight = hav(A[1], A[2], B[1], B[2]);
  let reach = A[3] || B[3] ? 4 : 1.5,
    src,
    dst;
  for (; reach <= 12; reach *= 2) {
    src = near(A[1], A[2], A[3] ? Math.max(reach, 4) : reach);
    dst = near(B[1], B[2], B[3] ? Math.max(reach, 4) : reach);
    if (src.length && dst.length) break;
  }
  if (!src.length || !dst.length)
    return { a, b, straight, fail: `no track within ${reach / 2} km of ${src.length ? b : a}` };
  qid++;
  const g = (n) => (SEEN[n] === qid ? G_[n] : Infinity);
  const h = (n) => hav(LAT[n], LON[n], B[1], B[2]);
  const term = new Map(dst.map(([n, d]) => [n, d * SNAP_W]));
  const heap = new Heap();
  for (const [n, d] of src)
    if (d * SNAP_W < g(n)) {
      SEEN[n] = qid;
      G_[n] = d * SNAP_W;
      PREV[n] = -1;
      heap.push(G_[n] + h(n), n);
    }
  const limit = straight * 3 + 30;
  let best = Infinity,
    end = -1,
    popped = 0;
  while (heap.size) {
    const [f, n] = heap.pop();
    if (f >= best || f > limit) break;
    const gn = G_[n];
    if (f > gn + h(n) + 1e-9) continue;
    popped++;
    const t = term.get(n);
    if (t !== undefined && gn + t < best) {
      best = gn + t;
      end = n;
    }
    for (let e = OFF[n]; e < OFF[n + 1]; e++) {
      const m = TO[e],
        gm = gn + WT[e];
      if (gm < g(m)) {
        SEEN[m] = qid;
        G_[m] = gm;
        PREV[m] = n;
        heap.push(gm + h(m), m);
      }
    }
    for (const [m, w] of GAPS.get(n) || []) {
      const gm = gn + w;
      if (gm < g(m)) {
        SEEN[m] = qid;
        G_[m] = gm;
        PREV[m] = n;
        heap.push(gm + h(m), m);
      }
    }
  }
  if (end < 0) return { a, b, straight, fail: `no track joins them within ${Math.round(limit)} km` };
  const path = [];
  let gaps = 0;
  for (let n = end; n >= 0; n = PREV[n]) {
    path.push([LAT[n], LON[n]]);
    if (PREV[n] >= 0 && GAPKM.has(PREV[n] + "," + n) && GAPKM.get(PREV[n] + "," + n) > 0.05)
      gaps += GAPKM.get(PREV[n] + "," + n);
  }
  path.reverse();
  const pts = [[A[1], A[2]], ...path, [B[1], B[2]]];
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  const snapA = hav(A[1], A[2], path[0][0], path[0][1]),
    snapB = hav(B[1], B[2], path[path.length - 1][0], path[path.length - 1][1]);
  return { a, b, straight, km, pts, snapA, snapB, popped, gaps, ratio: km / Math.max(straight, 0.1) };
}

// Douglas-Peucker on a local flat projection; keeps both ends
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const kx = 111.32 * Math.cos(pts[0][0] * RAD),
    ky = 110.574;
  const X = pts.map((p) => p[1] * kx),
    Y = pts.map((p) => p[0] * ky);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const dx = X[j] - X[i],
      dy = Y[j] - Y[i],
      L2 = dx * dx + dy * dy;
    let far = 0,
      at = -1;
    for (let k = i + 1; k < j; k++) {
      let t = L2 ? ((X[k] - X[i]) * dx + (Y[k] - Y[i]) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(X[k] - X[i] - t * dx, Y[k] - Y[i] - t * dy);
      if (d > far) {
        far = d;
        at = k;
      }
    }
    if (far > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

// ---------- Trace every pair of stops that follow each other on a route
const t0 = Date.now();
const pairs = new Map(); // "A B" with A < B -> traced line from A to B
const pairKey = (a, b) => (a < b ? `${a} ${b}` : `${b} ${a}`);
for (const r of routes)
  for (let i = 1; i < r.s.length; i++) {
    const key = pairKey(r.s[i - 1], r.s[i]);
    if (!pairs.has(key)) {
      const [a, b] = key.split(" ");
      pairs.set(key, trace(a, b));
    }
  }
const lines = {},
  estimated = [];
let points = 0,
  traced = 0;
for (const [key, p] of [...pairs].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
  if (p.fail || p.ratio > MAX_RATIO) {
    estimated.push(key);
    continue;
  }
  const s = simplify(p.pts, TOL)
    .map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5])
    .filter((q, i, a) => !i || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]);
  traced += p.pts.length;
  points += s.length;
  lines[key] = encode(s);
}

// ---------- Report
console.log(
  `${stats.ways} railway lines (${stats.skippedGauge} not broad gauge left out, ${stats.freight} for freight), ${N} points of track, ${stats.abroad} stretches outside India, ${stats.joins} loose ends joined across breaks in the map`,
);
console.log(
  `${pairs.size} pairs of stops traced in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${pairs.size - estimated.length} along the track, ${estimated.length} not; ${traced} points simplified to ${points} at ${TOL * 1000} m`,
);
const name = (c) => `${stations[c][0]} (${c})`;
for (const key of estimated) {
  const p = pairs.get(key);
  console.log(
    `  NOT TRACED ${name(p.a)} to ${name(p.b)}: ${p.fail || `the line found is ${p.km.toFixed(0)} km, ${p.ratio.toFixed(2)} times the ${p.straight.toFixed(0)} km straight line`}`,
  );
}
const odd = [...pairs.values()].filter(
  (p) => !p.fail && p.ratio <= MAX_RATIO && (ALL || p.ratio > 1.45 || p.snapA > 0.6 || p.snapB > 0.6 || p.gaps > 0),
);
for (const p of odd.sort((x, y) => y.ratio - x.ratio)) {
  console.log(
    `  check ${name(p.a)} to ${name(p.b)}: ${p.km.toFixed(1)} km by rail, ${p.ratio.toFixed(2)} times the straight line; track ${p.snapA.toFixed(2)} km from ${p.a}, ${p.snapB.toFixed(2)} km from ${p.b}${p.gaps ? `; crosses ${p.gaps.toFixed(2)} km of breaks in the map` : ""}`,
  );
}

// ---------- Write the files
let changed = 0;
routes.forEach((r, ri) => {
  const k = [0];
  let cum = 0;
  for (let i = 1; i < r.s.length; i++) {
    const p = pairs.get(pairKey(r.s[i - 1], r.s[i]));
    cum += lines[pairKey(r.s[i - 1], r.s[i])] ? p.km : p.straight * 1.2;
    k.push(Math.round(cum));
  }
  const km = k[k.length - 1];
  if (km !== r.km) changed++;
  const out = {}; // the same fields in the same order, with k after km
  for (const [f, v] of Object.entries(r)) {
    if (f === "k") continue;
    out[f] = f === "km" ? km : v;
    if (f === "km") out.k = k;
  }
  routes[ri] = out;
});
console.log(`${changed} of ${routes.length} routes change length`);
if (DRY) process.exit(0);
const shapes = {
  source: `Track from OpenStreetMap, © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright), fetched ${String(osm.fetched).slice(0, 10)}`,
  format: "Each line runs from the first station to the second, in Google's encoded polyline format, precision 5",
  estimated,
  lines,
};
writeFileSync(join(OUT, "shapes.json"), JSON.stringify(shapes, null, 2) + "\n");
writeFileSync(join(OUT, "routes.json"), "[\n" + routes.map((r) => "  " + JSON.stringify(r)).join(",\n") + "\n]\n");
console.log(`wrote shapes.json and routes.json in ${OUT}; now run node tools/format-data.mjs`);
