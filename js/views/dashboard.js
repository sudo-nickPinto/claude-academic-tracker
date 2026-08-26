import { courses } from "../config.js";
import { load, update } from "../store.js";
import {
  today, dashboardStats, perCourse, upcoming, workload14, horizonList, hasCalendar,
  daysLeft, startBy, shouldHaveStarted, rowState, analytics, dayDiff, horizonOf,
} from "../compute.js";
import {
  esc, fmtDate, fmtDateFull, fmtHours, fmtPct, pill, bar, daysLabel, weekday, emptyState,
} from "../ui.js";
import { barChartH, barChartV, donut } from "../charts.js";

export function renderDashboard(outlet) {
  const state = load();
  const ref = today();
  const s = dashboardStats(state, ref);
  const byCourse = perCourse(state, ref);
  const includePersonal = state.prefs.includePersonalInWeek;
  const week = upcoming(state, { ref, includePersonal });
  const days = workload14(state, ref);
  const horizon = horizonList(state, ref);

  outlet.style.cssText = "";
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">Dashboard</div>
        <h1>Semester at a glance</h1>
        <p>${esc(fmtDateFull(ref))} · what's live right now. Work more than ${horizonOf(state)} days out waits in Later.</p>
      </div>
    </header>

    ${statGrid(s)}

    <section class="section split">
      ${weekCard(week, ref, includePersonal)}
      ${sideColumn(days, horizon, ref, hasCalendar(state))}
    </section>

    <section class="section">
      <div class="section-head"><h2>By course</h2>
        <span class="small faint">Personal is excluded from every figure here.</span></div>
      ${courseTable(byCourse, ref)}
    </section>

    <section class="section">
      <div class="section-head"><h2>Where the work is</h2></div>
      <div class="chart-grid">
        ${chartCard("Active tasks by course", barChartH(byCourse.map((c) => ({
          label: c.course, value: c.active, color: `var(--c-${c.course})`,
        }))))}
        ${chartCard("Estimated hours of active work", barChartH(byCourse.map((c) => ({
          label: c.course, value: Math.round(c.activeHours * 10) / 10, color: `var(--c-${c.course})`,
        })), { format: (v) => `${fmtHours(v)}h` }))}
        ${chartCard("Status of all coursework", donut(statusRows(state), { centerLabel: "tasks" }))}
      </div>
    </section>`;

  outlet.querySelector("#include-personal")?.addEventListener("change", (e) => {
    const on = e.target.checked;
    update((draft) => { draft.prefs.includePersonalInWeek = on; });
    renderDashboard(outlet);
  });
}

function statGrid(s) {
  return `
  <div class="stat-grid">
    <div class="stat"><span class="stat-label">Active tasks</span>
      <span class="stat-value">${s.active}</span>
      <span class="stat-sub">of ${s.open} open · ${fmtHours(s.activeHours)}h</span></div>
    <div class="stat"><span class="stat-label">Later</span>
      <span class="stat-value">${s.later}</span><span class="stat-sub">surface automatically</span></div>
    <div class="stat" data-tone="danger"><span class="stat-label">Overdue</span>
      <span class="stat-value">${s.overdue}</span><span class="stat-sub">past due, not done</span></div>
    <div class="stat" data-tone="warning"><span class="stat-label">Due in 7 days</span>
      <span class="stat-value">${s.dueWeek}</span><span class="stat-sub">${fmtHours(s.hoursThisWeek)}h of work</span></div>
    <div class="stat" data-tone="warning"><span class="stat-label">Should have started</span>
      <span class="stat-value">${s.shouldHaveStarted}</span><span class="stat-sub">past their start-by date</span></div>
    <div class="stat" data-tone="success"><span class="stat-label">Semester complete</span>
      <span class="stat-value">${fmtPct(s.completion)}</span>
      <span class="stat-sub">${s.done} of ${s.total} done</span>${bar(s.completion, 'style="--accent:var(--success)"')}</div>
  </div>`;
}

/** The widget Nick actually opens every morning — given the most space and the top slot. */
function weekCard(week, ref, includePersonal) {
  return `
  <div class="card">
    <div class="card-head">
      <div>
        <h2>Overdue &amp; the next seven days</h2>
        <span class="hint">Sorted by due date, then priority.</span>
      </div>
      <label class="switch">
        <input type="checkbox" id="include-personal" ${includePersonal ? "checked" : ""}>
        Include personal
      </label>
    </div>
    ${week.length ? `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Course</th><th>Task</th><th data-col="t3">Priority</th><th>Status</th>
            <th class="num">Due</th><th class="num">Days</th>
            <th class="num" data-col="t1">Est.</th><th class="num" data-col="t1">Start by</th>
          </tr>
        </thead>
        <tbody>
          ${week.map((t) => {
            const left = daysLeft(t, ref);
            const start = startBy(t);
            return `
            <tr data-state="${rowState(t, ref)}">
              <td class="nowrap" data-cell="check"><span class="chip" style="--accent:var(--c-${t.course})">${esc(t.course)}</span></td>
              <td data-cell="main">
                <span class="cell-main">${esc(t.task)}</span>
                ${t.type ? `<span class="cell-sub faint">${esc(t.type)}</span>` : ""}
                <span class="cell-fold" data-when="t1">${start ? `Start by ${fmtDate(start)}` : "No start date"} · ${t.estMin ? `${t.estMin}m` : "—"} est</span>
                <span class="cell-fold cell-fold-inline" data-when="t3">${pill(t.priority)}</span>
              </td>
              <td data-col="t3" data-label="Priority">${pill(t.priority)}</td>
              <td data-label="Status">${pill(t.status)}</td>
              <td class="num nowrap" data-label="Due">${weekday(t.due)} ${fmtDate(t.due)}</td>
              <td class="num nowrap days-left" data-neg="${left < 0}" data-label="Days left">${daysLabel(left)}</td>
              <td class="num nowrap" data-col="t1" data-label="Est.">${t.estMin ? `${t.estMin}m` : "—"}</td>
              <td class="num nowrap ${shouldHaveStarted(t, ref) ? "start-flag" : ""}" data-col="t1" data-label="Start by">${start ? fmtDate(start) : "—"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : emptyState("Nothing overdue and nothing due this week.", "Enjoy it.")}
  </div>`;
}

function sideColumn(days, horizon, ref, withCal) {
  const heavy = days.filter((d) => d.heavy);
  const tight = days.filter((d) => d.overbooked);
  const totalHours = days.reduce((s, d) => s + d.hours, 0);

  return `
  <div class="stack">
    <div class="card">
      <div class="card-head">
        <div><h2>Next 14 days</h2>
          <span class="hint">${fmtHours(totalHours)}h of work scheduled${
            withCal
              ? ` · ${fmtHours(days.reduce((sum, d) => sum + d.committed, 0))}h already committed${
                  tight.length ? ` · ${tight.length} day${tight.length > 1 ? "s" : ""} overbooked` : ""}`
              : heavy.length ? ` · ${heavy.length} heavy day${heavy.length > 1 ? "s" : ""}` : ""}</span>
        </div>
      </div>
      <div class="card-pad">
        ${barChartV(days.map((d) => ({
          value: Math.round(d.hours * 10) / 10,
          committed: withCal ? Math.round(d.committed * 10) / 10 : 0,
          label: d.offset % 2 === 0 ? weekday(d.date).slice(0, 1) : "",
          heavy: d.heavy,
          overbooked: d.overbooked,
          title: `${fmtDateFull(d.date)} — ${fmtHours(d.hours)}h of work, ${d.count} task${d.count === 1 ? "" : "s"}${
            withCal ? `; ${fmtHours(d.committed)}h committed, ${fmtHours(d.free)}h free` : ""}`,
        })), { format: (v) => (v ? `${v}` : "") })}
        <div class="legend">
          <span><i style="background:var(--progress)"></i>Hours due</span>
          ${withCal ? '<span><i style="background:var(--text-faint);opacity:.45"></i>Committed (calendar)</span>' : ""}
          <span><i style="background:var(--danger)"></i>${withCal ? "More work than free hours" : "Heavy day (4h+)"}</span>
        </div>
      </div>
      ${days.some((d) => d.count) ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th class="num">Tasks</th><th class="num">Work</th>
            ${withCal ? '<th class="num" data-col="t2">Class</th><th class="num">Free</th>' : ""}</tr></thead>
          <tbody>
            ${days.filter((d) => d.count || (withCal && d.committed)).map((d) => `
              <tr data-state="${d.overbooked || d.heavy ? "overdue" : ""}">
                <td data-cell="main">${weekday(d.date)} ${fmtDate(d.date)}${d.offset === 0 ? ' <span class="tag">today</span>' : ""}</td>
                <td class="num" data-label="Tasks">${d.count}</td>
                <td class="num" data-label="Work">${fmtHours(d.hours)}h</td>
                ${withCal ? `<td class="num" data-col="t2" data-label="Class">${d.committed ? `${fmtHours(d.committed)}h` : "—"}</td>
                  <td class="num days-left" data-neg="${d.overbooked}" data-label="Free">${fmtHours(d.free)}h</td>` : ""}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `<div class="card-pad muted small">No dated work in the next two weeks.</div>`}
    </div>
    ${horizonCard(horizon, ref)}
  </div>`;
}

/**
 * Later is only tolerable if it's never a hole things vanish into. This card is the
 * receipt: what's waiting, and the exact day each one arrives.
 */
function horizonCard(later, ref) {
  const shown = later.slice(0, 6);
  return `
  <div class="card" id="horizon-card">
    <div class="card-head">
      <div><h2>On the horizon</h2>
        <span class="hint">${later.length
          ? `${later.length} task${later.length === 1 ? "" : "s"} waiting · next arrives ${fmtDate(later[0].surfaces)}`
          : "Nothing waiting"}</span>
      </div>
    </div>
    ${shown.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Course</th><th>Task</th><th class="num">Surfaces</th><th class="num">Due</th></tr></thead>
        <tbody>
          ${shown.map((t) => `
          <tr data-state="later">
            <td class="nowrap"><span class="chip" style="--accent:var(--c-${t.course})">${esc(t.course)}</span></td>
            <td><span class="cell-main">${esc(t.task)}</span>
              ${t.type ? `<span class="cell-sub faint">${esc(t.type)}</span>` : ""}</td>
            <td class="num nowrap">${fmtDate(t.surfaces)}
              <span class="cell-sub faint">in ${dayDiff(t.surfaces, ref)}d</span></td>
            <td class="num nowrap">${fmtDate(t.due)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${later.length > shown.length
      ? `<div class="card-pad muted small">+ ${later.length - shown.length} more, further out. Every course tab has a Later filter.</div>`
      : ""}`
    : `<div class="card-pad muted small">Everything open is active right now.</div>`}
  </div>`;
}

function courseTable(rows, ref) {
  return `
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Course</th><th style="min-width:120px" data-col="t2">Progress</th>
          <th class="num">Active</th><th class="num" data-col="t3">Later</th>
          <th class="num">Overdue</th><th class="num" data-col="t3">Due ≤7d</th>
          <th class="num" data-col="t1">Active hrs</th>
          <th data-col="t1">Next big one</th><th class="num" data-col="t1">Days away</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((c) => `
        <tr>
          <td data-cell="main">
            <span class="chip" style="--accent:var(--c-${c.course})">${esc(c.course)}</span>
            <span class="cell-sub">${esc(courses[c.course].name)}</span>
            <span class="cell-fold" data-when="t1">${fmtHours(c.activeHours)}h active${c.nextBig
              ? ` · next: ${esc(c.nextBig.task)} (${fmtDate(c.nextBig.due)})` : ""}</span>
            <span class="cell-fold" data-when="t2">${fmtPct(c.pctDone)} complete</span>
            <span class="cell-fold" data-when="t3">${c.later || 0} later · ${c.dueWeek} due within 7 days</span>
          </td>
          <td data-col="t2" data-label="Progress">
            <div class="bar-row" style="--accent:var(--c-${c.course})">
              ${bar(c.pctDone)}<span class="num">${fmtPct(c.pctDone)}</span>
            </div>
          </td>
          <td class="num" data-label="Active">${c.active}</td>
          <td class="num faint" data-col="t3" data-label="Later">${c.later || "—"}</td>
          <td class="num ${c.overdue ? "days-left" : ""}" data-neg="${c.overdue > 0}" data-label="Overdue">${c.overdue}</td>
          <td class="num" data-col="t3" data-label="Due ≤7d">${c.dueWeek}</td>
          <td class="num" data-col="t1" data-label="Active hrs">${fmtHours(c.activeHours)}</td>
          <td data-col="t1" data-label="Next big one">${c.nextBig
            ? `<span class="cell-main">${esc(c.nextBig.task)}</span><span class="cell-sub faint">${esc(c.nextBig.type)} · ${fmtDate(c.nextBig.due)}</span>`
            : '<span class="faint">—</span>'}</td>
          <td class="num nowrap" data-col="t1" data-label="Days away">${c.daysAway === null ? "—" : daysLabel(c.daysAway)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function statusRows(state) {
  const colors = {
    "Not Started": "var(--text-faint)",
    "In Progress": "var(--progress)",
    "Waiting / Blocked": "var(--blocked)",
    "Done": "var(--success)",
  };
  return analytics(state).byStatus
    .filter((r) => r.count)
    .map((r) => ({ label: r.key, value: r.count, color: colors[r.key] || "var(--border-strong)" }));
}

function chartCard(title, body) {
  return `<div class="card"><div class="card-head"><h3>${esc(title)}</h3></div>
    <div class="card-pad">${body}</div></div>`;
}
