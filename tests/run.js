// Data and logic checks. Run with: node tests/run.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildNetwork, runsOn, DAYS } from "../lib/network.js";
import { findJourneys, fewestTrains } from "../lib/finder.js";
import { schedule, rotate, seasonScan, toDay, weekday, fmtDay } from "../lib/schedule.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const stations = load("stations.json"), routes = load("routes.json"), timetables = load("timetables.json");
const places = load("places.json"), circuits = load("circuits.json").circuits, events = load("events.json").events;
const net = buildNetwork({ stations, routes, timetables, places });

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { failures++; console.log("  FAIL", msg); } };

// ---------- Data ----------
console.log("Data");
for (const r of routes) for (const c of r.s) ok(c in stations, `route ${r.n}: unknown station ${c}`);
const routeN = new Map(routes.map((r) => [r.n, r]));
for (const [num, t] of Object.entries(timetables.trains)) {
  const r = routeN.get(t.route);
  ok(!!r, `train ${num}: unknown route ${t.route}`);
  if (!r) continue;
  ok(t.days.length > 0 && t.days.every((d) => DAYS.includes(d)), `train ${num}: bad days ${t.days}`);
  ok(Array.isArray(t.src) && t.src.length > 0, `train ${num}: no source`);
  const idx = Object.keys(t.times).filter((c) => r.s.includes(c)).map((c) => r.s.indexOf(c));
  const sorted = [...idx].sort((a, b) => a - b);
  ok(idx.join() === sorted.join() || idx.join() === [...sorted].reverse().join(), `train ${num}: times out of route order`);
  for (const c of Object.keys(t.times)) ok(r.s.includes(c), `train ${num}: ${c} is not a halt on ${t.route}`);
}
for (const p of places.places) {
  for (const c of p.codes) ok(c in stations, `place ${p.id}: unknown station ${c}`);
  ok(/^[012]{12}$/.test(p.months), `place ${p.id}: months must be 12 digits of 0, 1 or 2`);
  ok(p.see.length >= 3, `place ${p.id}: needs at least three things to see`);
}
const extras = new Set(places.places.filter((p) => p.lat != null).map((p) => p.id));
for (const c of circuits) {
  for (const s of c.stops) {
    ok(net.PLACES.has(s.place), `${c.id}: unknown place ${s.place}`);
    for (const leg of s.move) {
      if (leg.road) continue;
      for (const n of leg.options || [leg.train]) {
        const t = net.TRAINS.get(n);
        ok(!!t, `${c.id}: no timetable for ${n}`);
        if (!t) continue;
        const r = t.route;
        const i = r.index.get(leg.from), j = r.index.get(leg.to);
        ok(i != null && j != null, `${c.id}: ${n} does not call at ${leg.from} and ${leg.to}`);
        ok(t.forward === (i < j), `${c.id}: ${n} runs the other way between ${leg.from} and ${leg.to}`);
      }
    }
  }
}
ok(extras.has("orchha"), "Orchha needs coordinates");
ok(stations.MMCT && stations.MMCT[4] === "Maharashtra", "Mumbai Central is in Maharashtra, not Dadra and Nagar Haveli and Daman and Diu");

// ---------- Finder ----------
console.log("Finder");
const city = (id) => net.PLACES.get(id).codes;
let j = findJourneys(net, city("chennai"), city("mysuru"), { maxChanges: 2 });
ok(j.length && j[0].trains === 1 && j[0].legs[0].train && j[0].legs[0].train.num === "20607", "Chennai to Mysuru: the direct 20607 comes first");
j = findJourneys(net, city("srinagar"), city("delhi"), { maxChanges: 2 });
ok(j.length && j[0].trains === 2, "Srinagar to Delhi: two trains via Katra or Jammu");
j = findJourneys(net, city("mumbai"), city("kolkata"), { maxChanges: 6 });
ok(j.length > 0, "Mumbai to Kolkata: some Vande Bharat-only journey exists");
console.log(`  Mumbai to Kolkata: fewest trains ${j[0] ? j[0].trains : "-"}, ${j.length} options`);
j = findJourneys(net, ["NDLS"], ["NDLS"], {});
ok(j.length === 0, "same station returns nothing");
j = findJourneys(net, city("srinagar"), ["NCJ"], { maxChanges: 6 });
ok(j.length && j[0].trains === 8, "Srinagar to Nagercoil: Any finds the 8-train journeys");
ok(findJourneys(net, city("srinagar"), ["NCJ"], { maxChanges: 3 }).length === 0, "Srinagar to Nagercoil: nothing within 3 changes");
// "Any" must never come back empty: for every pair of places, its first journey has the fewest trains possible
let deep = 0;
for (const p of net.PLACES.values()) for (const q of net.PLACES.values()) {
  if (p === q || !p.codes.length || !q.codes.length) continue;
  const o = new Set(p.codes), d = new Set(q.codes.filter((c) => !o.has(c)));
  const f = fewestTrains(net, o, d);
  ok(!!f, `${p.name} to ${q.name}: Vande Bharats can make it`);
  if (!f || f.trains < 7) continue;
  deep++;
  const jj = findJourneys(net, p.codes, q.codes, { maxChanges: 6, limit: 1 });
  ok(jj.length && jj[0].trains === f.trains, `${p.name} to ${q.name}: Any finds the ${f.trains}-train journey`);
}
console.log(`  ${deep} pairs of places need 7 or more trains; Any finds every one`);

// ---------- Circuits ----------
console.log("Circuits");
const start = toDay(2027, 2, 1); // a Monday
for (const c of circuits) {
  for (const startAt of [0, 4]) {
    const stops = rotate(c.stops, startAt);
    const plan = schedule(net, stops, start, events);
    ok(plan.warnings.length === 0, `${c.id} from ${stops[0].place}: ${plan.warnings.join("; ")}`);
    for (const s of plan.stops) {
      for (const l of s.legs) {
        if (l.kind !== "rail") continue;
        ok(runsOn(l.train, l.from, weekday(l.day)), `${c.id}: ${l.train.num} does not run on ${fmtDay(l.day)}`);
      }
      if (!s.first) ok(s.depart.day >= s.arrive.day, `${c.id}: leaves ${s.place.name} before arriving`);
    }
    ok(plan.end > plan.start, `${c.id}: ends after it starts`);
    if (startAt === 0) console.log(`  ${c.name}: ${plan.days} days, ${plan.rides} rides, ${plan.waits} nights waiting for a train, ${fmtDay(plan.start)} to ${fmtDay(plan.end)}`);
  }
  const scan = seasonScan(net, c.stops, toDay(2026, 12, 1), 24, events);
  ok(scan.length === 24 && scan.every((x) => x.score >= 0 && x.score <= 1), `${c.id}: season scan`);
  const best = scan.reduce((a, b) => (b.score > a.score ? b : a));
  console.log(`  best start ${fmtDay(best.day)} (${Math.round(best.score * 100)}%); scores: ` + scan.map((x) => fmtDay(x.day, false) + " " + Math.round(x.score * 100)).join(", "));
}

console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
