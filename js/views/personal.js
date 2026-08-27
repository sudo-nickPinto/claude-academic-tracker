import { load } from "../store.js";
import { today, daysLeft, rowState, isDone, isNamed } from "../compute.js";
import { esc, daysLabel, emptyState } from "../ui.js";
import { openTaskDialog } from "./taskdialog.js";
import { toggleDone } from "../tasks.js";
import { qe, mountQuickEdit } from "./row.js";

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
            <th data-col="t1">Notes</th>
            <th data-col="t3">Priority</th>
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
              <td data-cell="check"><input type="checkbox" class="toggle checkbox" ${isDone(t) ? "checked" : ""} aria-label="Mark ${esc(t.task)} done"></td>
              <td data-cell="main"><span class="cell-main">${esc(t.task)}</span>
                ${t.notes ? `<span class="cell-fold" data-when="t1">${esc(t.notes)}</span>` : ""}
                <span class="cell-fold cell-fold-inline" data-when="t3">${qe("Personal", t, "priority")}</span></td>
              <td class="muted small" data-col="t1" data-label="Notes">${esc(t.notes) || "—"}</td>
              <td data-col="t3" data-label="Priority">${qe("Personal", t, "priority")}</td>
              <td data-label="Status">${qe("Personal", t, "status")}</td>
              <td class="num nowrap" data-label="Due">${qe("Personal", t, "due")}</td>
              <td class="num nowrap days-left" data-neg="${left !== null && left < 0}" data-label="Days left" data-derived="days">${daysLabel(left)}</td>
              <td data-cell="act"><button class="btn btn-ghost btn-sm edit" type="button">Edit</button></td>
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

  // Personal has no start-by and no estimate, so the only derived cell an edit can
  // move is Days left. A row marked Done sorts to the bottom on the next render; it
  // is not restacked here, for the same reason nothing is removed mid-edit.
  mountQuickEdit(outlet, {
    onEdited: ({ task }) => {
      const tr = outlet.querySelector(`tr[data-id="${CSS.escape(task.id)}"]`);
      if (!tr) return;
      const left = daysLeft(task, ref);
      const days = tr.querySelector('[data-derived="days"]');
      if (days) {
        days.textContent = daysLabel(left);
        days.dataset.neg = String(left !== null && left < 0);
      }
      tr.querySelector(".toggle").checked = isDone(task);
      tr.dataset.state = rowState(task, ref);
    },
  });
}
