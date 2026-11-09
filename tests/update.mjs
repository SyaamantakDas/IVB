// Updates: a visitor who comes back after a deploy gets the new version whole, never new HTML with old styles.
// It serves a copy of the site as published (with version tags, tools/stamp.mjs) and as GitHub Pages serves it
// (browsers may reuse a file for 10 minutes without asking),
// lets a browser visit it so the service worker installs, then "deploys" a changed copy, with a changed service
// worker, and reloads. At every step the page, its styles and its script must be of one version; once deployed,
// the new one; and offline, the site must still open.
// Run with: node tests/update.mjs [--browser=webkit]   (needs Playwright with that browser)
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve, sep } from "node:path";
import { stamp } from "../tools/stamp.mjs";

const require = createRequire(import.meta.url);
const BROWSER = process.argv.find((a) => a.startsWith("--browser="))?.slice(10) || "chromium";
const engine = require("playwright")[BROWSER];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// two copies of the site, each marked with its version in the HTML, the styles and the script
const work = mkdtempSync(join(tmpdir(), "ivb-update-"));
for (const v of ["old", "new"]) {
  const dir = join(work, v);
  for (const f of ["index.html", "manifest.webmanifest", "sw.js", "assets", "lib", "data", "vendor"])
    cpSync(join(root, f), join(dir, f), { recursive: true });
  const edit = (f, fn) => writeFileSync(join(dir, f), fn(readFileSync(join(dir, f), "utf8")));
  edit("index.html", (s) => s.replace("<head>", `<head>\n<meta name="ivb-version" content="${v}">`));
  edit("assets/app.css", (s) => s + `\n:root { --ivb-version: "${v}"; }\n`);
  edit("assets/app.js", (s) => s + `\nwindow.ivbVersion = "${v}";\n`);
  if (v === "new") edit("sw.js", (s) => s.replace(/const CACHE = "([^"]+)";/, 'const CACHE = "$1-next";'));
  stamp(dir); // version tags, as tools/assemble.mjs adds them before publishing
}

let tree = join(work, "old");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(tree, "." + path);
  if (!file.startsWith(tree + sep)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
    const head = { ETag: etag, "Cache-Control": "max-age=600" }; // as GitHub Pages
    if (req.headers["if-none-match"] === etag) return res.writeHead(304, head).end();
    res.writeHead(200, { ...head, "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0,
  passes = 0;
const ok = (cond, msg) => {
  if (cond) passes++;
  else {
    failures++;
    console.log("  FAIL", msg);
  }
};
const browser = await engine.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const version = () =>
  page.evaluate(() => [
    document.querySelector('meta[name="ivb-version"]')?.content,
    getComputedStyle(document.documentElement).getPropertyValue("--ivb-version").trim().replace(/"/g, ""),
    window.ivbVersion,
  ]);
const settle = async () => {
  await page.waitForFunction(() => window.ivbVersion && document.querySelector("path.route"), null, {
    timeout: 15000,
  });
  await page.waitForTimeout(500);
};
console.log(`Updates, in ${BROWSER}`);
try {
  await page.goto(base);
  await settle();
  const controlled = await page
    .waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  ok(controlled, "the service worker takes charge on the first visit");
  await page.reload();
  await settle();
  ok((await version()).join() === "old,old,old", `before the deploy, the old version whole: ${await version()}`);

  tree = join(work, "new"); // the deploy
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await settle();
    const v = await version();
    seen.push(v.join("/"));
    ok(new Set(v).size === 1, `reload ${i + 1} after the deploy shows one version, not a mix: ${v.join(", ")}`);
  }
  ok(seen[seen.length - 1] === "new/new/new", `the new version arrives within three reloads: ${seen.join(" then ")}`);
  ok(seen[0] === "new/new/new", `in fact on the first reload: ${seen[0]}`);

  await ctx.setOffline(true);
  await page.reload();
  await settle();
  ok((await version()).join() === "new,new,new", `offline, the site still opens, whole: ${await version()}`);
} catch (e) {
  ok(false, String(e.message).split("\n")[0]);
}
await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
