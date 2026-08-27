/**
 * Quick-edit cells, and the one controller that makes all of them work.
 *
 * Every view renders task rows differently — the dashboard has no Type column,
 * Personal has no estimate at all, the calendar's day panel is a list rather than
 * a table — so each view still owns its own markup. What it does not own is what
 * happens when someone clicks a value: that is here, once, delegated from a single
 * listener per view root rather than a handler per cell.
 *
 * The rendering helpers matter as much as the controller. A quick-edit trigger has
 * to render the *same string* the cell rendered before it was editable, because
 * `tools/tests/layout.test.mjs` measures column widths at 360px and a trigger that
 * adds so much as a caret glyph widens its column. See the `.qe` block in
 * css/controls.css for the full contract.
 */

import { esc, attrs, pill, fmtDate, weekday } from "../ui.js";
import { FIELD_SPEC, editableFields, taskById, patchTask } from "../tasks.js";
import { undo, undoDepth } from "../store.js";
import { openPopover, openEditor } from "../ui/popover.js";
import { toastUndo } from "../ui/toast.js";

/**
 * How a field reads inside a cell. Must match what the view rendered statically,
 * or the column changes width the first time a cell is repainted.
 *
 * `fmt` exists because views legitimately word the same value differently — the
 * dashboard's Due column reads "Mon Sep 7" where a course tab reads "Sep 7". The
 * trigger records which wording it used, so a repaint reproduces that one rather
 * than flattening every view to a single house style.
 */
export function fieldText(task, field, fmt) {
  switch (field) {
    case "due":
    case "activeFrom":
      return fmt === "weekday" && task[field]
        ? `${weekday(task[field])} ${fmtDate(task[field])}`
        : fmtDate(task[field]);
    case "estMin":
      return task.estMin ? `${task.estMin}m` : "—";
    default:
      return task[field] ?? "";
  }
}

/** The inner HTML of an editable cell: a pill for choices, plain text otherwise. */
export function fieldInner(task, field, fmt) {
  const spec = FIELD_SPEC[field];
  if (field === "type") return `<span class="tag">${esc(task.type)}</span>`;
  if (spec?.kind === "choice") return pill(task[field]);
  return esc(fieldText(task, field, fmt));
}

const isEmpty = (task, field) =>
  task[field] === null || task[field] === undefined || task[field] === "";

/**
 * One editable cell.
 *
 * The button carries everything the controller needs, so the controller never has
 * to walk the DOM to work out what was clicked — which is what lets the same
 * listener serve a table row, a folded twin of that row, and a list item in the
 * calendar's day panel without knowing anything about any of them.
 */
export function qe(listKey, task, field, { fmt } = {}) {
  const spec = FIELD_SPEC[field];
  // A field the list doesn't carry renders as plain text rather than as a control
  // that would open, accept a value, and then have it dropped by `taskPatch` —
  // Personal has no estimate, so a Personal row on the dashboard shows "—" and
  // nothing more.
  if (!spec || !editableFields(listKey).some(([key]) => key === field)) {
    return fieldInner(task, field, fmt);
  }

  const value = fieldText(task, field, fmt);
  return `<button type="button" class="qe"${attrs({
    "data-qe": field,
    "data-qe-list": listKey,
    "data-qe-id": task.id,
    "data-qe-fmt": fmt || false,
    "data-empty": isEmpty(task, field) ? "true" : false,
    "aria-expanded": "false",
    "aria-haspopup": spec.kind === "choice" ? "listbox" : "dialog",
    "aria-label": `${spec.label}: ${value || "not set"}. Activate to change.`,
  })}>${fieldInner(task, field, fmt)}</button>`;
}

// -------------------------------------------------------------- repaint

/**
 * Rewrite the editable cells of one row from the task's current values.
 *
 * Partial repaint rather than a view-wide re-render, following the precedent in
 * js/views/grades.js: re-rendering the whole view on every edit throws away focus,
 * scroll position and any open search box, and js/views/course.js already shows
 * what that costs — it re-renders per keystroke and then has to restore the caret
 * by hand.
 */
export function repaintCells(root, task, listKey) {
  root.querySelectorAll("[data-qe]").forEach((btn) => {
    if (btn.dataset.qeId !== task.id) return;
    const field = btn.dataset.qe;
    if (!FIELD_SPEC[field]) return;

    const fmt = btn.dataset.qeFmt;
    btn.innerHTML = fieldInner(task, field, fmt);
    const value = fieldText(task, field, fmt);
    btn.setAttribute("aria-label", `${FIELD_SPEC[field].label}: ${value || "not set"}. Activate to change.`);
    if (isEmpty(task, field)) btn.dataset.empty = "true";
    else delete btn.dataset.empty;
  });
}

/** A brief flash on the cell that was just written, in place of moving anything. */
export function flashSaved(root, taskId, field) {
  const btn = root.querySelector(`[data-qe="${field}"][data-qe-id="${taskId}"]`);
  if (!btn) return;
  btn.dataset.saved = "true";
  setTimeout(() => { delete btn.dataset.saved; }, 400);
}

/**
 * Mark a row that no longer belongs in the list it is sitting in.
 *
 * Deliberately not removed. An edit that re-buckets a row — marking it Done in an
 * open-only list, pushing a due date past the horizon — would otherwise delete the
 * row out from under the cursor, moving every row below it up by one and leaving
 * the pointer over something the user never meant to touch. It stays, greyed, with
 * a note about where it is going, and leaves on the next render.
 */
export function markStale(tr, label) {
  if (!tr || tr.dataset.stale === label) return;
  tr.dataset.stale = label;

  const main = tr.querySelector('[data-cell="main"] .cell-main')
    || tr.querySelector(".cell-main")
    || tr.querySelector(".cal-ev");
  if (!main || tr.querySelector(".stale-cue")) return;
  const cue = document.createElement("span");
  cue.className = "stale-cue";
  cue.textContent = label;
  // The calendar's day panel is a three-column grid, so a fourth child would start a
  // new row. There the cue goes inside the title cell rather than beside it.
  if (main.classList.contains("cal-ev")) main.append(cue);
  else main.insertAdjacentElement("afterend", cue);
}

export function clearStale(tr) {
  if (!tr) return;
  delete tr.dataset.stale;
  tr.querySelector(".stale-cue")?.remove();
}

// ------------------------------------------------------------ controller

/**
 * Wire every quick-edit cell under `root`.
 *
 * @param root     the view's container; one listener is attached to it
 * @param onEdited called after a successful write (and after an undo) with
 *                 `{ listKey, id, field, task, trigger }`. The view uses it to
 *                 repaint derived cells — days left, start-by, row state — that
 *                 only it knows how to compute.
 */
const handlers = new WeakMap();

export function mountQuickEdit(root, { onEdited } = {}) {
  if (!root) return;

  // Every view renders into the same `#outlet`, so the listener is attached once and
  // the callback is swapped on each render. Registering a second listener would leave
  // the dashboard's repaint running against a course tab's rows; skipping the second
  // call entirely — the obvious guard — would do the same thing the other way round.
  handlers.set(root, onEdited);
  if (root.dataset.qeMounted) return;
  root.dataset.qeMounted = "1";

  root.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-qe]");
    if (!trigger || !root.contains(trigger)) return;
    e.preventDefault();
    e.stopPropagation();
    openFor(root, trigger, (detail) => handlers.get(root)?.(detail));
  });
}

function openFor(root, trigger, onEdited) {
  const field = trigger.dataset.qe;
  const listKey = trigger.dataset.qeList;
  const id = trigger.dataset.qeId;
  const spec = FIELD_SPEC[field];
  const task = taskById(listKey, id);
  if (!spec || !task) return;

  const write = (raw) => commit(root, { listKey, id, field, raw, trigger, onEdited });

  if (spec.kind === "choice") {
    openPopover(trigger, {
      label: spec.label,
      values: spec.values,
      value: task[field],
      asPill: field !== "type",
      onPick: write,
    });
  } else {
    openEditor(trigger, {
      label: spec.label,
      type: spec.kind === "number" ? "number" : "date",
      value: spec.kind === "number" ? (task[field] ?? "") : (task[field] || ""),
      clearable: spec.clearable,
      min: spec.kind === "number" ? 0 : undefined,
      step: spec.step,
      hint: field === "activeFrom"
        ? "The day this stops being Later. Clear it to go back to automatic."
        : undefined,
      onCommit: write,
    });
  }
}

function commit(root, { listKey, id, field, raw, trigger, onEdited }) {
  const spec = FIELD_SPEC[field];
  const before = patchTask(listKey, id, { [field]: raw }, { undoLabel: spec.label });
  if (!before) return;

  const task = taskById(listKey, id);
  repaintCells(root, task, listKey);
  flashSaved(root, id, field);
  onEdited?.({ listKey, id, field, task, trigger, before });

  // Only offer the undo while it is still the most recent write. The stack is
  // LIFO over whole-state snapshots, so undoing after two further edits would
  // silently revert those too — the depth check is what stops a stale toast from
  // throwing away work the user did after it appeared.
  const depth = undoDepth();
  toastUndo(`${spec.label} → ${fieldText(task, field) || "not set"}`, () => {
    if (undoDepth() !== depth) return;
    undo();
    const reverted = taskById(listKey, id);
    if (!reverted) return;
    repaintCells(root, reverted, listKey);
    onEdited?.({ listKey, id, field, task: reverted, trigger, undone: true });
  });
}
