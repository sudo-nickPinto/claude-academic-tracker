/**
 * The bulk-action bar: what appears once more than one row is selected.
 *
 * It hosts no state of its own. The view owns the selection — it is the only thing
 * that knows which rows are on screen and which list they belong to — and this module
 * only draws the bar and reports which button was pressed. That split is what lets the
 * same bar serve any view that grows a selection later without moving any state here.
 *
 * The field buttons reuse js/ui/popover.js rather than growing their own menu: picking
 * "High" for eleven rows should look and behave exactly like picking it for one.
 */

import { esc } from "../ui.js";
import { openPopover, closePopover } from "./popover.js";

const host = () => document.getElementById("bulkbar");

/**
 * Draw the bar for the current selection.
 *
 * @param count    how many rows are selected
 * @param fields   [{ field, label, values }] — one button per editable field
 * @param onPick   (field, value) once a value is chosen
 * @param onDone   the Mark done button
 * @param onClear  the Clear button, and what Escape does
 */
export function showBulkBar({ count, fields = [], onPick, onDone, onClear }) {
  const el = host();
  if (!el) return;

  el.innerHTML = `
    <span class="bulk-count">${count} selected</span>
    <span class="bulk-sep"></span>
    ${fields.map(({ field, label }) =>
      `<button class="btn btn-ghost btn-sm" type="button" data-field="${esc(field)}">${esc(label)}</button>`).join("")}
    <button class="btn btn-ghost btn-sm" type="button" data-act="done">Mark done</button>
    <span class="bulk-sep"></span>
    <button class="btn btn-ghost btn-sm" type="button" data-act="clear">Clear</button>`;

  el.hidden = false;

  fields.forEach(({ field, label, values }) => {
    el.querySelector(`[data-field="${field}"]`).addEventListener("click", (e) => {
      openPopover(e.currentTarget, {
        label: `${label} for ${count} task${count === 1 ? "" : "s"}`,
        values,
        value: null,
        onPick: (value) => onPick?.(field, value),
      });
    });
  });

  el.querySelector('[data-act="done"]').addEventListener("click", () => onDone?.());
  el.querySelector('[data-act="clear"]').addEventListener("click", () => onClear?.());
}

export function hideBulkBar() {
  const el = host();
  if (!el) return;
  // A popover anchored to a button inside the bar would outlive the bar itself and
  // sit over the page pointing at nothing.
  if (el.contains(document.activeElement)) closePopover({ restoreFocus: false });
  el.hidden = true;
  el.innerHTML = "";
}

export const isBulkBarOpen = () => Boolean(host() && !host().hidden);
