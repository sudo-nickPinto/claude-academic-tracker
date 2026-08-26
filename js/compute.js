/**
 * All derived values. Pure functions over plain state — no DOM, no store access —
 * so the tricky arithmetic stays independently checkable from the console.
 *
 * Dates are 'YYYY-MM-DD' strings throughout. Day arithmetic normalizes to UTC before
 * subtracting: doing it on local Date objects goes off by one across a DST boundary,
 * which would misreport "days left" for exactly the deadlines that matter most.
 */

import {
  courseIds, majorTypes, priorities, priorityRank, statuses,
  dailyCapacityMin, workingDayMin, heavyDayHours, horizonDays, semester,
} from "./config.js";

const MS_PER_DAY = 86400000;

export function today() {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function toISO(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function epochDay(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Whole days from `from` to `iso`; negative means `iso` is in the past. */
export function dayDiff(iso, from) {
  if (!iso || !from) return null;
  return epochDay(iso) - epochDay(from);
}

export function addDays(iso, n) {
  const date = new Date(epochDay(iso) * MS_PER_DAY + n * MS_PER_DAY);
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export const isDone = (t) => t.status === "Done";

/** A row with no task name was an empty template row in the workbook — never counted. */
export const isNamed = (t) => Boolean(t.task && t.task.trim());

export function daysLeft(task, ref = today()) {
  if (!task.due || isDone(task)) return null;
  return dayDiff(task.due, ref);
}

export function startBy(task) {
  if (!task.due || !task.estMin || isDone(task)) return null;
  return addDays(task.due, -Math.max(1, Math.ceil(task.estMin / dailyCapacityMin)));
}

/** 'overdue' | 'soon' | 'done' | 'normal' — drives every row's styling. */
export function rowState(task, ref = today()) {
  if (isDone(task)) return "done";
  const left = daysLeft(task, ref);
  if (left === null) return "normal";
  if (left < 0) return "overdue";
  if (left <= 3) return "soon";
  return "normal";
}

export function shouldHaveStarted(task, ref = today()) {
  const start = startBy(task);
  return start !== null && !isDone(task) && epochDay(start) <= epochDay(ref);
}

// --------------------------------------------------------------- active / later

/**
 * The day a task stops being "Later" and joins today's work.
 *
 * Whichever comes first: the horizon (due minus N days) or the task's own Start By.
 * A big project's Start By can land inside the horizon, and when it does it wins —
 * a 12-hour project should never be buried by the same rule that hides a 20-minute
 * reading. Undated work has no horizon to sit behind, so it is always active.
 */
export function surfacesOn(task, horizon = horizonDays) {
  if (task.activeFrom) return task.activeFrom;
  if (!task.due) return null;
  const edge = addDays(task.due, -horizon);
  const start = startBy(task);
  return start && start < edge ? start : edge;
}

/** Statuses that mean work has actually begun, which surfaces a task on its own. */
const isUnderway = (t) => t.status === "In Progress" || t.status === "Waiting / Blocked";

/**
 * Later = real, editable, counted in the semester inventory, but not in today's list.
 *
 * The last two guards are what make Later safe to trust: anything overdue, and anything
 * already being worked on, surfaces no matter what the dates say. Combined with
 * surfacesOn taking Start By into account, nothing can go quietly past its start date.
 */
export function isLater(task, ref = today(), horizon = horizonDays) {
  if (isDone(task) || isUnderway(task)) return false;
  const left = daysLeft(task, ref);
  if (left !== null && left < 0) return false;
  const surfaces = surfacesOn(task, horizon);
  return surfaces !== null && epochDay(surfaces) > epochDay(ref);
}

export function isActive(task, ref = today(), horizon = horizonDays) {
  return !isDone(task) && !isLater(task, ref, horizon);
}

/** The horizon setting in effect, falling back to the built-in default. */
export const horizonOf = (state) =>
  typeof state?.prefs?.horizonDays === "number" ? state.prefs.horizonDays : horizonDays;

/** Coursework only. Personal is deliberately excluded from every aggregate. */
export function courseTasks(state) {
  return courseIds.flatMap((id) =>
    state.tasks[id].filter(isNamed).map((t) => ({ ...t, course: id })));
}


// ------------------------------------------------------------------- calendar

/**
 * Committed time, in minutes, on one date — imported calendar events that are
 * actually busy. Events marked "free" in Outlook are on the calendar but don't
 * compete with coursework, so they don't count here.
 */
export function busyMinutes(state, date) {
  const events = state?.calendar?.events;
  if (!Array.isArray(events)) return 0;
  return events.reduce((sum, e) => (e.date === date && e.busy ? sum + (e.minutes || 0) : sum), 0);
}

/** { 'YYYY-MM-DD': minutes } for every day with committed time. One pass. */
export function committedByDate(state) {
  const out = {};
  for (const e of state?.calendar?.events || []) {
    if (!e.busy) continue;
    out[e.date] = (out[e.date] || 0) + (e.minutes || 0);
  }
  return out;
}

export const eventsOn = (state, date) =>
  (state?.calendar?.events || [])
    .filter((e) => e.date === date)
    .sort((a, b) => a.start - b.start);

export const hasCalendar = (state) => Boolean(state?.calendar?.events?.length);

export const semesterWindow = (state) => ({ ...semester, ...(state?.prefs?.semester || {}) });

/**
 * Minutes actually available for coursework on a date: the daily capacity less
 * whatever the calendar has already spoken for, floored at zero.
 */
/**
 * Minutes of coursework a day can absorb: the workbook's focused-work assumption,
 * but never more than what the calendar has left of the working day. With no
 * calendar loaded this is exactly dailyCapacityMin, which is what keeps
 * realisticStart() identical to startBy() until an import actually says otherwise.
 */
export function freeCapacity(state, date) {
  return Math.max(0, Math.min(dailyCapacityMin, workingDayMin - busyMinutes(state, date)));
}

/** Hours of the working day the calendar hasn't already claimed. */
export function freeHours(state, date) {
  return Math.max(0, workingDayMin - busyMinutes(state, date)) / 60;
}

/**
 * An advisory start date that walks backward from the due date skipping days the
 * calendar has already filled, so a task needing three sessions doesn't nominally
 * "start" on a day with back-to-back classes.
 *
 * `startBy()` is deliberately NOT this. That formula mirrors the workbook and is
 * asserted against Excel's own cached values; it has to stay stable and
 * explainable. This is the second opinion, shown only once a calendar is loaded.
 */
export function realisticStart(task, state, ref = today()) {
  const plain = startBy(task);
  if (!plain || !hasCalendar(state)) return plain;

  let remaining = task.estMin;
  let date = task.due;
  // A term's worth of days is a generous bound; the loop exits on the work running out.
  for (let i = 0; i < 240 && remaining > 0; i++) {
    date = addDays(date, -1);
    remaining -= freeCapacity(state, date);
  }
  // Never advise a date later than the plain rule, and never one already past.
  const advised = date < plain ? date : plain;
  return advised < ref ? plain : advised;
}

const hours = (tasks) => tasks.reduce((sum, t) => sum + (t.estMin || 0), 0) / 60;

function dueWithin(task, ref, days) {
  const left = daysLeft(task, ref);
  return left !== null && left >= 0 && left <= days;
}

// ------------------------------------------------------------------ dashboard

export function dashboardStats(state, ref = today()) {
  const horizon = horizonOf(state);
  const all = courseTasks(state);
  // `open` stays "not done" — the honest semester inventory, and what the workbook
  // agrees with. Active and Later sit alongside it rather than redefining it.
  const open = all.filter((t) => !isDone(t));
  const later = open.filter((t) => isLater(t, ref, horizon));
  const active = open.filter((t) => !isLater(t, ref, horizon));
  const dueWeek = open.filter((t) => dueWithin(t, ref, 7));
  const done = all.filter(isDone);

  return {
    open: open.length,
    active: active.length,
    later: later.length,
    activeHours: hours(active),
    laterHours: hours(later),
    overdue: open.filter((t) => daysLeft(t, ref) < 0).length,
    dueWeek: dueWeek.length,
    hoursThisWeek: hours(dueWeek),
    shouldHaveStarted: open.filter((t) => shouldHaveStarted(t, ref)).length,
    completion: all.length ? done.length / all.length : 0,
    total: all.length,
    done: done.length,
  };
}

export function perCourse(state, ref = today()) {
  const horizon = horizonOf(state);
  return courseIds.map((id) => {
    const all = state.tasks[id].filter(isNamed);
    const open = all.filter((t) => !isDone(t));
    const active = open.filter((t) => !isLater(t, ref, horizon));
    const major = open
      .filter((t) => majorTypes.includes(t.type) && t.due)
      .sort((a, b) => a.due.localeCompare(b.due))[0] || null;

    return {
      course: id,
      total: all.length,
      done: all.length - open.length,
      open: open.length,
      active: active.length,
      later: open.length - active.length,
      activeHours: hours(active),
      overdue: open.filter((t) => daysLeft(t, ref) < 0).length,
      dueWeek: open.filter((t) => dueWithin(t, ref, 7)).length,
      estHours: hours(open),
      pctDone: all.length ? (all.length - open.length) / all.length : 0,
      nextBig: major,
      daysAway: major ? dayDiff(major.due, ref) : null,
    };
  });
}

/**
 * The morning list: everything overdue or landing within a week, ranked.
 * Sorting by due date ascending naturally floats overdue items to the top.
 */
export function upcoming(state, { ref = today(), includePersonal = false } = {}) {
  const pool = courseTasks(state);
  if (includePersonal) {
    pool.push(...state.personal.filter(isNamed).map((t) => ({ ...t, course: "Personal" })));
  }
  return pool
    .filter((t) => !isDone(t) && t.due)
    .filter((t) => {
      const left = daysLeft(t, ref);
      return left < 0 || left <= 7;
    })
    .sort((a, b) =>
      a.due.localeCompare(b.due) ||
      (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1) ||
      a.seq - b.seq);
}

/**
 * Everything sitting in Later, in the order it will surface. The point of showing this
 * is that Later must never feel like a hole things fall into.
 */
export function horizonList(state, ref = today()) {
  const horizon = horizonOf(state);
  return courseTasks(state)
    .filter((t) => isLater(t, ref, horizon))
    .map((t) => ({ ...t, surfaces: surfacesOn(t, horizon) }))
    .sort((a, b) =>
      a.surfaces.localeCompare(b.surfaces) ||
      (a.due || "").localeCompare(b.due || "") ||
      a.seq - b.seq);
}

export function workload14(state, ref = today()) {
  const open = courseTasks(state).filter((t) => !isDone(t) && t.due);
  return Array.from({ length: 14 }, (_, i) => {
    const date = addDays(ref, i);
    const due = open.filter((t) => t.due === date);
    const h = hours(due);
    const committed = busyMinutes(state, date) / 60;
    const free = freeHours(state, date);
    return {
      date, offset: i, count: due.length, hours: h, heavy: h >= heavyDayHours,
      committed,
      // Hours left for coursework once the calendar has taken its share.
      free,
      // More work due than there are hours left to do it in — the real crunch signal.
      overbooked: h > 0 && h > free,
    };
  });
}

// ------------------------------------------------------------------ analytics

export function analytics(state, ref = today()) {
  const horizon = horizonOf(state);
  const all = courseTasks(state);
  const open = all.filter((t) => !isDone(t));
  const later = open.filter((t) => isLater(t, ref, horizon));

  return {
    // Analytics counts the whole semester; the dashboard counts what's live today.
    snapshot: {
      total: all.length,
      open: open.length,
      active: open.length - later.length,
      later: later.length,
      completed: all.length - open.length,
      completion: all.length ? (all.length - open.length) / all.length : 0,
      overdue: open.filter((t) => daysLeft(t, ref) < 0).length,
      inProgress: all.filter((t) => t.status === "In Progress").length,
      blocked: all.filter((t) => t.status === "Waiting / Blocked").length,
      openHours: hours(open),
      avgMinPerOpen: open.length
        ? open.reduce((s, t) => s + (t.estMin || 0), 0) / open.length
        : 0,
      noDueDate: open.filter((t) => !t.due).length,
    },
    outlook: outlookBuckets(open, ref),
    byCourse: perCourse(state, ref).map((c) => ({
      key: c.course, open: c.open, done: c.done, overdue: c.overdue, estHours: c.estHours,
    })),
    // Priority is a closed vocabulary, so an unused level still gets a row (at zero)
    // in its own order. Type is open-ended, so those keys come from the data.
    byPriority: groupBy(all, (t) => t.priority, ref, priorities),
    byStatus: statusBreakdown(all),
    byType: groupBy(all, (t) => t.type, ref),
  };
}

function outlookBuckets(open, ref) {
  const buckets = {
    "Overdue": [], "Due today": [], "Next 7 days": [],
    "8–30 days": [], "Beyond 30 days": [], "No due date": [],
  };
  for (const t of open) {
    const left = daysLeft(t, ref);
    if (left === null) buckets["No due date"].push(t);
    else if (left < 0) buckets["Overdue"].push(t);
    else if (left === 0) buckets["Due today"].push(t);
    else if (left <= 7) buckets["Next 7 days"].push(t);
    else if (left <= 30) buckets["8–30 days"].push(t);
    else buckets["Beyond 30 days"].push(t);
  }
  return Object.entries(buckets).map(([key, tasks]) => ({
    key, count: tasks.length, hours: hours(tasks),
  }));
}

function groupBy(all, keyOf, ref, order) {
  const keys = order ?? [...new Set(all.map(keyOf))].filter(Boolean);
  return keys.map((key) => {
    const rows = all.filter((t) => keyOf(t) === key);
    const open = rows.filter((t) => !isDone(t));
    return {
      key,
      open: open.length,
      done: rows.length - open.length,
      overdue: open.filter((t) => daysLeft(t, ref) < 0).length,
      estHours: hours(open),
    };
  });
}

function statusBreakdown(all) {
  const keys = [...statuses, "No status set"];
  return keys.map((key) => {
    const count = all.filter((t) => (t.status || "No status set") === key).length;
    return { key, count, pct: all.length ? count / all.length : 0 };
  }).filter((row) => row.count > 0 || statuses.includes(row.key));
}

// --------------------------------------------------------------------- grades

export function gradeSummary(entry) {
  const items = entry.items.filter((i) => i.item && typeof i.weight === "number");
  const graded = items.filter((i) => typeof i.score === "number");

  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const gradedWeight = graded.reduce((s, i) => s + i.weight, 0);
  const earnedPoints = graded.reduce((s, i) => s + i.weight * i.score, 0);
  const remainingWeight = totalWeight - gradedWeight;
  const target = entry.target ?? 0.93;

  return {
    totalWeight,
    gradedWeight,
    earnedPoints,
    remainingWeight,
    target,
    currentGrade: gradedWeight > 0 ? earnedPoints / gradedWeight : null,
    neededOnRest: remainingWeight <= 0
      ? null
      : Math.max(0, (target - earnedPoints) / remainingWeight),
    // A common data-entry slip: weights that don't add up to a whole course.
    weightWarning: items.length > 0 && Math.abs(totalWeight - 1) > 0.005,
  };
}
