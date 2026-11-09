// The Vande Bharat network: stations, routes, directional timetables and destinations.
// Pure data model shared by the website and the tests (no DOM access).

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const CHANGE_KM = 15; // stations this close count as one city for changing trains by road

export function haversine(a, b) {
  const p = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lon - a.lon) * p) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// "08:15" -> { min: 495, day: 0 }, "00:40+1" -> { min: 40, day: 1 }
export function parseTime(s) {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?:\+(\d))?$/.exec(s);
  if (!m) return null;
  return { min: +m[1] * 60 + +m[2], day: m[3] ? +m[3] : 0, text: `${m[1].padStart(2, "0")}:${m[2]}` };
}

/**
 * @param {{ stations: Record<string, any[]>, routes: any[], timetables: any, places: any }} data  the files in data/
 * @returns {import("./types.js").Network}
 */
export function buildNetwork({ stations, routes, timetables, places }) {
  const ST = new Map();
  for (const [code, v] of Object.entries(stations)) {
    ST.set(code, { code, name: v[0], lat: v[1], lon: v[2], approx: !!v[3], state: v[4], routes: [], term: false });
  }
  const ROUTES = routes.map((r, id) => {
    const nums = r.n.split(" · ");
    const route = {
      id,
      n: r.n,
      nums,
      label: r.l,
      type: r.t,
      stops: r.s,
      note: r.note || "",
      unc: new Set(r.u || []),
      km: r.km,
      k: r.k || null,
      first: Math.min(...nums.map((p) => parseInt(p, 10))),
      numbers: new Set(r.n.split(/[/ ·]+/).filter(Boolean)),
    };
    // cumulative straight-line distance along the stops, to share out the route's km when it has no k
    route.cum = [0];
    for (let i = 1; i < route.stops.length; i++) {
      route.cum.push(route.cum[i - 1] + haversine(ST.get(route.stops[i - 1]), ST.get(route.stops[i])));
    }
    route.index = new Map(route.stops.map((c, i) => [c, i]));
    return route;
  });
  for (const r of ROUTES) {
    r.stops.forEach((c, i) => {
      const s = ST.get(c);
      if (!s.routes.includes(r)) s.routes.push(r);
      if (i === 0 || i === r.stops.length - 1) s.term = true;
    });
  }
  for (const s of ST.values()) {
    s.routes.sort((a, b) => a.first - b.first);
    s.pairs = s.routes.reduce((n, r) => n + r.nums.length, 0);
  }

  // Nearby stations for changing trains by road
  const list = [...ST.values()];
  for (const a of list) {
    a.near = [];
    for (const b of list) {
      if (a === b) continue;
      const d = haversine(a, b);
      if (d <= CHANGE_KM) a.near.push({ code: b.code, km: Math.round(d * 1.3) || 1 });
    }
    a.near.sort((x, y) => x.km - y.km);
  }

  // Directional trains: number -> entry with its route and direction along that route
  const TRAINS = new Map();
  const routeByN = new Map(ROUTES.map((r) => [r.n, r]));
  for (const [num, t] of Object.entries(timetables.trains || {})) {
    const route = routeByN.get(t.route);
    if (!route) continue;
    const fi = route.index.get(t.from),
      ti = route.index.get(t.to);
    const times = {};
    for (const [c, [a, d]] of Object.entries(t.times || {})) times[c] = { arr: parseTime(a), dep: parseTime(d) };
    TRAINS.set(num, { ...t, num, route, forward: fi != null && ti != null ? fi < ti : null, times });
  }
  const trainsByRoute = new Map();
  for (const t of TRAINS.values()) {
    if (!trainsByRoute.has(t.route.id)) trainsByRoute.set(t.route.id, []);
    trainsByRoute.get(t.route.id).push(t);
  }

  // Destinations
  const PLACES = new Map();
  const placeByCode = new Map();
  for (const p of places.places || []) {
    PLACES.set(p.id, p);
    for (const c of p.codes) placeByCode.set(c, p);
  }

  return { ST, ROUTES, TRAINS, trainsByRoute, PLACES, placeByCode, checked: timetables.checked };
}

// Rail km between two stop indexes: from the distances along the track (k), or else by sharing out
// the route's km by straight-line distance
/** @param {import("./types.js").Route} route @param {number} i @param {number} j @returns {number} */
export function legKm(route, i, j) {
  const a = Math.min(i, j),
    b = Math.max(i, j);
  if (route.k) return route.k[b] - route.k[a];
  const total = route.cum[route.cum.length - 1] || 1;
  return Math.round(((route.cum[b] - route.cum[a]) / total) * (route.km || total));
}

// The timetable entry (if IVB has one) for riding `route` from station a to station b
export function trainFor(net, route, a, b) {
  const list = net.trainsByRoute.get(route.id) || [];
  const forward = route.index.get(a) < route.index.get(b);
  const cands = list.filter((t) => t.forward === forward);
  return cands.find((t) => t.times[a] && t.times[b]) || cands[0] || null;
}

// Weekday-aware check: does train t run from station `code` on weekday `wd` (0 = Sunday)?
export function runsOn(t, code, wd) {
  const off = ((t.times[code] && (t.times[code].dep || t.times[code].arr)) || { day: 0 }).day;
  return t.days.includes(DAYS[(wd - off + 7) % 7]);
}

export function dayOffset(t, a, b) {
  const da = t.times[a] && (t.times[a].dep || t.times[a].arr);
  const db = t.times[b] && (t.times[b].arr || t.times[b].dep);
  if (!da || !db) return t.sleeper ? 1 : 0;
  return db.day - da.day;
}
