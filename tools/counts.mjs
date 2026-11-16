// The size of the network wherever it is written out by hand: the README, the Google Play listing, the share
// card's description in index.html, and the numbers on the share card itself (assets/og-image.jpg).
// Usage: node tools/counts.mjs           rewrites the text where the numbers have changed
//        node tools/counts.mjs --image   also redraws the numbers on the share card (needs Playwright)
// tests/run.js fails when the text is out of date, so a change to the network is never left half-told.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** The network's size, counted the way the app counts it. */
export function counts() {
  const routes = load("routes.json");
  const trains = Object.keys(load("timetables.json").trains).length;
  const sleepers = routes.filter((r) => r.t === "sleeper").length;
  return {
    routes: routes.length,
    pairs: routes.reduce((n, r) => n + r.n.split(" · ").length, 0),
    trains,
    stations: new Set(routes.flatMap((r) => r.s)).size,
    sleepers: WORDS[sleepers] || String(sleepers),
    sleeperS: sleepers === 1 ? "" : "s",
    places: load("places.json").places.filter((p) => p.codes && p.codes.length).length,
  };
}

// each file, with what to find and what to write in its place
const EDITS = (c) => ({
  "README.md": [
    [
      /All \d+ routes and \d+ train pairs(?: running on [^,]+)?, including the \w+ Vande Bharat Sleepers?/,
      `All ${c.routes} routes and ${c.pairs} train pairs, including the ${c.sleepers} Vande Bharat Sleeper${c.sleeperS}`,
    ],
    [/\d+ routes, \d+ trains and \d+ stations/, `${c.routes} routes, ${c.trains} trains and ${c.stations} stations`],
  ],
  "android/store/listing.md": [
    [/between \d+ destinations/, `between ${c.places} destinations`],
    [/all \d+ trains/, `all ${c.trains} trains`],
  ],
  "index.html": [
    [
      /\d+ train pairs, \d+ routes and \d+ stations/,
      `${c.pairs} train pairs, ${c.routes} routes and ${c.stations} stations`,
    ],
  ],
});

/** The files whose text no longer matches the network, with the text as it should be. */
export function stale() {
  const out = [];
  for (const [file, edits] of Object.entries(EDITS(counts()))) {
    const text = readFileSync(join(root, file), "utf8");
    let next = text;
    for (const [find, put] of edits) {
      if (!find.test(next)) throw new Error(`${file}: cannot find ${find} to update`);
      next = next.replace(find, put);
    }
    if (next !== text) out.push({ file, next });
  }
  return out;
}

// the numbers on the share card, drawn over a copy with that corner left blank (assets/og-base.jpg)
export async function drawCard(c) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("drawing the share card needs Playwright: run npm ci, then npx playwright install chromium");
  }
  const asset = (f, type) => `data:${type};base64,${readFileSync(join(root, "assets", f)).toString("base64")}`;
  const html = `<!doctype html><style>
    @font-face { font-family: Teko; font-weight: 500; src: url(${asset("fonts/teko-latin-500-normal.woff2", "font/woff2")}); }
    @font-face { font-family: Hind; font-weight: 500; src: url(${asset("fonts/hind-latin-500-normal.woff2", "font/woff2")}); }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { background: url(${asset("og-base.jpg", "image/jpeg")}); }
    dl { position: absolute; left: 72px; top: 329px; display: flex; gap: 44px; margin: 0; }
    div { display: flex; flex-direction: column-reverse; }
    dd { margin: 0; font: 500 66px/0.8 Teko; color: #13213b; font-variant-numeric: tabular-nums; }
    dt { margin-top: 10px; font: 500 14.5px Hind; letter-spacing: 0.135em; text-transform: uppercase; color: #55667e; }
  </style><dl><div><dt>Train pairs</dt><dd>${c.pairs}</dd></div><div><dt>Routes</dt><dd>${c.routes}</dd></div><div><dt>Stations</dt><dd>${c.stations}</dd></div></dl>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  await page.evaluate(() => globalThis.document.fonts.ready.then(() => 1));
  await page.screenshot({ path: join(root, "assets", "og-image.jpg"), type: "jpeg", quality: 90 });
  await browser.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = counts();
  const files = stale();
  for (const { file, next } of files) writeFileSync(join(root, file), next);
  console.log(
    `${c.pairs} train pairs, ${c.routes} routes, ${c.trains} trains, ${c.stations} stations: ` +
      (files.length ? `updated ${files.map((f) => f.file).join(", ")}` : "the text is up to date"),
  );
  if (process.argv.includes("--image")) {
    await drawCard(c);
    console.log("redrew the numbers on assets/og-image.jpg");
  }
}
