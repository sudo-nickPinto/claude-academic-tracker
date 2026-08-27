/**
 * The task write path — the one place a task field is coerced, and the one place a
 * task is patched.
 *
 * Before this module, every write was an ad-hoc `update(draft => …)` that re-derived
 * `isPersonal ? draft.personal : draft.tasks[listKey]`, found the row by id, and
 * hand-maintained the status/completed coupling. That coupling was written twice and
 * had already drifted in shape between the two copies; quick-edit would have made it
 * three. So coercion and the coupling live here as pure functions, and every caller —
 * the dialog, the row checkbox, quick-edit, bulk actions — goes through `patchTask`.
 */

import { priorities, statuses, taskTypes } from "./config.js";
import { today } from "./compute.js";
import { load, update, nextSeq } from "./store.js";

/**
 * What each editable field is, and which lists it belongs to.
 *
 * `courseOnly` marks the fields a Personal task has no room for. Personal is
 * deliberately seven fields wide (id, seq, task, notes, due, priority, status), and
 * this table is what stops a quick-edit popover inventing an eighth.
 */
export const FIELD_SPEC = {
  priority: { kind: "choice", values: priorities, label: "Priority" },
  status: { kind: "choice", values: statuses, label: "Status" },
  type: { kind: "choice", values: taskTypes, label: "Type", courseOnly: true },
  due: { kind: "date", label: "Due date", clearable: true },
  estMin: { kind: "number", label: "Est. minutes", courseOnly: true, clearable: true, step: 5 },
  activeFrom: { kind: "date", label: "Surface on", courseOnly: true, clearable: true },
};

/** Written alongside a field, never typed by anyone. */
const DERIVED = new Set(["completed"]);

/** Writable whatever list the task lives in. */
const ALWAYS = new Set(["task", "details", "source", "notes"]);

/** The [key, spec] pairs a given list may edit. */
export function editableFields(listKey) {
  const personal = listKey === "Personal";
  return Object.entries(FIELD_SPEC).filter(([, spec]) => !(personal && spec.courseOnly));
}

/**
 * Normalize one field. Pure, total, and never throws: an unusable value becomes the
 * field's resting state rather than propagating.
 *
 * The `estMin` guard matters more than it looks. `Number("abc")` is NaN, and while NaN
 * is falsy — so `startBy` and the hour sums already absorb it — `JSON.stringify` writes
 * it as `null`, so a bad value round-trips through a save as silent data loss. A number
 * input sanitizes before FormData sees it, but `importJSON` and free-text editors don't.
 */
export function coerceField(field, raw) {
  switch (field) {
    case "task":
    case "details":
    case "source":
    case "notes":
      return String(raw ?? "").trim();
    case "due":
    case "activeFrom":
    case "completed":
      return raw ? String(raw) : null;
    case "estMin": {
      if (raw === "" || raw === null || raw === undefined) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }
    case "priority":
      return priorities.includes(raw) ? raw : "Medium";
    case "status":
      return statuses.includes(raw) ? raw : "Not Started";
    case "type":
      return taskTypes.includes(raw) ? raw : "Other";
    default:
      return raw;
  }
}

/**
 * Build the patch to apply to `task`. Pure — no store, no DOM — which is what makes the
 * completion coupling testable instead of merely asserted in a browser.
 *
 * Completion follows status in both directions: entering Done stamps the date unless the
 * task already carries one, leaving Done clears it. A patch that doesn't touch status
 * doesn't touch `completed` either.
 */
export function taskPatch(task, fields, listKey, ref = today()) {
  const allowed = new Set(editableFields(listKey).map(([key]) => key));
  const out = {};

  for (const [key, value] of Object.entries(fields)) {
    if (DERIVED.has(key)) continue;
    if (!allowed.has(key) && !ALWAYS.has(key)) continue;
    out[key] = coerceField(key, value);
  }

  if ("status" in out) {
    out.completed = out.status === "Done" ? (task.completed || ref) : null;
  }
  return out;
}

const listOf = (state, listKey) =>
  (listKey === "Personal" ? state.personal : state.tasks[listKey]);

export function taskById(listKey, id, state = load()) {
  return listOf(state, listKey)?.find((t) => t.id === id) || null;
}

/**
 * Apply `fields` to one task. Returns a shallow copy of the task as it was — what the
 * caller shows in an undo toast, and `null` when the id no longer resolves.
 */
export function patchTask(listKey, id, fields, { undoLabel } = {}) {
  const ref = today();
  let before = null;

  update((draft) => {
    const target = listOf(draft, listKey)?.find((t) => t.id === id);
    if (!target) return;
    before = { ...target };
    Object.assign(target, taskPatch(target, fields, listKey, ref));
  }, { undoLabel });

  return before;
}

/** Apply the same fields to many tasks in ONE write, so a single undo reverts the batch. */
export function patchMany(entries, fields, { undoLabel } = {}) {
  const ref = today();
  let count = 0;
  update((draft) => {
    for (const { listKey, id } of entries) {
      const target = listOf(draft, listKey)?.find((t) => t.id === id);
      if (!target) continue;
      Object.assign(target, taskPatch(target, fields, listKey, ref));
      count += 1;
    }
  }, { undoLabel });
  return count;
}

export function createTask(listKey, fields) {
  const ref = today();
  const personal = listKey === "Personal";
  let created = null;

  update((draft) => {
    const seeded = taskPatch({}, fields, listKey, ref);
    created = {
      id: crypto.randomUUID(),
      seq: nextSeq(),
      task: coerceField("task", fields.task),
      notes: coerceField("notes", fields.notes),
      due: null,
      priority: "Medium",
      status: "Not Started",
      ...(personal ? {} : {
        details: "", type: "Assignment", estMin: null, source: "", activeFrom: null, added: ref,
      }),
      ...seeded,
      completed: seeded.status === "Done" ? ref : null,
    };
    listOf(draft, listKey).push(created);
  }, { undoLabel: "Task added" });

  return created;
}

export function deleteTask(listKey, id, { undoLabel = "Task deleted" } = {}) {
  let removed = null;
  update((draft) => {
    const list = listOf(draft, listKey);
    const i = list ? list.findIndex((t) => t.id === id) : -1;
    if (i >= 0) removed = list.splice(i, 1)[0];
  }, { undoLabel });
  return removed;
}

/** The row checkbox. Flipping status is all it does — `completed` follows on its own. */
export function toggleDone(listKey, id) {
  const task = taskById(listKey, id);
  if (!task) return null;
  const done = task.status === "Done";
  return patchTask(listKey, id, { status: done ? "Not Started" : "Done" },
    { undoLabel: done ? "Marked not started" : "Marked done" });
}

/** The Surface button on a Later row: pull it into the active list as of today. */
export function surfaceNow(listKey, id) {
  return patchTask(listKey, id, { activeFrom: today() }, { undoLabel: "Surfaced" });
}
