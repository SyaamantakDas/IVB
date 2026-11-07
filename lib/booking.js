// When to book: Indian Railways opens bookings 60 days before a train leaves its first station, at 8 am (India time).
// Pure functions shared by the website and the tests (no DOM access).
import { isoOf } from "./schedule.js";

export const ADVANCE_DAYS = 60;
export const OPENS_AT_IST = "08:00";

// Every rail leg of a circuit plan, with the day its booking opens.
// A leg boarded after midnight on a train that started the day before opens a day earlier,
// because the 60 days count from the train's first station.
export function bookingDates(plan) {
  const out = [];
  for (const s of plan.stops) {
    for (const l of s.legs) {
      if (l.kind !== "rail") continue;
      const at = l.train.times[l.from];
      const offset = (at && (at.dep || at.arr) || { day: 0 }).day;
      const trainStart = l.day - offset;
      out.push({ leg: l, num: l.train.num, from: l.from, to: l.to, day: l.day, trainStart, opens: trainStart - ADVANCE_DAYS });
    }
  }
  return out;
}

// An iCalendar file with a reminder for each booking opening (8:00 IST is 02:30 UTC)
export function bookingCalendar(items, { name, stationName, title = "IVB booking dates", url = "https://www.irctc.co.in/" }) {
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const ymd = (day) => isoOf(day).replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IVB India on Vande Bharat//Booking dates//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(title)}`,
  ];
  for (const it of items) {
    const leg = `${stationName(it.from)} to ${stationName(it.to)}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:ivb-${it.num}-${ymd(it.day)}-${it.from}-${it.to}@syaamantakdas.github.io`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ymd(it.opens)}T023000Z`,
      `DTEND:${ymd(it.opens)}T030000Z`,
      `SUMMARY:${esc(`Book ${it.num} ${leg}`)}`,
      `DESCRIPTION:${esc(`Booking opens at 8:00 am for ${it.num}, ${leg}, travelling ${isoOf(it.day)}${name ? ` (${name})` : ""}. On the opening day only Aadhaar-verified IRCTC accounts can book. Planned with IVB: https://syaamantakdas.github.io/IVB/`)}`,
      `URL:${url}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", `DESCRIPTION:${esc(`Booking for ${it.num} opens at 8:00 am`)}`, "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Lines longer than 75 octets continue on the next line after a space (RFC 5545)
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = "", size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; size = 0; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
