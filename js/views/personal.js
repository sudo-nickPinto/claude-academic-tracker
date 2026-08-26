import { load } from "../store.js";
import { today, daysLeft, rowState, isDone, isNamed } from "../compute.js";
import { esc, fmtDate, pill, daysLabel, emptyState } from "../ui.js";
import { openTaskDialog, toggleDone } from "./taskdialog.js";

/** Five fields, no analytics, no computed columns. The simplicity is the point. */
export function renderPersonal(outlet) {
  const state = load();
  const ref = today();
  const rows = state.personal.filter(isNamed).sort((a, b) => {
    if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;
    if (!a.due && !b.due) return a.seq - b.seq;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due.localeCompare(b.due) || a.seq - b.seq;
  });

  outlet.style.cssText = "--accent: var(--c-Personal)";
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">Personal</div>
        <h1>Not coursework</h1>
        <p>Kept out of every Dashboard and Analytics number on purpose.</p>
      </div>
      <button class="btn btn-primary" id="add-task">+ New item</button>
    </header>

    ${rows.length ? `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:34px"></th>
            <th>Task</th>
            <th>Notes</th>
            <th>Priority</th>
            <th>Status</th>
            <th class="num">Due</th>
            <th class="num">Days</th>
            <th style="width:52px"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((t) => {
            const left = daysLeft(t, ref);
            return `
            <tr data-state="${rowState(t, ref)}" data-id="${t.id}">
              <td><input type="checkbox" class="toggle" ${isDone(t) ? "checked" : ""} aria-label="Mark ${esc(t.task)} done"></td>
              <td><span class="cell-main">${esc(t.task)}</span></td>
              <td class="muted small">${esc(t.notes) || "—"}</td>
              <td>${pill(t.priority)}</td>
              <td>${pill(t.status)}</td>
              <td class="num nowrap">${fmtDate(t.due)}</td>
              <td class="num nowrap days-left" data-neg="${left !== null && left < 0}">${daysLabel(left)}</td>
              <td><button class="btn btn-ghost btn-sm edit" type="button">Edit</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : emptyState("Nothing on the personal list.", "Add one with the New item button.")}`;

  const rerender = () => renderPersonal(outlet);

  outlet.querySelector("#add-task").addEventListener("click", () =>
    openTaskDialog("Personal", null, rerender));

  outlet.querySelectorAll("tbody tr").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector(".toggle").addEventListener("change", () => {
      toggleDone("Personal", id);
      rerender();
    });
    tr.querySelector(".edit").addEventListener("click", () => {
      openTaskDialog("Personal", load().personal.find((t) => t.id === id), rerender);
    });
  });
}
