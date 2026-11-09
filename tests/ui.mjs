// Browser checks: the site as a visitor uses it, under its own content security policy.
//   node tests/ui.mjs                   the working copy, served from this folder, with the pages and GTFS feed
//                                       that tools/build-pages.mjs and tools/build-gtfs.mjs built, if they are there
//   node tests/ui.mjs --dir=site        the site as it will be published (tools/assemble.mjs builds the folder)
//   node tests/ui.mjs --live [address]  the published site (https://syaamantakdas.github.io/IVB/ unless given);
//                                       also checks that it runs the code on main and that its timetables are fresh
//   --browser=webkit                    Safari's engine (or firefox; chromium unless given)
//   --shots=<folder>                    saves screenshots of the main views there, and of any check that fails
// Needs Playwright with the browser (npx playwright install webkit), and axe-core for the accessibility checks.
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve, sep } from "node:path";
import { hashOf } from "../tools/stamp.mjs";

const require = createRequire(import.meta.url);
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BROWSER = flag("browser") || "chromium";
const SHOTS = flag("shots");
const engine = require("playwright")[BROWSER];
if (!engine) throw new Error(`no browser called ${BROWSER}: chromium, webkit or firefox`);
let AXE = null;
try {
  AXE = require.resolve("axe-core/axe.min.js");
} catch {
  /* accessibility checks skipped */
}

const SITE = "https://syaamantakdas.github.io/IVB/"; // where the sitemap says the pages are
const liveAt = process.argv.indexOf("--live");
const LIVE = liveAt > 0;
const given = process.argv[liveAt + 1];
let base = LIVE ? (given && !given.startsWith("--") ? given : SITE).replace(/\/?$/, "/") : "";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = flag("dir");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml",
  ".zip": "application/zip",
};
let server = null;
if (!LIVE) {
  // a folder as published, or else the working copy with the generated pages in pages/ laid over it
  const dirs = DIR ? [resolve(DIR)] : [root, join(root, "pages")];
  server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    for (const dir of dirs) {
      const file = resolve(dir, "." + path);
      if (!file.startsWith(dir + sep)) break;
      try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
        return;
      } catch {
        /* not here: try the next folder */
      }
    }
    res.writeHead(404).end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/`;
}
console.log(`Checking ${LIVE ? "the published site" : DIR ? DIR : "the working copy"} at ${base} in ${BROWSER}`);

let failures = 0,
  passes = 0;
const ok = (cond, msg) => {
  if (cond) passes++;
  else {
    failures++;
    console.log("  FAIL", msg);
  }
};
const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `  WARN ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a Monday at least this many days ahead, as YYYY-MM-DD
const monday = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
};
// fetch, trying again when the server is busy or the network drops
async function get(url, method = "GET") {
  let last = "no answer";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { "User-Agent": "IVB-site-check/1.0 (+https://github.com/SyaamantakDas/IVB)" },
      });
      if (res.status < 500 && res.status !== 429) return res;
      last = res.status;
    } catch (e) {
      last = e.message;
    }
    await sleep(3000 * (attempt + 1));
  }
  return { ok: false, status: last };
}

const browser = await engine.launch();
const problems = [];
let current = null; // the page a check is looking at, for a screenshot if it fails
async function open(path, opts = {}) {
  if (BROWSER === "firefox") delete opts.isMobile; // Firefox has no mobile mode; the size and touch still apply
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  current = page;
  page.on("console", (m) => {
    // WebKit reports the style Playwright adds to take a screenshot, which the site's policy refuses: not the site's
    const shooting = SHOTS && BROWSER === "webkit" && /^Refused to apply a stylesheet/.test(m.text());
    if (m.type() === "error" && !shooting) problems.push(`${path}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${path}: ${e.message}`));
  await page.goto(base + path);
  return page;
}
// axe-core's findings on an open page (it needs the page's own content security policy bypassed to load)
const axe = async (p) => {
  await p.addScriptTag({ path: AXE });
  return p.evaluate(async () =>
    (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map(
      (x) => `${x.id} (${x.nodes.length})`,
    ),
  );
};
const shot = async (p, name, clip) => {
  if (!SHOTS || !p || p.isClosed()) return;
  mkdirSync(SHOTS, { recursive: true });
  // caret: "initial" stops Playwright adding a style of its own, which the site's policy would rightly refuse
  await p
    .screenshot({ path: join(SHOTS, `${BROWSER}-${name}.jpg`), clip, type: "jpeg", quality: 70, caret: "initial" })
    .catch(() => null);
};
// each group of checks: one that throws (a page that never shows what it should) counts as a failure, with a
// screenshot, and the rest still run
async function section(name, fn) {
  console.log(name);
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: ${String(e.message).split("\n")[0]}`);
    await shot(current, `failed-${name.toLowerCase().replace(/\W+/g, "-")}`);
  }
}
// the light-or-dark switch: three options in a row, each about 32 by 28 pixels
const sideBySide = (p) =>
  p.$$eval(".theme label", (ls) => {
    const r = ls.map((l) => l.getBoundingClientRect());
    return (
      r.length === 3 &&
      r.every(
        (b) => b.width > 20 && b.width < 50 && b.height > 20 && b.height < 50 && Math.abs(b.top - r[0].top) < 2,
      ) &&
      r[0].right <= r[1].left + 1 &&
      r[1].right <= r[2].left + 1
    );
  });
const trackLoaded = (p) =>
  p.waitForFunction(() => /track/.test(document.getElementById("lg-note").textContent), null, { timeout: 15000 });

await section("Map", async () => {
  const p = await open("index.html");
  await p.waitForSelector("path.route");
  ok((await p.$$("path.route")).length >= 80, "the map draws every route");
  await trackLoaded(p);
  ok(
    await p.$eval("path.route", (e) => e.getAttribute("d").split("L").length > 20),
    "routes follow the track once the lines load",
  );
  await shot(p, "map");
  ok(/^\d+$/.test(await p.$eval("#n-pairs", (e) => e.textContent.trim())), "the tally counts the trains");
  await p.click("#zin");
  await p.waitForTimeout(400);
  ok(/scale\(/.test(await p.$eval("svg#map > g", (g) => g.getAttribute("transform") || "")), "the zoom button zooms");
  await p.context().close();
});

await section("Connections", async () => {
  const p = await open("index.html?from=Chennai&to=Mysuru");
  await p.waitForSelector(".jcard");
  ok(/Direct/.test(await p.$eval(".jcard .jsum", (e) => e.textContent)), "Chennai to Mysuru: a direct train first");
  ok(/20607/.test(await p.$eval(".jcard.open", (e) => e.textContent)), "Chennai to Mysuru: the 20607");
  await shot(p, "connections");
  const second = (await p.$$(".jsum[role=button]"))[1];
  await second.focus();
  await p.keyboard.press("Enter");
  ok(
    await p.$eval('.jcard[data-j="1"] .jsum', (e) => e.getAttribute("aria-expanded") === "true"),
    "Enter opens a journey from the keyboard",
  );
  await p.context().close();
});

await section("Dated journeys", async () => {
  const iso = monday(1);
  const p = await open(`index.html?from=Chennai&to=Mysuru&on=${iso}`);
  await p.waitForSelector(".jcard");
  ok(
    /Leaving on|leaves on/.test(await p.$eval(".res-head", (e) => e.textContent)),
    "a date lists the trains leaving that day",
  );
  ok(
    /Booking (opens|is open)/.test(await p.$eval(".jcard.open", (e) => e.textContent)),
    "each ride says when its booking opens",
  );
  ok(new URL(p.url()).searchParams.get("on") === iso, "the date goes into the link");
  await p.context().close();
});

await section("Your own circuit", async () => {
  // far enough ahead that no ride is on sale yet (tickets go on sale 60 days ahead), so there are dates to remind of
  const p = await open(`index.html?loop=own&stops=delhi.2,agra.1,varanasi.2&date=${monday(70)}#circuits`);
  await p.waitForSelector(".own-list");
  ok((await p.$$(".own-list li")).length === 3, "the link sets the places");
  await p.selectOption("#own-add", "goa");
  await p.waitForFunction(() => document.querySelectorAll(".own-list li").length === 4);
  ok(/goa\.1/.test(decodeURIComponent(p.url())), "an added place goes into the link");
  await shot(p, "circuit");
  ok(!/cannot make/.test(await p.$eval("#v-circuits", (e) => e.textContent)), "Vande Bharats make every hop");
  const [dl] = await Promise.all([
    p.waitForEvent("download", { timeout: 5000 }).catch(() => null),
    p.click('[data-act="ics"]'),
  ]);
  ok(dl && /\.ics$/.test(dl.suggestedFilename()), "the booking calendar downloads");
  await p.context().close();
});

await section("Trains", async () => {
  const p = await open("index.html#trains");
  await p.fill("#q", "22435");
  await p.waitForTimeout(300);
  ok(/22435/.test(await p.$eval("#v-trains", (e) => e.textContent)), "searching a number finds the train");
  await p.context().close();
});

await section("Phone", async () => {
  const p = await open("index.html?from=Mumbai&to=Goa", {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await p.waitForSelector(".jcard");
  ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "nothing runs off the side of a phone",
  );
  ok(await p.isVisible(".theme"), "the light-or-dark switch is there on a phone");
  ok(await sideBySide(p), "its three options sit side by side");
  await shot(p, "phone");
  await p.context().close();
});

await section("Light or dark", async () => {
  const LIGHT = "rgb(237, 241, 246)",
    DARK = "rgb(10, 17, 29)";
  const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const pick = (p, v) => p.check(`input[name="ivb-theme"][value="${v}"]`);
  const chosen = (p) => p.$eval('input[name="ivb-theme"]:checked', (e) => e.value);
  const ready = (p) => p.waitForSelector(".theme:not([hidden])");
  const p = await open("index.html", { colorScheme: "dark" }); // a device set to dark
  await ready(p);
  ok(await sideBySide(p), "the switch's three options sit side by side, each the size of an icon");
  ok((await chosen(p)) === "auto" && (await bg(p)) === DARK, "the switch starts on the device's setting");
  await pick(p, "light");
  ok((await bg(p)) === LIGHT, "Light turns the page light on a dark device");
  await shot(p, "masthead-light", { x: 0, y: 0, width: 1280, height: 160 });
  // the choice is in place before the page's body arrives, so the page never shows the wrong colours first
  await p.addInitScript(() => {
    new MutationObserver((_, obs) => {
      if (!document.body) return;
      window.themeAtBody = document.documentElement.dataset.theme || "auto";
      obs.disconnect();
    }).observe(document, { childList: true, subtree: true }); // from before the page has any elements
  });
  await p.reload();
  await ready(p);
  ok((await chosen(p)) === "light" && (await bg(p)) === LIGHT, "the choice is remembered");
  ok((await p.evaluate(() => window.themeAtBody)) === "light", "and applied before the page is drawn");
  await p.focus('input[name="ivb-theme"]:checked');
  await p.keyboard.press("ArrowRight");
  ok((await chosen(p)) === "auto" && (await bg(p)) === DARK, "the arrow keys move to the device's setting");
  await shot(p, "masthead-dark", { x: 0, y: 0, width: 1280, height: 160 });
  // the plain pages follow the choice, and a choice made on one page reaches the others
  if (LIVE || (await get(base + "privacy/")).ok) {
    const q = await p.context().newPage();
    q.on("console", (m) => m.type() === "error" && problems.push(`privacy/: ${m.text()}`));
    q.on("pageerror", (e) => problems.push(`privacy/: ${e.message}`));
    await pick(p, "light");
    await q.goto(base + "privacy/");
    await ready(q);
    ok((await chosen(q)) === "light" && (await bg(q)) === LIGHT, "a plain page follows the choice");
    await shot(q, "plain-page", { x: 0, y: 0, width: 1280, height: 300 });
    await pick(q, "dark");
    await p
      .waitForFunction(() => document.documentElement.dataset.theme === "dark", null, { timeout: 3000 })
      .catch(() => null);
    ok(
      (await bg(q)) === DARK && (await bg(p)) === DARK && (await chosen(p)) === "dark",
      "and a choice there reaches the app",
    );
  }
  await p.context().close();
});

if (AXE)
  await section("Accessibility (axe-core)", async () => {
    for (const [path, wait] of [
      ["index.html?from=Mumbai&to=Varanasi", ".jcard"],
      ["index.html?loop=own&stops=delhi.2,agra.1#circuits", ".own-list"],
      ["index.html#trains", "#q"],
    ]) {
      for (const colorScheme of ["light", "dark"]) {
        const p = await open(path, { bypassCSP: true, colorScheme });
        await p.waitForSelector(wait);
        const v = await axe(p);
        ok(v.length === 0, `${path} in ${colorScheme}: ${v.join(", ")}`);
        await p.context().close();
      }
    }
  });

await section("Sitemap and generated pages", async () => {
  const sitemap = await get(base + "sitemap.xml");
  if (!sitemap.ok && !LIVE) {
    console.log("  skipped: none built (node tools/build-pages.mjs pages)");
    return;
  }
  ok(sitemap.ok, `the sitemap answers (${sitemap.status})`);
  const locs = sitemap.ok ? [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]) : [];
  ok(locs.length >= 1000, `the sitemap lists every page (${locs.length})`);
  ok(
    locs.every((u) => u.startsWith(SITE)),
    "every address in the sitemap is on the site",
  );
  const rel = (u) => u.slice(SITE.length);
  // every address answers: a few at a time, with HEAD, so as to be gentle with the server (once, in Chromium:
  // the answer does not depend on the browser)
  const bad = [];
  let next = BROWSER === "chromium" ? 0 : locs.length;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < locs.length) {
        const u = locs[next++];
        const res = await get(base + rel(u), "HEAD");
        if (!res.ok) bad.push(`${rel(u) || "/"} (${res.status})`);
      }
    }),
  );
  ok(
    bad.length === 0,
    `every address in the sitemap answers: ${bad.slice(0, 10).join(", ")}${bad.length > 10 ? ` and ${bad.length - 10} more` : ""}`,
  );
  // one page of each kind: it has its heading and no errors under its policy (no script but the light-or-dark
  // switch), and passes axe
  const kinds = ["train/", "station/", "place/", "go/", "loop/", "browse/", "privacy/"];
  const samples = kinds.map((k) => locs.map(rel).find((p) => p.startsWith(k))).filter(Boolean);
  ok(samples.length === kinds.length, `the sitemap has a page of every kind (${samples.join(", ")})`);
  for (const path of samples) {
    const p = await open(path);
    ok((await p.$$("h1")).length === 1, `${path} has one main heading`);
    await p.context().close();
    if (!AXE) continue;
    for (const colorScheme of ["light", "dark"]) {
      const q = await open(path, { bypassCSP: true, colorScheme });
      const v = await axe(q);
      ok(v.length === 0, `${path} in ${colorScheme}: ${v.join(", ")}`);
      await q.context().close();
    }
  }
});

// the feed and the published files do not depend on the browser either
if (BROWSER === "chromium")
  await section("GTFS feed", async () => {
    const zip = await get(base + "gtfs/ivb-gtfs.zip");
    if (!zip.ok && !LIVE) {
      console.log("  skipped: none built (node tools/build-gtfs.mjs gtfs)");
      return;
    }
    const buf = zip.ok ? Buffer.from(await zip.arrayBuffer()) : Buffer.alloc(0);
    ok(buf.length > 10000 && buf.readUInt32LE(0) === 0x04034b50, `the feed downloads as a zip (${zip.status})`);
    const missing = ["agency", "stops", "routes", "trips", "stop_times", "calendar", "shapes", "feed_info"]
      .map((f) => f + ".txt")
      .filter((f) => !buf.includes(f));
    ok(missing.length === 0, `the feed has every file: ${missing.join(", ")} missing`);
  });

if (LIVE && BROWSER === "chromium")
  await section("The published site", async () => {
    // the published site is a checkout of main with version tags added, so without them these should match it
    const untag = (b) => Buffer.from(b.toString("utf8").replace(/\?v=[0-9a-f]{10}/g, ""));
    const files = [
      "index.html",
      "sw.js",
      "assets/app.js",
      "assets/app.css",
      "data/routes.json",
      "data/timetables.json",
    ];
    const differ = [];
    let timetables = null;
    for (const f of files) {
      const res = await get(base + f);
      const body = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      const plain = body && /\.(html|js)$/.test(f) ? untag(body) : body;
      if (!plain || !plain.equals(await readFile(join(root, f)))) differ.push(`${f} (${res.status})`);
      if (body && f === "data/timetables.json") timetables = JSON.parse(body.toString());
    }
    ok(
      differ.length === 0,
      `the site runs the code on main; these differ: ${differ.join(", ")}. Did the last deploy fail?`,
    );
    // the GTFS feed's calendar runs for 364 days from the day the timetables were checked
    const checked = timetables?.checked;
    const age = checked ? Math.floor((Date.now() - Date.parse(checked)) / 864e5) : Infinity;
    ok(age < 330, `the timetables were checked less than 330 days ago (${checked}), before the GTFS feed runs out`);
    if (age >= 90 && age < 330)
      warn(`The timetables were last checked on ${checked}, ${age} days ago: time to check them again.`);
  });

// version tags (tools/stamp.mjs): each must name the contents of the very file it points to, or a page could still
// get the styles or scripts of another version
if (BROWSER === "chromium" && (LIVE || DIR))
  await section("Version tags", async () => {
    const tags = new Map();
    const html = await (await get(base + "index.html")).text();
    for (const [, f, v] of html.matchAll(/((?:assets|vendor)\/[\w.-]+)\?v=([0-9a-f]{10})/g)) tags.set(f, v);
    const app = await (await get(base + "assets/app.js")).text();
    for (const [, f, v] of app.matchAll(/"\.\.\/(lib\/[\w-]+\.js)\?v=([0-9a-f]{10})"/g)) tags.set(f, v);
    const wrong = [];
    for (const [f, v] of tags) {
      const res = await get(base + f);
      const got = res.ok ? hashOf(Buffer.from(await res.arrayBuffer())) : res.status;
      if (got !== v) wrong.push(`${f} (tag ${v}, file ${got})`);
    }
    ok(tags.size >= 10, `the page and its modules carry version tags (${tags.size})`);
    ok(wrong.length === 0, `every version tag names its file's contents: ${wrong.join(", ")}`);
  });

ok(problems.length === 0, `no errors in the console: ${problems.join(" | ")}`);
await browser.close();
server?.close();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
