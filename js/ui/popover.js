/**
 * The quick-edit popover: a small floating menu anchored to whatever was clicked.
 *
 * There is exactly one popover element, `#pop`, reused for every edit. Reusing one
 * node rather than creating one per cell is not a micro-optimisation — it is what
 * guarantees only one editor can ever be open, so there is never a question of
 * which one a keystroke belongs to.
 *
 * Why it lives at the end of <body> instead of inside the cell it edits: a task
 * cell sits inside `.table-wrap`, which is both `overflow-x: auto` and
 * `container-type: inline-size`. The first clips (a non-visible overflow on one
 * axis forces the other to `auto`, so it clips vertically too), and the second
 * applies layout containment, which makes the wrapper a containing block even for
 * `position: fixed` descendants. An in-cell popover is therefore clipped *and*
 * positioned against the wrong box. The top layer escapes both, and being out of
 * flow it cannot widen the document — which is what keeps layout.test.mjs green.
 */

import { esc, attrs, pill } from "../ui.js";

const EDGE = 8;   // keep this much clear of every viewport edge
const GAP = 4;    // between the anchor and the popover

let el = null;
let anchor = null;
let session = null;

const host = () => document.getElementById("pop");

/** True once the browser has the Popover API; otherwise we position a plain box. */
const supportsPopover = () =>
  typeof HTMLElement !== "undefined" && HTMLElement.prototype.hasOwnProperty("popover");

export const isPopoverOpen = () => Boolean(session);

// ------------------------------------------------------------------ placement

/**
 * Place the popover against its anchor in viewport coordinates.
 *
 * Everything here is `position: fixed` maths, so it is deliberately unaware of
 * scroll offsets — `getBoundingClientRect()` is already viewport-relative, and the
 * top layer is not scrolled by any ancestor.
 */
function place() {
  if (!el || !anchor?.isConnected) return;

  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Left-align with the anchor, then pull back inside the viewport. Clamping to
  // EDGE last means a popover wider than the screen still starts on-screen
  // rather than being pushed off the left edge by the right-hand clamp.
  let left = Math.min(r.left, vw - EDGE - w);
  left = Math.max(EDGE, left);

  let top = r.bottom + GAP;
  let side = "below";
  if (top + h > vh - EDGE) {
    const above = r.top - GAP - h;
    if (above >= EDGE) {
      top = above;
      side = "above";
    } else {
      // Fits neither way — sit against the bottom edge rather than overflowing.
      top = Math.max(EDGE, vh - EDGE - h);
    }
  }

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.dataset.side = side;
}

// -------------------------------------------------------------------- opening

function ensureHost() {
  el = host();
  if (!el) return false;
  if (!el.dataset.wired) {
    el.dataset.wired = "1";
    el.addEventListener("keydown", onKeydown);
    // Reposition rather than close: the anchor can move under a scrolling
    // .table-wrap, and closing on every scroll tick makes the popover feel
    // like it is fighting the page. Capture, because the scroll may be on an
    // ancestor that does not bubble scroll events.
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
  }
  return true;
}

function open(anchorEl, html, { onKey } = {}) {
  if (!ensureHost() || !anchorEl) return false;

  closePopover({ restoreFocus: false });

  anchor = anchorEl;
  session = { onKey };
  el.innerHTML = html;
  anchor.setAttribute("aria-expanded", "true");

  if (supportsPopover()) {
    try {
      el.showPopover();
    } catch {
      // Already open, or the element is not in the document. Either way the
      // fallback path below still renders it correctly.
      el.dataset.fallback = "true";
    }
  } else {
    el.dataset.fallback = "true";
  }

  place();

  // Outside-click and outside-focus dismissal. Registered a tick late so the
  // click that opened the popover doesn't immediately close it — the event is
  // still propagating when this runs.
  setTimeout(() => {
    if (!session) return;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("focusin", onOutside, true);
  }, 0);

  return true;
}

function onOutside(e) {
  if (!el || !session) return;
  if (el.contains(e.target) || anchor?.contains(e.target)) return;
  closePopover();
}

export function closePopover({ restoreFocus = true } = {}) {
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("focusin", onOutside, true);

  if (!el || !session) {
    session = null;
    return;
  }

  const returnTo = anchor;
  session = null;
  anchor = null;

  if (supportsPopover() && el.matches(":popover-open")) {
    try { el.hidePopover(); } catch { /* already hidden */ }
  }
  delete el.dataset.fallback;
  el.innerHTML = "";

  if (returnTo?.isConnected) {
    returnTo.setAttribute("aria-expanded", "false");
    // Focus goes back to the cell you clicked, so a keyboard user carries on
    // from the value they just changed instead of from the top of the document.
    if (restoreFocus) returnTo.focus();
  }
}

// ------------------------------------------------------------------- keyboard

function items() {
  return el ? [...el.querySelectorAll(".pop-item")] : [];
}

function activeIndex(list) {
  const i = list.findIndex((n) => n.dataset.active === "true");
  return i === -1 ? list.findIndex((n) => n.getAttribute("aria-selected") === "true") : i;
}

function setActive(list, next) {
  list.forEach((n, i) => {
    const on = i === next;
    n.dataset.active = String(on);
    if (on) {
      n.focus();
      n.scrollIntoView({ block: "nearest" });
    }
  });
}

function onKeydown(e) {
  if (!session) return;

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closePopover();
    return;
  }

  if (session.onKey?.(e) === true) return;

  const list = items();
  if (!list.length) return;

  const current = activeIndex(list);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    const start = current === -1 ? (step === 1 ? -1 : 0) : current;
    setActive(list, (start + step + list.length) % list.length);
  } else if (e.key === "Home") {
    e.preventDefault();
    setActive(list, 0);
  } else if (e.key === "End") {
    e.preventDefault();
    setActive(list, list.length - 1);
  }
}

// -------------------------------------------------------------------- choices

/**
 * A list of values to pick from.
 *
 * @param anchorEl the element the popover hangs off, and where focus returns
 * @param label    the field name, shown as the popover's heading
 * @param values   the options
 * @param value    the current one, pre-selected and focused
 * @param asPill   render each option as a status/priority pill rather than text
 * @param onPick   called with the chosen value; the popover closes first, so the
 *                 caller is free to re-render the row it was anchored to
 */
export function openPopover(anchorEl, { label, values, value, asPill = true, onPick }) {
  const body = `
    <div class="pop-label">${esc(label)}</div>
    <div class="pop-list" role="listbox" aria-label="${esc(label)}">
      ${values.map((v) => `
        <button type="button" class="pop-item" role="option"
                aria-selected="${v === value}" data-value="${esc(v)}">
          <span class="pop-check" aria-hidden="true">✓</span>
          ${asPill ? pill(v) : `<span>${esc(v)}</span>`}
        </button>`).join("")}
    </div>`;

  if (!open(anchorEl, body)) return;

  el.querySelectorAll(".pop-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const picked = btn.dataset.value;
      closePopover();
      onPick?.(picked);
    });
  });

  const list = items();
  const selected = Math.max(0, list.findIndex((n) => n.getAttribute("aria-selected") === "true"));
  setActive(list, selected);
}

/**
 * A single date or number field.
 *
 * Enter commits, Escape cancels, and a clearable field gets a Clear button that
 * commits `null` — which is how a due date or a manual surface date goes back to
 * "unset" without anyone having to know that an empty string means null.
 */
export function openEditor(anchorEl, { label, type = "date", value, clearable, min, step, hint, onCommit }) {
  const body = `
    <div class="pop-label">${esc(label)}</div>
    <div class="pop-form">
      <input id="pop-input" type="${esc(type)}" value="${esc(value ?? "")}"
             ${attrs({ min, step })}>
      ${hint ? `<div class="pop-hint">${esc(hint)}</div>` : ""}
      <div class="pop-actions">
        ${clearable ? `<button class="btn btn-ghost btn-sm" type="button" data-clear>Clear</button>` : ""}
        <span class="spacer"></span>
        <button class="btn btn-primary btn-sm" type="button" data-save>Save</button>
      </div>
    </div>`;

  const commit = (raw) => {
    closePopover();
    onCommit?.(raw);
  };

  if (!open(anchorEl, body, {
    onKey: (e) => {
      if (e.key !== "Enter") return false;
      e.preventDefault();
      commit(el.querySelector("#pop-input").value);
      return true;
    },
  })) return;

  el.querySelector("[data-save]").addEventListener("click", () =>
    commit(el.querySelector("#pop-input").value));
  el.querySelector("[data-clear]")?.addEventListener("click", () => commit(""));

  const input = el.querySelector("#pop-input");
  input.focus();
  input.select?.();
}
