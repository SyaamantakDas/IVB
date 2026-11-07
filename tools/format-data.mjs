// Lays out IVB's data files the way they are kept, so hand edits and tools leave clean diffs.
// Usage: node tools/format-data.mjs          rewrites the files in data/
//        node tools/format-data.mjs --check  exits 1 if any file is not laid out this way
//
// stations.json and routes.json: one entry per line.
// The other files: a value stays on one line when it fits in 100 characters, otherwise one item per line.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const WIDTH = 100;
const PER_LINE = new Set(["stations.json", "routes.json"]);
const FILES = ["stations.json", "routes.json", "timetables.json", "places.json", "circuits.json", "events.json"];

// JSON.parse puts integer-like keys (train numbers) first, in numeric order, so parse into Maps to keep the file's own order
function parse(text) {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i])) i++; };
  const str = () => { const m = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i)); i += m[0].length; return JSON.parse(m[0]); };
  const val = () => {
    ws();
    if (text[i] === "{") {
      i++; const out = new Map(); ws();
      if (text[i] === "}") { i++; return out; }
      for (;;) { ws(); const k = str(); ws(); i++; out.set(k, val()); ws(); if (text[i++] === ",") continue; return out; }
    }
    if (text[i] === "[") {
      i++; const out = []; ws();
      if (text[i] === "]") { i++; return out; }
      for (;;) { out.push(val()); ws(); if (text[i++] === ",") continue; return out; }
    }
    if (text[i] === '"') return str();
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  return val();
}

const oneLine = (v) => {
  if (Array.isArray(v)) return "[" + v.map(oneLine).join(", ") + "]";
  if (v instanceof Map) return "{" + [...v].map(([k, x]) => JSON.stringify(k) + ": " + oneLine(x)).join(", ") + "}";
  return JSON.stringify(v);
};
function layout(v, ind = "", prefix = 0) {
  const s = oneLine(v);
  const size = Array.isArray(v) ? v.length : v instanceof Map ? v.size : 0;
  if (ind.length + prefix + s.length <= WIDTH || !size) return s;
  if (Array.isArray(v)) return "[\n" + v.map((x) => ind + "  " + layout(x, ind + "  ")).join(",\n") + "\n" + ind + "]";
  return "{\n" + [...v].map(([k, x]) => ind + "  " + JSON.stringify(k) + ": " + layout(x, ind + "  ", JSON.stringify(k).length + 2)).join(",\n") + "\n" + ind + "}";
}
const perLine = (v) => Array.isArray(v)
  ? "[\n" + v.map((x) => "  " + oneLine(x)).join(",\n") + "\n]"
  : "{\n" + [...v].map(([k, x]) => "  " + JSON.stringify(k) + ": " + oneLine(x)).join(",\n") + "\n}";

const check = process.argv.includes("--check");
let bad = 0;
for (const name of FILES) {
  const p = join(dataDir, name);
  const text = readFileSync(p, "utf8");
  const v = parse(text);
  const out = (PER_LINE.has(name) ? perLine(v) : layout(v)) + "\n";
  if (out === text) continue;
  if (check) { console.log(`${name} is not laid out as IVB keeps it: run node tools/format-data.mjs`); bad++; }
  else { writeFileSync(p, out); console.log(`laid out ${name}`); }
}
if (check) {
  if (bad) process.exit(1);
  console.log("data files are laid out as IVB keeps them");
}
