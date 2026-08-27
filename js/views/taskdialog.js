/** The add/edit form, shared by the course views and Personal. */

import { taskTypes, priorities, statuses } from "../config.js";
import { load } from "../store.js";
import { today, surfacesOn, isLater, horizonOf } from "../compute.js";
import { esc, openDialog, meta, fmtDate } from "../ui.js";
import { createTask, patchTask, deleteTask } from "../tasks.js";

const dialog = () => document.getElementById("task-dialog");

const options = (values, selected) =>
  values.map((v) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");

function blank(isPersonal) {
  const base = { task: "", notes: "", due: "", priority: "Medium", status: "Not Started" };
  return isPersonal
    ? base
    : { ...base, details: "", type: "Assignment", estMin: "", source: "", activeFrom: null };
}

/**
 * Explains when this task joins the active list, and why. Written out in words because
 * the rule (earlier of the horizon and Start By) is not something to make anyone rederive.
 */
function timingNote(task, ref, horizon) {
  if (!task.due && !task.activeFrom) return "No due date, so this stays in the active list.";
  const surfaces = surfacesOn(task, horizon);
  if (!surfaces) return "This stays in the active list.";
  if (task.activeFrom) {
    return surfaces > ref
      ? `Pushed back by you — surfaces ${fmtDate(surfaces)}.`
      : `You surfaced this on ${fmtDate(surfaces)}.`;
  }
  return surfaces > ref
    ? `Automatic — surfaces ${fmtDate(surfaces)}, ${horizon} days before it's due (or on its start-by date, whichever is first).`
    : "Active now.";
}

/**
 * @param listKey  a course id, or "Personal"
 * @param existing the task to edit, or null to add
 */
export function openTaskDialog(listKey, existing, onSaved) {
  const isPersonal = listKey === "Personal";
  const task = existing || blank(isPersonal);
  const info = meta(listKey);
  const el = dialog();
  const ref = today();
  const horizon = horizonOf(load());

  el.style.cssText = `--accent: var(--c-${listKey})`;
  el.innerHTML = `
    <form method="dialog" id="task-form">
      <div class="dialog-head">
        <div>
          <div class="eyebrow">${esc(listKey)}${isPersonal ? "" : ` · ${esc(info.name)}`}</div>
          <h2>${existing ? "Edit task" : "New task"}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-close>Close</button>
      </div>

      <div class="dialog-body">
        <div class="form-grid">
          <div class="field span-2">
            <label for="f-task">Task</label>
            <input id="f-task" name="task" type="text" required value="${esc(task.task)}"
                   placeholder="Short name — this is what shows in every list">
          </div>

          ${isPersonal ? "" : `
          <div class="field span-2">
            <label for="f-details">Details / what's required</label>
            <textarea id="f-details" name="details" placeholder="What the assignment asks for, what to hand in">${esc(task.details)}</textarea>
          </div>
          <div class="field">
            <label for="f-type">Type</label>
            <select id="f-type" name="type">${options(taskTypes, task.type)}</select>
          </div>`}

          <div class="field">
            <label for="f-priority">Priority</label>
            <select id="f-priority" name="priority">${options(priorities, task.priority)}</select>
          </div>
          <div class="field">
            <label for="f-status">Status</label>
            <select id="f-status" name="status">${options(statuses, task.status)}</select>
          </div>
          <div class="field">
            <label for="f-due">Due date</label>
            <input id="f-due" name="due" type="date" value="${esc(task.due || "")}">
          </div>

          ${isPersonal ? `
          <div class="field span-2">
            <label for="f-notes">Notes</label>
            <textarea id="f-notes" name="notes">${esc(task.notes)}</textarea>
          </div>` : `
          <div class="field">
            <label for="f-est">Est. minutes</label>
            <input id="f-est" name="estMin" type="number" min="0" step="5" value="${esc(task.estMin ?? "")}"
                   placeholder="e.g. 90">
          </div>
          <div class="field span-2">
            <label for="f-source">Source / pages</label>
            <input id="f-source" name="source" type="text" value="${esc(task.source)}"
                   placeholder="Reading pages, filenames, week reference">
          </div>
          <div class="field span-2">
            <label for="f-notes">Notes</label>
            <textarea id="f-notes" name="notes">${esc(task.notes)}</textarea>
          </div>`}
        </div>

        ${isPersonal ? "" : `
        <fieldset class="timing">
          <legend>Timing</legend>
          <p class="small" id="timing-note">${esc(timingNote(task, ref, horizon))}</p>
          <div class="timing-row">
            <button class="btn btn-sm" type="button" id="f-surface">Surface now</button>
            <label class="small" for="f-active-from">or keep it out of the way until</label>
            <input id="f-active-from" name="activeFrom" type="date" value="${esc(task.activeFrom || "")}">
            <button class="btn btn-ghost btn-sm" type="button" id="f-auto">Automatic</button>
          </div>
        </fieldset>`}
      </div>

      <div class="dialog-foot">
        ${existing ? `<button class="btn btn-danger" type="button" id="f-delete">Delete</button>` : ""}
        <span style="flex:1"></span>
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="submit">${existing ? "Save changes" : "Add task"}</button>
      </div>
    </form>`;

  const form = el.querySelector("#task-form");
  const activeFrom = el.querySelector("#f-active-from");

  // The timing controls only ever write into the date field; commit() reads it once
  // on save, so nothing is persisted until the user actually saves the form.
  el.querySelector("#f-surface")?.addEventListener("click", () => {
    activeFrom.value = ref;
    refreshTimingNote();
  });
  el.querySelector("#f-auto")?.addEventListener("click", () => {
    activeFrom.value = "";
    refreshTimingNote();
  });
  activeFrom?.addEventListener("change", refreshTimingNote);
  el.querySelector("#f-due")?.addEventListener("change", refreshTimingNote);
  el.querySelector("#f-est")?.addEventListener("change", refreshTimingNote);

  function refreshTimingNote() {
    const note = el.querySelector("#timing-note");
    if (!note) return;
    const data = Object.fromEntries(new FormData(form));
    note.textContent = timingNote({
      due: data.due || null,
      estMin: data.estMin === "" ? null : Number(data.estMin),
      status: data.status,
      activeFrom: data.activeFrom || null,
    }, ref, horizon);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.task.trim()) return;
    commit(listKey, existing, data, isPersonal);
    el.close();
    onSaved?.();
  });

  el.querySelector("#f-delete")?.addEventListener("click", () => {
    if (!confirm(`Delete “${existing.task}”?`)) return;
    deleteTask(listKey, existing.id, { undoLabel: `Deleted “${existing.task}”` });
    el.close();
    onSaved?.();
  });

  openDialog(el);
  el.querySelector("#f-task").focus();
}

/**
 * Hand the form's values to the shared write path.
 *
 * Everything this used to do by hand — trimming, `estMin` coercion, the
 * status↔completed coupling, choosing the right list — now lives in js/tasks.js,
 * which is also what quick-edit and the bulk bar write through. There is one
 * definition of what a field means, so the dialog and a two-click popover edit
 * cannot disagree about it.
 */
function commit(listKey, existing, data, isPersonal) {
  const fields = {
    task: data.task,
    notes: data.notes,
    due: data.due,
    priority: data.priority,
    status: data.status,
  };
  if (!isPersonal) {
    Object.assign(fields, {
      details: data.details,
      type: data.type,
      estMin: data.estMin,
      source: data.source,
      activeFrom: data.activeFrom,
    });
  }

  if (existing) patchTask(listKey, existing.id, fields, { undoLabel: `Edited “${data.task.trim()}”` });
  else createTask(listKey, fields);
}
