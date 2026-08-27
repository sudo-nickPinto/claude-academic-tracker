/**
 * The Cmd/Ctrl-K command palette: jump to any view, or find a task by name
 * without knowing which course it lives on.
 *
 * Rendered into `#palette-dialog` and driven through `openDialog()` (see
 * js/ui.js) so it gets showModal(), backdrop-click and focus-return for free —
 * the same contract every other dialog in the app follows. The list itself is
 * plain divs with ARIA roles rather than <ul>/<li>: `.palette-group` headers and
 * `.palette-item` buttons sit as siblings, which a real list can't do without an
 * extra wrapper per item, and the roles are what make it read as a listbox
 * regardless of the underlying tags.
 */

import { courseIds, courses, scheduleCourses } from "../config.js";
import { load } from "../store.js";
import { courseTasks, isDone, isNamed } from "../compute.js";
import { esc, fmtDate, openDialog } from "../ui.js";

const TASK_LIMIT = 8;

let dialog = null;
let inputEl = null;
let listEl = null;

/** Flat, in the same order as the DOM — what Enter and the arrow keys walk. */
let results = [];
let activeIdx = 0;

const host = () => document.getElementById("palette-dialog");

export function isPaletteOpen() {
  return Boolean(dialog?.open);
}

export function closePalette() {
  dialog?.close();
}

export function openPalette(initialQuery = "") {
  const el = host();
  if (!el) return;
  dialog = el;

  renderShell();
  // openDialog() calls showModal(), which throws on a dialog that's already
  // open — a second Cmd+K while the palette is up just re-seeds the query
  // instead of round-tripping through a throw.
  if (!dialog.open) openDialog(dialog);

  inputEl.value = initialQuery;
  runQuery(initialQuery);
  inputEl.focus();
  inputEl.select();
}

// -------------------------------------------------------------------- shell

function renderShell() {
  dialog.innerHTML = `
    <div class="palette-input-row">
      <input id="palette-input" type="text" autocomplete="off" spellcheck="false"
             placeholder="Jump to a view or search tasks…">
    </div>
    <div class="palette-list" id="palette-list" role="listbox" aria-label="Command palette results"></div>
    <div class="palette-foot">
      <span><span class="kbd">↑↓</span> navigate</span>
      <span><span class="kbd">↵</span> open</span>
      <span><span class="kbd">esc</span> close</span>
    </div>`;

  inputEl = dialog.querySelector("#palette-input");
  listEl = dialog.querySelector("#palette-list");

  inputEl.addEventListener("input", () => runQuery(inputEl.value));
  inputEl.addEventListener("keydown", onKeydown);
}

function runQuery(raw) {
  activeIdx = 0;
  renderList(raw.trim());
}

// -------------------------------------------------------------------- data

function routeList() {
  return [
    { href: "#/dashboard", label: "Dashboard" },
    { href: "#/calendar", label: "Calendar" },
    { href: "#/analytics", label: "Analytics" },
    { href: "#/grades", label: "Grades" },
    { href: "#/personal", label: "Personal" },
    { href: "#/settings", label: "Settings" },
    { href: "#/groups", label: "CS440 Groups" },
    ...courseIds.map((id) => ({ href: `#/course/${id}`, label: `${id} — ${courses[id].name}` })),
    ...scheduleCourses.map((id) => ({ href: `#/schedule/${id}`, label: `${id} Schedule` })),
  ];
}

/** Every named, open task across all courses and Personal, course tagged on. */
function taskPool() {
  const state = load();
  const fromCourses = courseTasks(state).filter((t) => !isDone(t));
  const fromPersonal = state.personal
    .filter((t) => isNamed(t) && !isDone(t))
    .map((t) => ({ ...t, course: "Personal" }));
  return [...fromCourses, ...fromPersonal];
}

const taskHref = (t) => (t.course === "Personal" ? "#/personal" : `#/course/${t.course}`);

// ------------------------------------------------------------------ matching

const matches = (text, needle) => !needle || text.toLowerCase().includes(needle);

/** Wrap the matched span in <mark>, escaping the three pieces independently
 *  so the query itself can never inject markup through the split. */
function highlight(text, needle) {
  if (!needle) return esc(text);
  const i = text.toLowerCase().indexOf(needle);
  if (i === -1) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + needle.length)) + "</mark>" +
    esc(text.slice(i + needle.length));
}

// ------------------------------------------------------------------ render

function renderList(query) {
  const needle = query.toLowerCase();
  const routes = routeList().filter((r) => matches(r.label, needle));
  // Empty query: routes only, no tasks — searching every task by name is the
  // point of typing, not something to dump on the palette at rest.
  const tasks = query ? taskPool().filter((t) => matches(t.task, needle)).slice(0, TASK_LIMIT) : [];

  results = [
    ...routes.map((r) => ({ ...r, type: "route" })),
    ...tasks.map((t) => ({ href: taskHref(t), type: "task", task: t })),
  ];

  if (!results.length) {
    listEl.innerHTML = `<div class="palette-empty">No matches</div>`;
    return;
  }

  let html = "";
  let idx = 0;
  if (routes.length) {
    html += `<div class="palette-group">Go to</div>`;
    for (const r of routes) { html += routeItem(r, idx, query); idx++; }
  }
  if (tasks.length) {
    html += `<div class="palette-group">Tasks</div>`;
    for (const t of tasks) { html += taskItem(t, idx, query); idx++; }
  }

  listEl.innerHTML = html;
  listEl.querySelectorAll(".palette-item").forEach((btn) => {
    btn.addEventListener("click", () => activate(Number(btn.dataset.idx)));
  });
  setActive(0);
}

function routeItem(r, idx, query) {
  return `
    <button type="button" class="palette-item" role="option" data-idx="${idx}">
      <span class="palette-item-main">${highlight(r.label, query)}</span>
    </button>`;
}

function taskItem(t, idx, query) {
  return `
    <button type="button" class="palette-item" role="option" data-idx="${idx}">
      <span class="palette-item-main">${highlight(t.task, query)}</span>
      <span class="palette-item-sub">${esc(fmtDate(t.due))}</span>
      <span class="palette-item-meta">${esc(t.course)}</span>
    </button>`;
}

function setActive(idx) {
  activeIdx = idx;
  listEl.querySelectorAll(".palette-item").forEach((btn, i) => {
    const on = i === idx;
    btn.dataset.active = String(on);
    btn.setAttribute("aria-selected", String(on));
    if (on) btn.scrollIntoView({ block: "nearest" });
  });
}

// ---------------------------------------------------------------- activation

function activate(idx) {
  const item = results[idx];
  if (!item) return;
  closePalette();
  location.hash = item.href;
}

function onKeydown(e) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!results.length) return;
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    setActive((activeIdx + step + results.length) % results.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    activate(activeIdx);
  } else if (e.key === "Escape") {
    // The dialog already closes itself on Escape; this just short-circuits
    // before that native handling has to.
    e.preventDefault();
    closePalette();
  }
}
