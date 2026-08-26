import { courses } from "../config.js";
import { load, update } from "../store.js";
import {
  today, dashboardStats, perCourse, upcoming, workload14,
  daysLeft, startBy, shouldHaveStarted, rowState, analytics,
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

  outlet.style.cssText = "";
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">Dashboard</div>
        <h1>Semester at a glance</h1>
        <p>${esc(fmtDateFull(ref))} · everything here is calculated live from your course lists.</p>
      </div>
    </header>

    ${statGrid(s)}

    <section class="section split">
      ${weekCard(week, ref, includePersonal)}
      ${sideColumn(days, state, ref)}
    </section>

    <section class="section">
      <div class="section-head"><h2>By course</h2>
        <span class="small faint">Personal is excluded from every figure here.</span></div>
      ${courseTable(byCourse, ref)}
    </section>

    <section class="section">
      <div class="section-head"><h2>Where the work is</h2></div>
      <div class="chart-grid">
        ${chartCard("Open tasks by course", barChartH(byCourse.map((c) => ({
          label: c.course, value: c.open, color: `var(--c-${c.course})`,
        }))))}
        ${chartCard("Estimated hours of open work", barChartH(byCourse.map((c) => ({
          label: c.course, value: Math.round(c.estHours * 10) / 10, color: `var(--c-${c.course})`,
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
    <div class="stat"><span class="stat-label">Open tasks</span>
      <span class="stat-value">${s.open}</span><span class="stat-sub">across four courses</span></div>
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
            <th>Course</th><th>Task</th><th>Priority</th><th>Status</th>
            <th class="num">Due</th><th class="num">Days</th>
            <th class="num">Est.</th><th class="num">Start by</th>
          </tr>
        </thead>
        <tbody>
          ${week.map((t) => {
            const left = daysLeft(t, ref);
            const start = startBy(t);
            return `
            <tr data-state="${rowState(t, ref)}">
              <td class="nowrap"><span class="chip" style="--accent:var(--c-${t.course})">${esc(t.course)}</span></td>
              <td>
                <span class="cell-main">${esc(t.task)}</span>
                ${t.type ? `<span class="cell-sub faint">${esc(t.type)}</span>` : ""}
              </td>
              <td>${pill(t.priority)}</td>
              <td>${pill(t.status)}</td>
              <td class="num nowrap">${weekday(t.due)} ${fmtDate(t.due)}</td>
              <td class="num nowrap days-left" data-neg="${left < 0}">${daysLabel(left)}</td>
              <td class="num nowrap">${t.estMin ? `${t.estMin}m` : "—"}</td>
              <td class="num nowrap ${shouldHaveStarted(t, ref) ? "start-flag" : ""}">${start ? fmtDate(start) : "—"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : emptyState("Nothing overdue and nothing due this week.", "Enjoy it.")}
  </div>`;
}

function sideColumn(days, state, ref) {
  const heavy = days.filter((d) => d.heavy);
  const totalHours = days.reduce((s, d) => s + d.hours, 0);

  return `
  <div class="stack">
    <div class="card">
      <div class="card-head">
        <div><h2>Next 14 days</h2>
          <span class="hint">${fmtHours(totalHours)}h of work scheduled${heavy.length ? ` · ${heavy.length} heavy day${heavy.length > 1 ? "s" : ""}` : ""}</span>
        </div>
      </div>
      <div class="card-pad">
        ${barChartV(days.map((d) => ({
          value: Math.round(d.hours * 10) / 10,
          label: d.offset % 2 === 0 ? weekday(d.date).slice(0, 1) : "",
          heavy: d.heavy,
          title: `${fmtDateFull(d.date)} — ${fmtHours(d.hours)}h, ${d.count} task${d.count === 1 ? "" : "s"}`,
        })), { format: (v) => (v ? `${v}` : "") })}
        <div class="legend">
          <span><i style="background:var(--progress)"></i>Hours due</span>
          <span><i style="background:var(--danger)"></i>Heavy day (4h+)</span>
        </div>
      </div>
      ${days.some((d) => d.count) ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th class="num">Tasks</th><th class="num">Hours</th></tr></thead>
          <tbody>
            ${days.filter((d) => d.count).map((d) => `
              <tr data-state="${d.heavy ? "overdue" : ""}">
                <td class="nowrap">${weekday(d.date)} ${fmtDate(d.date)}${d.offset === 0 ? ' <span class="tag">today</span>' : ""}</td>
                <td class="num">${d.count}</td>
                <td class="num">${fmtHours(d.hours)}h</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `<div class="card-pad muted small">No dated work in the next two weeks.</div>`}
    </div>
  </div>`;
}

function courseTable(rows, ref) {
  return `
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Course</th><th style="min-width:120px">Progress</th>
          <th class="num">Open</th><th class="num">Overdue</th><th class="num">Due ≤7d</th>
          <th class="num">Est. hrs</th><th>Next big one</th><th class="num">Days away</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((c) => `
        <tr>
          <td class="nowrap">
            <span class="chip" style="--accent:var(--c-${c.course})">${esc(c.course)}</span>
            <span class="cell-sub">${esc(courses[c.course].name)}</span>
          </td>
          <td>
            <div class="bar-row" style="--accent:var(--c-${c.course})">
              ${bar(c.pctDone)}<span class="num">${fmtPct(c.pctDone)}</span>
            </div>
          </td>
          <td class="num">${c.open}</td>
          <td class="num ${c.overdue ? "days-left" : ""}" data-neg="${c.overdue > 0}">${c.overdue}</td>
          <td class="num">${c.dueWeek}</td>
          <td class="num">${fmtHours(c.estHours)}</td>
          <td>${c.nextBig
            ? `<span class="cell-main">${esc(c.nextBig.task)}</span><span class="cell-sub faint">${esc(c.nextBig.type)} · ${fmtDate(c.nextBig.due)}</span>`
            : '<span class="faint">—</span>'}</td>
          <td class="num nowrap">${c.daysAway === null ? "—" : daysLabel(c.daysAway)}</td>
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
