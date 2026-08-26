import { load } from "../store.js";
import { today, analytics } from "../compute.js";
import { esc, fmtHours, fmtPct, bar } from "../ui.js";
import { barChartH, donut } from "../charts.js";

const STATUS_COLORS = {
  "Not Started": "var(--text-faint)",
  "In Progress": "var(--progress)",
  "Waiting / Blocked": "var(--blocked)",
  "Done": "var(--success)",
  "No status set": "var(--border-strong)",
};

const OUTLOOK_COLORS = {
  "Overdue": "var(--danger)",
  "Due today": "var(--warning)",
  "Next 7 days": "var(--warning)",
  "8–30 days": "var(--progress)",
  "Beyond 30 days": "var(--text-faint)",
  "No due date": "var(--border-strong)",
};

export function renderAnalytics(outlet) {
  const state = load();
  const a = analytics(state, today());

  outlet.style.cssText = "";
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">Analytics</div>
        <h1>Cross-course statistics</h1>
        <p>Coursework only — the Personal list is excluded from every number on this page.
        This page counts the whole semester; the dashboard counts what's active today.</p>
      </div>
    </header>

    <div class="stat-grid">
      <div class="stat"><span class="stat-label">Total tasks</span><span class="stat-value">${a.snapshot.total}</span></div>
      <div class="stat"><span class="stat-label">Open</span><span class="stat-value">${a.snapshot.open}</span>
        <span class="stat-sub">${a.snapshot.active} active · ${a.snapshot.later} later</span></div>
      <div class="stat" data-tone="success"><span class="stat-label">Completed</span>
        <span class="stat-value">${a.snapshot.completed}</span>
        <span class="stat-sub">${fmtPct(a.snapshot.completion)} completion</span></div>
      <div class="stat" data-tone="danger"><span class="stat-label">Overdue</span><span class="stat-value">${a.snapshot.overdue}</span></div>
      <div class="stat" data-tone="progress"><span class="stat-label">In progress</span><span class="stat-value">${a.snapshot.inProgress}</span></div>
      <div class="stat"><span class="stat-label">Waiting / blocked</span><span class="stat-value">${a.snapshot.blocked}</span></div>
      <div class="stat"><span class="stat-label">Est. hours open</span><span class="stat-value">${fmtHours(a.snapshot.openHours)}</span></div>
      <div class="stat"><span class="stat-label">Avg. per open task</span>
        <span class="stat-value">${Math.round(a.snapshot.avgMinPerOpen)}</span><span class="stat-sub">minutes</span></div>
      <div class="stat" ${a.snapshot.noDueDate ? 'data-tone="warning"' : ""}>
        <span class="stat-label">No due date</span><span class="stat-value">${a.snapshot.noDueDate}</span>
        <span class="stat-sub">open, undated</span></div>
    </div>

    <section class="section split">
      <div class="card">
        <div class="card-head"><h2>Due-date outlook</h2><span class="hint">Open tasks only</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Window</th><th class="num">Tasks</th><th class="num">Hours</th><th style="min-width:110px" data-col="t1"></th></tr></thead>
            <tbody>
              ${a.outlook.map((b) => {
                const max = Math.max(1, ...a.outlook.map((x) => x.count));
                return `
                <tr>
                  <td class="nowrap"><span class="chip" style="--accent:${OUTLOOK_COLORS[b.key]}">${esc(b.key)}</span></td>
                  <td class="num" data-label="Tasks">${b.count}</td>
                  <td class="num" data-label="Hours">${fmtHours(b.hours)}</td>
                  <td data-col="t1">${bar(b.count / max, `style="--accent:${OUTLOOK_COLORS[b.key]}"`)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>By status</h2></div>
        <div class="card-pad">
          ${donut(a.byStatus.filter((r) => r.count).map((r) => ({
            label: r.key, value: r.count, color: STATUS_COLORS[r.key],
          })), { centerLabel: "tasks" })}
          <div class="kv" style="margin-top:var(--sp-4)">
            ${a.byStatus.map((r) => `<dt>${esc(r.key)}</dt><dd>${r.count} · ${fmtPct(r.pct)}</dd>`).join("")}
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>By course</h2></div>
      ${breakdownTable(a.byCourse, "Course", true)}
    </section>

    <section class="section split">
      <div class="card">
        <div class="card-head"><h2>By priority</h2></div>
        ${breakdownRows(a.byPriority, "Priority", false)}
      </div>
      <div class="card">
        <div class="card-head"><h2>Open tasks by priority</h2></div>
        <div class="card-pad">${barChartH(a.byPriority.map((r) => ({
          label: r.key, value: r.open,
          color: r.key === "High" ? "var(--danger)" : r.key === "Medium" ? "var(--warning)" : "var(--text-faint)",
        })))}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>By type of work</h2></div>
      ${breakdownTable(a.byType.sort((x, y) => y.open - x.open), "Type", true)}
    </section>`;
}

function breakdownTable(rows, label, withHours) {
  return `<div class="table-wrap">${tableBody(rows, label, withHours)}</div>`;
}

function breakdownRows(rows, label, withHours) {
  return `<div class="table-wrap" style="border:none;box-shadow:none;border-radius:0">${tableBody(rows, label, withHours)}</div>`;
}

function tableBody(rows, label, withHours) {
  return `
  <table>
    <thead>
      <tr><th>${esc(label)}</th><th class="num">Open</th><th class="num">Done</th>
        <th class="num">Overdue</th>${withHours ? '<th class="num" data-col="t1">Est. hrs open</th>' : ""}</tr>
    </thead>
    <tbody>
      ${rows.map((r) => `
      <tr>
        <td class="nowrap">${label === "Course"
          ? `<span class="chip" style="--accent:var(--c-${r.key})">${esc(r.key)}</span>`
          : esc(r.key)}</td>
        <td class="num" data-label="Open">${r.open}</td>
        <td class="num" data-label="Done">${r.done}</td>
        <td class="num ${r.overdue ? "days-left" : ""}" data-neg="${r.overdue > 0}" data-label="Overdue">${r.overdue}</td>
        ${withHours ? `<td class="num" data-col="t1" data-label="Est. hrs">${fmtHours(r.estHours)}</td>` : ""}
      </tr>`).join("")}
    </tbody>
  </table>`;
}
