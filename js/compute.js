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
  dailyCapacityMin, heavyDayHours,
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

/** Coursework only. Personal is deliberately excluded from every aggregate. */
export function courseTasks(state) {
  return courseIds.flatMap((id) =>
    state.tasks[id].filter(isNamed).map((t) => ({ ...t, course: id })));
}

const hours = (tasks) => tasks.reduce((sum, t) => sum + (t.estMin || 0), 0) / 60;

function dueWithin(task, ref, days) {
  const left = daysLeft(task, ref);
  return left !== null && left >= 0 && left <= days;
}

// ------------------------------------------------------------------ dashboard

export function dashboardStats(state, ref = today()) {
  const all = courseTasks(state);
  const open = all.filter((t) => !isDone(t));
  const dueWeek = open.filter((t) => dueWithin(t, ref, 7));
  const done = all.filter(isDone);

  return {
    open: open.length,
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
  return courseIds.map((id) => {
    const all = state.tasks[id].filter(isNamed);
    const open = all.filter((t) => !isDone(t));
    const major = open
      .filter((t) => majorTypes.includes(t.type) && t.due)
      .sort((a, b) => a.due.localeCompare(b.due))[0] || null;

    return {
      course: id,
      total: all.length,
      done: all.length - open.length,
      open: open.length,
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

export function workload14(state, ref = today()) {
  const open = courseTasks(state).filter((t) => !isDone(t) && t.due);
  return Array.from({ length: 14 }, (_, i) => {
    const date = addDays(ref, i);
    const due = open.filter((t) => t.due === date);
    const h = hours(due);
    return { date, offset: i, count: due.length, hours: h, heavy: h >= heavyDayHours };
  });
}

// ------------------------------------------------------------------ analytics

export function analytics(state, ref = today()) {
  const all = courseTasks(state);
  const open = all.filter((t) => !isDone(t));

  return {
    snapshot: {
      total: all.length,
      open: open.length,
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
