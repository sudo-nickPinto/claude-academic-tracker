/**
 * A small iCalendar (RFC 5545) reader, sized for one job: turning an Outlook
 * calendar export into flat, per-day committed-time blocks.
 *
 * Pure functions over a string — no DOM, no store — so the parsing rules stay
 * checkable from node without a browser.
 *
 * TIME ZONES, DELIBERATELY SIMPLE. A `Z` suffix means UTC and is converted to
 * local time. Everything else — including `TZID=Eastern Standard Time`, which is
 * what Outlook writes — is taken as local wall-clock time and used as-is. These
 * are the calendar owner's own events, read in the owner's own zone, so the wall
 * clock is already the right answer; evaluating the VTIMEZONE DST rules would be
 * several hundred lines to arrive back at the same number. The one case this gets
 * wrong is a calendar exported in one zone and read in another, which is worth
 * knowing about but is not Nick opening his own timetable.
 */

import { epochDay, addDays } from "./compute.js";

/** ICS weekday codes, in the order the spec numbers them (0 = Sunday). */
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Runaway guard: a malformed unbounded FREQ=DAILY must not hang the browser. */
const MAX_INSTANCES = 500;

// --------------------------------------------------------------------- lexing

/**
 * Undo RFC 5545 line folding. Outlook wraps at 75 octets, mid-word, and a parser
 * that splits on newlines first will happily cut a SUMMARY in half. This has to
 * happen before anything else looks at the text.
 */
function unfold(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "");
}

function unescapeText(value) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** `DTSTART;TZID=Foo;VALUE=DATE:20260908` → { name, params, value } */
function parseLine(line) {
  const colon = splitOutsideQuotes(line, ":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const parts = [];
  let start = 0;
  for (;;) {
    const semi = splitOutsideQuotes(head, ";", start);
    if (semi < 0) { parts.push(head.slice(start)); break; }
    parts.push(head.slice(start, semi));
    start = semi + 1;
  }

  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value };
}

/** Parameter values may be quoted and contain `:` or `;` — don't split inside quotes. */
function splitOutsideQuotes(str, char, from = 0) {
  let quoted = false;
  for (let i = from; i < str.length; i++) {
    if (str[i] === '"') quoted = !quoted;
    else if (str[i] === char && !quoted) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------- dates

/**
 * `20260908`, `20260908T093000` or `20260908T133000Z` → { date, minutes, allDay }
 * where `minutes` is minutes past local midnight.
 */
function parseDateTime(value, params = {}) {
  const raw = (value || "").trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw);
  if (!m) return null;

  const [, y, mo, d, hh, mm, , zulu] = m;
  const allDay = hh === undefined || params.VALUE === "DATE";
  if (allDay) return { date: `${y}-${mo}-${d}`, minutes: 0, allDay: true };

  if (zulu) {
    // The only conversion we do: UTC instant → the viewer's local wall clock.
    const at = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm));
    return {
      date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
      minutes: at.getHours() * 60 + at.getMinutes(),
      allDay: false,
    };
  }
  return { date: `${y}-${mo}-${d}`, minutes: +hh * 60 + +mm, allDay: false };
}

const pad = (n) => String(n).padStart(2, "0");

/** 0 = Sunday. Epoch day 0 was a Thursday, hence the +4. */
const weekdayOf = (iso) => ((epochDay(iso) % 7) + 11) % 7;

/** `PT1H30M` / `P1D` → minutes. */
function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value || "");
  if (!m) return null;
  const [, sign, w, d, h, min, s] = m;
  const total = (+w || 0) * 10080 + (+d || 0) * 1440 + (+h || 0) * 60 + (+min || 0) + (+s || 0) / 60;
  return sign === "-" ? -total : total;
}

// ------------------------------------------------------------------ recurrence

function parseRRule(value) {
  const rule = {};
  for (const part of (value || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return rule;
}

/**
 * Expand one VEVENT's RRULE into start dates, clipped to [from, to] and capped.
 * Only the shapes Outlook actually emits for a class timetable are supported;
 * anything else falls back to the single start date rather than guessing.
 */
function expand(startDate, rule, from, to) {
  if (!rule || !rule.FREQ) return [startDate];

  const freq = rule.FREQ.toUpperCase();
  const interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  const count = parseInt(rule.COUNT, 10) || Infinity;
  const untilParsed = rule.UNTIL ? parseDateTime(rule.UNTIL) : null;
  const until = untilParsed ? untilParsed.date : null;

  // Never walk past the window we're going to keep anyway.
  const horizon = until && until < to ? until : to;
  const out = [];
  const emit = (iso) => {
    if (iso < startDate) return true;
    if (iso > horizon) return false;
    if (iso >= from) out.push(iso);
    return out.length + 1 <= MAX_INSTANCES && out.length < count;
  };

  if (freq === "WEEKLY") {
    const days = rule.BYDAY
      ? rule.BYDAY.split(",").map((d) => DAY_CODES.indexOf(d.trim().slice(-2).toUpperCase())).filter((i) => i >= 0)
      : [weekdayOf(startDate)];
    // Walk from the Sunday of the start week so BYDAY entries before the start
    // weekday in week 1 are considered and then skipped by the `iso < startDate` guard.
    let cursor = addDays(startDate, -weekdayOf(startDate));
    for (let guard = 0; guard < MAX_INSTANCES * 2; guard++) {
      for (const d of days.slice().sort((a, b) => a - b)) {
        if (!emit(addDays(cursor, d))) return finish(out, count);
      }
      cursor = addDays(cursor, 7 * interval);
      if (cursor > horizon) break;
    }
    return finish(out, count);
  }

  if (freq === "DAILY") {
    let cursor = startDate;
    for (let guard = 0; guard < MAX_INSTANCES * 2; guard++) {
      if (!emit(cursor)) break;
      cursor = addDays(cursor, interval);
      if (cursor > horizon) break;
    }
    return finish(out, count);
  }

  if (freq === "MONTHLY") {
    const [sy, sm, sd] = startDate.split("-").map(Number);
    const ordinal = rule.BYDAY ? /^(-?\d+)?([A-Z]{2})$/.exec(rule.BYDAY.trim().toUpperCase()) : null;
    for (let i = 0; i < MAX_INSTANCES; i++) {
      const total = (sm - 1) + i * interval;
      const y = sy + Math.floor(total / 12);
      const mo = (total % 12) + 1;
      const iso = ordinal
        ? nthWeekdayOfMonth(y, mo, DAY_CODES.indexOf(ordinal[2]), parseInt(ordinal[1], 10) || 1)
        : clampToMonth(y, mo, sd);
      if (!iso) continue;
      if (iso > horizon) break;
      if (!emit(iso)) break;
    }
    return finish(out, count);
  }

  return [startDate];
}

const finish = (out, count) => (count === Infinity ? out : out.slice(0, count));

/** Day 31 in a 30-day month is skipped, per the spec, rather than rolling over. */
function clampToMonth(y, mo, d) {
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d > last ? null : `${y}-${pad(mo)}-${pad(d)}`;
}

/** `2FR` = second Friday; `-1MO` = last Monday. */
function nthWeekdayOfMonth(y, mo, weekday, nth) {
  if (weekday < 0) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const first = `${y}-${pad(mo)}-01`;
  const shift = (weekday - weekdayOf(first) + 7) % 7;
  const dates = [];
  for (let d = 1 + shift; d <= last; d += 7) dates.push(`${y}-${pad(mo)}-${pad(d)}`);
  const picked = nth > 0 ? dates[nth - 1] : dates[dates.length + nth];
  return picked || null;
}

// ----------------------------------------------------------------- the reader

/**
 * Read an .ics file into flat, already-expanded event instances.
 *
 * Returns `{ events, stats }`. Nothing is dropped without being counted, so the
 * import screen can say exactly what didn't make it and why. See the `stats`
 * declaration below for which counter is in which unit.
 */
export function parseICS(text, { from, to } = {}) {
  // Two different units, deliberately separated. `entries` and `unreadable` count
  // VEVENT blocks in the file; everything else counts dated occurrences, because one
  // weekly class is a single entry and thirty occurrences — and "56 imported, 2
  // skipped" only means anything if both halves are counted the same way.
  const stats = { entries: 0, unreadable: 0,
                  imported: 0, allDay: 0, outside: 0, cancelled: 0, free: 0 };
  if (typeof text !== "string" || !text.includes("BEGIN:VEVENT")) {
    return { events: [], stats, error: "That file doesn't look like a calendar export." };
  }

  const lines = unfold(text).split("\n");
  const raw = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") { current = { props: [] }; continue; }
    if (trimmed === "END:VEVENT") { if (current) raw.push(current); current = null; continue; }
    if (!current) continue;
    const parsed = parseLine(trimmed);
    if (parsed) current.props.push(parsed);
  }

  // A download that got cut off mid-event still has a usable event in it. Keeping
  // it beats discarding it silently — it shows up in the counts either way.
  if (current && current.props.length) raw.push(current);

  stats.entries = raw.length;

  // Instances that override a generated one (Outlook writes these when a single
  // meeting in a series moves). Keyed by uid + the date they replace.
  const overrides = new Map();
  const series = [];

  for (const ev of raw) {
    const read = readEvent(ev);
    if (!read) { stats.unreadable++; continue; }
    if (read.recurrenceId) overrides.set(`${read.uid}|${read.recurrenceId}`, read);
    else series.push(read);
  }

  const seen = new Set();
  const events = [];

  const keep = (ev, date) => {
    if (ev.status === "CANCELLED") { stats.cancelled++; return; }
    if (ev.allDay) { stats.allDay++; return; }
    if ((from && date < from) || (to && date > to)) { stats.outside++; return; }
    const key = `${ev.uid}|${date}`;
    if (seen.has(key)) return;
    seen.add(key);
    // TRANSP:TRANSPARENT is Outlook's "show as Free" — on the calendar, but not
    // time you've actually committed, so it must not eat into the day's capacity.
    const busy = ev.transparent !== true;
    if (!busy) stats.free++;
    events.push({
      uid: ev.uid,
      title: ev.title,
      date,
      start: ev.startMinutes,
      end: ev.startMinutes + ev.minutes,
      minutes: ev.minutes,
      busy,
      location: ev.location,
    });
    stats.imported++;
  };

  for (const ev of series) {
    const dates = ev.rrule
      ? expand(ev.date, ev.rrule, from || ev.date, to || addDays(ev.date, 365))
      : [ev.date];
    for (const date of dates) {
      if (ev.exdates.has(date)) continue;
      const override = overrides.get(`${ev.uid}|${date}`);
      if (override) keep(override, override.date);
      else keep(ev, date);
    }
  }

  // Overrides that moved an instance to a date outside the generated series.
  for (const [key, ev] of overrides) {
    const [, replaced] = key.split("|");
    if (ev.date !== replaced) keep(ev, ev.date);
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  return { events, stats };
}

function readEvent(ev) {
  const get = (name) => ev.props.find((p) => p.name === name);
  const dtstart = get("DTSTART");
  if (!dtstart) return null;

  const start = parseDateTime(dtstart.value, dtstart.params);
  if (!start) return null;

  const dtend = get("DTEND");
  const end = dtend ? parseDateTime(dtend.value, dtend.params) : null;
  const duration = get("DURATION");

  let minutes;
  if (end) {
    minutes = (epochDay(end.date) - epochDay(start.date)) * 1440 + (end.minutes - start.minutes);
  } else if (duration) {
    minutes = parseDuration(duration.value);
  }
  // A malformed or missing end is common in the wild. Assume an hour rather than
  // dropping the event or, worse, letting a negative length subtract committed time.
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = start.allDay ? 0 : 60;

  const recurrence = get("RECURRENCE-ID");
  const exdates = new Set();
  for (const p of ev.props.filter((x) => x.name === "EXDATE")) {
    for (const one of p.value.split(",")) {
      const d = parseDateTime(one, p.params);
      if (d) exdates.add(d.date);
    }
  }

  return {
    uid: get("UID")?.value || `${start.date}-${get("SUMMARY")?.value || "untitled"}`,
    title: unescapeText(get("SUMMARY")?.value || "").trim() || "(no title)",
    location: unescapeText(get("LOCATION")?.value || "").trim(),
    date: start.date,
    startMinutes: start.minutes,
    minutes,
    allDay: start.allDay,
    status: (get("STATUS")?.value || "").toUpperCase(),
    transparent: (get("TRANSP")?.value || "").toUpperCase() === "TRANSPARENT",
    rrule: get("RRULE") ? parseRRule(get("RRULE").value) : null,
    recurrenceId: recurrence ? parseDateTime(recurrence.value, recurrence.params)?.date : null,
    exdates,
  };
}
