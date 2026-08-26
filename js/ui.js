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

export const pill = (value) =>
  value ? `<span class="pill" data-v="${esc(value)}">${esc(value)}</span>` : "";

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

/** Wires <dialog> close buttons and backdrop clicks once per dialog. */
export function openDialog(dialog) {
  if (!dialog.dataset.wired) {
    dialog.dataset.wired = "1";
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.querySelectorAll("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => dialog.close()));
  }
  dialog.showModal();
}

export function emptyState(title, hint) {
  return `<div class="empty"><strong>${esc(title)}</strong>${hint ? esc(hint) : ""}</div>`;
}
