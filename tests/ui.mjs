// Browser checks: the site as a visitor uses it, in Chromium, under its own content security policy.
// Run with: node tests/ui.mjs   (needs Playwright with Chromium; axe-core too, for the accessibility checks)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let AXE = null;
try { AXE = require.resolve("axe-core/axe.min.js"); } catch { /* accessibility checks skipped */ }

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".zip": "application/zip" };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body); }
  catch { res.writeHead(404).end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { failures++; console.log("  FAIL", msg); } };
const browser = await chromium.launch();
const problems = [];
async function open(path, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${path}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`${path}: ${e.message}`));
  await page.goto(base + path);
  return page;
}
const trackLoaded = (p) => p.waitForFunction(() => /track/.test(document.getElementById("lg-note").textContent), null, { timeout: 15000 });

console.log("Map");
{
  const p = await open("index.html");
  await p.waitForSelector("path.route");
  ok((await p.$$("path.route")).length >= 80, "the map draws every route");
  await trackLoaded(p);
  ok(await p.$eval("path.route", (e) => e.getAttribute("d").split("L").length > 20), "routes follow the track once the lines load");
  ok(/^\d+$/.test(await p.$eval("#n-pairs", (e) => e.textContent.trim())), "the tally counts the trains");
  await p.click("#zin");
  await p.waitForTimeout(400);
  ok(/scale\(/.test(await p.$eval("svg#map > g", (g) => g.getAttribute("transform") || "")), "the zoom button zooms");
  await p.context().close();
}

console.log("Connections");
{
  const p = await open("index.html?from=Chennai&to=Mysuru");
  await p.waitForSelector(".jcard");
  ok(/Direct/.test(await p.$eval(".jcard .jsum", (e) => e.textContent)), "Chennai to Mysuru: a direct train first");
  ok(/20607/.test(await p.$eval(".jcard.open", (e) => e.textContent)), "Chennai to Mysuru: the 20607");
  const second = (await p.$$(".jsum[role=button]"))[1];
  await second.focus();
  await p.keyboard.press("Enter");
  ok(await p.$eval('.jcard[data-j="1"] .jsum', (e) => e.getAttribute("aria-expanded") === "true"), "Enter opens a journey from the keyboard");
  await p.context().close();
}

console.log("Dated journeys");
{
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); // next Monday
  const iso = d.toISOString().slice(0, 10);
  const p = await open(`index.html?from=Chennai&to=Mysuru&on=${iso}`);
  await p.waitForSelector(".jcard");
  ok(/Leaving on|leaves on/.test(await p.$eval(".res-head", (e) => e.textContent)), "a date lists the trains leaving that day");
  ok(/Booking (opens|is open)/.test(await p.$eval(".jcard.open", (e) => e.textContent)), "each ride says when its booking opens");
  ok(new URL(p.url()).searchParams.get("on") === iso, "the date goes into the link");
  await p.context().close();
}

console.log("Your own circuit");
{
  const p = await open("index.html?loop=own&stops=delhi.2,agra.1,varanasi.2&date=2027-01-11#circuits");
  await p.waitForSelector(".own-list");
  ok((await p.$$(".own-list li")).length === 3, "the link sets the places");
  await p.selectOption("#own-add", "goa");
  await p.waitForFunction(() => document.querySelectorAll(".own-list li").length === 4);
  ok(/goa\.1/.test(decodeURIComponent(p.url())), "an added place goes into the link");
  ok(!/cannot make/.test(await p.$eval("#v-circuits", (e) => e.textContent)), "Vande Bharats make every hop");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 5000 }).catch(() => null), p.click('[data-act="ics"]')]);
  ok(dl && /\.ics$/.test(dl.suggestedFilename()), "the booking calendar downloads");
  await p.context().close();
}

console.log("Trains");
{
  const p = await open("index.html#trains");
  await p.fill("#q", "22435");
  await p.waitForTimeout(300);
  ok(/22435/.test(await p.$eval("#v-trains", (e) => e.textContent)), "searching a number finds the train");
  await p.context().close();
}

console.log("Phone");
{
  const p = await open("index.html?from=Mumbai&to=Goa", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.waitForSelector(".jcard");
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nothing runs off the side of a phone");
  await p.context().close();
}

if (AXE) {
  console.log("Accessibility (axe-core)");
  for (const [path, wait] of [["index.html?from=Mumbai&to=Varanasi", ".jcard"], ["index.html?loop=own&stops=delhi.2,agra.1#circuits", ".own-list"], ["index.html#trains", "#q"]]) {
    for (const colorScheme of ["light", "dark"]) {
      const p = await open(path, { bypassCSP: true, colorScheme });
      await p.waitForSelector(wait);
      await p.addScriptTag({ path: AXE });
      const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => `${x.id} (${x.nodes.length})`));
      ok(v.length === 0, `${path} in ${colorScheme}: ${v.join(", ")}`);
      await p.context().close();
    }
  }
}

ok(problems.length === 0, `no errors in the console: ${problems.join(" | ")}`);
await browser.close();
server.close();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
