/**
 * The one exception to store.js's "everything is local" model: a small shared
 * inbox, so a task added from outside this browser (by Claude, on your behalf)
 * still shows up here.
 *
 * The inbox lives in a GitHub Gist as one JSON file, `{ items: [...] }`. Writing
 * to it needs a token and happens elsewhere — never in this code, never shipped
 * to the browser. Reading a gist is public once you know its id, no token
 * needed, so this module only ever does an unauthenticated GET.
 *
 * Sync is one-way and additive. On every load, any inbox item whose id isn't in
 * `inboxSeen` yet is created through the normal createTask() path — same
 * defaults, same undo entry a manual add would get — and its id is remembered
 * so it is never created twice. Nothing already in your data is read, patched,
 * or removed. If the fetch fails (offline, gist deleted, GitHub down) this
 * quietly does nothing; the rest of the app never depends on it.
 */

import { load, update } from "./store.js";
import { createTask } from "./tasks.js";
import { courseIds } from "./config.js";

const GIST_ID = "c31b57268fdce85e31db71ff7281d361";

const TASK_FIELDS = ["task", "details", "type", "priority", "status", "due", "estMin", "source", "notes"];

function pickFields(item) {
  const out = {};
  for (const key of TASK_FIELDS) if (item[key] !== undefined) out[key] = item[key];
  return out;
}

export async function syncInbox() {
  let items;
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { cache: "no-store" });
    if (!res.ok) return 0;
    const gist = await res.json();
    const content = gist.files?.["inbox.json"]?.content;
    items = content ? JSON.parse(content).items : [];
  } catch {
    return 0; // offline or unreachable — local data is unaffected either way
  }
  if (!Array.isArray(items) || items.length === 0) return 0;

  const seen = new Set(load().inboxSeen || []);
  const fresh = items.filter((it) => it && typeof it.id === "string" && !seen.has(it.id));
  if (fresh.length === 0) return 0;

  let added = 0;
  for (const item of fresh) {
    const listKey = courseIds.includes(item.course) ? item.course : null;
    if (listKey && item.task) {
      createTask(listKey, pickFields(item));
      added += 1;
    }
    // Mark seen even when skipped (bad/unknown course, missing name) so a
    // malformed inbox entry doesn't get retried forever.
    seen.add(item.id);
  }

  update((draft) => { draft.inboxSeen = [...seen]; });
  return added;
}
