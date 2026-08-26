/** The add/edit form, shared by the course views and Personal. */

import { taskTypes, priorities, statuses } from "../config.js";
import { update, nextSeq, load } from "../store.js";
import { today, surfacesOn, isLater, horizonOf } from "../compute.js";
import { esc, openDialog, meta, fmtDate } from "../ui.js";

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
    if (!confirm(`Delete “${existing.task}”? This can't be undone.`)) return;
    update((draft) => {
      const list = isPersonal ? draft.personal : draft.tasks[listKey];
      const i = list.findIndex((t) => t.id === existing.id);
      if (i >= 0) list.splice(i, 1);
    });
    el.close();
    onSaved?.();
  });

  openDialog(el);
  el.querySelector("#f-task").focus();
}

function commit(listKey, existing, data, isPersonal) {
  const now = today();

  update((draft) => {
    const list = isPersonal ? draft.personal : draft.tasks[listKey];
    const fields = {
      task: data.task.trim(),
      notes: (data.notes || "").trim(),
      due: data.due || null,
      priority: data.priority,
      status: data.status,
    };
    if (!isPersonal) {
      Object.assign(fields, {
        details: (data.details || "").trim(),
        type: data.type,
        estMin: data.estMin === "" ? null : Number(data.estMin),
        source: (data.source || "").trim(),
        activeFrom: data.activeFrom || null,
      });
    }

    if (existing) {
      const target = list.find((t) => t.id === existing.id);
      Object.assign(target, fields);
      // Completion date follows status in both directions.
      if (fields.status === "Done") target.completed ||= now;
      else target.completed = null;
    } else {
      list.push({
        id: crypto.randomUUID(),
        seq: nextSeq(),
        ...fields,
        ...(isPersonal ? {} : { added: now }),
        completed: fields.status === "Done" ? now : null,
      });
    }
  });
}

/** Fast path for the Surface button on a Later row. */
export function surfaceNow(listKey, id) {
  const now = today();
  update((draft) => {
    const task = draft.tasks[listKey]?.find((t) => t.id === id);
    if (task) task.activeFrom = now;
  });
}

/** Fast path for the checkbox in a task row. */
export function toggleDone(listKey, id) {
  const isPersonal = listKey === "Personal";
  const now = today();
  update((draft) => {
    const list = isPersonal ? draft.personal : draft.tasks[listKey];
    const task = list.find((t) => t.id === id);
    if (!task) return;
    if (task.status === "Done") {
      task.status = "Not Started";
      task.completed = null;
    } else {
      task.status = "Done";
      task.completed = now;
    }
  });
}
