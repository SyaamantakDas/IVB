// Dated journeys: for a day you want to leave, the journeys on Vande Bharats alone that arrive soonest for each
// number of trains, leaving as late as they can. This is RAPTOR (Delling, Pajor and Werneck, "Round-Based Public
// Transit Routing", 2012) run once for each departure from the origin that day, so that a journey which waits for
// a later train never hides one that simply leaves later ("range RAPTOR").
// Pure functions shared by the website and the tests (no DOM access).
import { DAYS, legKm } from "./network.js";
import { weekday } from "./schedule.js";

export const MIN_CHANGE = 20; // minutes to change trains at the same station
export const ROAD_MIN_PER_KM = 4; // rough city traffic, for a change of station by road
export const MAX_DAYS = 8; // how many days a journey may take

// Each train's halts in the order it calls, with minutes from midnight on the day it leaves its first station
const patterns = new WeakMap();
function trainPatterns(net) {
  let p = patterns.get(net);
  if (p) return p;
  p = [];
  for (const t of net.TRAINS.values()) {
    const r = t.route, seq = [];
    const order = t.forward === false ? [...r.stops].reverse() : r.stops;
    for (const code of order) {
      const x = t.times[code];
      if (!x || !(x.arr || x.dep)) continue;
      const arr = x.arr || x.dep, dep = x.dep || x.arr;
      seq.push({ code, i: r.index.get(code), arr: arr.min + arr.day * 1440, dep: dep.min + dep.day * 1440 });
    }
    if (seq.length >= 2) p.push({ train: t, seq });
  }
  patterns.set(net, p);
  return p;
}

/**
 * @param {import("./types.js").Network} net        network from buildNetwork()
 * @param {string[]} fromCodes     station codes to leave from (a city can have several)
 * @param {string[]} toCodes       station codes to arrive at
 * @param {number} day             the day to leave (days since 1970-01-01, as in schedule.js)
 * @param {{ after?: number, maxTrains?: number, allowRoad?: boolean, limit?: number }} [opts]
 *   after: minutes after midnight (0); maxTrains (8); allowRoad (true); limit (6)
 * @returns {import("./types.js").DatedJourney[]} soonest arrival first, with times in minutes from midnight on `day`
 */
export function planJourneys(net, fromCodes, toCodes, day, opts = {}) {
  const after = opts.after ?? 0, maxTrains = opts.maxTrains ?? 8, allowRoad = opts.allowRoad !== false, limit = opts.limit ?? 6;
  const origin = new Set(fromCodes.filter((c) => net.ST.has(c)));
  const dest = new Set(toCodes.filter((c) => net.ST.has(c) && !origin.has(c)));
  if (!origin.size || !dest.size) return [];

  // every run of every train that could matter, with times in minutes from midnight on `day`
  const trips = [];
  for (const { train, seq } of trainPatterns(net)) {
    for (let d = -2; d < MAX_DAYS + 7; d++) {
      if (!train.days.includes(DAYS[weekday(day + d)])) continue;
      trips.push({ train, seq, start: day + d, base: d * 1440 });
    }
  }

  // run from each departure from the origin on the day, latest first; if no journey leaves that day
  // (no train, or none that gets there within MAX_DAYS and maxTrains), from each departure on the next day, and so on
  const found = new Map();
  for (let first = 0; first < 7 && !found.size; first++) {
    const starts = new Set();
    for (const T of trips) for (const s of T.seq) {
      const t = T.base + s.dep;
      if (origin.has(s.code) && t >= Math.max(after, first * 1440) && t < (first + 1) * 1440) starts.add(t);
    }
    const horizon = (first + MAX_DAYS) * 1440;
    for (const t0 of [...starts].sort((a, b) => b - a)) {
      for (const j of raptor(net, trips, origin, dest, t0, maxTrains, allowRoad, horizon)) {
        if (Math.floor(j.dep / 1440) !== first) continue;
        const key = j.legs.map((l) => (l.kind === "rail" ? `${l.train.num}@${l.start}` : `${l.from}>${l.to}`)).join("|");
        if (!found.has(key)) found.set(key, j);
      }
    }
  }
  // keep only journeys that nothing beats: no other leaves as late or later, arrives as soon or sooner and takes no more trains;
  // and those that leave on the day asked for, unless none do
  const all = [...found.values()];
  const kept = all.filter((a) => !all.some((b) => b !== a && b.dep >= a.dep && b.arr <= a.arr && b.trains <= a.trains && (b.dep > a.dep || b.arr < a.arr || b.trains < a.trains)));
  kept.sort((a, b) => a.arr - b.arr || a.trains - b.trains || b.dep - a.dep);
  return kept.slice(0, limit);
}

// One RAPTOR run from time t0: for each number of trains, the soonest arrival, as a journey
function raptor(net, trips, origin, dest, t0, maxTrains, allowRoad, horizon) {
  const arr = [new Map()], how = [new Map()];
  for (const c of origin) arr[0].set(c, t0);
  let marked = new Set(origin), bestDest = Infinity;
  const out = [];
  const get = (k, c) => (arr[k].has(c) ? arr[k].get(c) : Infinity);
  for (let k = 1; k <= maxTrains && marked.size; k++) {
    arr[k] = new Map(arr[k - 1]);
    how[k] = new Map();
    const next = new Set();
    for (const T of trips) {
      let board = -1;
      for (let x = 0; x < T.seq.length; x++) {
        const s = T.seq[x];
        if (board >= 0) {
          const a = T.base + s.arr;
          if (a < get(k, s.code) && a < bestDest && a < horizon) {
            arr[k].set(s.code, a);
            how[k].set(s.code, { kind: "rail", T, board, alight: x });
            next.add(s.code);
          }
        }
        // board a city's train at the first of its stations the train calls at (Mumbai Central, not Borivali)
        if (k === 1 && board < 0 && origin.has(s.code) && x > 0 && T.seq.slice(0, x).some((q) => origin.has(q.code))) continue;
        if (board < 0 && marked.has(s.code)) {
          const ready = get(k - 1, s.code);
          const need = ready + (k === 1 ? 0 : MIN_CHANGE);
          if (ready < Infinity && T.base + s.dep >= need && x < T.seq.length - 1) board = x;
        }
      }
    }
    // a change of station by road, straight after a train
    if (allowRoad) {
      for (const c of [...next]) {
        const t = get(k, c);
        for (const n of net.ST.get(c).near) {
          const a = t + n.km * ROAD_MIN_PER_KM;
          if (a < get(k, n.code) && a < bestDest) {
            arr[k].set(n.code, a);
            how[k].set(n.code, { kind: "road", from: c, km: n.km });
            next.add(n.code);
          }
        }
      }
    }
    let at = null;
    for (const c of dest) if (get(k, c) < bestDest) { bestDest = get(k, c); at = c; }
    if (at) out.push(trace(net, how, k, at));
    marked = next;
  }
  return out;
}

// Walk back from the destination to build the journey found in round k
function trace(net, how, k, at) {
  const legs = [];
  let c = at;
  while (k > 0) {
    const h = how[k].get(c);
    if (!h) { k--; continue; } // reached in an earlier round
    if (h.kind === "road") {
      legs.unshift({ kind: "road", from: h.from, to: c, km: h.km });
      c = h.from;
      continue;
    }
    const { T, board, alight } = h;
    const a = T.seq[board], b = T.seq[alight], r = T.train.route;
    legs.unshift({
      kind: "rail", train: T.train, route: r, from: a.code, to: b.code, i: a.i, j: b.i,
      halts: Math.abs(b.i - a.i) - 1, km: legKm(r, a.i, b.i), start: T.start,
      dep: T.base + a.dep, arr: T.base + b.arr,
    });
    c = a.code;
    k--;
  }
  const rail = legs.filter((l) => l.kind === "rail");
  const dep = rail[0].dep, arrive = rail[rail.length - 1].arr;
  return {
    legs, dep, arr: arrive, trains: rail.length, changes: rail.length - 1,
    km: legs.reduce((s, l) => s + l.km, 0), roadKm: legs.filter((l) => l.kind === "road").reduce((s, l) => s + l.km, 0),
    nights: Math.floor(arrive / 1440) - Math.floor(dep / 1440),
  };
}
