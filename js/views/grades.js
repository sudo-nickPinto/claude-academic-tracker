import { courseIds, courses } from "../config.js";
import { load, update } from "../store.js";
import { gradeSummary } from "../compute.js";
import { esc, fmtPct } from "../ui.js";

/** Weights and scores are stored as fractions (0.25, not 25) but typed as percents. */
const toPct = (frac) => (typeof frac === "number" ? (frac * 100).toFixed(1).replace(/\.0$/, "") : "");
const fromPct = (text) => (text === "" ? null : Number(text) / 100);

export function renderGrades(outlet) {
  const state = load();
  const summaries = Object.fromEntries(
    courseIds.map((id) => [id, gradeSummary(state.grades[id])]));

  outlet.style.cssText = "";
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">Grades</div>
        <h1>Grade calculator</h1>
        <p>Type each graded item and its weight from the syllabus, then fill in scores as they come back.</p>
      </div>
    </header>

    <div class="card">
      <div class="card-head"><h2>All courses</h2>
        <span class="hint">Current grade is your average on what's been graded so far.</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Course</th><th class="num">Current</th><th class="num">Target</th>
            <th class="num" data-col="t1">Weight graded</th><th class="num">Need on everything left</th></tr></thead>
          <tbody data-all>${allCoursesRows(summaries)}</tbody>
        </table>
      </div>
    </div>

    ${courseIds.map((id) => courseBlock(id, state.grades[id], summaries[id])).join("")}`;

  wire(outlet);
}

function needCell(g) {
  if (g.neededOnRest === null) {
    return g.totalWeight > 0
      ? '<span class="faint">everything graded</span>'
      : '<span class="faint">—</span>';
  }
  const out = g.neededOnRest > 1;
  return `<span class="${out ? "days-left" : ""}" data-neg="${out}">${fmtPct(g.neededOnRest)}</span>`;
}

function allCoursesRows(summaries) {
  return courseIds.map((id) => {
    const g = summaries[id];
    return `
      <tr>
        <td class="nowrap"><span class="chip" style="--accent:var(--c-${id})">${esc(id)}</span>
          <span class="cell-sub">${esc(courses[id].name)}</span></td>
        <td class="num" data-label="Current">${g.currentGrade === null ? '<span class="faint">—</span>' : fmtPct(g.currentGrade)}</td>
        <td class="num" data-label="Target">${fmtPct(g.target)}</td>
        <td class="num" data-col="t1" data-label="Weight graded">${fmtPct(g.gradedWeight)}</td>
        <td class="num" data-label="Need left">${needCell(g)}</td>
      </tr>`;
  }).join("");
}

const warnBanner = (g) => (g.weightWarning ? `
  <div class="card-pad" style="padding-bottom:0">
    <div class="banner" data-tone="warning" style="margin:0">
      <div><strong>Weights total ${fmtPct(g.totalWeight)}, not 100%.</strong>
      Current grade and “need on everything left” assume the full item list adds up to a whole course.</div>
    </div>
  </div>` : "");

const ptsCell = (item) => (typeof item?.weight === "number" && typeof item?.score === "number"
  ? fmtPct(item.weight * item.score) : '<span class="faint">—</span>');

const statusCell = (item) => (typeof item?.score === "number"
  ? '<span class="pill" data-v="Done">Graded</span>'
  : '<span class="pill" data-v="Not Started">Not graded</span>');

const kvRows = (g) => `
  <dt>Weight assigned (should total 100%)</dt><dd>${fmtPct(g.totalWeight)}</dd>
  <dt>Weight already graded</dt><dd>${fmtPct(g.gradedWeight)}</dd>
  <dt>Current grade</dt><dd>${g.currentGrade === null ? "—" : fmtPct(g.currentGrade)}</dd>
  <dt>Remaining weight</dt><dd>${fmtPct(g.remainingWeight)}</dd>
  <dt>Need on everything left</dt><dd>${needCell(g)}</dd>`;

const reachHint = (g) => (g.neededOnRest !== null && g.neededOnRest > 1
  ? `<span class="small" style="color:var(--danger)">Out of reach — you'd need ${fmtPct(g.neededOnRest)} on everything remaining.</span>`
  : "");

function courseBlock(id, entry, g) {
  const items = entry.items;
  return `
  <section class="section" style="--accent:var(--c-${id})">
    <div class="card" data-course="${id}">
      <div class="card-head">
        <div>
          <div class="eyebrow">${esc(id)}</div>
          <h2 style="font-size:var(--step-1)">${esc(courses[id].name)}</h2>
        </div>
        <button class="btn btn-sm" data-add="${id}" type="button">+ Add item</button>
      </div>

      <div data-warn>${warnBanner(g)}</div>

      ${items.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Graded item</th><th class="num" style="width:110px">Weight %</th>
            <th class="num" style="width:110px">Score %</th><th class="num" data-col="t1">Points earned</th>
            <th data-col="t2">Status</th><th style="width:44px"></th></tr></thead>
          <tbody>
            ${items.map((item, i) => `
            <tr data-row="${i}">
              <td data-cell="main"><input type="text" data-f="item" value="${esc(item.item ?? "")}" placeholder="Midterm, Final, Homework…"></td>
              <td data-label="Weight %"><input type="number" class="num" data-f="weight" min="0" max="100" step="0.5" value="${toPct(item.weight)}"></td>
              <td data-label="Score %"><input type="number" class="num" data-f="score" min="0" max="150" step="0.5" value="${toPct(item.score)}" placeholder="—"></td>
              <td class="num" data-pts data-col="t1" data-label="Points">${ptsCell(item)}</td>
              <td data-st data-col="t2" data-label="Status">${statusCell(item)}</td>
              <td data-cell="act"><button class="btn btn-ghost btn-sm" data-del="${i}" type="button" aria-label="Delete row">✕</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `<div class="empty"><strong>No graded items yet.</strong>
        Ten minutes with the syllabus now, and the “what do I need on the final” answer is there all semester.</div>`}

      <div class="card-pad" style="border-top:1px solid var(--border)">
        <div class="split" style="gap:var(--sp-5)">
          <dl class="kv" data-kv>${kvRows(g)}</dl>
          <div class="field" style="max-width:200px">
            <label for="target-${id}">Target final grade</label>
            <input id="target-${id}" type="number" min="0" max="100" step="0.5"
                   data-target="${id}" value="${toPct(g.target)}">
            <span data-reach>${reachHint(g)}</span>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

/** Repaint only the derived cells, so an input keeps its focus and caret while you type. */
function refresh(outlet) {
  const state = load();
  const summaries = Object.fromEntries(
    courseIds.map((id) => [id, gradeSummary(state.grades[id])]));

  outlet.querySelector("[data-all]").innerHTML = allCoursesRows(summaries);

  for (const id of courseIds) {
    const block = outlet.querySelector(`[data-course="${id}"]`);
    const g = summaries[id];
    block.querySelector("[data-warn]").innerHTML = warnBanner(g);
    block.querySelector("[data-kv]").innerHTML = kvRows(g);
    block.querySelector("[data-reach]").innerHTML = reachHint(g);
    block.querySelectorAll("[data-row]").forEach((tr) => {
      const item = state.grades[id].items[Number(tr.dataset.row)];
      tr.querySelector("[data-pts]").innerHTML = ptsCell(item);
      tr.querySelector("[data-st]").innerHTML = statusCell(item);
    });
  }
}

function wire(outlet) {
  const rerender = () => renderGrades(outlet);

  outlet.querySelectorAll("[data-add]").forEach((btn) =>
    btn.addEventListener("click", () => {
      update((draft) => draft.grades[btn.dataset.add].items.push({ item: "", weight: null, score: null }));
      rerender();
    }));

  outlet.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.closest("[data-course]").dataset.course;
      update((draft) => draft.grades[id].items.splice(Number(btn.dataset.del), 1));
      rerender();
    }));

  outlet.querySelectorAll("[data-target]").forEach((input) =>
    input.addEventListener("input", () => {
      if (input.value === "") return;
      update((draft) => { draft.grades[input.dataset.target].target = fromPct(input.value); });
      refresh(outlet);
    }));

  outlet.querySelectorAll("[data-f]").forEach((input) =>
    input.addEventListener("input", () => {
      const id = input.closest("[data-course]").dataset.course;
      const index = Number(input.closest("[data-row]").dataset.row);
      const field = input.dataset.f;
      update((draft) => {
        const item = draft.grades[id].items[index];
        item[field] = field === "item" ? input.value.trim() : fromPct(input.value);
      });
      refresh(outlet);
    }));
}
