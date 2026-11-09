// Your own circuit: a loop through the places you choose, on Vande Bharats alone.
// It turns a list of places and nights into stops with moves, as in data/circuits.json, so that schedule()
// can lay it out around each train's day off. Pure functions shared by the website and the tests.
import { findJourneys } from "./finder.js";
import { haversine } from "./network.js";

export const OWN_ID = "own";
export const MAX_NIGHTS = 7;

// Places a circuit can stop at: those with a Vande Bharat station
export const ownPlaces = (net) => [...net.PLACES.values()].filter((p) => p.codes.length);

// "delhi.2,agra.1" <-> [{ place: "delhi", nights: 2 }, { place: "agra", nights: 1 }]
export const ownToText = (list) => list.map((s) => `${s.place}.${s.nights}`).join(",");
export function ownFromText(net, text) {
  const list = String(text || "")
    .split(",")
    .map((x) => {
      const [place, n] = x.split(".");
      return { place, nights: Math.max(0, Math.min(MAX_NIGHTS, parseInt(n, 10) || 0)) };
    })
    .filter((s) => net.PLACES.has(s.place) && net.PLACES.get(s.place).codes.length);
  return list.length >= 2 ? list : null;
}

/**
 * @param {import("./types.js").Network} net
 * @param {import("./types.js").OwnStop[]} list  the places in the order you visit them; the last leads back to the first
 * @returns {{ stops: any[], missing: string[] }} stops as in circuits.json, and any hop Vande Bharats
 *          cannot make (never expected: every place is connected)
 */
export function buildCircuit(net, list) {
  const stops = [],
    missing = [];
  const name = (c) => net.ST.get(c).name;
  let arrived = null;
  list.forEach((s, i) => {
    const a = net.PLACES.get(s.place),
      b = net.PLACES.get(list[(i + 1) % list.length].place);
    const j = findJourneys(net, a.codes, b.codes, { maxChanges: 6, allowRoad: true, limit: 1 })[0];
    if (!j) {
      missing.push(`${a.name} to ${b.name}`);
      return;
    }
    const first = j.legs[0].from,
      code = arrived && a.codes.includes(arrived) ? arrived : first;
    const move = [];
    // arriving at one of a city's stations and leaving from another means a change by road
    if (code !== first)
      move.push({
        road: true,
        from: code,
        to: first,
        km: Math.max(1, Math.round(haversine(net.ST.get(code), net.ST.get(first)) * 1.3)),
        text: `${name(code)} to ${name(first)}`,
      });
    let rails = 0;
    for (const l of j.legs) {
      if (l.kind === "road") {
        move.push({ road: true, from: l.from, to: l.to, km: l.km, text: `${name(l.from)} to ${name(l.to)}` });
        continue;
      }
      const forward = l.j > l.i;
      const options = (net.trainsByRoute.get(l.route.id) || [])
        .filter((t) => t.forward === forward && t.times[l.from] && t.times[l.to])
        .sort((x, y) => dep(x, l.from) - dep(y, l.from))
        .map((t) => t.num);
      // after the first train, wait at the change for as long as it takes (a night or more), as a traveller would
      move.push({
        options: options.length ? options : [l.train && l.train.num].filter(Boolean),
        from: l.from,
        to: l.to,
        ...(rails++ ? { flex: true } : {}),
      });
    }
    stops.push({ place: a.id, code, nights: s.nights, move });
    arrived = j.legs[j.legs.length - 1].to;
  });
  return { stops, missing };
}

// the time of day a train leaves a station, so the earliest of the day is tried first
function dep(t, code) {
  const x = t.times[code],
    d = x && (x.dep || x.arr);
  return d ? d.min : Infinity;
}
