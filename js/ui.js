/** Small rendering helpers shared by every view. */

import { courses, personalMeta } from "./config.js";

export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export const meta = (id) => courses[id] || personalMeta;

export const accentVar = (id) => `--accent: var(--c-${id});`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const { m, d } = parts(iso);
  return `${MONTHS[m - 1]} ${d}`;
}

export function fmtDateFull(iso) {
  if (!iso) return "—";
  const { y, m, d, weekday } = parts(iso);
  return `${DAYS[weekday]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

export const weekday = (iso) => (iso ? DAYS[parts(iso).weekday] : "");

export function fmtHours(h) {
  if (!h) return "0";
  return h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h).toString();
}

export const fmtPct = (frac) => `${Math.round((frac || 0) * 100)}%`;

/**
 * Serialize a plain object into HTML attributes. Values are escaped; a `false`,
 * `null` or `undefined` value drops the attribute, and `true` renders it bare.
 */
export function attrs(map = {}) {
  return Object.entries(map)
    .filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");
}

/**
 * A status/priority badge. `opts.attrs` rides on the element itself, which is
 * what lets a quick-edit trigger tag its pill without a wrapper — a wrapper
 * would add width, and column width is what the layout gate measures.
 */
export const pill = (value, opts = {}) =>
  value ? `<span class="pill" data-v="${esc(value)}"${attrs(opts.attrs)}>${esc(value)}</span>` : "";

export function bar(frac, extra = "") {
  const pct = Math.max(0, Math.min(1, frac || 0)) * 100;
  return `<div class="bar" ${extra}><span style="width:${pct.toFixed(1)}%"></span></div>`;
}

export function daysLabel(n) {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "today";
  if (n < 0) return `${Math.abs(n)}d over`;
  return `${n}d`;
}

/**
 * Wires <dialog> close buttons and backdrop clicks once per dialog, and returns
 * focus where it came from on close.
 *
 * Without the focus return, closing the task dialog drops focus onto <body>, so a
 * keyboard user lands at the top of the document and has to tab all the way back
 * to the row they were editing. The listener is registered once, alongside the
 * other one-time wiring, and reads the anchor off the dialog each time.
 */
export function openDialog(dialog) {
  if (!dialog.dataset.wired) {
    dialog.dataset.wired = "1";
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.querySelectorAll("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => dialog.close()));
    dialog.addEventListener("close", () => {
      const anchor = dialog._returnFocus;
      dialog._returnFocus = null;
      // Only if it's still in the document — the dialog may have deleted the row
      // whose button opened it.
      if (anchor?.isConnected) anchor.focus();
    });
  }
  dialog._returnFocus = document.activeElement;
  dialog.showModal();
}

/**
 * The "nothing here" panel. `action` takes `{ label, attrs }` and renders a
 * button, so an empty list can offer the thing you'd have come here to do
 * instead of only stating that it is empty.
 */
export function emptyState(title, hint, action = null) {
  const btn = action
    ? `<button class="btn btn-sm" type="button"${attrs(action.attrs)}>${esc(action.label)}</button>`
    : "";
  return `<div class="empty"><strong>${esc(title)}</strong>${hint ? esc(hint) : ""}${
    btn ? `<div class="empty-action">${btn}</div>` : ""
  }</div>`;
}
