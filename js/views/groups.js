import { cs440Groups, myGroups } from "../reference.js";
import { esc } from "../ui.js";

/** Read-only reference — the source sheet had no formulas and no editing. */
export function renderGroups(outlet) {
  outlet.style.cssText = "--accent: var(--c-CS440)";
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">CS440</div>
        <h1>Project groups</h1>
        <p>Reference only. Highlighted rows are groups you're in — ${esc(myGroups.join(", "))}.</p>
      </div>
    </header>

    <div class="banner" data-tone="warning">
      <div><strong>The workbook only flagged Group 1 and Group 5 as yours.</strong>
      Your name also appears in ${esc(myGroups[myGroups.length - 1])}, so this view derives “my groups”
      from the roster itself rather than the old highlight. Worth double-checking against the real roster —
      and note there's no facilitation task on your CS440 list for it.</div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Group</th><th>Members</th><th>Facilitates</th></tr>
        </thead>
        <tbody>
          ${cs440Groups.map((g) => `
          <tr data-mine="${g.mine}">
            <td class="nowrap"><span class="cell-main">${esc(g.group)}</span>
              ${g.mine ? '<span class="star" title="You are in this group">★</span>' : ""}</td>
            <td>${g.members.map((m) => `<span class="tag">${esc(m)}</span>`).join(" ")}</td>
            <td class="muted small">${esc(g.facilitates) || "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>

    <p class="small faint" style="margin-top:var(--sp-3)">
      Classmates are shown by initial. The workbook stored first names; they're kept out of the
      published repo — see the README if you'd rather have them back.
    </p>`;
}
