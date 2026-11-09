// The site as it is published: every file in the repository, the GTFS feed (gtfs/) and the generated pages
// (pages/, laid over the root), with version tags on the styles and scripts (tools/stamp.mjs). The pages
// workflow tests this folder in the browsers and then publishes it, so what is tested is what goes live.
// Usage: node tools/assemble.mjs [folder]   (default: site; build the feed and the pages first)
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stamp } from "./stamp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, process.argv[2] || "site");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
for (const f of tracked) if (!f.startsWith(".github/")) cpSync(join(root, f), join(out, f), { recursive: true });
for (const [from, to] of [
  ["gtfs", "gtfs"],
  ["pages", "."],
]) {
  if (!existsSync(join(root, from))) throw new Error(`${from}/ is missing: build it first`);
  cpSync(join(root, from), join(out, to), { recursive: true });
}
const { tag, pages } = stamp(out);
console.log(
  `site: ${tracked.length} files from the repository, the feed and the pages; version tags on ${tag.size} files, in ${pages} pages`,
);
