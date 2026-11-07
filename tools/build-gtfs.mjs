// Builds IVB's GTFS feed from the data files: every Vande Bharat service with its halts, times and running days.
// Usage: node tools/build-gtfs.mjs [outDir]   (default: gtfs) -> outDir/ivb-gtfs.zip and the .txt files beside it
//
// The feed is published at https://syaamantakdas.github.io/IVB/gtfs/ivb-gtfs.zip under the ODbL 1.0.
// GTFS reference: https://gtfs.org/documentation/schedule/reference/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { decode } from "../lib/polyline.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, process.argv[2] || "gtfs");
const load = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const stations = load("stations.json"), routes = load("routes.json"), timetables = load("timetables.json");
const shapes = existsSync(join(root, "data", "shapes.json")) ? load("shapes.json") : null;

const SITE = "https://syaamantakdas.github.io/IVB/";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // calendar.txt order
const ymd = (iso) => iso.replace(/-/g, "");
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// CSV with quoting only where needed
const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) => [header.join(","), ...rows.map((r) => header.map((h) => cell(r[h])).join(","))].join("\r\n") + "\r\n";

// "06:00" or "00:40+1" -> "06:00:00" or "24:40:00"
const gtfsTime = (t) => {
  const m = /^(\d{2}):(\d{2})(?:\+(\d))?$/.exec(t);
  const h = +m[1] + 24 * (m[3] ? +m[3] : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}:00`;
};
const routeId = (n) => "VB-" + n.replace(/\s*·\s*/g, "-").replace(/\//g, "-");

// The calendar starts on the day the timetables were last checked, or on the build day if that is earlier
// (the check date is India's; the build may still be on the previous day in UTC)
const today = new Date().toISOString().slice(0, 10);
const start = timetables.checked < today ? timetables.checked : today;
const end = addDays(start, 364);

// --- agency, routes
const agency = [{ agency_id: "IR", agency_name: "Indian Railways", agency_url: "https://indianrailways.gov.in/", agency_timezone: "Asia/Kolkata", agency_lang: "en" }];
const routeRows = routes.map((r) => {
  const pairs = r.n.split(/\s*·\s*/); // a route can carry more than one pair of trains; the first names it
  const kind = r.t === "sleeper" ? "Vande Bharat Sleeper: overnight sleeper train" : "Vande Bharat Express: chair car day train";
  return {
  route_id: routeId(r.n), agency_id: "IR", route_short_name: pairs[0],
  route_long_name: `${r.l} ${r.t === "sleeper" ? "Vande Bharat Sleeper" : "Vande Bharat Express"}`,
  route_desc: pairs.length > 1 ? `${kind}. Also trains ${pairs.slice(1).join(", ")}.` : kind,
  route_type: 2, route_url: SITE, route_color: r.t === "sleeper" ? "7A3DAF" : "1D5BB8", route_text_color: "FFFFFF",
  };
});
const routeByN = new Map(routes.map((r) => [r.n, r]));

// --- shapes: each route's track, joined up from the lines between its stops in data/shapes.json
// (a pair of stops without a line gets a straight one). The line passes through every stop, so each
// stop's shape_dist_traveled is the distance to its point on the line.
const shapeRows = [], shapeOf = new Map(); // route n -> { dist: km to each stop, forward }
if (shapes) {
  for (const r of routes) {
    const pts = [], at = [0];
    for (let i = 1; i < r.s.length; i++) {
      const a = r.s[i - 1], b = r.s[i], text = shapes.lines[a < b ? `${a} ${b}` : `${b} ${a}`];
      let line = text ? decode(text) : [[stations[a][1], stations[a][2]], [stations[b][1], stations[b][2]]];
      if (text && a > b) line = line.reverse();
      if (!pts.length) pts.push(line[0]);
      for (const q of line.slice(1)) pts.push(q);
      at.push(pts.length - 1);
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1];
    for (const dir of [0, 1]) {
      const order = dir ? [...pts.keys()].reverse() : [...pts.keys()];
      order.forEach((k, i) => shapeRows.push({
        shape_id: routeId(r.n) + "-" + dir, shape_pt_lat: pts[k][0], shape_pt_lon: pts[k][1], shape_pt_sequence: i + 1,
        shape_dist_traveled: (dir ? total - cum[k] : cum[k]).toFixed(3),
      }));
    }
    shapeOf.set(r.n, { dist: at.map((k) => cum[k]), total });
  }
}

// --- trips, stop times, services
const services = new Map(); // days key -> service_id
const trips = [], stopTimes = [], used = new Set();
for (const [num, t] of Object.entries(timetables.trains)) {
  const r = routeByN.get(t.route);
  const seq = r.s.filter((c) => t.times[c]);
  const forward = r.s.indexOf(t.from) < r.s.indexOf(t.to);
  if (!forward) seq.reverse();
  if (seq.length < 2) continue;
  const key = DAYS.map((d) => (t.days.includes(d) ? 1 : 0)).join("");
  if (!services.has(key)) services.set(key, "D" + key);
  const last = seq[seq.length - 1];
  trips.push({
    route_id: routeId(t.route), service_id: services.get(key), trip_id: num, trip_headsign: stations[last][0],
    trip_short_name: num, direction_id: forward ? 0 : 1,
    shape_id: shapeOf.has(t.route) ? routeId(t.route) + (forward ? "-0" : "-1") : "",
  });
  const sh = shapeOf.get(t.route);
  seq.forEach((c, i) => {
    const [a, d] = t.times[c];
    const arr = gtfsTime(a || d), dep = gtfsTime(d || a);
    used.add(c);
    const km = sh ? sh.dist[r.s.indexOf(c)] : null;
    stopTimes.push({
      trip_id: num, arrival_time: arr, departure_time: dep, stop_id: c, stop_sequence: i + 1,
      pickup_type: i === seq.length - 1 ? 1 : 0, drop_off_type: i === 0 ? 1 : 0, timepoint: 1,
      shape_dist_traveled: sh ? (forward ? km : sh.total - km).toFixed(3) : "",
    });
  });
}
const calendar = [...services].map(([key, id]) => {
  const row = { service_id: id };
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].forEach((d, i) => (row[d] = key[i]));
  return { ...row, start_date: ymd(start), end_date: ymd(end) };
});
const stops = [...used].sort().map((c) => ({ stop_id: c, stop_code: c, stop_name: stations[c][0], stop_lat: stations[c][1], stop_lon: stations[c][2], location_type: 0 }));

function haversine([la1, lo1], [la2, lo2]) {
  const q = Math.PI / 180, x = Math.sin(((la2 - la1) * q) / 2) ** 2 + Math.cos(la1 * q) * Math.cos(la2 * q) * Math.sin(((lo2 - lo1) * q) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

// --- feed info, attributions, licence
const version = start + (process.env.GITHUB_SHA ? "-" + process.env.GITHUB_SHA.slice(0, 7) : "");
const feedInfo = [{
  feed_publisher_name: "IVB (India on Vande Bharat)", feed_publisher_url: SITE, feed_lang: "en", default_lang: "en",
  feed_start_date: ymd(start), feed_end_date: ymd(end), feed_version: version,
  feed_contact_url: "https://github.com/SyaamantakDas/IVB/issues",
}];
const attributions = [
  { attribution_id: "ivb", organization_name: "IVB (India on Vande Bharat) by Syaamantak Das", is_producer: 1, is_operator: 0, is_authority: 0, attribution_url: SITE },
  { attribution_id: "ir", organization_name: "Indian Railways", is_producer: 0, is_operator: 1, is_authority: 0, attribution_url: "https://indianrailways.gov.in/" },
  ...(shapeRows.length ? [{ attribution_id: "osm", organization_name: "OpenStreetMap contributors (track shapes)", is_producer: 1, is_operator: 0, is_authority: 0, attribution_url: "https://www.openstreetmap.org/copyright" }] : []),
];
const licence = `IVB GTFS feed, version ${version}

This feed is IVB (India on Vande Bharat) by Syaamantak Das, ${SITE}
It is made available under the Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/
Credit it as: IVB (India on Vande Bharat) by Syaamantak Das, ${SITE}, data under ODbL 1.0.
If you publish a database built from it, share that database under the ODbL as well.

IVB is unofficial and is not connected with Indian Railways or IRCTC. The times come from public
timetable sites (ConfirmTkt, erail, RailMitra, etrain and others), Wikipedia and Railway Board
circulars; each train's sources and the date it was checked are in data/timetables.json at
https://github.com/SyaamantakDas/IVB. Station positions come from DataMeet railways (CC0).${shapeRows.length ? `
The shapes (track lines) and distances are traced along OpenStreetMap's railway lines:
© OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright` : ""}
Timetables change at short notice: check NTES or IRCTC before you travel.
`;

const files = {
  "agency.txt": csv(["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"], agency),
  "stops.txt": csv(["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon", "location_type"], stops),
  "routes.txt": csv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_desc", "route_type", "route_url", "route_color", "route_text_color"], routeRows),
  "trips.txt": csv(["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name", "direction_id", ...(shapeRows.length ? ["shape_id"] : [])], trips),
  "stop_times.txt": csv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type", "timepoint", ...(shapeRows.length ? ["shape_dist_traveled"] : [])], stopTimes),
  "calendar.txt": csv(["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], calendar),
  "feed_info.txt": csv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "default_lang", "feed_start_date", "feed_end_date", "feed_version", "feed_contact_url"], feedInfo),
  "attributions.txt": csv(["attribution_id", "organization_name", "is_producer", "is_operator", "is_authority", "attribution_url"], attributions),
  ...(shapeRows.length ? { "shapes.txt": csv(["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"], shapeRows) } : {}),
  "LICENSE.txt": licence,
};

// --- a small zip writer (deflate), with a fixed timestamp so the same data gives the same file
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(entries) {
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 1 Jan 2026, 00:00
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, "utf8"), comp = deflateRawSync(data, { level: 9 }), crc = crc32(data), nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(DOS_TIME, 12); cen.writeUInt16LE(DOS_DATE, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cenBuf = Buffer.concat(central), endRec = Buffer.alloc(22);
  endRec.writeUInt32LE(0x06054b50, 0); endRec.writeUInt16LE(entries.length, 8); endRec.writeUInt16LE(entries.length, 10);
  endRec.writeUInt32LE(cenBuf.length, 12); endRec.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, endRec]);
}

mkdirSync(outDir, { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text);
writeFileSync(join(outDir, "ivb-gtfs.zip"), zip(Object.entries(files)));
console.log(`GTFS: ${routeRows.length} routes, ${trips.length} trips, ${stops.length} stops, ${stopTimes.length} stop times, ${calendar.length} service patterns${shapeRows.length ? `, ${shapeRows.length} shape points` : ""}; valid ${start} to ${end}`);
