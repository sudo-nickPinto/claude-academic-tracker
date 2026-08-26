/** Hand-rolled SVG charts — no libraries, consistent with the no-dependency constraint. */

import { esc } from "./ui.js";

const nice = (max) => {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / mag) * mag;
};

/**
 * Horizontal bars — best when the labels are words (course names, task types)
 * that would otherwise be turned sideways.
 */
export function barChartH(rows, { color = "var(--progress)", format = (v) => v } = {}) {
  if (!rows.length || rows.every((r) => !r.value)) {
    return `<p class="muted small">Nothing to chart yet.</p>`;
  }
  const rowH = 30;
  const labelW = 92;
  const w = 320;
  const max = nice(Math.max(...rows.map((r) => r.value)));
  const h = rows.length * rowH;

  const bars = rows.map((r, i) => {
    const y = i * rowH + 6;
    const width = (r.value / max) * (w - labelW - 44);
    const fill = r.color || color;
    return `
      <text x="${labelW - 8}" y="${y + 12}" text-anchor="end">${esc(r.label)}</text>
      <rect class="track" x="${labelW}" y="${y}" width="${w - labelW - 44}" height="16" rx="4"/>
      <rect class="b" x="${labelW}" y="${y}" width="${Math.max(0, width)}" height="16" rx="4" fill="${fill}"/>
      <text class="val" x="${w - 38}" y="${y + 12}">${esc(format(r.value))}</text>`;
  }).join("");

  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img">${bars}</svg></div>`;
}

/** Vertical bars for the 14-day workload — days read left to right, like a calendar. */
export function barChartV(days, { format = (v) => v } = {}) {
  const w = 460, h = 150, pad = 26, base = h - 24;
  // `committed` stacks under the work bar, so the axis shows the whole day, not
  // just the coursework half of it.
  const max = nice(Math.max(1, ...days.map((d) => d.value + (d.committed || 0))));
  const slot = (w - pad) / days.length;
  const bw = Math.min(22, slot * 0.62);
  const scale = (v) => (v / max) * (base - 14);

  const bars = days.map((d, i) => {
    const x = pad + i * slot + (slot - bw) / 2;
    const ch = scale(d.committed || 0);
    const bh = scale(d.value);
    const y = base - ch - bh;
    const fill = d.heavy || d.overbooked ? "var(--danger)" : "var(--progress)";
    return `
      ${d.committed ? `<rect class="b" x="${x}" y="${base - ch}" width="${bw}" height="${Math.max(0, ch)}"
            rx="3" fill="var(--text-faint)" opacity="0.45"><title>${esc(d.title)}</title></rect>` : ""}
      <rect class="b" x="${x}" y="${y}" width="${bw}" height="${Math.max(0, bh)}" rx="3" fill="${fill}"
            opacity="${d.value ? 1 : 0.18}"><title>${esc(d.title)}</title></rect>
      ${d.value ? `<text class="val" x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" style="font-size:9px">${esc(format(d.value))}</text>` : ""}
      <text x="${x + bw / 2}" y="${base + 12}" text-anchor="middle" style="font-size:9px">${esc(d.label)}</text>`;
  }).join("");

  const ticks = [0, max / 2, max].map((v) => {
    const y = base - (v / max) * (base - 14);
    return `<line class="axis" x1="${pad}" x2="${w}" y1="${y}" y2="${y}" opacity="0.5"/>
            <text x="${pad - 6}" y="${y + 3}" text-anchor="end" style="font-size:9px">${v % 1 ? v.toFixed(1) : v}</text>`;
  }).join("");

  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img">${ticks}${bars}</svg></div>`;
}

/** Donut for the status breakdown, with the total in the hole. */
export function donut(rows, { total, centerLabel = "tasks" } = {}) {
  const sum = total ?? rows.reduce((s, r) => s + r.value, 0);
  if (!sum) return `<p class="muted small">Nothing to chart yet.</p>`;

  const size = 190, r = 70, cx = size / 2, cy = size / 2, stroke = 26;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  const arcs = rows.filter((row) => row.value).map((row) => {
    const frac = row.value / sum;
    const dash = `${frac * circumference} ${circumference}`;
    const seg = `<circle class="arc" cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${row.color}" stroke-width="${stroke}" stroke-dasharray="${dash}"
      stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"
      ><title>${esc(row.label)}: ${row.value}</title></circle>`;
    offset += frac * circumference;
    return seg;
  }).join("");

  const legend = rows.filter((row) => row.value).map((row) =>
    `<span><i style="background:${row.color}"></i>${esc(row.label)} · ${row.value}</span>`).join("");

  return `
    <div class="chart">
      <svg viewBox="0 0 ${size} ${size}" role="img" style="max-width:190px;margin-inline:auto">
        <circle class="track" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
        ${arcs}
        <text class="val" x="${cx}" y="${cy - 2}" text-anchor="middle" style="font-size:26px">${sum}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle">${esc(centerLabel)}</text>
      </svg>
      <div class="legend">${legend}</div>
    </div>`;
}
