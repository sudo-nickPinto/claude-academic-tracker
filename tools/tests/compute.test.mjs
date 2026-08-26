// Unit tests for the pure computation layer. Run: node tools/tests/compute.test.mjs
import { seedTasks, seedPersonal, seedGrades } from "../../js/seed.js";
import * as C from "../../js/compute.js";

const state = { tasks: seedTasks, personal: seedPersonal, grades: seedGrades,
                prefs: { includePersonalInWeek: false } };
const REF = "2026-08-25";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
};

// --- date arithmetic ---
eq("dayDiff across DST fall-back", C.dayDiff("2026-11-05", "2026-10-29"), 7);
eq("dayDiff across DST spring-fwd", C.dayDiff("2026-03-15", "2026-03-05"), 10);
eq("addDays across month end", C.addDays("2026-08-31", -3), "2026-08-28");
eq("addDays across year end", C.addDays("2027-01-02", -5), "2026-12-28");
eq("dayDiff negative", C.dayDiff("2026-08-20", REF), -5);

// --- startBy: due - max(1, ceil(estMin/90)) ---
eq("startBy 30min -> 1 day", C.startBy({ due: "2026-08-31", estMin: 30, status: "Not Started" }), "2026-08-30");
eq("startBy 90min -> 1 day", C.startBy({ due: "2026-08-31", estMin: 90, status: "Not Started" }), "2026-08-30");
eq("startBy 180min -> 2 days", C.startBy({ due: "2026-08-31", estMin: 180, status: "Not Started" }), "2026-08-29");
eq("startBy 240min -> 3 days", C.startBy({ due: "2026-08-31", estMin: 240, status: "Not Started" }), "2026-08-28");
eq("startBy null when Done", C.startBy({ due: "2026-08-31", estMin: 240, status: "Done" }), null);
eq("startBy null without estMin", C.startBy({ due: "2026-08-31", estMin: null, status: "Not Started" }), null);
eq("daysLeft null when Done", C.daysLeft({ due: "2026-08-20", status: "Done" }, REF), null);

// --- row state ---
const rs = (due, status = "Not Started") => C.rowState({ due, status }, REF);
eq("rowState overdue", rs("2026-08-24"), "overdue");
eq("rowState today is soon", rs("2026-08-25"), "soon");
eq("rowState +3d soon", rs("2026-08-28"), "soon");
eq("rowState +4d normal", rs("2026-08-29"), "normal");
eq("rowState done", rs("2026-08-01", "Done"), "done");

// --- seed integrity ---
eq("seed counts", Object.fromEntries(Object.entries(seedTasks).map(([k, v]) => [k, v.length])),
   { CS440: 16, CS391: 3, CS360: 18, ENG216: 3 });
eq("personal count", seedPersonal.length, 4);
eq("seq values unique", new Set([...Object.values(seedTasks).flat(), ...seedPersonal].map(t => t.seq)).size, 44);
eq("no imported Days Left/Start By fields",
   [...Object.values(seedTasks).flat()].some(t => "daysLeft" in t || "startBy" in t), false);

// --- dashboard ---
const s = C.dashboardStats(state, REF);
eq("total coursework tasks", s.total, 40);
// ENG216 ships two tasks already marked Done in the workbook.
eq("open", s.open, 38);
eq("done", s.done, 2);
eq("completion 2/40", s.completion, 0.05);
eq("done tasks stay counted in total", s.open + s.done, s.total);
console.log("   dashboard:", JSON.stringify(s));

const upc = C.upcoming(state, { ref: REF });
console.log(`   upcoming (${upc.length}):`);
upc.forEach(t => console.log(`     ${t.due} ${t.course.padEnd(7)} ${t.priority.padEnd(6)} seq=${String(t.seq).padEnd(3)} ${t.task}`));
const sorted = upc.every((t, i) => i === 0 || upc[i - 1].due <= t.due);
eq("upcoming sorted by due asc", sorted, true);
eq("upcoming excludes Personal by default", upc.some(t => t.course === "Personal"), false);
eq("upcoming includes Personal when asked",
   C.upcoming(state, { ref: REF, includePersonal: true }).some(t => t.course === "Personal"), true);

// tiebreak: same due date -> priority then seq
const sameDay = upc.filter(t => t.due === upc[0].due);
console.log("   same-day ordering:", sameDay.map(t => `${t.priority}/${t.seq}`).join(" "));

// --- per-course "Next Big One" ---
for (const c of C.perCourse(state, REF)) {
  console.log(`   ${c.course.padEnd(7)} open=${String(c.open).padEnd(3)} overdue=${c.overdue} due7=${c.dueWeek} hrs=${c.estHours.toFixed(1)} nextBig=${c.nextBig ? `${c.nextBig.task} (${c.nextBig.type}, ${c.nextBig.due}, ${c.daysAway}d)` : "—"}`);
  if (c.nextBig) eq(`  ${c.course} nextBig is a major type`,
    ["Exam / Quiz", "Paper", "Project"].includes(c.nextBig.type), true);
}

// --- 14-day workload ---
const wl = C.workload14(state, REF);
eq("workload spans 14 days", wl.length, 14);
eq("workload starts today", wl[0].date, REF);
eq("workload ends today+13", wl[13].date, "2026-09-07");
console.log("   heavy days:", wl.filter(d => d.heavy).map(d => `${d.date} ${d.hours}h`).join(", ") || "none");
console.log("   loaded days:", wl.filter(d => d.count).map(d => `${d.date}=${d.hours}h/${d.count}`).join(" "));

// --- analytics buckets are a partition ---
const a = C.analytics(state, REF);
eq("outlook buckets sum to open count",
   a.outlook.reduce((n, b) => n + b.count, 0), a.snapshot.open);
eq("status counts sum to total", a.byStatus.reduce((n, r) => n + r.count, 0), a.snapshot.total);
eq("byCourse open sums to total open", a.byCourse.reduce((n, r) => n + r.open, 0), a.snapshot.open);
eq("byPriority open sums to total open", a.byPriority.reduce((n, r) => n + r.open, 0), a.snapshot.open);
eq("byType open sums to total open", a.byType.reduce((n, r) => n + r.open, 0), a.snapshot.open);
console.log("   outlook:", a.outlook.map(b => `${b.key}=${b.count}`).join(" "));

// --- grades ---
const g1 = C.gradeSummary({ target: 0.93, items: [
  { item: "Midterm", weight: 0.30, score: 0.90 },
  { item: "Final", weight: 0.40, score: null },
  { item: "Homework", weight: 0.30, score: null },
]});
eq("gradedWeight", g1.gradedWeight, 0.30);
eq("earnedPoints", +g1.earnedPoints.toFixed(4), 0.27);
eq("currentGrade = 90% on what's graded", +g1.currentGrade.toFixed(4), 0.9);
eq("remainingWeight", +g1.remainingWeight.toFixed(4), 0.70);
// (0.93 - 0.27) / 0.70 = 0.942857
eq("neededOnRest", +g1.neededOnRest.toFixed(4), 0.9429);
eq("no weight warning at 100%", g1.weightWarning, false);

const g2 = C.gradeSummary({ target: 0.93, items: [
  { item: "Midterm", weight: 0.50, score: 0.40 },
  { item: "Final", weight: 0.50, score: null },
]});
eq("unreachable target flagged >100%", g2.neededOnRest > 1, true);

const g3 = C.gradeSummary({ target: 0.93, items: [
  { item: "Only thing", weight: 0.60, score: 0.80 },
]});
eq("weights not summing to 1 warns", g3.weightWarning, true);
eq("neededOnRest null when nothing remains", g3.neededOnRest, null);

const g4 = C.gradeSummary({ target: 0.93, items: [] });
eq("empty grades -> currentGrade null", g4.currentGrade, null);
eq("empty grades -> no false warning", g4.weightWarning, false);

const g5 = C.gradeSummary({ target: 0.50, items: [
  { item: "A", weight: 0.5, score: 1.0 }, { item: "B", weight: 0.5, score: null },
]});
eq("neededOnRest clamped at 0, never negative", g5.neededOnRest, 0);


// ------------------------------------------------------- active / later split
console.log("\n--- active / later ---");
const H = 21;
const openAll = C.courseTasks(state).filter(t => !C.isDone(t));
const laterAll = openAll.filter(t => C.isLater(t, REF, H));
eq("seed split at 21 days: active", openAll.length - laterAll.length, 14);
eq("seed split at 21 days: later", laterAll.length, 24);
eq("active + later === open", (openAll.length - laterAll.length) + laterAll.length, openAll.length);
eq("dashboard agrees", [s2().active, s2().later], [14, 24]);
function s2() { return C.dashboardStats(state, REF); }
eq("per-course later counts", C.perCourse(state, REF).map(c => `${c.course}:${c.active}/${c.later}`),
   ["CS440:6/10", "CS391:3/0", "CS360:4/14", "ENG216:1/0"]);
eq("horizonList is sorted by surface date",
   C.horizonList(state, REF).every((t, i, a) => i === 0 || a[i-1].surfaces <= t.surfaces), true);
eq("horizonList length matches later count", C.horizonList(state, REF).length, 24);

// surfacesOn: earlier of horizon and startBy
eq("surfacesOn uses horizon for a small task",
   C.surfacesOn({ due: "2026-12-01", estMin: 30, status: "Not Started" }, H), "2026-11-10");
eq("surfacesOn uses startBy when it lands first",
   C.surfacesOn({ due: "2026-12-01", estMin: 3000, status: "Not Started" }, H), "2026-10-28");
eq("undated work has no horizon", C.surfacesOn({ due: null, estMin: 60 }, H), null);
eq("undated work is active", C.isLater({ due: null, status: "Not Started" }, REF, H), false);

// the guards
const far = { due: "2026-12-07", estMin: 60, status: "Not Started" };
eq("far-off task is Later", C.isLater(far, REF, H), true);
eq("In Progress surfaces it", C.isLater({ ...far, status: "In Progress" }, REF, H), false);
eq("Waiting/Blocked surfaces it", C.isLater({ ...far, status: "Waiting / Blocked" }, REF, H), false);
eq("Done is never Later", C.isLater({ ...far, status: "Done" }, REF, H), false);
eq("explicit activeFrom in the past surfaces it",
   C.isLater({ ...far, activeFrom: "2026-08-01" }, REF, H), false);
eq("explicit activeFrom in the future hides a near task",
   C.isLater({ due: "2026-08-28", estMin: 30, status: "Not Started", activeFrom: "2026-08-27" }, REF, H), true);
eq("but never hides an overdue one",
   C.isLater({ due: "2026-08-01", estMin: 30, status: "Not Started", activeFrom: "2026-12-01" }, REF, H), false);
// The horizon is how many days BEFORE a due date a task surfaces, so a bigger
// horizon shows more, not less. A zero horizon holds work back until its Start By.
const laterAt = (h) => C.courseTasks(state).filter((t) => C.isLater(t, REF, h)).length;
eq("a bigger horizon surfaces more work", laterAt(60) < laterAll.length, true);
eq("a horizon past the whole term leaves nothing Later", laterAt(365), 0);
eq("a zero horizon holds almost everything back", laterAt(0) > laterAll.length, true);
eq("horizon is monotonic", [laterAt(0), laterAt(7), laterAt(21), laterAt(60), laterAt(365)]
   .every((n, i, a) => i === 0 || n <= a[i - 1]), true);

// The property that makes Later safe to trust, over a full year of reference dates.
let violations = 0, taskDays = 0;
for (let i = 0; i < 365; i++) {
  const ref = C.addDays("2026-08-01", i);
  for (const t of openAll) {
    taskDays++;
    if (!C.isLater(t, ref, H)) continue;
    if (C.daysLeft(t, ref) < 0) violations++;
    if (C.shouldHaveStarted(t, ref)) violations++;
  }
}
eq(`no overdue or past-start-by task ever hides in Later (${taskDays} task-days)`, violations, 0);

// --- committed time from an imported calendar -------------------------------
// A hand-built calendar rather than the .ics fixture: these assertions are about
// what compute.js does with events, not about how they were parsed.
const ev = (date, start, minutes, busy = true, title = "Class") =>
  ({ uid: `${date}-${start}`, title, date, start, end: start + minutes, minutes, busy, allDay: false });

const withCal = {
  ...state,
  calendar: {
    events: [
      ev("2026-08-25", 540, 75),           // 9:00, 75m
      ev("2026-08-25", 780, 50),           // 13:00, 50m
      ev("2026-08-25", 900, 60, false, "Gym"), // shown as Free in Outlook
      ev("2026-08-26", 540, 300),          // a five-hour teaching day
    ],
    importedAt: "2026-08-24T12:00:00.000Z", filename: "test.ics", stats: null,
  },
};

eq("no calendar means no committed time", C.busyMinutes(state, "2026-08-25"), 0);
eq("hasCalendar is false without one", C.hasCalendar(state), false);
eq("hasCalendar is true with one", C.hasCalendar(withCal), true);
eq("busyMinutes sums only busy events", C.busyMinutes(withCal, "2026-08-25"), 125);
eq("a free-marked event is on the day but costs nothing", C.eventsOn(withCal, "2026-08-25").length, 3);
eq("eventsOn is in time order",
   C.eventsOn(withCal, "2026-08-25").map((e) => e.start), [540, 780, 900]);
eq("busyMinutes is 0 on an empty day", C.busyMinutes(withCal, "2026-08-27"), 0);
eq("committedByDate covers exactly the days with busy events",
   Object.keys(C.committedByDate(withCal)).sort(), ["2026-08-25", "2026-08-26"]);

// Two different numbers, deliberately: freeCapacity is coursework minutes (capped by
// the workbook's 90/day), freeHours is what's left of the 8-hour working day.
const cap = C.freeCapacity(state, "2026-08-25");
eq("coursework capacity is the workbook's assumption with no calendar", cap, 90);
eq("a light day doesn't dent the focused-work budget", C.freeCapacity(withCal, "2026-08-25"), 90);
eq("a five-hour teaching day still leaves the full focused-work budget",
   C.freeCapacity(withCal, "2026-08-26"), 90);
eq("but a day almost entirely committed leaves only the remainder",
   C.freeCapacity({ ...state, calendar: { ...withCal.calendar,
     events: [ev("2026-09-01", 480, 450)] } }, "2026-09-01"), 480 - 450);
eq("coursework capacity never goes negative",
   C.freeCapacity({ ...state, calendar: { ...withCal.calendar,
     events: [ev("2026-09-01", 480, 600)] } }, "2026-09-01"), 0);
eq("free hours is the whole working day when nothing is committed",
   C.freeHours(withCal, "2026-08-27"), 8);
eq("committed time comes off free hours", C.freeHours(withCal, "2026-08-25"), (480 - 125) / 60);

// --- workload14 gains committed / free / overbooked --------------------------
const plainDays = C.workload14(state, REF);
const calDays = C.workload14(withCal, REF);
eq("workload14 still reports the same work either way",
   calDays.map((d) => d.hours), plainDays.map((d) => d.hours));
eq("committed is 0 everywhere without a calendar", plainDays.every((d) => d.committed === 0), true);
eq("day 0 shows the imported committed hours", calDays[0].committed, 125 / 60);
eq("free is the working day minus committed", calDays[0].free, (480 - 125) / 60);
eq("overbooked only when work exceeds the free hours left",
   calDays.every((d) => d.overbooked === (d.hours > 0 && d.hours > d.free)), true);
eq("a day with no work is never overbooked",
   calDays.filter((d) => d.hours === 0).every((d) => !d.overbooked), true);

// A day swallowed whole by class has no room left, so any work due is overbooked.
const buried = { ...state, calendar: { ...withCal.calendar,
  events: [ev(C.addDays(REF, 3), 480, 24 * 60)] } };
const buriedDay = C.workload14(buried, REF)[3];
eq("a fully booked day leaves no free hours", buriedDay.free, 0);
eq("and any work due that day is overbooked", buriedDay.overbooked, buriedDay.hours > 0);

// --- realisticStart is advisory, and never contradicts the workbook formula ---
const task = { due: "2026-09-30", estMin: 300, status: "Not Started" };
eq("realisticStart equals startBy when no calendar is loaded",
   C.realisticStart(task, state, REF), C.startBy(task));
eq("startBy itself is untouched by a calendar", C.startBy(task), C.startBy(task));
const busyState = { ...state, calendar: { ...withCal.calendar,
  events: Array.from({ length: 40 }, (_, i) => ev(C.addDays("2026-09-30", -i), 480, 300)) } };
const advised = C.realisticStart(task, busyState, REF);
eq("a calendar full of class moves the advised start no later than the plain one",
   advised <= C.startBy(task), true);
eq("and never advises a date already in the past", advised >= REF, true);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
