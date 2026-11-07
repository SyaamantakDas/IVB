// Circuit scheduling: lays a loop out on the calendar around each train's day off,
// and scores start dates by how many nights fall in each destination's good season.
import { DAYS, runsOn, dayOffset } from "./network.js";

const MIN_CHANGE = 20; // minutes between trains on the same day
const MIN_STOPOVER = 30; // minutes at a day stop before the onward train

// Dates are whole days since 1970-01-01 (UTC), so weekdays never drift with time zones.
export const toDay = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
export const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return toDay(y, m, d); };
export const weekday = (day) => (day + 4) % 7; // 1970-01-01 was a Thursday
const dateOf = (day) => new Date(day * 86400000);
export const monthOf = (day) => dateOf(day).getUTCMonth(); // 0..11
export const yearOf = (day) => dateOf(day).getUTCFullYear();
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDay = (day, withWeekday = true) => {
  const d = dateOf(day);
  return (withWeekday ? DAYS[weekday(day)] + " " : "") + d.getUTCDate() + " " + MON[d.getUTCMonth()];
};
export const isoOf = (day) => dateOf(day).toISOString().slice(0, 10);

// Put the stop at `start` first; the loop ends back there
export function rotate(stops, start) {
  return stops.slice(start).concat(stops.slice(0, start));
}

/**
 * Lay a circuit out from a start date.
 * @returns { stops: [...], end, days, rides, waits, warnings }
 */
export function schedule(net, stops, startDay, events = []) {
  const out = [];
  const warnings = [];
  let arrDay = startDay, arrTime = null, rides = 0, waits = 0;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const first = i === 0;
    const planned = first ? startDay : arrDay + s.nights;
    let chosen = null, depDay = planned;
    for (let d = planned; d < planned + 8; d++) {
      const sameDayAsArrival = !first && d === arrDay;
      const r = tryMove(net, s.move, d, sameDayAsArrival ? arrTime : null);
      if (r) { chosen = r; depDay = d; break; }
    }
    if (!chosen) {
      warnings.push(`No run found within a week for the move from ${placeName(net, s)}.`);
      chosen = tryMove(net, s.move, planned, null, true);
      depDay = planned;
    }
    const waited = depDay - planned;
    waits += waited;
    const place = net.PLACES.get(s.place);
    out.push({
      ...s, place, index: i, first,
      arrive: first ? null : { day: arrDay, time: arrTime },
      depart: { day: depDay, time: chosen.depTime },
      nightsActual: first ? 0 : depDay - arrDay,
      waited,
      legs: chosen.legs,
      events: first ? [] : eventsAt(events, s.place, arrDay, depDay),
    });
    rides += chosen.legs.filter((l) => l.kind === "rail").length;
    arrDay = chosen.arrDay;
    arrTime = chosen.arrTime;
  }
  return { stops: out, start: startDay, end: arrDay, endTime: arrTime, days: arrDay - startDay + 1, rides, waits, warnings };
}

function placeName(net, s) {
  const p = net.PLACES.get(s.place);
  return p ? p.name : s.place;
}

// Try to make every leg of a move on day `d`. Returns null if a train does not run or a connection fails.
// A leg marked `flex` (your own circuits) may instead wait for a later day, a night or more at the change.
function tryMove(net, move, d, afterTime, force = false) {
  let day = d, time = afterTime, roadMin = 0;
  const legs = [];
  let depTime = null;
  for (const leg of move) {
    if (leg.road) {
      legs.push({ kind: "road", from: leg.from, to: leg.to, km: leg.km, text: leg.text || "" });
      roadMin += leg.km * 4;
      continue;
    }
    const options = (leg.options || [leg.train]).map((n) => net.TRAINS.get(n)).filter(Boolean);
    let pick = null;
    for (let extra = 0; !pick && extra < (leg.flex && !force ? 7 : 1); extra++) {
      for (const t of options) {
        if (!force && !runsOn(t, leg.from, weekday(day + extra))) continue;
        const dep = t.times[leg.from] && (t.times[leg.from].dep || t.times[leg.from].arr);
        const need = time == null || extra ? null : time + roadMin + (legs.length ? MIN_CHANGE : MIN_STOPOVER);
        if (!force && need != null && dep && dep.min < need) continue;
        pick = t;
        day += extra;
        break;
      }
    }
    if (!pick && force) pick = options[0];
    if (!pick) return null;
    const dep = pick.times[leg.from] && (pick.times[leg.from].dep || pick.times[leg.from].arr);
    const arr = pick.times[leg.to] && (pick.times[leg.to].arr || pick.times[leg.to].dep);
    const off = dayOffset(pick, leg.from, leg.to);
    if (depTime == null) depTime = dep ? dep.min : null;
    legs.push({ kind: "rail", train: pick, from: leg.from, to: leg.to, day, dep, arr, arrDay: day + off });
    day += off;
    time = arr ? arr.min : null;
    roadMin = 0;
  }
  return { legs, arrDay: day, arrTime: time, depTime };
}

function eventsAt(events, place, from, to) {
  return events.filter((e) => (e.place === place || e.place === "*") && fromISO(e.from) <= to && fromISO(e.to) >= from);
}

/**
 * Score a start date: the share of nights spent in each destination's good months.
 * months strings run Jan..Dec with 2 = best, 1 = fair, 0 = avoid.
 */
export function seasonScore(net, plan) {
  let num = 0, den = 0, best = 0, fair = 0, poor = 0;
  for (const s of plan.stops) {
    if (s.first || !s.place) continue;
    const w = Math.max(s.nightsActual, 0.5);
    const mid = s.arrive.day + Math.floor(s.nightsActual / 2);
    const m = +s.place.months[monthOf(mid)];
    num += w * m; den += w * 2;
    if (m === 2) best++; else if (m === 1) fair++; else poor++;
  }
  return { score: den ? num / den : 0, best, fair, poor };
}

export function seasonScan(net, stops, fromDay, count = 24, events = []) {
  const out = [];
  const d0 = dateOf(fromDay);
  let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1;
  for (let k = 0; out.length < count; k++) {
    for (const dd of [1, 15]) {
      if (out.length >= count) break;
      const day = toDay(y, m, dd);
      const plan = schedule(net, stops, day, events);
      out.push({ day, ...seasonScore(net, plan), days: plan.days });
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
