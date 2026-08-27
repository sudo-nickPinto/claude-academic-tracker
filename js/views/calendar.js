import { courses, courseIds, personalMeta, workingDayMin } from "../config.js";
import { load } from "../store.js";
import {
  today, epochDay, addDays, isDone, isNamed, daysLeft,
  eventsOn, busyMinutes, hasCalendar, semesterWindow, committedByDate, freeHours,
} from "../compute.js";
import { esc, fmtDateFull, fmtHours, emptyState } from "../ui.js";
import { qe, mountQuickEdit, markStale, clearStale } from "./row.js";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** View state: which month is on screen and which day is open. Not persisted. */
let cursor = null;
let selected = null;

export function renderCalendar(outlet) {
  const state = load();
  const ref = today();
  cursor ||= ref.slice(0, 7);
  selected ||= ref;

  const [y, m] = cursor.split("-").map(Number);
  const deadlines = deadlinesByDate(state);
  const committed = committedByDate(state);

  outlet.style.cssText = "";
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">Calendar</div>
        <h1>${MONTHS[m - 1]} ${y}</h1>
        <p>${hasCalendar(state)
          ? "Deadlines and imported committed time, side by side."
          : "Your deadlines. Import an Outlook calendar in Settings to see committed time alongside them."}</p>
      </div>
      <div class="row">
        <button class="btn btn-sm" id="prev" type="button" aria-label="Previous month">←</button>
        <button class="btn btn-sm" id="today" type="button">Today</button>
        <button class="btn btn-sm" id="next" type="button" aria-label="Next month">→</button>
      </div>
    </header>

    <div class="cal-layout">
      <div class="card cal-card">
        <div class="cal-grid" role="grid" aria-label="${MONTHS[m - 1]} ${y}">
          ${WEEKDAYS.map((d) => `<div class="cal-dow" role="columnheader">${d}</div>`).join("")}
          ${monthCells(y, m, ref, deadlines, committed)}
        </div>
        ${legend(state)}
      </div>
      <div class="card cal-day" id="day-detail">${dayDetail(state, selected, ref)}</div>
    </div>`;

  wire(outlet, y, m, ref);
}

/** { 'YYYY-MM-DD': [{ id, title, accent }] } across the four courses and Personal. */
function deadlinesByDate(state) {
  const out = {};
  const push = (task, accent, label) => {
    if (!isNamed(task) || isDone(task) || !task.due) return;
    (out[task.due] ||= []).push({ title: task.task, accent, label });
  };
  for (const id of courseIds) {
    for (const t of state.tasks[id]) push(t, `var(--c-${id})`, id);
  }
  for (const t of state.personal) push(t, "var(--c-Personal)", personalMeta.name);
  return out;
}

function monthCells(y, m, ref, deadlines, committed) {
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday-first: shift so Monday is column 0.
  const lead = (((epochDay(first) % 7) + 11) % 7 + 6) % 7;

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell is-blank" role="gridcell"></div>');

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const due = deadlines[date] || [];
    const mins = committed[date] || 0;
    // Density relative to the working day, so a 5-hour teaching day reads as mostly full.
    const density = Math.min(1, mins / workingDayMin);

    cells.push(`
      <button class="cal-cell" role="gridcell" type="button" data-date="${date}"
        ${date === ref ? 'data-today="true"' : ""}
        ${date === selected ? 'data-selected="true"' : ""}
        aria-label="${fmtDateFull(date)}${due.length ? `, ${due.length} due` : ""}${mins ? `, ${fmtHours(mins / 60)} committed` : ""}">
        <span class="cal-num">${d}</span>
        ${mins ? `<span class="cal-busy" style="--fill:${(density * 100).toFixed(0)}%"
            title="${fmtHours(mins / 60)} committed"></span>` : ""}
        <span class="cal-dots">
          ${due.slice(0, 4).map((t) =>
            `<span class="cal-dot" style="background:${t.accent}" title="${esc(t.title)}"></span>`).join("")}
          ${due.length > 4 ? `<span class="cal-more">+${due.length - 4}</span>` : ""}
        </span>
      </button>`);
  }
  return cells.join("");
}

function legend(state) {
  const { start, end } = semesterWindow(state);
  return `<div class="cal-legend">
    <span><span class="cal-dot" style="background:var(--c-CS440)"></span>deadline</span>
    <span><span class="cal-busy is-key" style="--fill:70%"></span>committed time</span>
    <span class="faint">Term ${start} → ${end}</span>
  </div>`;
}

function dayDetail(state, date, ref) {
  const events = eventsOn(state, date);
  const mins = busyMinutes(state, date);
  const free = freeHours(state, date) * 60;
  const due = [];
  for (const id of courseIds) {
    for (const t of state.tasks[id]) {
      if (isNamed(t) && !isDone(t) && t.due === date) due.push({ ...t, accent: `var(--c-${id})`, label: id });
    }
  }
  for (const t of state.personal) {
    if (isNamed(t) && !isDone(t) && t.due === date) due.push({ ...t, accent: "var(--c-Personal)", label: "Personal" });
  }

  const workMin = due.reduce((s, t) => s + (t.estMin || 0), 0);
  const tight = workMin > free;

  return `
    <div class="card-head">
      <h2>${fmtDateFull(date)}</h2>
      ${date === ref ? '<span class="hint">Today</span>' : ""}
    </div>
    <div class="card-pad stack">
      ${hasCalendar(state) ? `
        <div class="cal-budget" data-tight="${tight}">
          <div><span class="cal-budget-label">Committed</span><strong>${fmtHours(mins / 60)}</strong></div>
          <div><span class="cal-budget-label">Free for work</span><strong>${fmtHours(free / 60)}</strong></div>
          <div><span class="cal-budget-label">Due this day</span><strong>${fmtHours(workMin / 60)}</strong></div>
        </div>
        ${tight ? `<div class="banner" data-tone="warning" style="margin:0"><div>
          More work due than free hours — ${fmtHours(workMin / 60)} of work against ${fmtHours(free / 60)} free.
          Worth starting something earlier.</div></div>` : ""}` : ""}

      ${events.length ? `
        <div>
          <h3 class="cal-sub">On the calendar</h3>
          <ul class="cal-list">
            ${events.map((e) => `
              <li ${e.busy ? "" : 'data-free="true"'}>
                <span class="cal-time">${clock(e.start)}</span>
                <span class="cal-ev">${esc(e.title)}
                  ${e.location ? `<span class="cell-sub faint">${esc(e.location)}</span>` : ""}</span>
                <span class="cal-len">${e.busy ? fmtHours(e.minutes / 60) : "free"}</span>
              </li>`).join("")}
          </ul>
        </div>` : ""}

      ${due.length ? `
        <div>
          <h3 class="cal-sub">Due</h3>
          <ul class="cal-list">
            ${due.map((t) => `
              <li data-id="${esc(t.id)}" data-list="${esc(t.label)}">
                <span class="chip" style="--accent:${t.accent}">${esc(t.label)}</span>
                <span class="cal-ev">${esc(t.task)}
                  <span class="cell-sub">${qe(t.label, t, "status")} ${qe(t.label, t, "priority")}</span></span>
                <span class="cal-len">${qe(t.label, t, "estMin")}</span>
              </li>`).join("")}
          </ul>
        </div>` : ""}

      ${!events.length && !due.length
        ? `<p class="muted small">Nothing on this day.${hasCalendar(state) ? "" : " Import a calendar in Settings to see your classes here."}</p>`
        : ""}
    </div>`;
}

const clock = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
};

function wire(outlet, y, m, ref) {
  const go = (deltaMonths) => {
    const total = (y * 12 + (m - 1)) + deltaMonths;
    cursor = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    renderCalendar(outlet);
  };

  outlet.querySelector("#prev").addEventListener("click", () => go(-1));
  outlet.querySelector("#next").addEventListener("click", () => go(1));
  outlet.querySelector("#today").addEventListener("click", () => {
    cursor = ref.slice(0, 7);
    selected = ref;
    renderCalendar(outlet);
  });

  outlet.querySelectorAll(".cal-cell[data-date]").forEach((cell) => {
    cell.addEventListener("click", () => {
      selected = cell.dataset.date;
      // Repaint only the two things that changed, so the month doesn't flash.
      outlet.querySelectorAll(".cal-cell[data-selected]").forEach((c) => delete c.dataset.selected);
      cell.dataset.selected = "true";
      outlet.querySelector("#day-detail").innerHTML = dayDetail(load(), selected, ref);
    });
  });

  // The day panel is the fourth place task rows appear, so it gets the same editing
  // the tables do. An edit that empties the day — marking it done, moving the due date —
  // leaves the item in place with a cue; the month dots catch up on the next render.
  mountQuickEdit(outlet, {
    onEdited: ({ task }) => {
      const li = outlet.querySelector(`.cal-list li[data-id="${CSS.escape(task.id)}"]`);
      if (!li) return;
      if (!isDone(task) && task.due === selected) clearStale(li);
      else markStale(li, isDone(task) ? "done" : "moved to another day");
    },
  });
}
