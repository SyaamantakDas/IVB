// Reads the MobilityData GTFS Validator's report.json and fails when the feed has any error.
// Usage: node tools/check-gtfs-report.mjs gtfs/report/report.json
import { readFileSync } from "node:fs";
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
for (const n of report.notices || []) {
  counts[n.severity] = (counts[n.severity] || 0) + n.totalNotices;
  console.log(`${n.severity.padEnd(7)} ${n.code} (${n.totalNotices})`);
}
console.log(`GTFS validation: ${counts.ERROR} errors, ${counts.WARNING} warnings, ${counts.INFO} info notices`);
if (counts.ERROR) process.exit(1);
