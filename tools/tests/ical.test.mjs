// Unit tests for the iCalendar reader. Run: node tools/tests/ical.test.mjs
// Fixture is a synthetic Outlook export written for this suite — folded lines,
// VTIMEZONE, RRULE/EXDATE/RECURRENCE-ID, all-day, CANCELLED, TRANSP, truncation.
import { readFileSync } from "node:fs";
import { parseICS } from "../../js/ical.js";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
};
const ok = (label, cond, detail = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const WIN = { from: "2026-08-24", to: "2026-12-07" };
const ics = readFileSync(new URL("./outlook.ics", import.meta.url), "utf8");
const { events, stats } = parseICS(ics, WIN);

// ---------------------------------------------------------------- line folding
const lecture = events.filter((e) => e.uid === "cs360-lecture@gettysburg.edu");
ok("unfolds a wrapped SUMMARY",
  lecture[0].title === "CS360 Database Systems Lecture, Section A — Glatfelter Hall Room 112",
  lecture[0].title);
eq("unescapes \\, in TEXT", lecture[0].title.includes("Lecture, Section"), true);

// -------------------------------------------------------------- RRULE WEEKLY
// Recomputed independently with Date, rather than trusting a number I typed.
const dow = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
ok("every lecture instance lands on Mon/Wed/Fri",
  lecture.every((e) => [1, 3, 5].includes(dow(e.date))),
  [...new Set(lecture.map((e) => dow(e.date)))].join(","));
eq("series starts on DTSTART", lecture[0].date, "2026-08-31");
ok("series respects UNTIL", lecture.at(-1).date <= "2026-12-04", lecture.at(-1).date);

const expectedMWF = [];
for (let d = new Date("2026-08-31T12:00:00Z"); d <= new Date("2026-12-04T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
  if ([1, 3, 5].includes(d.getUTCDay())) expectedMWF.push(d.toISOString().slice(0, 10));
}
const skipped = ["2026-10-12", "2026-10-14"];
eq("instance count matches an independent MWF walk minus EXDATEs",
  lecture.length, expectedMWF.length - skipped.length);

// -------------------------------------------------------------------- EXDATE
eq("EXDATE removes fall-break classes",
  skipped.filter((d) => lecture.some((e) => e.date === d)), []);

// ------------------------------------------------------------- RECURRENCE-ID
const moved = lecture.find((e) => e.date === "2026-11-20");
eq("RECURRENCE-ID overrides that instance's time", moved.start, 14 * 60);
eq("RECURRENCE-ID override keeps its own title", moved.title, "CS360 Lecture (moved to afternoon)");
eq("override does not duplicate the date",
  lecture.filter((e) => e.date === "2026-11-20").length, 1);

// ------------------------------------------------------------ COUNT/DURATION
const lab = events.filter((e) => e.uid === "cs440-lab@gettysburg.edu");
eq("COUNT=10 yields ten instances", lab.length, 10);
eq("DURATION:PT2H is 120 minutes", lab[0].minutes, 120);
ok("all lab instances are Thursdays", lab.every((e) => dow(e.date) === 4));

// ------------------------------------------------------------- MONTHLY BYDAY
const seminar = events.filter((e) => e.uid === "seminar@example.com");
ok("FREQ=MONTHLY;BYDAY=2FR gives second Fridays",
  seminar.every((e) => dow(e.date) === 5 && Number(e.date.slice(-2)) >= 8 && Number(e.date.slice(-2)) <= 14),
  seminar.map((e) => e.date).join(" "));
ok("monthly series is clipped to the window", seminar.every((e) => e.date <= WIN.to));

// --------------------------------------------------------------------- skips
eq("all-day events are skipped", events.some((e) => e.uid === "birthday@example.com"), false);
eq("all-day skips are counted", stats.allDay, 1);
eq("CANCELLED is skipped", events.some((e) => e.uid === "cancelled-talk@example.com"), false);
eq("out-of-window events are skipped",
  events.some((e) => ["summer-job@example.com", "winter@example.com"].includes(e.uid)), false);
eq("out-of-window skips are counted", stats.outside, 2);

// ------------------------------------------------------------------ TRANSP
const gym = events.find((e) => e.uid === "gym@example.com");
ok("TRANSP:TRANSPARENT is imported but not busy", gym && gym.busy === false);
eq("free events are counted separately", stats.free, 1);

// ------------------------------------------------------------- missing DTEND
const oh = events.find((e) => e.uid === "no-end@example.com");
eq("a missing DTEND falls back to 60 minutes", oh.minutes, 60);

// ------------------------------------------------------------- UTC conversion
const advising = events.find((e) => e.uid === "advising@example.com" || e.uid === "advising@gettysburg.edu");
const utc = new Date(Date.UTC(2026, 8, 15, 15, 0));
eq("a Z-suffixed time converts to local wall clock",
  [advising.date, advising.start],
  [`${utc.getFullYear()}-${String(utc.getMonth() + 1).padStart(2, "0")}-${String(utc.getDate()).padStart(2, "0")}`,
   utc.getHours() * 60 + utc.getMinutes()]);
eq("a TZID time is taken as wall clock, unconverted", lecture[0].start, 9 * 60 + 30);

// ----------------------------------------------------------------- accounting
eq("every VEVENT is accounted for",
  stats.entries, 11);
eq("imported + skipped covers the expanded series",
  events.length, stats.imported);
ok("nothing was unreadable", stats.unreadable === 0, String(stats.unreadable));

// ------------------------------------------------------------------ hardening
eq("garbage input is refused, not thrown", parseICS("not a calendar", WIN).events, []);
ok("garbage input explains itself", Boolean(parseICS("not a calendar", WIN).error));
eq("empty string is refused", parseICS("", WIN).events, []);
eq("null is refused", parseICS(null, WIN).events, []);
const truncated = ics.slice(0, ics.indexOf("EXDATE"));
ok("a truncated file still parses what it can", parseICS(truncated, WIN).events.length > 0);

const runaway = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:runaway@example.com
SUMMARY:Runaway
DTSTART:20260101T090000
DTEND:20260101T100000
RRULE:FREQ=DAILY
END:VEVENT
END:VCALENDAR`;
const wide = parseICS(runaway, { from: "2020-01-01", to: "2099-01-01" });
ok("an unbounded FREQ=DAILY is capped, not infinite",
  wide.events.length > 0 && wide.events.length <= 500, String(wide.events.length));

console.log(fails ? `\n${fails} FAILED` : "\nAll iCal checks passed.");
process.exit(fails ? 1 : 0);
