import { courses } from "../config.js";
import { load, undo } from "../store.js";
import {
  today, daysLeft, startBy, realisticStart, rowState, shouldHaveStarted, isDone, isNamed,
  isLater, surfacesOn, horizonOf, hasCalendar,
} from "../compute.js";
import { esc, fmtDate, fmtHours, fmtPct, bar, daysLabel, emptyState } from "../ui.js";
import { openTaskDialog } from "./taskdialog.js";
import { toggleDone, surfaceNow, patchMany, editableFields, FIELD_SPEC } from "../tasks.js";
import { qe, mountQuickEdit, markStale, clearStale } from "./row.js";
import { showBulkBar, hideBulkBar } from "../ui/bulkbar.js";
import { toastUndo } from "../ui/toast.js";

const filters = {};

/**
 * Bulk selection state.
 *
 * The row checkbox does double duty rather than a second column appearing: an extra
 * <td> would shift every cell index after it, and the table already folds three
 * columns away by 700px — a permanent select column would be the first thing
 * competing for that space. In select mode the same checkbox means "selected"
 * instead of "done", which is also why the mode has to be explicit and visible.
 */
let selectMode = false;
let selected = new Set();
let selectionFor = null;

const MATCHERS = {
  active: (t, ref, h) => !isDone(t) && !isLater(t, ref, h),
  later: (t, ref, h) => isLater(t, ref, h),
  done: (t) => isDone(t),
  all: () => true,
};

const FILTERS = [
  { key: "active", label: "Active now" },
  { key: "later", label: "Later" },
  { key: "all", label: "All" },
  { key: "done", label: "Completed" },
];

/**
 * The filter, as a row of chips rather than a dropdown.
 *
 * A `<select>` hid three of the four counts behind a click — you could not see that
 * fourteen tasks were waiting in Later without opening it. The chips show every count
 * at once and cost one click instead of three, and they wrap rather than forcing a
 * minimum width on the toolbar, which a native select does.
 */
function chipRow(f, counts) {
  return `
  <div class="chip-row" role="group" aria-label="Filter tasks">
    ${FILTERS.map(({ key, label }) => `
      <button type="button" class="chip-filter" data-filter="${key}"
              aria-pressed="${f.status === key}">
        ${esc(label)}<span class="chip-count">${counts[key]}</span>
      </button>`).join("")}
  </div>`;
}

export function renderCourse(outlet, id) {
  // A selection means nothing on a course you are no longer looking at.
  if (selectionFor !== id) {
    selectionFor = id;
    selectMode = false;
    selected = new Set();
  }

  const state = load();
  const info = courses[id];
  const all = state.tasks[id].filter(isNamed);
  filters[id] ||= { status: "active", q: "" };
  const f = filters[id];
  const ref = today();
  const horizon = horizonOf(state);

  const open = all.filter((t) => !isDone(t));
  const later = open.filter((t) => isLater(t, ref, horizon));
  const match = MATCHERS[f.status] || MATCHERS.all;
  const visible = all
    .filter((t) => match(t, ref, horizon))
    .filter((t) => !f.q || `${t.task} ${t.details} ${t.source} ${t.notes}`.toLowerCase().includes(f.q.toLowerCase()))
    .sort((a, b) => {
      if (!a.due && !b.due) return a.seq - b.seq;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due) || a.seq - b.seq;
    });

  const active = open.filter((t) => !isLater(t, ref, horizon));
  const withCal = hasCalendar(state);
  const hours = active.reduce((s, t) => s + (t.estMin || 0), 0) / 60;
  const pctDone = all.length ? (all.length - open.length) / all.length : 0;

  outlet.style.cssText = `--accent: var(--c-${id})`;
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">${esc(id)}</div>
        <h1>${esc(info.name)}</h1>
      </div>
      <button class="btn btn-primary" id="add-task">+ New task</button>
    </header>

    <div class="stat-grid" style="margin-bottom:var(--sp-4)">
      <div class="stat"><span class="stat-label">Active</span><span class="stat-value">${active.length}</span>
        <span class="stat-sub">of ${open.length} open</span></div>
      <div class="stat"><span class="stat-label">Later</span><span class="stat-value">${later.length}</span>
        <span class="stat-sub">surface automatically</span></div>
      <div class="stat" data-tone="danger"><span class="stat-label">Overdue</span>
        <span class="stat-value">${open.filter((t) => daysLeft(t, ref) < 0).length}</span></div>
      <div class="stat"><span class="stat-label">Est. hours active</span><span class="stat-value">${fmtHours(hours)}</span></div>
      <div class="stat"><span class="stat-label">Complete</span>
        <span class="stat-value">${fmtPct(pctDone)}</span>
        <span class="stat-sub">${all.length - open.length} of ${all.length} done</span>
        ${bar(pctDone)}
      </div>
    </div>

    <div class="toolbar">
      ${chipRow(f, {
        active: active.length,
        later: later.length,
        all: all.length,
        done: all.length - open.length,
      })}
      <input id="f-q" type="text" placeholder="Search tasks…" value="${esc(f.q)}" style="width:auto;flex:1 1 200px">
      <span class="spacer"></span>
      <button class="btn btn-sm" type="button" id="select-mode" aria-pressed="${selectMode}"
              title="Use the row checkboxes to select tasks instead of completing them">
        ${selectMode ? "Done selecting" : "Select"}
      </button>
      <span class="small faint">${visible.length} shown</span>
    </div>

    ${visible.length ? table(id, visible, ref, horizon, state, withCal) : emptyState(
      emptyHeadline(f, later.length),
      f.q ? "" : "Add one with the New task button.")}`;

  wire(outlet, id, f);
}

function emptyHeadline(f, laterCount) {
  if (f.q) return "Nothing matches that search.";
  if (f.status === "later") return "Nothing waiting on the horizon.";
  if (f.status !== "active") return "Nothing matches that filter.";
  return laterCount
    ? `Nothing active — ${laterCount} task${laterCount === 1 ? "" : "s"} waiting on the horizon.`
    : "No open tasks — you're clear.";
}

function table(listKey, rows, ref, horizon, state, withCal) {
  return `
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:34px"><span class="sr">Done</span></th>
          <th>Task</th>
          <th data-col="t2">Type</th>
          <th data-col="t3">Priority</th>
          <th>Status</th>
          <th class="num">Due</th>
          <th class="num">Days</th>
          <th class="num" data-col="t1">Est.</th>
          <th class="num" data-col="t1">Start by</th>
          <th style="width:52px"></th>
        </tr>
      </thead>
      <tbody>${rows.map((t) => row(listKey, t, ref, horizon, state, withCal)).join("")}</tbody>
    </table>
  </div>`;
}

/** The half of a row that any edit can change, extracted so `refreshRow` can rebuild it. */
function foldLine(t) {
  const start = startBy(t);
  const est = t.estMin ? `${t.estMin}m` : "\u2014";
  return `${start ? `Start by ${fmtDate(start)}` : "No start date"} \u00b7 ${est} est`;
}

function startCell(t, state, ref, withCal) {
  const start = startBy(t);
  const real = withCal ? realisticStart(t, state, ref) : null;
  return `${start ? fmtDate(start) : "\u2014"}
      ${real && real !== start ? `<span class="cell-sub faint" title="Allowing for the time already committed on your calendar">cal. ${fmtDate(real)}</span>` : ""}`;
}

function laterTag(t, horizon) {
  const surfaces = surfacesOn(t, horizon);
  return `<span class="tag tag-later">Later \u00b7 surfaces ${fmtDate(surfaces)}${t.activeFrom ? " (you set this)" : ""}</span>`;
}

function row(listKey, t, ref, horizon, state, withCal) {
  const left = daysLeft(t, ref);
  const late = shouldHaveStarted(t, ref);
  const later = isLater(t, ref, horizon);

  return `
  <tr data-state="${later ? "later" : rowState(t, ref)}" data-id="${t.id}" data-later="${later}">
    <td data-cell="check"><input type="checkbox" class="toggle checkbox" ${
      (selectMode ? selected.has(t.id) : isDone(t)) ? "checked" : ""
    } aria-label="${selectMode ? `Select ${esc(t.task)}` : `Mark ${esc(t.task)} done`}"></td>
    <td data-cell="main">
      <span class="cell-main">${esc(t.task)}</span>
      <span data-derived="later">${later ? laterTag(t, horizon) : ""}</span>
      ${t.details ? `<span class="cell-sub">${esc(t.details)}</span>` : ""}
      ${t.source ? `<span class="cell-sub faint">${esc(t.source)}</span>` : ""}
      <span class="cell-fold" data-when="t1" data-derived="fold">${foldLine(t)}</span>
      <span class="cell-fold cell-fold-inline" data-when="t2">${qe(listKey, t, "type")}</span>
      <span class="cell-fold cell-fold-inline" data-when="t3">${qe(listKey, t, "priority")}</span>
    </td>
    <td data-col="t2" data-label="Type">${qe(listKey, t, "type")}</td>
    <td data-col="t3" data-label="Priority">${qe(listKey, t, "priority")}</td>
    <td data-label="Status">${qe(listKey, t, "status")}</td>
    <td class="num nowrap" data-label="Due">${qe(listKey, t, "due")}</td>
    <td class="num nowrap days-left" data-neg="${left !== null && left < 0}" data-label="Days left" data-derived="days">${daysLabel(left)}</td>
    <td class="num nowrap" data-col="t1" data-label="Est.">${qe(listKey, t, "estMin")}</td>
    <td class="num nowrap ${late ? "start-flag" : ""}" data-col="t1" data-label="Start by" data-derived="startby">${startCell(t, state, ref, withCal)}</td>
    <td class="nowrap" data-cell="act">
      ${later ? '<button class="btn btn-ghost btn-sm surface" type="button" title="Move this into the active list now">Surface</button>' : ""}
      <button class="btn btn-ghost btn-sm edit" type="button">Edit</button>
    </td>
  </tr>`;
}

/**
 * Repaint everything in one row that an edit can have changed but that isn't itself
 * editable: the derived dates, the Later tag and its Surface button, the row's urgency
 * state, and — when the edit has pushed the task out of the filter you are looking at —
 * the cue saying so.
 */
function refreshRow(outlet, listKey, task, f, rerender) {
  const tr = outlet.querySelector(`tbody tr[data-id="${CSS.escape(task.id)}"]`);
  if (!tr) return;

  // Read the state fresh rather than closing over the render's copy: an edit is the
  // one moment the two are guaranteed to differ.
  const state = load();
  const ref = today();
  const horizon = horizonOf(state);
  const withCal = hasCalendar(state);
  const left = daysLeft(task, ref);
  const later = isLater(task, ref, horizon);

  const days = tr.querySelector('[data-derived="days"]');
  if (days) {
    days.textContent = daysLabel(left);
    days.dataset.neg = String(left !== null && left < 0);
  }

  const startTd = tr.querySelector('[data-derived="startby"]');
  if (startTd) {
    startTd.innerHTML = startCell(task, state, ref, withCal);
    startTd.classList.toggle("start-flag", shouldHaveStarted(task, ref));
  }

  const fold = tr.querySelector('[data-derived="fold"]');
  if (fold) fold.textContent = foldLine(task);

  const tag = tr.querySelector('[data-derived="later"]');
  if (tag) tag.innerHTML = later ? laterTag(task, horizon) : "";

  tr.dataset.state = later ? "later" : rowState(task, ref);
  tr.dataset.later = String(later);
  tr.querySelector(".toggle").checked = isDone(task);

  // Surface only exists on a Later row, so it appears and disappears with one.
  const act = tr.querySelector('[data-cell="act"]');
  const hasSurface = Boolean(tr.querySelector(".surface"));
  if (later && !hasSurface) {
    act.insertAdjacentHTML("afterbegin",
      '<button class="btn btn-ghost btn-sm surface" type="button" title="Move this into the active list now">Surface</button>');
    tr.querySelector(".surface").addEventListener("click", () => {
      surfaceNow(listKey, task.id);
      rerender();
    });
  } else if (!later && hasSurface) {
    tr.querySelector(".surface").remove();
  }

  const matches = (MATCHERS[f.status] || MATCHERS.all)(task, ref, horizon);
  if (matches) clearStale(tr);
  else markStale(tr, `no longer matches “${FILTER_NAMES[f.status] || f.status}”`);
}

const FILTER_NAMES = {
  active: "Active now",
  later: "Later",
  all: "All tasks",
  done: "Completed",
};

function wire(outlet, id, f) {
  const rerender = () => renderCourse(outlet, id);

  outlet.querySelector("#add-task").addEventListener("click", () =>
    openTaskDialog(id, null, rerender));

  outlet.querySelectorAll("[data-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      f.status = chip.dataset.filter;
      rerender();
    });
  });

  const search = outlet.querySelector("#f-q");
  search.addEventListener("input", (e) => {
    f.q = e.target.value;
    rerender();
    const next = document.querySelector("#f-q");
    next.focus();
    next.setSelectionRange(next.value.length, next.value.length);
  });

  outlet.querySelector("#select-mode").addEventListener("click", () => {
    selectMode = !selectMode;
    selected = new Set();
    rerender();
  });

  outlet.querySelectorAll("tbody tr").forEach((tr) => {
    const taskId = tr.dataset.id;
    tr.querySelector(".toggle").addEventListener("change", (e) => {
      if (selectMode) {
        if (e.target.checked) selected.add(taskId);
        else selected.delete(taskId);
        paintBulkBar(outlet, id, rerender);
        return;
      }
      toggleDone(id, taskId);
      rerender();
    });
    tr.querySelector(".edit").addEventListener("click", () => {
      const task = load().tasks[id].find((t) => t.id === taskId);
      openTaskDialog(id, task, rerender);
    });
    tr.querySelector(".surface")?.addEventListener("click", () => {
      surfaceNow(id, taskId);
      rerender();
    });
  });

  mountQuickEdit(outlet, {
    onEdited: ({ task }) => refreshRow(outlet, id, task, f, rerender),
  });

  paintBulkBar(outlet, id, rerender);
}

/**
 * Show or hide the bulk bar for the current selection, and apply what it asks for.
 *
 * Every bulk write goes through `patchMany`, which is one `update()` — so the whole
 * batch is a single entry on the undo stack and one Undo puts all of it back. Doing
 * it as N calls to `patchTask` would need N undos, in order, to get back to where
 * you were.
 */
function paintBulkBar(outlet, listKey, rerender) {
  if (!selectMode || selected.size === 0) {
    hideBulkBar();
    return;
  }

  const entries = [...selected].map((id) => ({ listKey, id }));
  const apply = (fields, label) => {
    const n = patchMany(entries, fields, { undoLabel: label });
    selected = new Set();
    rerender();
    toastUndo(`${label} · ${n} task${n === 1 ? "" : "s"}`, () => {
      undo();
      rerender();
    });
  };

  showBulkBar({
    count: selected.size,
    fields: editableFields(listKey)
      .filter(([, spec]) => spec.kind === "choice")
      .map(([field, spec]) => ({ field, label: spec.label, values: spec.values })),
    onPick: (field, value) => apply({ [field]: value }, `${FIELD_SPEC[field].label} → ${value}`),
    onDone: () => apply({ status: "Done" }, "Marked done"),
    onClear: () => {
      selected = new Set();
      rerender();
    },
  });
}
