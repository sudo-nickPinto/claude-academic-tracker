import { courses } from "../config.js";
import { load } from "../store.js";
import {
  today, daysLeft, startBy, realisticStart, rowState, shouldHaveStarted, isDone, isNamed,
  isLater, surfacesOn, horizonOf, hasCalendar,
} from "../compute.js";
import { esc, fmtDate, fmtHours, fmtPct, pill, bar, daysLabel, emptyState } from "../ui.js";
import { openTaskDialog, toggleDone, surfaceNow } from "./taskdialog.js";

const filters = {};

const MATCHERS = {
  active: (t, ref, h) => !isDone(t) && !isLater(t, ref, h),
  later: (t, ref, h) => isLater(t, ref, h),
  done: (t) => isDone(t),
  all: () => true,
};

export function renderCourse(outlet, id) {
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
      <select id="f-status" style="width:auto">
        <option value="active" ${f.status === "active" ? "selected" : ""}>Active now</option>
        <option value="later" ${f.status === "later" ? "selected" : ""}>Later (${later.length})</option>
        <option value="all" ${f.status === "all" ? "selected" : ""}>All tasks</option>
        <option value="done" ${f.status === "done" ? "selected" : ""}>Completed</option>
      </select>
      <input id="f-q" type="text" placeholder="Search tasks…" value="${esc(f.q)}" style="width:auto;flex:1 1 200px">
      <span class="spacer"></span>
      <span class="small faint">${visible.length} shown</span>
    </div>

    ${visible.length ? table(visible, ref, horizon, state, withCal) : emptyState(
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

function table(rows, ref, horizon, state, withCal) {
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
      <tbody>${rows.map((t) => row(t, ref, horizon, state, withCal)).join("")}</tbody>
    </table>
  </div>`;
}

function row(t, ref, horizon, state, withCal) {
  const left = daysLeft(t, ref);
  const start = startBy(t);
  const real = withCal ? realisticStart(t, state, ref) : null;
  const late = shouldHaveStarted(t, ref);
  const later = isLater(t, ref, horizon);
  const surfaces = later ? surfacesOn(t, horizon) : null;
  const est = t.estMin ? `${t.estMin}m` : "\u2014";

  return `
  <tr data-state="${later ? "later" : rowState(t, ref)}" data-id="${t.id}" data-later="${later}">
    <td data-cell="check"><input type="checkbox" class="toggle" ${isDone(t) ? "checked" : ""} aria-label="Mark ${esc(t.task)} done"></td>
    <td data-cell="main">
      <span class="cell-main">${esc(t.task)}</span>
      ${later ? `<span class="tag tag-later">Later \u00b7 surfaces ${fmtDate(surfaces)}${t.activeFrom ? " (you set this)" : ""}</span>` : ""}
      ${t.details ? `<span class="cell-sub">${esc(t.details)}</span>` : ""}
      ${t.source ? `<span class="cell-sub faint">${esc(t.source)}</span>` : ""}
      <span class="cell-fold" data-when="t1">${start ? `Start by ${fmtDate(start)}` : "No start date"} \u00b7 ${est} est</span>
      <span class="cell-fold cell-fold-inline" data-when="t2"><span class="tag">${esc(t.type)}</span></span>
      <span class="cell-fold cell-fold-inline" data-when="t3">${pill(t.priority)}</span>
    </td>
    <td data-col="t2" data-label="Type"><span class="tag">${esc(t.type)}</span></td>
    <td data-col="t3" data-label="Priority">${pill(t.priority)}</td>
    <td data-label="Status">${pill(t.status)}</td>
    <td class="num nowrap" data-label="Due">${fmtDate(t.due)}</td>
    <td class="num nowrap days-left" data-neg="${left !== null && left < 0}" data-label="Days left">${daysLabel(left)}</td>
    <td class="num nowrap" data-col="t1" data-label="Est.">${est}</td>
    <td class="num nowrap ${late ? "start-flag" : ""}" data-col="t1" data-label="Start by">${start ? fmtDate(start) : "\u2014"}
      ${real && real !== start ? `<span class="cell-sub faint" title="Allowing for the time already committed on your calendar">cal. ${fmtDate(real)}</span>` : ""}</td>
    <td class="nowrap" data-cell="act">
      ${later ? '<button class="btn btn-ghost btn-sm surface" type="button" title="Move this into the active list now">Surface</button>' : ""}
      <button class="btn btn-ghost btn-sm edit" type="button">Edit</button>
    </td>
  </tr>`;
}

function wire(outlet, id, f) {
  const rerender = () => renderCourse(outlet, id);

  outlet.querySelector("#add-task").addEventListener("click", () =>
    openTaskDialog(id, null, rerender));

  outlet.querySelector("#f-status").addEventListener("change", (e) => {
    f.status = e.target.value;
    rerender();
  });

  const search = outlet.querySelector("#f-q");
  search.addEventListener("input", (e) => {
    f.q = e.target.value;
    rerender();
    const next = document.querySelector("#f-q");
    next.focus();
    next.setSelectionRange(next.value.length, next.value.length);
  });

  outlet.querySelectorAll("tbody tr").forEach((tr) => {
    const taskId = tr.dataset.id;
    tr.querySelector(".toggle").addEventListener("change", () => {
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
}
