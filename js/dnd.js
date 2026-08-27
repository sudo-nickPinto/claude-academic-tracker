/**
 * Pointer-driven row sorting for a table body. No DOM library, no dependency.
 *
 * Pointer events rather than HTML5 drag-and-drop: `dragstart`/`drop` do nothing at
 * all on a touchscreen, and a phone is where a task list actually gets reshuffled.
 * One set of handlers covers mouse, trackpad, pen and finger.
 *
 * The dragged row is moved in the DOM as the pointer crosses each neighbour's
 * midpoint, so what you see mid-drag is exactly what gets saved — there is no
 * separate "preview" position that could disagree with the result.
 *
 * The handle is a real <button> and responds to the arrow keys, because a
 * drag-only feature is a feature some people simply do not have.
 */

const MOVE_THRESHOLD = 4;   // px before a press becomes a drag
const SCROLL_EDGE = 80;     // px from the viewport edge where auto-scroll kicks in
const SCROLL_STEP = 14;

export function sortableRows(tbody, { handle = ".grip", onCommit, announce } = {}) {
  let drag = null;

  const rows = () => [...tbody.children];
  const ids = () => rows().map((tr) => tr.dataset.id);

  function start(e) {
    if (drag || e.button > 0) return; // right or middle click is not a drag
    const tr = e.target.closest("tr");
    if (!tr) return;
    e.preventDefault();
    drag = { tr, pointerId: e.pointerId, startY: e.clientY, before: ids(), moved: false };
    tbody.dataset.dragging = "true";
    // Listeners on the window, deliberately not on the handle: moving a row in the
    // DOM makes the browser drop any pointer capture the handle was holding, which
    // would silently end the drag after the very first swap.
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.abs(e.clientY - drag.startY) < MOVE_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.tr.dataset.dragging = "true";
    }
    e.preventDefault();

    if (e.clientY < SCROLL_EDGE) window.scrollBy(0, -SCROLL_STEP);
    else if (e.clientY > window.innerHeight - SCROLL_EDGE) window.scrollBy(0, SCROLL_STEP);

    const { tr } = drag;
    for (const other of rows()) {
      if (other === tr) continue;
      const box = other.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      // compareDocumentPosition reads "is tr positioned after other?"
      const trIsBelow = Boolean(other.compareDocumentPosition(tr) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (e.clientY < middle && trIsBelow) { tbody.insertBefore(tr, other); break; }
      if (e.clientY > middle && !trIsBelow) { tbody.insertBefore(tr, other.nextSibling); break; }
    }
  }

  function end(e) {
    if (!drag || (e?.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
    const { tr, before, moved } = drag;
    drag = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    delete tbody.dataset.dragging;
    delete tr.dataset.dragging;
    if (!moved) return;
    const after = ids();
    if (after.join(" ") !== before.join(" ")) onCommit?.(after, tr.dataset.id);
  }

  function key(e) {
    const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    const tr = e.target.closest("tr");
    if (!tr) return;
    const order = ids();
    const to = order.indexOf(tr.dataset.id) + step;
    if (to < 0 || to >= order.length) return; // already at the end; nothing to say
    e.preventDefault();
    const neighbour = tbody.children[to];
    tbody.insertBefore(tr, step < 0 ? neighbour : neighbour.nextSibling);
    announce?.(`Moved to position ${to + 1} of ${order.length}.`);
    onCommit?.(ids(), tr.dataset.id);
  }

  tbody.querySelectorAll(handle).forEach((grip) => {
    grip.addEventListener("pointerdown", start);
    grip.addEventListener("keydown", key);
    // A press that begins on a handle is never also a click on the row beneath it.
    grip.addEventListener("click", (e) => e.preventDefault());
  });
}
