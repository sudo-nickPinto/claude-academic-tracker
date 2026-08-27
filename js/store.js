/**
 * The persistence seam. Every read and write of saved state goes through here —
 * no other module may touch localStorage. Swapping in a real backend later means
 * reimplementing load/save/subscribe and nothing else.
 */

import { courseIds, horizonDays } from "./config.js";
import { seedTasks, seedPersonal, seedGrades } from "./seed.js";

// The key stays at v1 across version bumps: changing it would orphan saved data.
// `version` records the shape, and normalize() migrates older payloads forward.
const KEY = "academic-tracker/v1";
const VERSION = 4;

const listeners = new Set();
let state = null;

/** Imported calendar events, kept apart from tasks — they are time, not work. */
const emptyCalendar = () => ({ events: [], importedAt: null, filename: null, stats: null });

/**
 * Fills in the fields a task is allowed to be missing.
 *
 * `order` is the manual position inside a course tab. It seeds from `seq`, the
 * workbook's own row order, so turning "My order" on for the first time shows the
 * list you already had rather than a shuffled one. `seq` itself is never rewritten:
 * it is provenance — which row of the spreadsheet this came from — and reordering
 * the screen is not allowed to forge that.
 */
const withDefaults = (list) => list.map((t, i) => ({
  activeFrom: null,
  ...t,
  order: typeof t.order === "number" ? t.order : (t.seq ?? i),
}));

function seedState() {
  return {
    version: VERSION,
    tasks: Object.fromEntries(courseIds.map((id) =>
      [id, withDefaults(structuredClone(seedTasks[id] || []))])),
    personal: structuredClone(seedPersonal),
    grades: structuredClone(seedGrades),
    prefs: { theme: "system", includePersonalInWeek: false, horizonDays, courseSort: {} },
    calendar: emptyCalendar(),
  };
}

/**
 * Fills in anything a saved payload is missing — an older save, a hand-edited
 * import, or a course added after the save was written.
 */
function normalize(raw) {
  const base = seedState();
  if (!raw || typeof raw !== "object") return base;

  const tasks = {};
  for (const id of courseIds) {
    const saved = Array.isArray(raw.tasks?.[id]) ? raw.tasks[id] : [];
    // v1 → v2: activeFrom is the manual override on when a task leaves "Later".
    // Absent means automatic, which is what every pre-v2 task should be.
    // v3 → v4: order is the manual position, seeded from the workbook's row order.
    tasks[id] = withDefaults(saved);
  }

  const grades = {};
  for (const id of courseIds) {
    const saved = raw.grades?.[id];
    grades[id] = {
      items: Array.isArray(saved?.items) ? saved.items : [],
      target: typeof saved?.target === "number" ? saved.target : 0.93,
    };
  }

  return {
    version: VERSION,
    tasks,
    personal: Array.isArray(raw.personal) ? raw.personal : [],
    grades,
    prefs: {
      ...base.prefs,
      ...(raw.prefs || {}),
      courseSort: { ...(raw.prefs?.courseSort || {}) },
    },
    // v2 → v3: an imported Outlook calendar. Absent on every older save, which is
    // correct — no calendar means no committed time, and the app reads the same
    // as it did before the feature existed.
    calendar: { ...emptyCalendar(), ...(raw.calendar || {}) },
  };
}

export function load() {
  if (state) return state;
  let raw = null;
  try {
    const stored = localStorage.getItem(KEY);
    raw = stored ? JSON.parse(stored) : null;
  } catch {
    raw = null; // unreadable or corrupt — fall back to seed rather than dying
  }
  state = raw ? normalize(raw) : seedState();
  return state;
}

export function save(next) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Could not persist state:", err);
  }
  for (const fn of listeners) fn(state);
  return state;
}

/** Apply a mutation to a draft copy, then persist and notify. */
export function update(mutator) {
  const draft = structuredClone(load());
  mutator(draft);
  return save(draft);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Highest seq ever used, so new rows keep a stable insertion order. */
export function nextSeq() {
  const current = load();
  const all = [...Object.values(current.tasks).flat(), ...current.personal];
  return all.reduce((max, t) => Math.max(max, t.seq ?? 0), 0) + 1;
}

export function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

/** Throws on malformed input so the caller can show a real error. */
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("File is not a tracker export.");
  if (!parsed.tasks && !parsed.personal) throw new Error("No tasks found in that file.");
  return save(normalize(parsed));
}

export function resetToSeed() {
  return save(seedState());
}
