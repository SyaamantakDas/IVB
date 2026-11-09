// Builds a plain web page for every train, station, place, pair of places and circuit, and a sitemap,
// so search engines and people without JavaScript can find IVB's timetables. The app stays at the site root.
// Usage: node tools/build-pages.mjs [outDir]   (default: pages) -> outDir/train/22435/index.html and so on
// The pages workflow builds them on every change; they are not kept in the repository.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildNetwork, DAYS, legKm } from "../lib/network.js";
import { findJourneys, fewestTrains } from "../lib/finder.js";
import { schedule, seasonScan, fromISO, fmtDay, yearOf } from "../lib/schedule.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, process.argv[2] || "pages");
const load = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const timetables = load("timetables.json"),
  places = load("places.json"),
  circuits = load("circuits.json").circuits,
  events = load("events.json").events;
const net = buildNetwork({ stations: load("stations.json"), routes: load("routes.json"), timetables, places });
const { ST, ROUTES, TRAINS, PLACES } = net;

const SITE = "https://syaamantakdas.github.io/IVB/";
const CHECKED = timetables.checked;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const FULLDAY = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};
const longDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => s.toLowerCase();
const kind = (r) => (r.type === "sleeper" ? "Vande Bharat Sleeper" : "Vande Bharat Express");
const fmtKm = (km) => km.toLocaleString("en-IN") + " km";
const daysText = (days) => {
  if (days.length === 7) return "every day";
  const off = DAYS.filter((d) => !days.includes(d));
  return off.length <= 2
    ? `every day except ${off.map((d) => FULLDAY[d]).join(" and ")}`
    : `on ${days.map((d) => FULLDAY[d]).join(", ")}`;
};
const placeOf = (code) => [...PLACES.values()].find((p) => p.codes.includes(code));
const SOURCES = {
  "confirmtkt.com": "ConfirmTkt",
  "erail.in": "erail",
  "railmitra.com": "RailMitra",
  "etrain.info": "etrain",
  "cleartrip.com": "Cleartrip",
  "wikipedia.org": "Wikipedia",
  "totaltraininfo.com": "Total Train Info",
  "indianrailways.gov.in": "Indian Railways",
};
const sourceName = (u) => {
  const h = new URL(u).hostname.replace(/^www\./, "");
  const k = Object.keys(SOURCES).find((x) => h.endsWith(x));
  return k ? SOURCES[k] : h;
};

// ---------- the page frame
const pages = []; // [path, html]
function page(path, { title, description, h1, kicker, body, image, jsonld }) {
  const depth = path.split("/").filter(Boolean).length; // train/22435/ -> 2
  const up = "../".repeat(depth);
  const url = SITE + path;
  const img = SITE + (image || "assets/og-image.jpg");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="IVB: India on Vande Bharat">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#13213B">
<link rel="icon" href="${up}assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${up}assets/fonts/hind-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${up}assets/pages.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>\n` : ""}</head>
<body>
<header class="top"><a class="home" href="${up}"><img src="${up}assets/logo.svg" alt="" width="64" height="27"><span>India on Vande Bharat</span></a><nav><a href="${up}browse/">All trains and places</a></nav></header>
<main>
${kicker ? `<p class="kicker">${kicker}</p>\n` : ""}<h1>${esc(h1)}</h1>
${body}
</main>
<footer><p>IVB is an unofficial planner, not connected with Indian Railways or IRCTC. Timetables change at short notice: check NTES or IRCTC before you travel.</p>
<p>© 2026 Syaamantak Das. Data under the <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>; track lines © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>. <a href="https://github.com/SyaamantakDas/IVB">Source and data</a> · <a href="${up}privacy/">Privacy</a>.</p></footer>
</body>
</html>
`;
  pages.push([path, html]);
}
const link = (from, path, text) =>
  `<a href="${"../".repeat(from.split("/").filter(Boolean).length)}${path}">${text}</a>`;
const trainPath = (num) => `train/${num}/`;
const stationPath = (code) => `station/${slug(code)}/`;
const placePath = (id) => `place/${id}/`;
const pairPath = (a, b) => `go/${a}-to-${b}/`;
const appLink = (from, query, text) =>
  `<a class="btn" href="${"../".repeat(from.split("/").filter(Boolean).length)}${query}">${text}</a>`;

// ---------- trains
const trainsSorted = [...TRAINS.values()].sort((a, b) => a.num.localeCompare(b.num));
const timeAt = (t, code) => {
  const x = t.times[code];
  return x && (x.dep || x.arr);
};
const order = (t) => (t.forward === false ? [...t.route.stops].reverse() : t.route.stops).filter((c) => t.times[c]);
const returnOf = (t) =>
  trainsSorted.find((u) => u !== t && u.route === t.route && u.forward !== t.forward && u.from === t.to) ||
  trainsSorted.find((u) => u !== t && u.route === t.route && u.forward !== t.forward);
for (const t of trainsSorted) {
  const path = trainPath(t.num),
    r = t.route,
    seq = order(t);
  const first = seq[0],
    last = seq[seq.length - 1];
  const a = timeAt(t, first),
    b = t.times[last].arr || t.times[last].dep;
  const k0 = r.index.get(first);
  const rows = seq
    .map((c, i) => {
      const x = t.times[c],
        ki = r.index.get(c);
      const day = (x.arr || x.dep).day + 1;
      return `<tr><td>${link(path, stationPath(c), esc(ST.get(c).name))} <span class="code">${c}</span></td><td class="t">${x.arr && i ? x.arr.text : "–"}</td><td class="t">${x.dep && i < seq.length - 1 ? x.dep.text : "–"}</td><td class="t">${day}</td><td class="t">${fmtKm(legKm(r, k0, ki))}</td></tr>`;
    })
    .join("");
  const back = returnOf(t);
  const name = `${t.num} ${ST.get(first).name} – ${ST.get(last).name} ${kind(r)}`;
  const dur = b.min + b.day * 1440 - a.min;
  const srcs = t.src.map((u) => `<a href="${esc(u)}">${esc(sourceName(u))}</a>`);
  const pf = placeOf(first),
    pl = placeOf(last);
  page(path, {
    title: `${t.num} ${ST.get(first).name} to ${ST.get(last).name} Vande Bharat: timetable and days`,
    description: `${name}: leaves ${ST.get(first).name} at ${a.text} and reaches ${ST.get(last).name} at ${b.text}${b.day ? " the next day" : ""}, ${daysText(t.days)}. ${seq.length - 2} halts, ${fmtKm(legKm(r, k0, r.index.get(last)))} by rail.`,
    kicker: r.type === "sleeper" ? "Vande Bharat Sleeper" : "Vande Bharat Express",
    h1: `${t.num} ${ST.get(first).name} to ${ST.get(last).name}`,
    body: `<p class="lede">Leaves ${esc(ST.get(first).name)} at <b>${a.text}</b> and reaches ${esc(ST.get(last).name)} at <b>${b.text}</b>${b.day ? " the next day" : ""}, ${daysText(t.days)}. ${Math.floor(dur / 60)} h${dur % 60 ? ` ${String(dur % 60).padStart(2, "0")} min` : ""}, ${seq.length - 2} ${seq.length - 2 === 1 ? "halt" : "halts"}, ${fmtKm(legKm(r, k0, r.index.get(last)))} by rail; ${r.type === "sleeper" ? "sleeper berths, overnight" : "chair car"}.</p>
<p class="actions">${appLink(path, `#${t.num}`, "See it on the map")}${pf && pl && pf !== pl ? appLink(path, `?from=${encodeURIComponent(pf.name)}&to=${encodeURIComponent(pl.name)}`, "Plan a journey") : ""}</p>
<table><caption>Timetable</caption><thead><tr><th>Station</th><th>Arrives</th><th>Leaves</th><th>Day</th><th>Distance</th></tr></thead><tbody>${rows}</tbody></table>
${t.note ? `<p class="note">${esc(t.note)}</p>` : ""}
${back ? `<p>The return train is ${link(path, trainPath(back.num), back.num)}, ${esc(ST.get(back.from).name)} to ${esc(ST.get(back.to).name)}.</p>` : ""}
<p class="src">Checked ${longDate(t.checked)} against ${srcs.length > 1 ? srcs.slice(0, -1).join(", ") + " and " + srcs[srcs.length - 1] : srcs[0]}. Distances are measured along the track. Something wrong? <a href="https://github.com/SyaamantakDas/IVB/issues/new?template=timetable-problem.yml&amp;title=${encodeURIComponent(`Train ${t.num}: `)}&amp;train=${t.num}">Report a problem</a>.</p>`,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "TrainTrip",
      name,
      trainNumber: t.num,
      trainName: kind(r),
      departureStation: { "@type": "TrainStation", name: ST.get(first).name },
      arrivalStation: { "@type": "TrainStation", name: ST.get(last).name },
      departureTime: a.text,
      arrivalTime: b.text,
      provider: { "@type": "Organization", name: "Indian Railways" },
    },
  });
}

// ---------- stations
const stationsSorted = [...ST.values()].filter((s) => s.routes.length).sort((a, b) => a.name.localeCompare(b.name));
for (const s of stationsSorted) {
  const path = stationPath(s.code);
  const calls = trainsSorted
    .filter((t) => t.times[s.code])
    .map((t) => {
      const seq = order(t),
        x = t.times[s.code],
        i = seq.indexOf(s.code);
      const toward = i === seq.length - 1 ? `from ${ST.get(seq[0]).name}` : `to ${ST.get(seq[seq.length - 1]).name}`;
      return { t, x, i, toward, sort: (x.dep || x.arr).min };
    })
    .sort((a, b) => a.sort - b.sort);
  const rows = calls
    .map(
      ({ t, x, i, toward }) =>
        `<tr><td class="t">${link(path, trainPath(t.num), t.num)}</td><td>${esc(toward)}</td><td class="t">${x.arr && i ? x.arr.text : "–"}</td><td class="t">${x.dep ? x.dep.text : "–"}</td><td>${esc(daysText(t.days))}</td></tr>`,
    )
    .join("");
  const p = placeOf(s.code);
  const near = s.near
    .filter((n) => ST.get(n.code).routes.length)
    .map((n) => `${link(path, stationPath(n.code), esc(ST.get(n.code).name))} (about ${n.km} km)`);
  page(path, {
    title: `Vande Bharat trains at ${s.name} (${s.code}): times and days`,
    description: `Every Vande Bharat train that calls at ${s.name} (${s.code}), ${s.state}: ${calls.length} ${calls.length === 1 ? "train" : "trains"}, with times and the days each runs.`,
    kicker: `${esc(s.state)} · ${s.code}`,
    h1: `Vande Bharat trains at ${s.name}`,
    body: `<p class="lede">${calls.length} Vande Bharat ${calls.length === 1 ? "train calls" : "trains call"} at ${esc(s.name)}${p ? `, one of the stations for ${link(path, placePath(p.id), esc(p.name))}` : ""}.</p>
<p class="actions">${appLink(path, `#${s.code}`, "See it on the map")}</p>
<table><caption>Trains, by time of day</caption><thead><tr><th>Train</th><th>Going</th><th>Arrives</th><th>Leaves</th><th>Runs</th></tr></thead><tbody>${rows}</tbody></table>
${near.length ? `<p>Nearby, for a change of station by road: ${near.join(", ")}.</p>` : ""}`,
  });
}

// ---------- places and pairs of places
const placeList = [...PLACES.values()].filter((p) => p.codes.length).sort((a, b) => a.name.localeCompare(b.name));
const monthsText = (p, v) => MONTHS.filter((m, i) => p.months[i] === v).map((m) => m.slice(0, 3));
const pairCache = new Map();
function pairJourneys(a, b) {
  const key = a.id + ">" + b.id;
  if (!pairCache.has(key)) pairCache.set(key, findJourneys(net, a.codes, b.codes, { maxChanges: 6, limit: 3 }));
  return pairCache.get(key);
}
const legLine = (path, l) => {
  if (l.kind === "road")
    return `<li class="road">${esc(ST.get(l.from).name)} to ${esc(ST.get(l.to).name)} by road, about ${l.km} km</li>`;
  const num = l.train ? l.train.num : l.route.nums[0].split("/")[0];
  return `<li>${link(path, trainPath(num), num)} ${esc(ST.get(l.from).name)} → ${esc(ST.get(l.to).name)}${l.dep && l.arr ? `, ${l.dep.text} → ${l.arr.text}${l.arr.day > l.dep.day ? " next day" : ""}` : ""}${l.days ? `, ${esc(daysText(l.days))}` : ""}</li>`;
};
for (const p of placeList) {
  const path = placePath(p.id);
  const from = placeList
    .filter((q) => q !== p)
    .map((q) => ({ q, f: fewestTrains(net, new Set(q.codes), new Set(p.codes.filter((c) => !q.codes.includes(c)))) }))
    .filter((x) => x.f)
    .sort((x, y) => x.f.trains - y.f.trains || x.q.name.localeCompare(y.q.name));
  const trains = trainsSorted.filter((t) => p.codes.some((c) => t.times[c]));
  page(path, {
    title: `${p.name} by Vande Bharat: trains, what to see and when to go`,
    description: `${p.name}, ${p.state}: what to see, the best months to visit, and the Vande Bharat trains that call there (${trains.length}), with journeys from ${from.length} other places on Vande Bharats alone.`,
    kicker: esc(p.state),
    h1: `${p.name} by Vande Bharat`,
    body: `<h2>What to see</h2><ul>${p.see.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p>${esc(p.tip)}</p>
<h2>When to go</h2><p>Best: ${monthsText(p, "2").join(", ") || "–"}. Fair: ${monthsText(p, "1").join(", ") || "–"}. Better avoided: ${monthsText(p, "0").join(", ") || "–"}.</p>
<h2>Stations</h2><p>${p.codes.map((c) => link(path, stationPath(c), `${esc(ST.get(c).name)} <span class="code">${c}</span>`)).join(", ")}</p>
<h2>Vande Bharat trains</h2><ul class="cols">${trains.map((t) => `<li>${link(path, trainPath(t.num), t.num)} ${esc(ST.get(t.from).name)} to ${esc(ST.get(t.to).name)}</li>`).join("")}</ul>
<h2>Getting here on Vande Bharats alone</h2><ul class="cols">${from.map(({ q, f }) => `<li>${link(path, pairPath(q.id, p.id), `From ${esc(q.name)}`)}: ${f.trains === 1 ? "direct" : `${f.trains} trains`}</li>`).join("")}</ul>`,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "TouristDestination",
      name: p.name,
      address: { "@type": "PostalAddress", addressRegion: p.state, addressCountry: "IN" },
      touristType: "Rail travellers",
    },
  });
}
for (const a of placeList)
  for (const b of placeList) {
    if (a === b) continue;
    const path = pairPath(a.id, b.id);
    const js = pairJourneys(a, b);
    if (!js.length) continue;
    const best = js[0];
    const cards = js
      .map(
        (j) =>
          `<li><b>${j.trains === 1 ? "Direct" : `${j.trains} trains`}</b>, ${fmtKm(j.km)}${j.nights ? `, ${j.nights} ${j.nights === 1 ? "night" : "nights"} on the way` : ""}<ol>${j.legs.map((l) => legLine(path, l)).join("")}</ol></li>`,
      )
      .join("");
    page(path, {
      title: `${a.name} to ${b.name} by Vande Bharat`,
      description: `${a.name} to ${b.name} on Vande Bharat trains alone: ${best.trains === 1 ? "a direct train" : `${best.trains} trains`}, ${fmtKm(best.km)} by rail. Times, days and changes for each way.`,
      kicker: "Journey",
      h1: `${a.name} to ${b.name} by Vande Bharat`,
      body: `<p class="lede">${best.trains === 1 ? "A direct Vande Bharat makes this journey." : `The fewest Vande Bharats that make this journey is ${best.trains}.`} ${js.length > 1 ? "The ways with the fewest trains:" : ""}</p>
<ol class="ways">${cards}</ol>
<p class="actions">${appLink(path, `?from=${encodeURIComponent(a.name)}&to=${encodeURIComponent(b.name)}`, "Pick a date and see the trains")}</p>
<p>More about ${link(path, placePath(a.id), esc(a.name))} and ${link(path, placePath(b.id), esc(b.name))}. The way back: ${link(path, pairPath(b.id, a.id), `${esc(b.name)} to ${esc(a.name)}`)}.</p>`,
    });
  }

// ---------- circuits
const IMAGES = { loop: "assets/og-loop.jpg", "loop-east": "assets/og-east.jpg" };
for (const c of circuits) {
  const path = `loop/${c.id}/`;
  const scan = seasonScan(net, c.stops, fromISO(CHECKED), 24, events);
  const best = scan.reduce((x, y) => (y.score > x.score ? y : x));
  const plan = schedule(net, c.stops, best.day, events);
  const stops = plan.stops
    .map(
      (s) =>
        `<li>${link(path, placePath(s.place.id), esc(s.place.name))}${s.first ? " (start)" : `, ${s.nightsActual ? `${s.nightsActual} ${s.nightsActual === 1 ? "night" : "nights"}` : "day stop"}`}</li>`,
    )
    .join("");
  page(path, {
    title: `${c.name}: India by Vande Bharat`,
    description: `${c.blurb} ${plan.days} days, ${plan.rides} train rides, ${plan.stops.length - 1} stops, all on Vande Bharat trains.`,
    kicker: "Circuit",
    h1: c.name,
    image: IMAGES[c.id],
    body: `<p class="lede">${esc(c.blurb)} ${plan.days} days, ${plan.rides} train rides and ${plan.stops.length - 1} stops, on Vande Bharat trains alone, leaving ${esc(plan.stops[0].place.name)} on ${fmtDay(plan.start)} ${yearOf(plan.start)}, the best start for the weather.</p>
<p class="actions">${appLink(path, `?loop=${c.id}#circuits`, "Plan it with your dates")}</p>
<ol class="cols">${stops}</ol>`,
  });
}

// ---------- privacy: what IVB keeps (nothing), for visitors and for the Play Store listing
page("privacy/", {
  title: "Privacy: IVB collects no personal data",
  description:
    "IVB, the website and the Android app, collects no personal data: no accounts, analytics, advertising or cookies. Your choices stay on your device.",
  kicker: "Privacy",
  h1: "IVB collects no personal data",
  body: `<p class="lede">IVB, the website and the Android app, has no accounts, no analytics, no advertising and no cookies, and it sends nothing about you anywhere.</p>
<h2>What stays on your device</h2>
<p>The places, dates and settings you choose are kept in your browser's local storage on your own device, so IVB remembers them next time. They never leave the device. Clearing the site's data in your browser removes them.</p>
<h2>What IVB loads</h2>
<p>IVB loads only its own files, from syaamantakdas.github.io: its pages, fonts, map and timetables. It loads nothing from other servers. The site is hosted on GitHub Pages, which may record visitors' IP addresses for security; see <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub's privacy statement</a>.</p>
<h2>The Android app</h2>
<p>The app opens IVB in Chrome or another browser on your phone, as a full-screen window, so that browser's own privacy policy applies too. The app asks for no permissions and collects nothing itself.</p>
<h2>Links to other sites</h2>
<p>Links to timetable sources, IRCTC and booking sites, and the form for reporting a problem on GitHub, take you to those sites, whose own privacy policies apply.</p>
<h2>Questions</h2>
<p>Ask on <a href="https://github.com/SyaamantakDas/IVB/issues">IVB's issue tracker</a>. This page was last updated on 9 November 2026.</p>`,
});

// ---------- the index of everything, and the sitemap
{
  const path = "browse/";
  const byRoute = ROUTES.slice()
    .sort((a, b) => a.first - b.first)
    .map((r) => {
      const ts = trainsSorted.filter((t) => t.route === r);
      return `<li>${ts.map((t) => link(path, trainPath(t.num), t.num)).join(" / ")} ${esc(r.label)}${r.type === "sleeper" ? " (sleeper)" : ""}</li>`;
    })
    .join("");
  const states = [...new Set(stationsSorted.map((s) => s.state))].sort();
  page(path, {
    title: "Every Vande Bharat train, station and place",
    description: `All ${TRAINS.size} Vande Bharat trains on ${ROUTES.length} routes, ${stationsSorted.length} stations and ${placeList.length} places to visit, with timetables, days and journeys on Vande Bharats alone.`,
    kicker: `Checked ${longDate(CHECKED)}`,
    h1: "Every Vande Bharat",
    body: `<h2>Circuits</h2><ul>${circuits.map((c) => `<li>${link(path, `loop/${c.id}/`, esc(c.name))}</li>`).join("")}</ul>
<h2>Places</h2><ul class="cols">${placeList.map((p) => `<li>${link(path, placePath(p.id), esc(p.name))}</li>`).join("")}</ul>
<h2>Trains, by route</h2><ul class="cols wide">${byRoute}</ul>
<h2>Stations, by state</h2>${states
      .map(
        (st) =>
          `<h3>${esc(st)}</h3><p>${stationsSorted
            .filter((s) => s.state === st)
            .map((s) => link(path, stationPath(s.code), esc(s.name)))
            .join(", ")}</p>`,
      )
      .join("")}`,
  });
}
// clear only what this script writes, so pointing it at the site root can never delete anything else
for (const dir of ["train", "station", "place", "go", "loop", "browse", "privacy"])
  rmSync(join(out, dir), { recursive: true, force: true });
for (const [path, html] of pages) {
  mkdirSync(join(out, path), { recursive: true });
  writeFileSync(join(out, path, "index.html"), html);
}
const urls = [SITE, ...pages.map(([p]) => SITE + p)];
writeFileSync(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u}</loc><lastmod>${CHECKED}</lastmod></url>`).join("\n")}\n</urlset>\n`,
);
const count = (pre) => pages.filter(([p]) => p.startsWith(pre)).length;
console.log(
  `pages: ${count("train/")} trains, ${count("station/")} stations, ${count("place/")} places, ${count("go/")} journeys, ${count("loop/")} circuits and an index; sitemap with ${urls.length} addresses`,
);
