import { courses, cs360ScheduleCaveat } from "../config.js";
import { cs440Schedule, cs360Schedule, myGroups } from "../reference.js";
import { esc, fmtDate, weekday } from "../ui.js";
import { today, epochDay } from "../compute.js";

/** Read-only reference — the tentative class-by-class schedule, as in the workbook. */
export function renderSchedule(outlet, id) {
  outlet.style.cssText = `--accent: var(--c-${id})`;
  outlet.innerHTML = id === "CS440" ? cs440(id) : cs360(id);
}

function head(id, note) {
  return `
    <header class="view-head">
      <div>
        <div class="eyebrow">${esc(id)}</div>
        <h1>Tentative schedule</h1>
        <p>${esc(courses[id].name)} · ${esc(note)}</p>
      </div>
    </header>`;
}

/** Marks the current or next class so the table has an anchor when you open it. */
function nextIndex(rows) {
  const ref = epochDay(today());
  return rows.findIndex((r) => r.date && epochDay(r.date) >= ref);
}

function cs440(id) {
  const rows = cs440Schedule;
  const next = nextIndex(rows);
  const mine = rows.filter((r) => r.mine);

  return `
    ${head(id, "reading must be done before class; the schedule may still change")}

    <div class="banner">
      <div><strong>You're facilitating ${mine.length} class${mine.length === 1 ? "" : "es"}.</strong>
      ${mine.map((r) => `${esc(r.facilitators)} · ${esc(r.topic)} (${fmtDate(r.date)})`).join(" · ")}</div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th class="num">Wk</th><th class="num">Date</th><th>Day</th><th>Topic</th>
            <th class="num">Slides</th><th class="num">SE text</th><th>Facilitators</th><th>Due</th></tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
          <tr data-mine="${r.mine}" ${i === next ? 'id="next-class"' : ""}>
            <td class="num">${esc(r.wk)}</td>
            <td class="num nowrap">${fmtDate(r.date)}${i === next ? ' <span class="tag">next</span>' : ""}</td>
            <td>${esc(r.day)}</td>
            <td><span class="cell-main">${r.mine ? '<span class="star">★</span> ' : ""}${esc(r.topic)}</span></td>
            <td class="num">${esc(r.reading) || "—"}</td>
            <td class="num">${esc(r.seText) || "—"}</td>
            <td class="nowrap">${r.facilitators
              ? `<span class="${myGroups.includes(r.facilitators) ? "star" : ""}">${esc(r.facilitators)}</span>`
              : '<span class="faint">—</span>'}</td>
            <td class="muted small">${esc(r.due) || ""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p class="small faint" style="margin-top:var(--sp-3)">★ marks a class your group facilitates.</p>`;
}

function cs360(id) {
  const rows = cs360Schedule;
  const next = nextIndex(rows);

  return `
    ${head(id, "read the required sections before class; the schedule may still change")}

    <div class="banner" data-tone="warning">
      <div><strong>Listed dates and meeting days may not line up.</strong>${esc(cs360ScheduleCaveat.replace(/^Heads up: /, " "))}</div>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr><th class="num">Wk</th><th class="num">Date</th><th>Topic</th><th class="num">Reading</th><th>Due</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `
          <tr ${i === next ? 'data-mine="true"' : ""}>
            <td class="num">${esc(r.wk)}</td>
            <td class="num nowrap">${weekday(r.date)} ${fmtDate(r.date)}${i === next ? ' <span class="tag">next</span>' : ""}</td>
            <td><span class="cell-main">${esc(r.topic)}</span></td>
            <td class="num">${esc(r.reading) || "—"}</td>
            <td class="muted small">${esc(r.due) || ""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}
