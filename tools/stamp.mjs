// Version tags: adds ?v=<a hash of the file> to every reference to the site's styles and scripts, and to the
// modules they import, in a folder about to be published. A page then always asks for the files of its own
// version: GitHub Pages lets browsers reuse a file for 10 minutes without asking, and a browser that does so
// can show a page just deployed with the styles of the version before.
// Usage: node tools/stamp.mjs <folder>   (tools/assemble.mjs runs it on the folder the pages workflow publishes)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// the files the pages name, each tagged with a hash of its contents
export const TAGGED = [
  "assets/app.js",
  "assets/app.css",
  "assets/theme.js",
  "assets/pages.css",
  "assets/logo.svg",
  "vendor/d3.ivb.min.js",
];
export const hashOf = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 10);

export function stamp(dir) {
  const read = (f) => readFileSync(join(dir, f), "utf8");
  const tag = new Map();
  // the modules first, each after those it imports, so that a change anywhere changes every tag that leads to it
  const IMPORT = /from "\.\/([\w-]+\.js)"/g;
  const visit = (f, path = []) => {
    if (tag.has(`lib/${f}`)) return;
    if (path.includes(f)) throw new Error(`lib/${f} imports itself: ${path.join(" > ")}`);
    const src = read(`lib/${f}`);
    for (const [, d] of src.matchAll(IMPORT)) visit(d, [...path, f]);
    const out = src.replace(IMPORT, (_, d) => `from "./${d}?v=${tag.get(`lib/${d}`)}"`);
    writeFileSync(join(dir, "lib", f), out);
    tag.set(`lib/${f}`, hashOf(out));
  };
  for (const f of readdirSync(join(dir, "lib")).filter((x) => x.endsWith(".js"))) visit(f);
  const app = read("assets/app.js").replace(
    /from "\.\.\/lib\/([\w-]+\.js)"/g,
    (_, d) => `from "../lib/${d}?v=${tag.get(`lib/${d}`)}"`,
  );
  writeFileSync(join(dir, "assets/app.js"), app);
  for (const f of TAGGED) tag.set(f, hashOf(readFileSync(join(dir, f))));

  // every page: index.html and the generated ones (their references start with ../ as deep as they are)
  const names = TAGGED.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const REF = new RegExp(`((?:\\.\\./)*)(${names})(?=")`, "g");
  let pages = 0;
  const walk = (d) => {
    for (const e of readdirSync(join(dir, d), { withFileTypes: true })) {
      const p = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!["node_modules", ".git"].includes(e.name)) walk(p);
      } else if (e.name.endsWith(".html")) {
        const src = read(p),
          out = src.replace(REF, (_, up, f) => `${up}${f}?v=${tag.get(f)}`);
        if (out !== src) {
          writeFileSync(join(dir, p), out);
          pages++;
        }
      }
    }
  };
  walk("");
  return { tag, pages };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: node tools/stamp.mjs <folder>");
  const { tag, pages } = stamp(dir);
  console.log(`version tags on ${tag.size} files, in ${pages} pages`);
}
