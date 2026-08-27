/**
 * Toasts — the app's only feedback channel for a write that happened somewhere
 * other than where you are looking, and the only place Undo lives.
 *
 * One live region, `#toasts`, present from load (see index.html — a live region
 * inserted at announce time is routinely missed by screen readers). Everything
 * else — the stack, the auto-dismiss timers, the exit animation — is owned here.
 */

import { esc } from "../ui.js";

const MAX_VISIBLE = 3;

// toastOut runs for --dur-2 (0.18s). Comfortably longer than that but still
// unnoticeable, this is the fallback that removes the node when animationend
// never fires — prefers-reduced-motion forces animations to a near-zero
// duration, and that boundary isn't reliable enough across browsers to trust
// animationend alone.
const REMOVE_FALLBACK_MS = 300;

const host = () => document.getElementById("toasts");

/** Toasts currently in the stack, oldest first. */
const stack = [];

function arm(entry, ms) {
  entry.deadline = Date.now() + ms;
  entry.timer = setTimeout(() => remove(entry), ms);
}

function pause(entry) {
  if (entry.timer === null) return;
  clearTimeout(entry.timer);
  entry.timer = null;
  entry.remaining = Math.max(0, entry.deadline - Date.now());
}

function resume(entry) {
  if (entry.removed || entry.timer !== null || !entry.remaining) return;
  arm(entry, entry.remaining);
}

/**
 * Detach a toast. Played through the exit animation unless `immediate` — used
 * when the 4th toast in evicts the oldest, where two toasts occupying the slot
 * at once for even one frame is exactly what "cap at 3 visible" rules out.
 *
 * Guarded against running twice: the stack-eviction path and a user click can
 * race (click the close button on the toast about to be evicted anyway), and
 * `el.remove()` on an already-detached node is a silent no-op either way.
 */
function remove(entry, { immediate = false } = {}) {
  if (entry.removed) return;
  entry.removed = true;
  clearTimeout(entry.timer);
  entry.timer = null;

  const i = stack.indexOf(entry);
  if (i !== -1) stack.splice(i, 1);

  const { el } = entry;
  if (immediate || !el.isConnected) {
    el.remove();
    return;
  }

  el.dataset.leaving = "true";
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
  };
  el.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, REMOVE_FALLBACK_MS);
}

export function toast(message, { actionLabel, onAction, tone = "info", timeout = 6000 } = {}) {
  const root = host();
  if (!root) return { dismiss() {} };

  while (stack.length >= MAX_VISIBLE) remove(stack[0], { immediate: true });

  const el = document.createElement("div");
  el.className = "toast";
  el.dataset.tone = tone;
  el.innerHTML = `
    <div class="toast-msg">${esc(message)}</div>
    ${actionLabel ? `<button type="button" class="toast-action">${esc(actionLabel)}</button>` : ""}
    <button type="button" class="toast-close" aria-label="Dismiss">×</button>
  `;
  root.appendChild(el);

  const entry = { el, timer: null, deadline: null, remaining: timeout, removed: false };
  stack.push(entry);
  const dismiss = () => remove(entry);

  el.querySelector(".toast-action")?.addEventListener("click", () => {
    onAction?.();
    dismiss();
  });
  el.querySelector(".toast-close").addEventListener("click", dismiss);

  // An Undo button that vanishes mid-reach is the whole failure mode toasts
  // exist to prevent, so the clock stops the moment the pointer or focus is on it.
  el.addEventListener("pointerenter", () => pause(entry));
  el.addEventListener("pointerleave", () => resume(entry));
  el.addEventListener("focusin", () => pause(entry));
  el.addEventListener("focusout", () => resume(entry));

  if (timeout) arm(entry, timeout);

  return { dismiss };
}

export function toastUndo(message, onUndo) {
  return toast(message, { actionLabel: "Undo", onAction: onUndo, tone: "success" });
}

export function dismissAll() {
  for (const entry of [...stack]) remove(entry);
}
