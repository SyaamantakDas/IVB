// IVB: India on Vande Bharat. Connections, circuits and the train list on one map.
import { buildNetwork, DAYS, runsOn } from "../lib/network.js";
import { findJourneys } from "../lib/finder.js";
import { schedule, rotate, seasonScan, seasonScore, toDay, fromISO, isoOf, fmtDay, monthOf, yearOf, weekday } from "../lib/schedule.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem("ivb-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("ivb-" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULLDAY = { Sun: "Sundays", Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays" };

function daysText(days) {
  if (!days) return "";
  if (days.length === 7) return "daily";
  if (days.length >= 5) return "not on " + DAYS.filter((d) => !days.includes(d)).map((d) => FULLDAY[d]).join(" or ");
  return days.join(", ") + " only";
}
const fmtKm = (km) => km.toLocaleString("en-IN") + " km";
// Where a train's times come from: the site names IVB checked them against, and when
const SOURCE_NAMES = {
  "confirmtkt.com": "ConfirmTkt", "erail.in": "erail", "railmitra.com": "RailMitra", "etrain.info": "etrain",
  "totaltraininfo.com": "Total Train Info", "wikipedia.org": "Wikipedia", "indianrailways.gov.in": "Railway Board",
  "cleartrip.com": "Cleartrip", "deshgujarat.com": "DeshGujarat", "odishabytes.com": "OdishaBytes",
};
function sourceName(url) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^(www|m|amp|en)\./, ""); } catch (e) { return "source"; }
  if (host.includes("wikipedia") || host.startsWith("wiki.") || host.includes("kiwix") || host.includes("freedombox")) return "Wikipedia";
  return SOURCE_NAMES[host] || host;
}
function fmtISO(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y ? `${d} ${MONTHS[m - 1]} ${y}` : "";
}
// "Checked 8 Nov 2026 against ConfirmTkt and RailMitra", with each source linked
function provenance(t) {
  const urls = (t && t.src) || [];
  if (!urls.length) return "";
  const seen = new Set(), links = [];
  for (const u of urls) {
    const n = sourceName(u);
    if (seen.has(n)) continue;
    seen.add(n);
    links.push(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`);
  }
  const list = links.length > 1 ? links.slice(0, -1).join(", ") + " and " + links[links.length - 1] : links[0];
  return `${t.checked ? `Checked ${esc(fmtISO(t.checked))}` : "Checked"} against ${list}`;
}
const fmtDur = (min) => `${Math.floor(min / 60)} h${min % 60 ? " " + String(min % 60).padStart(2, "0") + " min" : ""}`;

async function boot() {
  const files = ["stations", "routes", "timetables", "places", "circuits", "events", "india.geo"];
  let raw;
  try {
    const got = await Promise.all(files.map((f) => fetch(`data/${f}.json`).then((r) => { if (!r.ok) throw new Error(f); return r.json(); })));
    raw = Object.fromEntries(files.map((f, i) => [f, got[i]]));
  } catch (err) {
    console.error(err);
    const m = $("map-msg");
    m.hidden = false;
    m.textContent = "The data files could not be loaded. If you opened index.html straight from disk, serve the folder instead (for example: python3 -m http.server).";
    return;
  }
  start(raw);
}

function start(raw) {
  const net = buildNetwork({ stations: raw.stations, routes: raw.routes, timetables: raw.timetables, places: raw.places });
  const { ST, ROUTES, PLACES, TRAINS } = net;
  const EVENTS = raw.events.events;
  const CIRCUITS = raw.circuits.circuits;
  const GEO = raw["india.geo"];

  // Places that are not Vande Bharat stations (Orchha) still need a point on the map
  for (const p of PLACES.values()) {
    if (p.lat == null || !p.code) continue;
    ST.set(p.code, { code: p.code, name: p.name, lat: p.lat, lon: p.lon, state: p.state, routes: [], near: [], term: false, pairs: 0, extra: true });
    net.placeByCode.set(p.code, p);
  }
  for (const s of ST.values()) {
    s.imp = s.pairs + (s.term ? 3 : 0);
    s.slOnly = s.routes.length > 0 && s.routes.every((r) => r.type === "sleeper");
    s.r0 = s.term ? 3.4 : s.pairs >= 4 ? 2.7 : 2.2;
  }
  const byImp = [...ST.values()].filter((s) => !s.extra).sort((a, b) => b.imp - a.imp || a.name.localeCompare(b.name));
  const byNum = (a, b) => a.first - b.first;
  const placeOf = (code) => net.placeByCode.get(code) || null;
  const stName = (code) => (ST.get(code) ? ST.get(code).name : code);

  // Header numbers
  $("n-pairs").textContent = ROUTES.reduce((n, r) => n + r.nums.length, 0);
  $("n-routes").textContent = ROUTES.length;
  $("n-stations").textContent = [...ST.values()].filter((s) => !s.extra).length;
  $("c-all").textContent = ROUTES.length;
  $("c-cc").textContent = ROUTES.filter((r) => r.type === "cc").length;
  $("c-sl").textContent = ROUTES.filter((r) => r.type === "sleeper").length;
  if (net.checked) {
    const [y, m, d] = net.checked.split("-").map(Number);
    $("checked-date").textContent = `${d} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
  }

  /* ---------- State ---------- */
  const today = (() => { const n = new Date(); return toDay(n.getFullYear(), n.getMonth() + 1, n.getDate()); })();
  const state = {
    tab: "connections", view: "connections", sel: null, history: [], hover: null, hoverStation: null,
    type: "all", q: "", sort: "num",
    from: null, to: null, maxChanges: store.get("max", 6), allowRoad: store.get("road", true), journeys: [], jSel: 0,
    variant: store.get("variant", "loop"), startPlace: store.get("startPlace", "mumbai"), startDay: null, plan: null, scan: null,
    leg: null, legHover: null,
  };

  const panel = $("panel"), mapSection = $("mapsection"), mapwrap = $("mapwrap"), tip = $("tip");
  const views = { connections: $("v-connections"), circuits: $("v-circuits"), trains: $("v-trains"), route: $("v-route"), station: $("v-station") };

  /* ---------- Places and stations for the From and To boxes ---------- */
  function endpointFromPlace(p) { return { label: p.name, codes: p.codes.slice(), place: p }; }
  function endpointFromStation(s) { return { label: `${s.name} (${s.code})`, codes: [s.code], place: placeOf(s.code), station: s }; }
  function suggestions(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const p of PLACES.values()) {
      if (!p.codes.length) continue;
      const n = p.name.toLowerCase();
      if (n.startsWith(q) || (q.length >= 3 && n.includes(q))) out.push({ kind: "place", p, rank: n.startsWith(q) ? 0 : 1 });
    }
    for (const s of ST.values()) {
      if (s.extra) continue;
      const n = s.name.toLowerCase(), c = s.code.toLowerCase();
      let rank = -1;
      if (c === q) rank = 0;
      else if (n.startsWith(q)) rank = 2;
      else if (q.length >= 3 && n.includes(q)) rank = 3;
      else if (q.length >= 2 && c.startsWith(q)) rank = 4;
      if (rank >= 0) out.push({ kind: "station", s, rank });
    }
    out.sort((a, b) => a.rank - b.rank || (b.kind === "place") - (a.kind === "place") || (b.s ? b.s.pairs : 0) - (a.s ? a.s.pairs : 0));
    return out.slice(0, 8);
  }
  function resolve(text) {
    const q = text.trim().toLowerCase();
    if (!q) return null;
    for (const p of PLACES.values()) if (p.codes.length && p.name.toLowerCase() === q) return endpointFromPlace(p);
    const byCode = ST.get(text.trim().toUpperCase());
    if (byCode && !byCode.extra) return endpointFromStation(byCode);
    const m = /\(([A-Z]{2,5})\)\s*$/.exec(text.trim());
    if (m && ST.get(m[1])) return endpointFromStation(ST.get(m[1]));
    const sug = suggestions(text);
    if (sug.length) return sug[0].kind === "place" ? endpointFromPlace(sug[0].p) : endpointFromStation(sug[0].s);
    return null;
  }

  function combo(inputId, listId, key) {
    const input = $(inputId), list = $(listId);
    let items = [], active = -1;
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
    const choose = (it) => {
      state[key] = it.kind === "place" ? endpointFromPlace(it.p) : endpointFromStation(it.s);
      input.value = state[key].label;
      close();
      search();
    };
    const render = () => {
      items = suggestions(input.value);
      if (!items.length) { close(); return; }
      list.innerHTML = items.map((it, i) => it.kind === "place"
        ? `<li role="option" id="${listId}-${i}" aria-selected="${i === active}" data-i="${i}"><span class="city-tag">City</span><span>${esc(it.p.name)}</span><small>${it.p.codes.length} ${it.p.codes.length === 1 ? "station" : "stations"}</small></li>`
        : `<li role="option" id="${listId}-${i}" aria-selected="${i === active}" data-i="${i}"><span class="code">${it.s.code}</span><span>${esc(it.s.name)}</span><small>${esc(it.s.state || "")}</small></li>`).join("");
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (active >= 0) input.setAttribute("aria-activedescendant", `${listId}-${active}`); else input.removeAttribute("aria-activedescendant");
    };
    input.addEventListener("input", () => { active = -1; render(); });
    input.addEventListener("focus", () => { if (input.value) { input.select(); } });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (list.hidden) render();
        if (!items.length) return;
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        render();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!list.hidden && items.length) choose(items[Math.max(0, active)]);
        else { const r = resolve(input.value); if (r) { state[key] = r; input.value = r.label; search(); } }
      } else if (e.key === "Escape") { close(); }
    });
    input.addEventListener("blur", () => setTimeout(() => {
      close();
      if (input.value && (!state[key] || state[key].label !== input.value)) {
        const r = resolve(input.value);
        if (r) { state[key] = r; input.value = r.label; search(); }
      }
    }, 150));
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) choose(items[+li.dataset.i]); });
    return { set(ep) { state[key] = ep; input.value = ep ? ep.label : ""; } };
  }
  const fromBox = combo("from", "from-list", "from");
  const toBox = combo("to", "to-list", "to");
  $("finder").addEventListener("submit", (e) => e.preventDefault());
  $("swap").addEventListener("click", () => { const a = state.from, b = state.to; fromBox.set(b); toBox.set(a); search(); });
  document.querySelectorAll(".seg button").forEach((b) => {
    b.setAttribute("aria-checked", String(+b.dataset.max === state.maxChanges));
    b.addEventListener("click", () => {
      state.maxChanges = +b.dataset.max;
      store.set("max", state.maxChanges);
      document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      search();
    });
  });
  $("road").checked = state.allowRoad;
  $("road").addEventListener("change", (e) => { state.allowRoad = e.target.checked; store.set("road", state.allowRoad); search(); });

  /* ---------- Connections ---------- */
  function expand(ep) {
    // a single station also counts its near neighbours (Varanasi Jn and Banaras, say) when road changes are allowed
    const set = new Set(ep.codes);
    if (state.allowRoad && ep.codes.length === 1) for (const n of ST.get(ep.codes[0]).near) if (n.km <= 12) set.add(n.code);
    return [...set];
  }
  function search() {
    store.set("from", state.from ? state.from.label : "");
    store.set("to", state.to ? state.to.label : "");
    state.jSel = 0;
    state.leg = null;
    if (!state.from || !state.to) { state.journeys = []; renderResults(); renderDest(); refreshMap(true); return; }
    state.journeys = findJourneys(net, expand(state.from), expand(state.to), { maxChanges: state.maxChanges, allowRoad: state.allowRoad, limit: 8 });
    state.wider = null;
    if (!state.journeys.length && state.maxChanges < 6) {
      const more = findJourneys(net, expand(state.from), expand(state.to), { maxChanges: 6, allowRoad: state.allowRoad, limit: 1 });
      state.wider = more.length ? more[0].changes : null;
    }
    renderResults();
    renderDest();
    refreshMap(true);
  }
  function legText(l) {
    if (l.kind === "road") return `${stName(l.from)} to ${stName(l.to)} by road, about ${l.km} km`;
    return `${stName(l.from)} → ${stName(l.to)}`;
  }
  function trainNum(l) {
    if (l.train) return l.train.num;
    return l.route.n.split(" · ")[0];
  }
  function renderResults() {
    const el = $("results");
    if (!state.from || !state.to) {
      el.innerHTML = `<p class="empty">Choose where you start and where you want to go. IVB finds every way to do it on Vande Bharat trains alone.</p>`;
      return;
    }
    const js = state.journeys;
    if (!js.length) {
      el.innerHTML = `<div class="res-head"><p class="kicker">Connections</p><h2>${esc(state.from.label)} to ${esc(state.to.label)}</h2></div>` +
        `<p class="empty">${state.wider != null
          ? `No Vande Bharat journey with ${state.maxChanges === 0 ? "no changes" : "up to " + state.maxChanges + (state.maxChanges === 1 ? " change" : " changes")}. The fewest it takes is ${state.wider} ${state.wider === 1 ? "change" : "changes"}: choose “Any” to see them.`
          : state.allowRoad
            ? "There is no way to make this journey on Vande Bharat trains alone."
            : "There is no way to make this journey on Vande Bharat trains alone without a change of station by road. Allow one and IVB will look again."}</p>`;
      return;
    }
    const fewest = js[0].trains;
    const head = `<div class="res-head"><p class="kicker">${js.length} ${js.length === 1 ? "way" : "ways"} on Vande Bharats only</p>` +
      `<h2>${esc(state.from.label)} to ${esc(state.to.label)}</h2>` +
      `<p>${fewest === 1 ? "There is a direct train." : `The fewest is ${fewest} trains.`} Pick one to see its trains and the route on the map.</p></div>`;
    const cityOf = (code) => (placeOf(code) ? placeOf(code).name : stName(code));
    const cards = js.map((j, k) => {
      const open = k === state.jSel;
      const rails = j.legs.filter((l) => l.kind === "rail");
      const via = [...new Set(rails.slice(1).map((l) => cityOf(l.from)))];
      const label = j.trains === 1 ? "Direct" : `${j.trains} trains`;
      const when = j.duration != null ? fmtDur(j.duration) + " end to end"
        : j.timed ? (j.nights ? `${j.nights} ${j.nights === 1 ? "night" : "nights"} on the way` : "")
        : "some timings not in IVB yet";
      const sub = [fmtKm(j.km), when].filter(Boolean);
      let body = "";
      if (open) {
        const parts = [];
        j.legs.forEach((l) => {
          if (l.kind === "road") { parts.push(`<li class="jx">${esc(legText(l))}</li>`); return; }
          if (l.change) parts.push(`<li class="jx wait">${l.change.sameDay ? `${fmtDur(l.change.min)} to change at ${esc(stName(l.from))}` : `Night in ${esc(cityOf(l.from))}${l.dep ? `; the next train leaves at ${l.dep.text}` : ""}`}</li>`);
          const meta = [l.dep && l.arr ? `${l.dep.text} → ${l.arr.text}${l.arr.day > (l.dep.day || 0) ? " next day" : ""}` : "", l.days ? daysText(l.days) : "timetable not in IVB yet", `${l.halts} ${l.halts === 1 ? "halt" : "halts"}`, fmtKm(l.km)].filter(Boolean).join(" · ");
          const prov = l.train ? `<span class="prov">${provenance(l.train)}${l.train.note ? `. ${esc(l.train.note)}` : ""}</span>` : "";
          parts.push(`<li class="jleg"><span class="num${l.route.type === "sleeper" ? " sl" : ""}">${esc(trainNum(l))}</span><span class="what">${esc(legText(l))}</span><span class="meta">${esc(meta)}</span>${prov}</li>`);
        });
        body = `<ul class="jlegs">${parts.join("")}</ul>`;
      } else {
        body = `<p class="jvia">${via.length ? "Change at " + esc(via.join(", ")) : esc(rails.map(trainNum).join(" · "))}</p>`;
      }
      return `<li><div class="jcard${open ? " open" : ""}" role="button" tabindex="0" data-j="${k}" aria-pressed="${open}" aria-expanded="${open}"><div class="jsum"><b>${label}</b>${sub.map((s) => `<span>${esc(s)}</span>`).join("")}</div>${body}</div></li>`;
    }).join("");
    el.innerHTML = head + `<ol class="journeys">${cards}</ol>` +
      `<p class="res-more">Times and days come from the timetable sites named on each train, checked on the date shown; a night on the way assumes the next train runs that day. Distances share out each route's rail length between its halts.</p>`;
  }
  function placeCard(p, heading) {
    const now = monthOf(today);
    const strip = MONTHS.map((m, i) => `<span class="m${p.months[i]}${i === now ? " now" : ""}" title="${m}: ${["avoid", "fair", "good"][+p.months[i]]}">${m[0]}</span>`).join("");
    return `<div class="place"><div><p class="kicker">${esc(heading)}</p><h3>${esc(p.name)}</h3><p class="state">${esc(p.state)}</p></div>` +
      `<ul>${p.see.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` +
      `<p class="ptip">${esc(p.tip)}</p>` +
      `<div class="months"><span class="months-label">Best time to visit</span><div class="mstrip" role="img" aria-label="Good months: ${MONTHS.filter((m, i) => p.months[i] === "2").join(", ")}">${strip}</div>` +
      `<span class="mkey"><span><i class="k2"></i>Good</span><span><i class="k1"></i>Fair</span><span><i class="k0"></i>Better avoided</span><span>Outlined: this month</span></span></div></div>`;
  }
  function renderDest() {
    const p = state.to && (state.to.place || placeOf(state.to.codes[0]));
    $("dest").innerHTML = p ? placeCard(p, "What to see") : "";
  }

  /* ---------- Circuits ---------- */
  function circuitStops() {
    const c = CIRCUITS.find((x) => x.id === state.variant) || CIRCUITS[0];
    let i = c.stops.findIndex((s) => s.place === state.startPlace);
    if (i < 0) i = 0;
    return { c, stops: rotate(c.stops, i) };
  }
  function computeCircuit(resetDate) {
    const { stops } = circuitStops();
    const scanFrom = toDay(yearOf(today) + (monthOf(today) === 11 ? 1 : 0), ((monthOf(today) + 1) % 12) + 1, 1);
    state.scan = seasonScan(net, stops, scanFrom, 24, EVENTS);
    if (resetDate || state.startDay == null) {
      const saved = store.get("startDay", null);
      state.startDay = !resetDate && saved && saved >= today ? saved : state.scan.reduce((a, b) => (b.score > a.score ? b : a)).day;
    }
    state.plan = schedule(net, stops, state.startDay, EVENTS);
    state.planScore = seasonScore(net, state.plan);
  }
  function waitReason(s) {
    const planned = s.first ? s.depart.day - s.waited : s.arrive.day + s.nights;
    for (const l of s.legs) {
      if (l.kind !== "rail") continue;
      if (!runsOn(l.train, l.from, weekday(planned))) return `${l.train.num} does not run on ${FULLDAY[DAYS[weekday(planned)]]}`;
    }
    return "the onward train leaves too early to make the change";
  }
  function legButton(l, idx) {
    if (l.kind === "road") return `<li><p class="leg-x">${esc(l.text || legText(l))}, about ${l.km} km by road</p></li>`;
    const t = l.train;
    const time = l.dep && l.arr ? `${l.dep.text} → ${l.arr.text}${l.arrDay > l.day ? " next day" : ""}` : "";
    const meta = [fmtDay(l.day), time, t.sleeper ? "sleeper, overnight" : "", daysText(t.days)].filter(Boolean).join(" · ");
    return `<li><button class="leg" type="button" data-leg="${idx}"><span class="leg-no">${t.num}</span><span class="leg-route">${esc(stName(l.from))} → ${esc(stName(l.to))}</span><span class="leg-meta">${esc(meta)}</span></button></li>`;
  }
  function seasonChip(p, day) {
    const m = +p.months[monthOf(day)];
    return `<span class="pchip s${m}"><i></i>${["Off season", "Fair season", "Good season"][m]}</span>`;
  }
  function statesOf(plan) {
    const set = new Set();
    for (const s of plan.stops) for (const l of s.legs) {
      if (l.kind !== "rail") continue;
      const r = l.train.route, i = r.index.get(l.from), j = r.index.get(l.to);
      for (let k = Math.min(i, j); k <= Math.max(i, j); k++) set.add(ST.get(r.stops[k]).state);
    }
    return set.size;
  }
  // When the circuit's trains were last checked, and that each train names its sources
  function circuitProvenance(plan) {
    const dates = [...new Set(plan.stops.flatMap((s) => s.legs).filter((l) => l.kind === "rail" && l.train && l.train.checked).map((l) => l.train.checked))].sort();
    if (!dates.length) return "";
    const when = dates.length === 1 ? `on ${fmtISO(dates[0])}` : `between ${fmtISO(dates[0])} and ${fmtISO(dates[dates.length - 1])}`;
    return `The times of these trains were checked ${esc(when)} against timetable sites. Each train's page under Trains names its sources.`;
  }
  function renderCircuits() {
    const { c } = circuitStops();
    const plan = state.plan;
    const startPlace = PLACES.get(state.startPlace) || plan.stops[0].place;
    let legIdx = 0;
    const startOptions = [...new Map(c.stops.map((s) => [s.place, PLACES.get(s.place)])).values()]
      .map((p) => `<option value="${p.id}"${p.id === state.startPlace ? " selected" : ""}>${esc(p.name)}</option>`).join("");
    const items = plan.stops.map((s, i) => {
      const p = s.place;
      const stay = s.first ? `Leave ${fmtDay(s.depart.day)}` :
        s.nightsActual === 0 ? `${fmtDay(s.arrive.day)} · day stop` :
        `${fmtDay(s.arrive.day)} – ${fmtDay(s.depart.day)} · ${s.nightsActual} ${s.nightsActual === 1 ? "night" : "nights"}`;
      const chips = (s.first ? "" : seasonChip(p, s.arrive.day)) + s.events.map((e) => `<span class="pchip ev">${esc(e.name)}${e.from === e.to ? ", " + fmtDay(fromISO(e.from)) : ""}</span>`).join("");
      const legs = s.legs.map((l) => { const b = legButton(l, l.kind === "rail" ? legIdx : -1); if (l.kind === "rail") legIdx++; return b; }).join("");
      return `<li><span class="stopno" aria-hidden="true">${i + 1}</span>` +
        `<div class="stop-h"><button class="stop-city" type="button" data-code="${esc(s.code)}">${esc(p.name)}${s.first ? " (start)" : ""}</button><span class="stop-stay">${esc(stay)}</span></div>` +
        (chips ? `<div class="chips-row">${chips}</div>` : "") +
        (s.note ? `<p class="stop-note">${esc(s.note)}</p>` : "") +
        (s.first ? "" : `<p class="stop-see">${esc(p.see.slice(0, 3).join(" · "))}</p>`) +
        (s.waited ? `<p class="waited">Stays ${s.waited} more ${s.waited === 1 ? "night" : "nights"}: ${esc(waitReason(s))}.</p>` : "") +
        `<ul class="legs">${legs}</ul></li>`;
    }).join("");
    const best = state.scan.reduce((a, b) => (b.score > a.score ? b : a));
    const nstops = plan.stops.length;
    views.circuits.innerHTML =
      `<div class="cv-head"><p class="kicker">Circuits</p><h2>${esc(c.name)}</h2><p class="cv-blurb">${esc(c.blurb)}</p>` +
      `<div class="cv-controls"><div class="variant" role="group" aria-label="Which loop">` +
      CIRCUITS.map((x) => `<button type="button" data-variant="${x.id}" aria-pressed="${x.id === c.id}">${x.id === "loop" ? "Central India Loop" : "With the east"}</button>`).join("") +
      `</div><div class="cv-row"><label for="cv-start">Start from<select id="cv-start">${startOptions}</select></label>` +
      `<label for="cv-date">Start date<input type="date" id="cv-date" value="${isoOf(state.startDay)}" min="${isoOf(today)}"></label></div></div>` +
      `<dl class="stats"><div><dt>Days</dt><dd>${plan.days}</dd></div><div><dt>Train rides</dt><dd>${plan.rides}</dd></div><div><dt>Stops</dt><dd>${nstops - 1}</dd></div><div><dt>States and UTs</dt><dd>${statesOf(plan)}</dd></div></dl>` +
      `<p class="cv-dates">Leave ${esc(startPlace.name)} on <b>${fmtDay(plan.start)} ${yearOf(plan.start)}</b>, back on <b>${fmtDay(plan.end)} ${yearOf(plan.end)}</b>.` +
      (plan.waits ? ` That includes ${plan.waits} extra ${plan.waits === 1 ? "night" : "nights"} waiting for trains that skip a day.` : "") + `</p></div>` +
      `<section class="season" aria-labelledby="season-h"><h3 id="season-h">When to go</h3>` +
      `<p>Share of your nights spent in each place's good months, for a start on the 1st or 15th of each month.</p>` +
      `<div class="chart" id="season-chart"></div>` +
      `<p class="best">Best start: <b>${fmtDay(best.day)} ${yearOf(best.day)}</b>, ${Math.round(best.score * 100)}%. Your date scores ${Math.round(state.planScore.score * 100)}%.</p>` +
      `<div class="season-actions">${best.day !== state.startDay ? `<button class="btn" type="button" data-act="use-best">Start on the best date</button>` : ""}</div>` +
      `<p>The scores weigh weather only. October and November are also festival season, when trains fill up early.</p>` +
      `<details><summary>Show the scores as a table</summary><table><thead><tr><th>Start</th><th>Score</th><th>Days</th><th>Good</th><th>Fair</th><th>Off</th></tr></thead><tbody>` +
      state.scan.map((x) => `<tr><td>${fmtDay(x.day)} ${yearOf(x.day)}</td><td>${Math.round(x.score * 100)}%</td><td>${x.days}</td><td>${x.best}</td><td>${x.fair}</td><td>${x.poor}</td></tr>`).join("") +
      `</tbody></table></details></section>` +
      `<ol class="itin" aria-label="Stops in order">${items}</ol>` +
      `<p class="cv-end">Back in ${esc(startPlace.name)} on ${fmtDay(plan.end)}${plan.endTime != null ? " at " + String(Math.floor(plan.endTime / 60)).padStart(2, "0") + ":" + String(plan.endTime % 60).padStart(2, "0") : ""}.</p>` +
      (plan.warnings.length ? `<p class="cv-end">${esc(plan.warnings.join(" "))}</p>` : "") +
      `<p class="cv-src">${circuitProvenance(plan)}</p>`;
    drawSeasonChart($("season-chart"), state.scan, state.startDay, best.day);
    $("cv-start").addEventListener("change", (e) => { state.startPlace = e.target.value; store.set("startPlace", state.startPlace); computeCircuit(false); renderCircuits(); refreshMap(true); });
    $("cv-date").addEventListener("change", (e) => {
      if (!e.target.value) return;
      state.startDay = Math.max(today, fromISO(e.target.value));
      store.set("startDay", state.startDay);
      computeCircuit(false); renderCircuits(); refreshMap(false);
    });
  }

  // Season chart: one column per start date, the chosen date in saffron
  function drawSeasonChart(el, scan, chosen, bestDay) {
    const W = 400, H = 132, padL = 30, padR = 6, padT = 18, padB = 22;
    const iw = W - padL - padR, ih = H - padT - padB;
    const slot = iw / scan.length, bw = Math.min(24, slot - 2);
    const near = scan.reduce((a, b) => (Math.abs(b.day - chosen) < Math.abs(a.day - chosen) ? b : a));
    const y = (v) => padT + ih * (1 - v);
    const parts = [];
    for (const g of [0, 0.5, 1]) {
      parts.push(`<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"/>`);
      parts.push(`<text class="axis" x="${padL - 6}" y="${(y(g) + 3.5).toFixed(1)}" text-anchor="end">${g * 100}%</text>`);
    }
    scan.forEach((x, i) => {
      const cx = padL + slot * i + slot / 2;
      const h = Math.max(1, ih * x.score), top = y(x.score), left = cx - bw / 2, r = Math.min(4, h, bw / 2);
      const d = `M${left},${y(0)}V${top + r}Q${left},${top} ${left + r},${top}H${left + bw - r}Q${left + bw},${top} ${left + bw},${top + r}V${y(0)}Z`;
      const label = `${fmtDay(x.day)} ${yearOf(x.day)}: ${Math.round(x.score * 100)}%, ${x.days} days`;
      parts.push(`<rect class="hitbar" x="${(padL + slot * i).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${ih}" tabindex="0" role="button" aria-label="${esc(label)}" data-i="${i}"/>`);
      parts.push(`<path class="bar${x === near ? " hi" : ""}" d="${d}"/>`);
      if (new Date(x.day * 86400000).getUTCDate() === 1) {
        const m = monthOf(x.day);
        parts.push(`<text class="axis" x="${(padL + slot * i + slot).toFixed(1)}" y="${H - 6}" text-anchor="middle">${MONTHS[m][0]}${m === 0 ? "’" + String(yearOf(x.day)).slice(2) : ""}</text>`);
      }
    });
    const bi = scan.findIndex((x) => x.day === bestDay);
    if (bi >= 0) parts.push(`<text class="val" x="${(padL + slot * bi + slot / 2).toFixed(1)}" y="${(y(scan[bi].score) - 5).toFixed(1)}" text-anchor="middle">${Math.round(scan[bi].score * 100)}%</text>`);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Season score by start date">${parts.join("")}</svg><div class="ctip" hidden></div>`;
    const ctip = el.querySelector(".ctip");
    const show = (i) => {
      const x = scan[i], rect = el.getBoundingClientRect(), k = rect.width / W;
      ctip.innerHTML = `<b>${Math.round(x.score * 100)}%</b> · start ${esc(fmtDay(x.day))} ${yearOf(x.day)}<br>${x.days} days · ${x.best} stops in good season`;
      ctip.style.left = `${(padL + slot * i + slot / 2) * k}px`;
      ctip.style.top = `${(y(x.score) - 6) * k}px`;
      ctip.hidden = false;
    };
    el.querySelectorAll(".hitbar").forEach((r) => {
      const i = +r.dataset.i;
      r.addEventListener("pointerenter", () => show(i));
      r.addEventListener("focus", () => show(i));
      r.addEventListener("pointerleave", () => { ctip.hidden = true; });
      r.addEventListener("blur", () => { ctip.hidden = true; });
      const pick = () => { state.startDay = Math.max(today, scan[i].day); store.set("startDay", state.startDay); computeCircuit(false); renderCircuits(); refreshMap(false); };
      r.addEventListener("click", pick);
      r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
  }

  /* ---------- Trains list, route and station views ---------- */
  function routeMatches(r, q) {
    if (!q) return true;
    if (r.nums.some((n) => n.includes(q))) return true;
    if (r.label.toLowerCase().includes(q)) return true;
    return r.stops.some((c) => c.toLowerCase() === q || ST.get(c).name.toLowerCase().includes(q));
  }
  const filtered = () => ROUTES.filter((r) => (state.type === "all" || r.type === state.type) && routeMatches(r, state.q));
  function sorted(list) {
    const a = list.slice();
    if (state.sort === "name") a.sort((x, y) => x.label.localeCompare(y.label));
    else if (state.sort === "halts") a.sort((x, y) => y.stops.length - x.stops.length || x.first - y.first);
    else a.sort(byNum);
    return a;
  }
  function rowHTML(r) {
    const halts = r.stops.length - 2;
    return `<li><button type="button" class="rrow${r.type === "sleeper" ? " is-sl" : ""}" data-id="${r.id}">` +
      `<span class="rnum">${r.nums.map((n) => `<span>${n}</span>`).join("")}</span>` +
      `<span class="rname">${esc(r.label)}${r.type === "sleeper" ? '<span class="tag">Sleeper</span>' : ""}</span>` +
      `<span class="rhalts"><b>${halts}</b>${halts === 1 ? "halt" : "halts"}</span></button></li>`;
  }
  function renderList() {
    const list = sorted(filtered());
    $("routes").innerHTML = list.length ? list.map(rowHTML).join("") : `<li><p class="empty">No Vande Bharat train matches “${esc(state.q)}”. Try a station name, a code such as NDLS, or a train number.</p></li>`;
    const pairs = list.reduce((n, r) => n + r.nums.length, 0);
    $("count").textContent = state.q || state.type !== "all" ? `${list.length} ${list.length === 1 ? "route" : "routes"} · ${pairs} train ${pairs === 1 ? "pair" : "pairs"} match` : `${list.length} routes · ${pairs} train pairs`;
    const q = state.q, el = $("st-results");
    if (q.length >= 2) {
      const hits = [...ST.values()].filter((s) => !s.extra && (s.code.toLowerCase() === q || (s.code.toLowerCase().startsWith(q) && q.length >= 3) || s.name.toLowerCase().includes(q)))
        .sort((a, b) => (b.code.toLowerCase() === q) - (a.code.toLowerCase() === q) || b.pairs - a.pairs).slice(0, 6);
      el.hidden = !hits.length;
      el.innerHTML = hits.length ? `<p class="group-label">Stations</p><ul class="stlist">${hits.map((s) => `<li><button type="button" class="strow" data-code="${s.code}"><span class="code">${s.code}</span><span class="rname">${esc(s.name)}</span><span class="stcount">${s.pairs} ${s.pairs === 1 ? "train" : "trains"}</span></button></li>`).join("")}</ul><p class="group-label">Trains</p>` : "";
    } else { el.hidden = true; el.innerHTML = ""; }
    if (!state.sel && map) map.focus();
  }
  function backLabel() { return state.history.length ? "← Back" : { connections: "← Connections", circuits: "← Circuits", trains: "← All trains" }[state.tab]; }
  function renderRouteView(r) {
    const n = r.stops.length;
    const timed = [...TRAINS.values()].filter((t) => t.route === r && Object.keys(t.times).length);
    const fwd = timed.find((t) => t.forward), rev = timed.find((t) => !t.forward);
    const tCell = (t, c) => { const x = t && t.times[c]; const v = x && (x.dep || x.arr); return v ? v.text : ""; };
    views.route.innerHTML =
      `<div class="vhead"><button class="back" type="button" data-act="back">${backLabel()}</button><button class="tomap" type="button" data-act="tomap">Map ↑</button></div>` +
      `<div class="rv-head"><p class="rv-num${r.type === "sleeper" ? " sl" : ""}">${r.nums.map((x) => `<span>${x}</span>`).join("")}</p><h2>${esc(r.label)}</h2>` +
      `<p class="rv-meta"><span class="pill${r.type === "sleeper" ? " sl" : ""}">${r.type === "sleeper" ? "Sleeper" : "Chair car"}</span><span>${n} stations · ${n - 2} ${n - 2 === 1 ? "halt" : "halts"} · ${fmtKm(r.km)}</span></p>` +
      (r.note ? `<p class="rv-note">${esc(r.note)}</p>` : "") +
      (timed.length ? `<ul class="rv-tt">${timed.map((t) => `<li><b>${t.num}</b> ${esc(stName(t.from))} → ${esc(stName(t.to))}, ${esc(daysText(t.days))}.${t.note ? " " + esc(t.note) : ""} <span class="prov">${provenance(t)}.</span></li>`).join("")}</ul>` : `<p class="rv-tt">IVB does not have this train's timetable yet.</p>`) +
      `</div><ol class="strip" aria-label="Stops in order">${r.stops.map((c, i) => {
        const s = ST.get(c), term = i === 0 || i === n - 1, unc = r.unc.has(c);
        const times = [tCell(fwd, c), tCell(rev, c)].filter(Boolean).join(" / ");
        return `<li class="${term ? "term" : ""}${unc ? " unc" : ""}"><button type="button" class="srow" data-code="${c}"><span class="sn">${i + 1}</span><span class="tick" aria-hidden="true"></span><span class="code">${c}</span>` +
          `<span class="sname">${esc(s.name)}${unc ? '<span class="q" title="Listed by some sources only">unconfirmed</span>' : ""}</span><span class="sx">${times || (i === 0 ? "From" : i === n - 1 ? "To" : "")}</span></button></li>`;
      }).join("")}</ol>` +
      (fwd || rev ? `<p class="strip-foot">Times: ${[fwd && `${fwd.num} (${esc(stName(fwd.from))} first)`, rev && `${rev.num} (${esc(stName(rev.from))} first)`].filter(Boolean).join(" / ")}.</p>` : "") +
      (r.unc.size ? `<p class="strip-foot">Halts marked unconfirmed appear in some timetables only.</p>` : "");
  }
  function renderStationView(s) {
    const p = placeOf(s.code);
    views.station.innerHTML =
      `<div class="vhead"><button class="back" type="button" data-act="back">${backLabel()}</button><button class="tomap" type="button" data-act="tomap">Map ↑</button></div>` +
      `<div class="board"><h2 class="board-name">${esc(s.name)}</h2><span class="board-code">${s.extra ? "" : s.code}</span></div>` +
      (s.extra ? `<p class="sv-meta">No Vande Bharat station. ${esc(p ? p.tip : "")}</p>` :
        `<p class="sv-meta">${esc(s.state || "")} · ${s.pairs} Vande Bharat train ${s.pairs === 1 ? "pair stops" : "pairs stop"} here</p>` +
        `<div class="sv-actions"><button class="btn" type="button" data-plan="from" data-code="${s.code}">Plan a journey from here</button><button class="btn" type="button" data-plan="to" data-code="${s.code}">Plan a journey to here</button></div>`) +
      (p ? placeCard(p, "What to see") : "") +
      (s.routes.length ? `<p class="group-label">Trains</p><ol class="routes">${s.routes.slice().sort(byNum).map(rowHTML).join("")}</ol>` : "");
  }

  /* ---------- Views and selection ---------- */
  function showView(name) {
    state.view = name;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
    panel.scrollTop = 0;
    if (getComputedStyle(panel).overflowY === "visible" && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start" });
  }
  function setTab(tab, opts = {}) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    state.sel = null; state.history = []; state.hover = null; state.leg = null; state.legHover = null;
    updateSelbar();
    if (tab === "circuits" && !views.circuits.innerHTML) renderCircuits();
    showView(tab);
    if (!opts.keepHash && location.hash.slice(1) !== tab) { try { history.replaceState(null, "", "#" + tab); } catch (e) { /* ignore */ } }
    refreshMap(true);
  }
  function pushHistory() { if (state.sel) state.history.push(state.sel); }
  function selectRoute(r, opts = {}) {
    if (!opts.fromBack) pushHistory();
    state.sel = { kind: "route", r };
    state.hover = null;
    renderRouteView(r);
    showView("route");
    if (map) { map.focus(); map.zoomToRoute(r); }
    updateSelbar();
  }
  function selectStation(s, opts = {}) {
    if (!opts.fromBack) pushHistory();
    state.sel = { kind: "station", s };
    state.hover = null;
    renderStationView(s);
    showView("station");
    if (map) { map.focus(); map.ensureVisible(s); }
    updateSelbar();
  }
  function clearSel(opts = {}) {
    state.sel = null; state.history = []; state.hover = null;
    showView(state.tab);
    if (map) map.focus();
    updateSelbar();
    if (map && opts.fit) map.fitOverlay();
  }
  function goBack() {
    const prev = state.history.pop();
    if (!prev) return clearSel({ fit: true });
    if (prev.kind === "route") selectRoute(prev.r, { fromBack: true });
    else selectStation(prev.s, { fromBack: true });
  }
  function updateSelbar() {
    const sel = state.sel, bar = $("selbar");
    bar.hidden = !sel;
    if (!sel) return;
    $("selbar-text").innerHTML = sel.kind === "route" ? `<b>${sel.r.nums[0]}</b>${esc(sel.r.label)}` : `<b>${sel.s.extra ? "" : sel.s.code}</b>${esc(sel.s.name)}`;
  }
  function markLegs() {
    panel.querySelectorAll(".leg").forEach((b) => b.classList.toggle("on", +b.dataset.leg === state.leg));
  }

  /* ---------- The overlay drawn on the map ---------- */
  function railCodes(route, a, b) {
    const i = route.index.get(a), j = route.index.get(b);
    const out = [];
    if (i <= j) for (let k = i; k <= j; k++) out.push(route.stops[k]);
    else for (let k = i; k >= j; k--) out.push(route.stops[k]);
    return out;
  }
  function currentOverlay() {
    if (state.tab === "connections" && state.journeys.length) {
      const j = state.journeys[state.jSel] || state.journeys[0];
      const legs = [], stops = [];
      let n = 1;
      j.legs.forEach((l) => {
        if (l.kind === "rail") {
          legs.push({ kind: "rail", codes: railCodes(l.route, l.from, l.to), num: trainNum(l), label: legText(l), idx: legs.length });
          if (!stops.length || stops[stops.length - 1].code !== l.from) stops.push({ n: n++, code: l.from, label: placeOf(l.from) ? placeOf(l.from).name : stName(l.from) });
        } else legs.push({ kind: "road", codes: [l.from, l.to], label: legText(l), idx: legs.length });
      });
      const last = j.legs[j.legs.length - 1];
      stops.push({ n: n++, code: last.to, label: placeOf(last.to) ? placeOf(last.to).name : stName(last.to) });
      // road changes: make sure both ends get a stop badge
      return { kind: "journey", legs, stops, title: "This journey" };
    }
    if (state.tab === "circuits" && state.plan) {
      const legs = [], stops = [];
      state.plan.stops.forEach((s, i) => {
        stops.push({ n: i + 1, code: s.code, label: s.place.name });
        for (const l of s.legs) {
          if (l.kind === "rail") legs.push({ kind: "rail", codes: railCodes(l.train.route, l.from, l.to), num: l.train.num, label: `${stName(l.from)} → ${stName(l.to)}`, date: fmtDay(l.day), time: l.dep && l.arr ? `${l.dep.text} → ${l.arr.text}` : "", idx: legs.length });
          else legs.push({ kind: "road", codes: [l.from, l.to], label: l.text, idx: legs.length });
        }
      });
      return { kind: "circuit", legs, stops, title: "Your circuit" };
    }
    return null;
  }
  function refreshMap(fit) {
    if (!map) return;
    map.setOverlay(currentOverlay());
    map.focus();
    if (fit) map.fitOverlay();
  }
  function focusLeg(i) {
    // rail legs are numbered in the overlay with road legs in between; map buttons use rail order
    state.leg = state.leg === i ? null : i;
    markLegs();
    if (!map) return;
    map.legFocus();
    if (state.leg != null) map.zoomToLeg(state.leg); else map.fitOverlay();
  }

  /* ---------- Panel events ---------- */
  $("q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); renderList(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
  document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    state.type = b.dataset.type;
    document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderList();
  }));
  function pickJourney(card) {
    state.jSel = +card.dataset.j; state.leg = null;
    renderResults();
    const again = panel.querySelector(`.jcard[data-j="${state.jSel}"]`);
    if (again) again.focus({ preventScroll: true });
    refreshMap(true);
    if (getComputedStyle(panel).overflowY === "visible") mapwrap.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
  panel.addEventListener("keydown", (e) => {
    const card = e.target.closest && e.target.closest(".jcard");
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pickJourney(card); }
  });
  panel.addEventListener("click", (e) => {
    const card = e.target.closest(".jcard");
    if (card && !e.target.closest("a")) { pickJourney(card); return; } // a source link opens; it does not pick the card
    if (card) return;
    const t = e.target.closest("button");
    if (!t || !panel.contains(t)) return;
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.dataset.act === "back") return goBack();
    if (t.dataset.act === "tomap") return mapwrap.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    if (t.dataset.act === "use-best") {
      state.startDay = state.scan.reduce((a, b) => (b.score > a.score ? b : a)).day;
      store.set("startDay", state.startDay);
      computeCircuit(false); renderCircuits(); refreshMap(false);
      return;
    }
    if (t.dataset.variant) { state.variant = t.dataset.variant; store.set("variant", state.variant); computeCircuit(false); renderCircuits(); refreshMap(true); return; }
    if (t.dataset.leg !== undefined && +t.dataset.leg >= 0) {
      const railIdx = +t.dataset.leg;
      const ov = currentOverlay();
      const rails = ov ? ov.legs.filter((l) => l.kind === "rail") : [];
      if (rails[railIdx]) focusLeg(rails[railIdx].idx);
      if (getComputedStyle(panel).overflowY === "visible") mapwrap.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      return;
    }
    if (t.dataset.plan) {
      const ep = endpointFromStation(ST.get(t.dataset.code));
      (t.dataset.plan === "from" ? fromBox : toBox).set(ep);
      setTab("connections");
      search();
      return;
    }
    if (t.classList.contains("rrow")) return selectRoute(ROUTES[+t.dataset.id]);
    if (t.dataset.code) { const s = ST.get(t.dataset.code); if (s) selectStation(s); }
  });
  const hoverFromPanel = (e, on) => {
    const t = e.target.closest && e.target.closest(".rrow, .srow, .strow, .leg");
    if (!t) return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    if (t.classList.contains("leg")) {
      const ov = currentOverlay();
      const rails = ov ? ov.legs.filter((l) => l.kind === "rail") : [];
      const l = rails[+t.dataset.leg];
      state.legHover = on && l ? l.idx : null;
      if (map) map.legFocus();
    } else if (t.classList.contains("rrow")) {
      state.hover = on ? ROUTES[+t.dataset.id] : null;
      if (map) map.overlay();
    } else {
      state.hoverStation = on ? ST.get(t.dataset.code) : null;
      if (map) map.overlay();
    }
  };
  panel.addEventListener("mouseover", (e) => hoverFromPanel(e, true));
  panel.addEventListener("mouseout", (e) => hoverFromPanel(e, false));
  panel.addEventListener("focusin", (e) => hoverFromPanel(e, true));
  panel.addEventListener("focusout", (e) => hoverFromPanel(e, false));
  $("sb-clear").addEventListener("click", () => clearSel({ fit: true }));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || ["q", "from", "to"].includes(document.activeElement && document.activeElement.id)) return;
    if (state.sel) goBack();
    else if (state.leg != null) { state.leg = null; markLegs(); if (map) { map.legFocus(); map.fitOverlay(); } }
  });

  /* ---------- Map ---------- */
  let map = null;
  function initMap() {
    const d3 = window.d3;
    const svg = d3.select("#map");
    const root = svg.append("g");
    const gLand = root.append("g");
    const landPath = gLand.append("path").attr("class", "land");
    const innerPath = gLand.append("path").attr("class", "inner");
    const gRoutes = root.append("g").attr("class", "routes");
    const gOv = root.append("g").attr("class", "ov-g");
    const gHits = root.append("g");
    const gOvHit = root.append("g");
    const gSel = root.append("g");
    const gSt = root.append("g");
    const gOvDots = root.append("g").attr("class", "ov-dots");
    const gSelStops = root.append("g");
    const gRing = root.append("g");
    const gStHit = root.append("g");
    const gLabels = svg.append("g");
    const gBadges = svg.append("g").attr("class", "badges");

    const projection = d3.geoConicConformal().parallels([12.472944, 35.172806]).rotate([-80, 0]);
    const path = d3.geoPath(projection);
    const landF = { type: "Feature", geometry: GEO.land };
    const innerF = { type: "Feature", geometry: GEO.inner };
    let W = 0, H = 0, T = d3.zoomIdentity;
    let OV = null, ovCodes = new Set(), ovStopCodes = new Set(), ovByImp = [];

    const drawOrder = ROUTES.slice().sort((a, b) => (a.type === "sleeper") - (b.type === "sleeper"));
    const codesD = (codes) => "M" + codes.map((c) => { const s = ST.get(c); return s.x.toFixed(1) + "," + s.y.toFixed(1); }).join("L");
    const lineD = (r) => codesD(r.stops);
    const routeSel = gRoutes.selectAll("path").data(drawOrder).join("path").attr("class", (r) => "route" + (r.type === "sleeper" ? " sl" : ""));
    const hitSel = gHits.selectAll("path").data(drawOrder).join("path").attr("class", "hit");
    const stations = byImp.slice().reverse();
    const stSel = gSt.selectAll("circle").data(stations).join("circle").attr("class", (s) => "st" + (s.term ? " term" : "") + (s.slOnly ? " sl" : ""));
    const stHitSel = gStHit.selectAll("circle").data(stations).join("circle").attr("class", "sthit");
    let legSel = gOv.selectAll("g.ov-leg"), ovDotSel = gOvDots.selectAll("circle"), ovHitSel = gOvHit.selectAll("path");

    let tipFor = null;
    function showTip(e, html, cls, key) {
      if (e.pointerType === "touch") return;
      tipFor = key;
      tip.className = "tip" + (cls ? " " + cls : "");
      tip.innerHTML = html;
      tip.hidden = false;
      moveTip(e);
    }
    function moveTip(e) {
      if (tip.hidden) return;
      const [px, py] = d3.pointer(e, mapwrap);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = px + 14, y = py + 16;
      if (x + tw > W - 8) x = px - tw - 14;
      if (y + th > H - 8) y = py - th - 12;
      tip.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`;
    }
    function hideTip(key) { if (!key || key === tipFor) { tip.hidden = true; tipFor = null; } }

    hitSel
      .on("pointerenter", (e, r) => {
        state.hover = r; overlay();
        const halts = r.stops.length - 2;
        showTip(e, `<span class="tn">${r.nums.join(" · ")}</span>${esc(r.label)}<small>${r.type === "sleeper" ? "Sleeper · " : ""}${halts} ${halts === 1 ? "halt" : "halts"} · click for stops</small>`, "", "r" + r.id);
      })
      .on("pointermove", moveTip)
      .on("pointerleave", (e, r) => { if (state.hover === r) state.hover = null; overlay(); hideTip("r" + r.id); })
      .on("click", (e, r) => { e.stopPropagation(); hideTip(); selectRoute(r); });
    stHitSel
      .on("pointerenter", (e, s) => {
        state.hoverStation = s; overlay();
        showTip(e, `<span class="bn">${esc(s.name)}</span><span class="bc">${s.code} · ${s.pairs} ${s.pairs === 1 ? "train" : "trains"}</span>`, "board", "s" + s.code);
      })
      .on("pointermove", moveTip)
      .on("pointerleave", (e, s) => { if (state.hoverStation === s) state.hoverStation = null; overlay(); hideTip("s" + s.code); })
      .on("click", (e, s) => { e.stopPropagation(); hideTip(); selectStation(s); });

    function setOverlay(ov) {
      OV = ov;
      ovCodes = new Set(ov ? ov.legs.filter((l) => l.kind === "rail").flatMap((l) => l.codes) : []);
      for (const l of ov ? ov.legs : []) for (const c of l.codes) ovCodes.add(c);
      ovStopCodes = new Set(ov ? ov.stops.map((s) => s.code) : []);
      ovByImp = byImp.filter((s) => ovCodes.has(s.code));
      $("lg-ov-text").textContent = ov ? ov.title : "";
      mapSection.classList.toggle("ov-on", !!ov);
      legSel = gOv.selectAll("g.ov-leg").data(ov ? ov.legs : []).join((enter) => {
        const g = enter.append("g");
        g.append("path").attr("class", "ov-casing");
        g.append("path").attr("class", "ov-line");
        return g;
      }).attr("class", (l) => "ov-leg " + l.kind);
      ovDotSel = gOvDots.selectAll("circle").data([...ovCodes].map((c) => ST.get(c))).join("circle").attr("class", "ov-dot");
      ovHitSel = gOvHit.selectAll("path").data(ov ? ov.legs.filter((l) => l.kind === "rail") : []).join("path").attr("class", "ovhit");
      ovHitSel
        .on("pointerenter", (e, l) => {
          state.legHover = l.idx; legFocus();
          showTip(e, `<span class="tn">${esc(l.num)}${l.date ? " · " + esc(l.date) : ""}</span>${esc(l.label)}<small>${l.time ? esc(l.time) + " · " : ""}click to zoom in</small>`, "", "l" + l.idx);
        })
        .on("pointermove", moveTip)
        .on("pointerleave", (e, l) => { if (state.legHover === l.idx) state.legHover = null; legFocus(); hideTip("l" + l.idx); })
        .on("click", (e, l) => { e.stopPropagation(); hideTip(); if (state.sel) clearSel(); state.leg = state.leg === l.idx ? null : l.idx; markLegs(); legFocus(); if (state.leg != null) zoomToLeg(l.idx); });
      project();
    }
    function project() {
      legSel.select(".ov-casing").attr("d", (l) => codesD(l.codes));
      legSel.select(".ov-line").attr("d", (l) => codesD(l.codes));
      ovHitSel.attr("d", (l) => codesD(l.codes));
      ovDotSel.attr("cx", (s) => s.x).attr("cy", (s) => s.y);
      radii();
      scheduleLabels();
    }
    function legFocus() {
      const li = state.legHover != null ? state.legHover : state.leg;
      gOv.classed("legfocus", li != null);
      legSel.classed("on", (l) => l.idx === li);
      scheduleLabels();
    }
    function zoomToLeg(i) {
      const l = OV && OV.legs[i];
      if (l) zoomToPoints(l.codes.map((c) => [ST.get(c).x, ST.get(c).y]), 8);
    }
    function fitOverlay() {
      if (!OV || state.sel) return fit();
      const pts = [...ovCodes].map((c) => [ST.get(c).x, ST.get(c).y]);
      if (pts.length) zoomToPoints(pts, 6); else fit();
    }

    svg.on("click", (e) => {
      if (e.defaultPrevented) return;
      if (state.sel) clearSel();
      else if (state.leg != null) { state.leg = null; markLegs(); legFocus(); }
    });

    const zoom = d3.zoom().scaleExtent([1, 40])
      .filter((e) => {
        if (e.type === "touchstart" && e.touches && e.touches.length < 2 && T.k <= 1.01) return false;
        return (!e.ctrlKey || e.type === "wheel") && !e.button;
      })
      .on("start", (e) => { if (e.sourceEvent && e.sourceEvent.type === "mousedown") svg.classed("dragging", true); })
      .on("zoom", (e) => {
        T = e.transform; root.attr("transform", T); radii(); scheduleLabels();
        if (tipFor && e.sourceEvent && e.sourceEvent.type !== "mousemove") hideTip();
      })
      .on("end", () => { svg.classed("dragging", false); svg.style("touch-action", T.k > 1.01 ? "none" : "pan-y"); });
    svg.call(zoom).style("touch-action", "pan-y");
    const dur = (ms) => (reduceMotion ? 0 : ms);
    $("zin").addEventListener("click", () => svg.transition().duration(dur(250)).call(zoom.scaleBy, 1.7));
    $("zout").addEventListener("click", () => svg.transition().duration(dur(250)).call(zoom.scaleBy, 1 / 1.7));
    $("zfit").addEventListener("click", () => fit());
    function fit() { svg.transition().duration(dur(500)).call(zoom.transform, d3.zoomIdentity); }
    function zoomToPoints(pts, maxK, animate = true) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const padX = 60, padTop = 50, padBottom = 80;
      const k = Math.max(1, Math.min(maxK, (W - 2 * padX) / Math.max(x1 - x0, 1), (H - padTop - padBottom) / Math.max(y1 - y0, 1)));
      const t = d3.zoomIdentity.translate(W / 2, (H + padTop - padBottom) / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      (animate ? svg.transition().duration(dur(700)) : svg).call(zoom.transform, t);
    }
    function zoomToRoute(r, animate = true) { zoomToPoints(r.stops.map((c) => [ST.get(c).x, ST.get(c).y]), 9, animate); }
    function ensureVisible(s) {
      const [x, y] = T.apply([s.x, s.y]);
      if (x < 50 || y < 50 || x > W - 50 || y > H - 70) svg.transition().duration(dur(500)).call(zoom.translateTo, s.x, s.y);
    }
    function radii() {
      const k = T.k, g = 1 + 0.22 * Math.log2(k);
      stSel.attr("r", (s) => (s.r0 * g) / k);
      stHitSel.attr("r", Math.max(6, 5 * g) / k);
      gSelStops.selectAll("circle").attr("r", (d) => ((d.term ? 5.4 : 3.9) * g) / k);
      gRing.selectAll("circle.ring").attr("r", (6.5 * g) / k);
      gRing.selectAll("circle.pulse").attr("r", (9 * g) / k);
      ovDotSel.attr("r", (2.7 * g) / k);
    }
    function focus() {
      const sel = state.sel;
      let set = null;
      if (sel && sel.kind === "route") set = new Set([sel.r.id]);
      else if (sel && sel.kind === "station") set = new Set(sel.s.routes.map((r) => r.id));
      else if (state.tab === "trains" && (state.q || state.type !== "all")) set = new Set(filtered().map((r) => r.id));
      gRoutes.classed("dim", !!set);
      routeSel.classed("on", (r) => !set || set.has(r.id));
      for (const s of ST.values()) s.off = !!set && !s.routes.some((r) => set.has(r.id));
      stSel.classed("off", (s) => s.off);
      svg.classed("ov-on", !!OV);
      gOv.classed("faded", !!sel); gOvDots.classed("faded", !!sel); gBadges.classed("faded", !!sel);
      legFocus();
      overlay();
    }
    function overlay() {
      const sel = state.sel, items = [];
      if (sel && sel.kind === "route") items.push({ r: sel.r, kind: "sel" });
      if (state.hover && !(sel && sel.kind === "route" && sel.r === state.hover)) items.push({ r: state.hover, kind: "hover" });
      const g = gSel.selectAll("g.sel").data(items, (d) => d.kind + d.r.id).join((enter) => {
        const gg = enter.append("g").attr("class", (d) => "sel " + d.kind);
        gg.append("path").attr("class", "casing");
        gg.append("path").attr("class", "line");
        return gg;
      });
      g.select(".casing").attr("d", (d) => lineD(d.r));
      g.select(".line").attr("d", (d) => lineD(d.r));
      const stops = sel && sel.kind === "route" ? sel.r.stops.map((c, i, a) => ({ s: ST.get(c), term: i === 0 || i === a.length - 1, unc: sel.r.unc.has(c) })) : [];
      gSelStops.selectAll("circle").data(stops, (d) => d.s.code).join("circle")
        .attr("class", (d) => "ss" + (d.term ? " term" : "") + (d.unc ? " unc" : "")).attr("cx", (d) => d.s.x).attr("cy", (d) => d.s.y);
      const rings = [];
      if (sel && sel.kind === "station") rings.push({ s: sel.s, cls: "ring" });
      if (state.hoverStation && !(sel && sel.kind === "station" && sel.s === state.hoverStation)) rings.push({ s: state.hoverStation, cls: "pulse" });
      gRing.selectAll("circle").data(rings, (d) => d.cls + d.s.code).join("circle").attr("class", (d) => d.cls).attr("cx", (d) => d.s.x).attr("cy", (d) => d.s.y);
      radii();
      scheduleLabels();
    }

    const ctx = document.createElement("canvas").getContext("2d");
    const widthCache = new Map();
    function textW(t, weight, size) {
      const key = weight + "|" + size + "|" + t;
      let w = widthCache.get(key);
      if (w === undefined) { ctx.font = `${weight} ${size}px Hind, system-ui, sans-serif`; w = ctx.measureText(t).width; widthCache.set(key, w); }
      return w;
    }
    function obstacles() {
      const out = [], base = mapwrap.getBoundingClientRect();
      for (const id of ["zoombar", "selbar"]) {
        const el = $(id);
        if (!el || el.hidden) continue;
        const b = el.getBoundingClientRect();
        out.push([b.left - base.left - 4, b.top - base.top - 4, b.right - base.left + 4, b.bottom - base.top + 4]);
      }
      return out;
    }
    let labelQueued = false;
    function scheduleLabels() {
      if (labelQueued) return;
      labelQueued = true;
      requestAnimationFrame(() => { labelQueued = false; labels(); });
    }
    function labels() {
      const k = T.k, g = 1 + 0.22 * Math.log2(k), sel = state.sel, placed = obstacles();
      const badges = [];
      if (OV) {
        for (const st of OV.stops) {
          const s = ST.get(st.code);
          const [x, y] = T.apply([s.x, s.y]);
          const near = badges.find((b) => Math.hypot(b.x - x, b.y - y) < 16);
          if (near) { if (!near.nums.includes(st.n)) { near.text += "·" + st.n; near.nums.push(st.n); } near.codes.push(st.code); continue; }
          badges.push({ x, y, text: String(st.n), nums: [st.n], key: st.code + st.n, codes: [st.code] });
        }
        for (const b of badges) {
          if (b.nums.length > 3) b.text = b.nums[0] + "…" + b.nums[b.nums.length - 1];
          b.w = Math.max(18, textW(b.text, 700, 10.5) + 9); b.h = 17;
          placed.push([b.x - b.w / 2 - 1, b.y - b.h / 2 - 1, b.x + b.w / 2 + 1, b.y + b.h / 2 + 1]);
        }
      }
      const badgeFor = (code) => badges.find((b) => b.codes.includes(code));
      let cands;
      if (sel && sel.kind === "route") {
        const a = sel.r.stops;
        cands = a.map((c, i) => ({ s: ST.get(c), pri: i === 0 || i === a.length - 1 ? 2 : 1, focus: true })).sort((x, y) => y.pri - x.pri);
      } else if (sel && sel.kind === "station") {
        const m = new Map([[sel.s.code, { s: sel.s, pri: 3, focus: true }]]);
        for (const r of sel.s.routes) { const last = r.stops.length - 1; r.stops.forEach((c, i) => { if (!m.has(c)) m.set(c, { s: ST.get(c), pri: i === 0 || i === last ? 2 : 0 }); }); }
        cands = [...m.values()].sort((x, y) => y.pri - x.pri || y.s.imp - x.s.imp);
      } else if (OV) {
        cands = [];
        const seen = new Set();
        const add = (c) => { const key = c.key || c.s.code; if (seen.has(key)) return; seen.add(key); cands.push(c); };
        const li = state.legHover != null ? state.legHover : state.leg;
        if (li != null && OV.legs[li]) OV.legs[li].codes.forEach((c, i, a) => { if (!ovStopCodes.has(c)) add({ s: ST.get(c), pri: i === 0 || i === a.length - 1 ? 2 : 1, focus: true }); });
        const names = new Set();
        for (const st of OV.stops) {
          if (names.has(st.label)) continue;
          names.add(st.label);
          const b = badgeFor(st.code);
          add({ s: ST.get(st.code), key: "city-" + st.n, text: st.label, city: true, pri: 3, rx: b ? b.w / 2 + 3 : 10, ry: 11 });
        }
        const limitB = k < 1.8 ? 0 : Math.round(6 * Math.pow(k, 1.5));
        ovByImp.filter((s) => !ovStopCodes.has(s.code)).slice(0, limitB).forEach((s) => add({ s, pri: 1 }));
        const limitC = k < 3 ? 0 : Math.round(4 * Math.pow(k, 1.4));
        byImp.filter((s) => !ovCodes.has(s.code) && !s.off).slice(0, limitC).forEach((s) => add({ s, pri: 0 }));
      } else {
        const limit = Math.round(14 * Math.pow(k, 1.6));
        const pool = state.q || state.type !== "all" ? byImp.filter((s) => !s.off) : byImp;
        cands = pool.slice(0, limit).map((s) => ({ s, pri: s.term ? 2 : 0 }));
      }
      const out = [], size = 11.5, h = size + 3;
      for (const c of cands) {
        const [x, y] = T.apply([c.s.x, c.s.y]);
        if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue;
        const text = c.text || c.s.name;
        const weight = c.focus || c.city || c.pri >= 2 ? 600 : 500;
        const fs = c.city ? 12.5 : c.focus ? 12 : size;
        const w = textW(text, weight, fs);
        const rr = (c.s.r0 || 2.2) * g + 3;
        const rx = c.rx != null ? c.rx : rr, ry = c.ry != null ? c.ry : rr;
        const opts = [[x + rx, y - h / 2, "start"], [x - rx - w, y - h / 2, "end"], [x - w / 2, y - ry - h + 1, "middle"], [x - w / 2, y + ry - 1, "middle"]];
        for (const [lx, ly, anchor] of opts) {
          const box = [lx - 2, ly, lx + w + 2, ly + h];
          if (box[0] < 4 || box[2] > W - 4 || box[1] < 4 || box[3] > H - 4) continue;
          let hit = false;
          for (const b of placed) { if (b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1]) { hit = true; break; } }
          if (hit) continue;
          placed.push(box);
          out.push({ key: c.key || c.s.code, text, x: anchor === "start" ? lx : anchor === "end" ? lx + w : lx + w / 2, y: ly + h / 2, anchor, cls: "lbl" + (c.city ? " city" : c.focus ? " focus" : c.pri >= 2 ? " term" : "") });
          break;
        }
      }
      gLabels.selectAll("text").data(out, (d) => d.key).join("text")
        .attr("class", (d) => d.cls).attr("x", (d) => d.x.toFixed(1)).attr("y", (d) => d.y.toFixed(1)).attr("dy", "0.35em")
        .attr("text-anchor", (d) => d.anchor).text((d) => d.text);
      const bsel = gBadges.selectAll("g.badge").data(badges, (d) => d.key).join((enter) => {
        const gg = enter.append("g").attr("class", "badge");
        gg.append("rect");
        gg.append("text").attr("text-anchor", "middle").attr("dy", "0.35em");
        return gg;
      });
      bsel.attr("transform", (d) => `translate(${d.x.toFixed(1)},${d.y.toFixed(1)})`);
      bsel.select("rect").attr("x", (d) => -d.w / 2).attr("y", (d) => -d.h / 2).attr("width", (d) => d.w).attr("height", (d) => d.h).attr("rx", (d) => d.h / 2);
      bsel.select("text").text((d) => d.text);
    }

    function layout() {
      const b = mapwrap.getBoundingClientRect();
      const nw = Math.max(240, Math.round(b.width)), nh = Math.max(240, Math.round(b.height));
      if (nw === W && nh === H) return;
      W = nw; H = nh;
      svg.attr("viewBox", `0 0 ${W} ${H}`);
      const pad = Math.max(10, Math.min(W, H) * 0.035);
      projection.fitExtent([[pad, pad], [W - pad, H - pad]], landF);
      landPath.attr("d", path(landF));
      innerPath.attr("d", path(innerF));
      for (const s of ST.values()) { const p = projection([s.lon, s.lat]); s.x = p[0]; s.y = p[1]; }
      routeSel.attr("d", lineD);
      hitSel.attr("d", lineD);
      stSel.attr("cx", (s) => s.x).attr("cy", (s) => s.y);
      stHitSel.attr("cx", (s) => s.x).attr("cy", (s) => s.y);
      zoom.extent([[0, 0], [W, H]]).translateExtent([[0, 0], [W, H]]);
      svg.call(zoom.transform, d3.zoomIdentity);
      project();
      overlay();
      if (state.sel && state.sel.kind === "route") zoomToRoute(state.sel.r, false);
      else if (OV) fitOverlay();
    }
    let resizeQueued = false;
    new ResizeObserver(() => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => { resizeQueued = false; layout(); });
    }).observe(mapwrap);
    layout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { widthCache.clear(); scheduleLabels(); });
    return { focus, overlay, setOverlay, legFocus, fitOverlay, fit, zoomToRoute, zoomToLeg, ensureVisible };
  }

  /* ---------- Boot ---------- */
  computeCircuit(false);
  renderList();
  const savedFrom = resolve(store.get("from", "") || "Mumbai") || resolve("Mumbai");
  const savedTo = resolve(store.get("to", "") || "Srinagar") || resolve("Srinagar");
  fromBox.set(savedFrom);
  toBox.set(savedTo);
  state.journeys = findJourneys(net, expand(state.from), expand(state.to), { maxChanges: state.maxChanges, allowRoad: state.allowRoad, limit: 8 });
  renderResults();
  renderDest();
  if (window.d3) {
    try { map = initMap(); } catch (err) { console.error(err); }
  }
  if (!map) { const m = $("map-msg"); m.hidden = false; m.textContent = "The map could not load in this browser. Connections, circuits and the train list still work."; }

  // Routing: #connections, #circuits, #trains, a train number (#22435) or a station code (#NDLS)
  function route() {
    const h = decodeURIComponent((location.hash || "").slice(1)).trim();
    if (["connections", "circuits", "trains"].includes(h)) { if (state.tab !== h || state.sel) setTab(h, { keepHash: true }); return; }
    if (/^\d{5}$/.test(h)) {
      const r = ROUTES.find((x) => x.numbers.has(h));
      if (r) { if (state.tab !== "trains") setTab("trains", { keepHash: true }); selectRoute(r); return; }
    }
    const s = ST.get(h.toUpperCase());
    if (s && !s.extra) { if (state.tab !== "trains") setTab("trains", { keepHash: true }); selectStation(s); return; }
    if (!h) setTab("connections", { keepHash: true });
  }
  window.addEventListener("hashchange", route);
  route();
  if (!location.hash) refreshMap(true);

  // Installable on phones when served from a real site (service workers don't run inside previews)
  const pwa = document.querySelector("link[data-pwa]");
  if (pwa && "serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* not available here */ });
  }
}

boot();
