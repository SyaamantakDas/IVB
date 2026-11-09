// Connection finder: every sensible way to get between two places on Vande Bharat trains alone.
import { legKm, trainFor } from "./network.js";

const MIN_CHANGE = 20; // minutes needed to change trains at the same station
const ROAD_MIN_PER_KM = 4; // rough city traffic, for changes of station by road
export const ANY_CHANGES = 6; // maxChanges of this or more means "any number of changes"

/**
 * Journeys on Vande Bharats alone, whatever the day: maxChanges of ANY_CHANGES or more means no limit, so journeys
 * across the country that need eight or nine trains still show.
 * @param {import("./types.js").Network} net        network from buildNetwork()
 * @param {string[]} fromCodes     station codes to start from (a city can have several)
 * @param {string[]} toCodes       station codes to arrive at
 * @param {{ maxChanges?: number, allowRoad?: boolean, limit?: number, keepPerStation?: number }} [opts]  defaults 2, true and 12
 * @returns {any[]} journeys sorted by number of trains, then distance
 */
export function findJourneys(net, fromCodes, toCodes, opts = {}) {
  const allowRoad = opts.allowRoad !== false;
  const limit = opts.limit ?? 12;
  const keepPerStation = opts.keepPerStation ?? 5;
  const origin = new Set(fromCodes.filter((c) => net.ST.has(c)));
  const dest = new Set(toCodes.filter((c) => net.ST.has(c) && !origin.has(c)));
  if (!origin.size || !dest.size) return [];

  // the fewest trains it can take sets how deep to search; with "Any", one train more than that
  const fewest = fewestTrains(net, origin, dest, allowRoad);
  if (!fewest) return [];
  const want = opts.maxChanges ?? 2;
  const maxTrains = want >= ANY_CHANGES ? Math.max(7, fewest.trains + 1) : Math.max(1, want + 1);
  if (fewest.trains > maxTrains) return [];

  const found = new Map(); // signature -> journey
  let frontier = [...origin].map((c) => ({ at: c, legs: [], km: 0, roadKm: 0, visited: new Set([c]), used: new Set() }));

  for (let k = 1; k <= maxTrains && frontier.length; k++) {
    const next = new Map();
    const offer = (p) => {
      let arr = next.get(p.at);
      if (!arr) next.set(p.at, (arr = []));
      arr.push(p);
    };
    for (const p of frontier) {
      for (const r of net.ST.get(p.at).routes) {
        if (p.used.has(r.id)) continue;
        const i = r.index.get(p.at);
        for (const dir of [1, -1]) {
          // board a city's train at the first of its stations the train reaches (Mumbai Central, not Borivali)
          if (k === 1 && origin.has(r.stops[i - dir])) continue;
          const passed = [];
          for (let j = i + dir; j >= 0 && j < r.stops.length; j += dir) {
            const y = r.stops[j];
            if (p.visited.has(y)) break; // would loop back through somewhere already passed
            passed.push(y);
            const leg = { kind: "rail", route: r, from: p.at, to: y, i, j, km: legKm(r, i, j), halts: Math.abs(j - i) - 1 };
            const legs = [...p.legs, leg];
            const km = p.km + leg.km;
            if (dest.has(y)) {
              keepBest(found, { legs, km, roadKm: p.roadKm });
              continue;
            }
            if (k === maxTrains) continue;
            const visited = new Set([...p.visited, ...passed]);
            const used = new Set([...p.used, r.id]);
            offer({ at: y, legs, km, roadKm: p.roadKm, visited, used });
            if (!allowRoad) continue;
            for (const n of net.ST.get(y).near) {
              if (visited.has(n.code)) continue;
              const road = { kind: "road", from: y, to: n.code, km: n.km };
              // A road change straight into the destination city ends the journey
              if (dest.has(n.code)) { keepBest(found, { legs: [...legs, road], km: km + n.km, roadKm: p.roadKm + n.km }); continue; }
              offer({ at: n.code, legs: [...legs, road], km: km + n.km, roadKm: p.roadKm + n.km, visited: new Set([...visited, n.code]), used });
            }
          }
        }
      }
    }
    // keep the shortest few partial journeys at each station
    frontier = [];
    for (const arr of next.values()) {
      arr.sort((a, b) => a.km - b.km || a.roadKm - b.roadKm);
      frontier.push(...arr.slice(0, keepPerStation));
    }
  }

  // the search keeps only a few partial journeys at each station, so make sure the fewest-trains one is never lost
  if (![...found.values()].some((j) => j.legs.filter((l) => l.kind === "rail").length === fewest.trains)) {
    const sum = (legs) => legs.reduce((a, l) => a + l.km, 0);
    keepBest(found, { legs: fewest.legs, km: sum(fewest.legs), roadKm: sum(fewest.legs.filter((l) => l.kind === "road")) });
  }

  let list = [...found.values()].map((j) => annotate(net, j));
  if (!list.length) return [];
  const shortest = Math.min(...list.map((j) => j.km));
  const bestByTrains = new Map();
  for (const j of list) if (!bestByTrains.has(j.trains) || j.km < bestByTrains.get(j.trains).km) bestByTrains.set(j.trains, j);
  // a train that runs straight through makes any change onto or off it pointless
  const direct = new Set(list.filter((j) => j.trains === 1).map((j) => j.legs.find((l) => l.kind === "rail").route.id));
  if (direct.size) list = list.filter((j) => j.trains === 1 || !j.legs.some((l) => l.kind === "rail" && direct.has(l.route.id)));
  // drop long detours unless it is the best option with that many trains
  list = list.filter((j) => j.km <= shortest * 1.8 + 150 || bestByTrains.get(j.trains) === j);
  // fewest trains first, then fewest nights on the way, then shortest
  list.sort((a, b) => a.trains - b.trains || (a.nights + a.unknown) - (b.nights + b.unknown) || a.unknown - b.unknown || a.km - b.km || a.roadKm - b.roadKm);
  return list.slice(0, limit);
}

function signature(legs) {
  return legs.filter((l) => l.kind === "rail").map((l) => l.route.id + (l.j > l.i ? "+" : "-")).join("|");
}

function keepBest(found, j) {
  const sig = signature(j.legs);
  const prev = found.get(sig);
  if (!prev || j.km < prev.km || (j.km === prev.km && j.roadKm < prev.roadKm)) found.set(sig, j);
}

/**
 * The fewest trains between two sets of stations, ignoring times: riding one train counts 1, and a change of
 * station by road counts 0. As in findJourneys, a road change only comes straight after a train.
 * @param {import("./types.js").Network} net
 * @param {Set<string>} origin
 * @param {Set<string>} dest
 * @param {boolean} [allowRoad]
 * @returns {{ trains: number, legs: any[] } | null} one such journey, or null if Vande Bharats cannot make it at all
 */
export function fewestTrains(net, origin, dest, allowRoad = true) {
  // a state is a station plus how you got there: "~" after a road change, when another one is not allowed
  const dist = new Map(), prev = new Map(), done = new Set();
  const queue = [];
  const reach = (key, d, leg, front) => {
    if (dist.has(key) && dist.get(key) <= d) return;
    dist.set(key, d);
    if (leg) prev.set(key, leg);
    if (front) queue.unshift(key); else queue.push(key);
  };
  for (const c of origin) reach(c + "~", 0, null, false);
  while (queue.length) {
    const key = queue.shift();
    if (done.has(key)) continue;
    done.add(key);
    const d = dist.get(key), byRoad = key.endsWith("~"), u = byRoad ? key.slice(0, -1) : key;
    if (dest.has(u)) {
      const legs = [];
      for (let k = key; prev.has(k); ) { const l = prev.get(k); legs.unshift(l); k = l.fromKey; }
      return { trains: d, legs: legs.map(({ fromKey, ...l }) => l) };
    }
    const st = net.ST.get(u);
    if (allowRoad && !byRoad) {
      for (const n of st.near) reach(n.code + "~", d, { kind: "road", from: u, to: n.code, km: n.km, fromKey: key }, true);
    }
    for (const r of st.routes) {
      const i = r.index.get(u);
      r.stops.forEach((y, j) => {
        if (j !== i) reach(y, d + 1, { kind: "rail", route: r, from: u, to: y, i, j, km: legKm(r, i, j), halts: Math.abs(j - i) - 1, fromKey: key }, false);
      });
    }
  }
  return null;
}

// Add trains, timings and change times where IVB has a timetable
function annotate(net, j) {
  const legs = j.legs.map((l) => {
    if (l.kind !== "rail") return { ...l };
    const t = trainFor(net, l.route, l.from, l.to);
    const out = { ...l, train: t || null };
    if (t) {
      const a = t.times[l.from], b = t.times[l.to];
      out.dep = a && (a.dep || a.arr) || null;
      out.arr = b && (b.arr || b.dep) || null;
      out.days = t.days;
    }
    return out;
  });
  // change times between consecutive trains
  let prev = null, roadMin = 0;
  for (const l of legs) {
    if (l.kind === "road") { roadMin += l.km * ROAD_MIN_PER_KM; continue; }
    if (prev) {
      if (prev.arr && l.dep) {
        const gap = (l.dep.min - prev.arr.min) - roadMin;
        l.change = gap >= MIN_CHANGE && prev.arr.day === 0 ? { sameDay: true, min: l.dep.min - prev.arr.min } : { sameDay: false };
      } else {
        l.change = null; // not enough timetable data to say
      }
    }
    prev = l;
    roadMin = 0;
  }
  const rail = legs.filter((l) => l.kind === "rail");
  const allTimes = rail.every((l) => l.dep && l.arr) && rail.slice(1).every((l) => l.change);
  const sameDay = allTimes && rail.slice(1).every((l) => l.change.sameDay);
  const first = rail[0], last = rail[rail.length - 1];
  const duration = sameDay ? (last.arr.min + last.arr.day * 1440) - first.dep.min : null;
  // nights spent on the way: overnight changes plus trains that run through the night
  let nights = 0;
  for (const l of rail) {
    if (l.change && !l.change.sameDay) nights++;
    if (l.dep && l.arr) nights += Math.max(0, l.arr.day - l.dep.day);
  }
  const unknown = rail.slice(1).filter((l) => !l.change).length; // changes IVB cannot time yet
  return { legs, km: j.km, roadKm: j.roadKm, trains: rail.length, changes: rail.length - 1, duration, timed: allTimes, nights, unknown };
}
