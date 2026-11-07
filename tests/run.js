// Data and logic checks. Run with: node tests/run.js
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildNetwork, runsOn, DAYS, haversine, legKm } from "../lib/network.js";
import { findJourneys, fewestTrains } from "../lib/finder.js";
import { schedule, rotate, seasonScan, toDay, weekday, fmtDay } from "../lib/schedule.js";
import { bookingDates, bookingCalendar } from "../lib/booking.js";
import { decode } from "../lib/polyline.js";

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
  ok(Array.isArray(t.src) && t.src.length > 0 && t.src.every((u) => /^https:\/\//.test(u)), `train ${num}: needs at least one https source`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(t.checked || "") && t.checked <= timetables.checked, `train ${num}: needs the date it was last checked, no later than the file's`);
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

// ---------- Track lines and distances ----------
console.log("Track");
{
  const at = (c) => ({ lat: stations[c][1], lon: stations[c][2] });
  const pairs = new Set();
  for (const r of routes) for (let i = 1; i < r.s.length; i++) pairs.add([r.s[i - 1], r.s[i]].sort().join(" "));
  let lines = {}, estimated = [];
  if (existsSync(join(root, "data", "shapes.json"))) ({ lines, estimated } = load("shapes.json"));
  for (const [key, text] of Object.entries(lines)) {
    const [a, b] = key.split(" "), pts = decode(text);
    ok(pairs.has(key) && a < b, `shapes: "${key}" must be two stops next to each other on a route, in alphabetical order`);
    if (!(a in stations && b in stations)) continue;
    const miss = Math.max(haversine(at(a), { lat: pts[0][0], lon: pts[0][1] }), haversine(at(b), { lat: pts[pts.length - 1][0], lon: pts[pts.length - 1][1] }));
    ok(pts.length >= 2 && miss < 0.5, `shapes: the line for ${key} must start at ${a} and end at ${b} (it misses by ${miss.toFixed(2)} km: rerun tools/build-shapes.mjs)`);
  }
  const untraced = [...pairs].filter((key) => !(key in lines) && !estimated.includes(key));
  if (untraced.length) console.log(`  note: ${untraced.length} pairs of stops have no track line yet, so the map draws them straight (rerun tools/build-shapes.mjs): ${untraced.slice(0, 12).join(", ")}${untraced.length > 12 ? " …" : ""}`);
  let traced = 0;
  for (const r of routes) {
    if (!r.k) continue;
    traced++;
    ok(r.k.length === r.s.length && r.k[0] === 0 && r.k.every((x, i) => !i || x >= r.k[i - 1]) && r.km === r.k[r.k.length - 1], `route ${r.n}: k must give the distance to each stop, from 0 up to km`);
    for (let i = 1; i < r.s.length; i++) {
      const d = haversine(at(r.s[i - 1]), at(r.s[i])), by = r.k[i] - r.k[i - 1];
      ok(by >= d - 1.5 && by <= 2 * d + 5, `route ${r.n}: ${by} km by rail from ${r.s[i - 1]} to ${r.s[i]}, against ${d.toFixed(0)} km in a straight line`);
    }
  }
  const r0 = net.ROUTES[0];
  ok(!r0.k || legKm(r0, 0, r0.stops.length - 1) === r0.km, "legKm: a whole route is its km");
  console.log(`  ${Object.keys(lines).length} of ${pairs.size} pairs of stops follow the track; ${traced} of ${routes.length} routes have distances along it`);
}

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

// ---------- Booking dates ----------
console.log("Booking");
{
  const c = circuits[0];
  const plan = schedule(net, c.stops, start, events);
  const items = bookingDates(plan);
  ok(items.length === plan.rides, `booking: one date per ride (${items.length} vs ${plan.rides})`);
  for (const it of items) {
    ok(it.opens === it.trainStart - 60 && it.trainStart <= it.day && it.day - it.trainStart <= 1, `booking: ${it.num} opens 60 days before the train leaves its first station`);
  }
  // a ride boarded after midnight counts from the day before
  const t = net.TRAINS.get("27575");
  const fake = { stops: [{ legs: [{ kind: "rail", train: t, from: "AUB", to: "KYQ", day: start }] }] };
  const [b] = bookingDates(fake);
  ok(b && b.trainStart === start - 1 && b.opens === start - 61, "booking: boarding 27575 at Aluabari Road after midnight opens 61 days before");
  const ics = bookingCalendar(items, { name: c.name, stationName: (code) => net.ST.get(code).name });
  ok((ics.match(/BEGIN:VEVENT/g) || []).length === items.length, "calendar: one event per ride");
  ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "calendar: lines folded at 75 octets");
  ok(/DTSTART:\d{8}T023000Z/.test(ics), "calendar: reminders at 8:00 India time");
  console.log(`  ${c.name}: ${items.length} rides go on sale between ${fmtDay(Math.min(...items.map((x) => x.opens)))} and ${fmtDay(Math.max(...items.map((x) => x.opens)))}`);
}

console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
