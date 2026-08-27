// Unit tests for the task write path. Run: node tools/tests/tasks.test.mjs
//
// Only the pure half is exercised here — `coerceField`, `taskPatch` and
// `editableFields`. The store-touching half (`patchTask`, `patchMany`, `createTask`)
// needs localStorage and is covered in tools/tests/smoke.test.mjs instead.
//
// This file exists because the two rules it checks used to live in two places each.
// The status/completed coupling was written once in the dialog and once in the row
// checkbox, and had already drifted in shape between them; the estMin coercion was
// an unguarded `Number()` that turned a non-numeric estimate into NaN, which
// `JSON.stringify` then writes out as null — silent data loss on the next save.

import { coerceField, taskPatch, editableFields, FIELD_SPEC } from "../../js/tasks.js";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
};

const REF = "2026-08-27";

// --- coerceField: strings ---
eq("task is trimmed", coerceField("task", "  Read chapter 4  "), "Read chapter 4");
eq("a missing string becomes empty, not undefined", coerceField("notes", undefined), "");
eq("null notes become empty", coerceField("notes", null), "");

// --- coerceField: dates ---
eq("a date passes through", coerceField("due", "2026-09-07"), "2026-09-07");
eq("an empty date is null, not ''", coerceField("due", ""), null);
eq("a cleared activeFrom is null", coerceField("activeFrom", null), null);

// --- coerceField: estMin, the NaN guard ---
eq("a numeric string becomes a number", coerceField("estMin", "90"), 90);
eq("a number stays a number", coerceField("estMin", 45), 45);
eq("an empty estimate is null", coerceField("estMin", ""), null);
eq("free text does NOT become NaN", coerceField("estMin", "about an hour"), null);
eq("a negative estimate is refused", coerceField("estMin", -30), null);
eq("a fractional estimate is rounded", coerceField("estMin", 42.6), 43);
eq("zero is a legitimate estimate", coerceField("estMin", 0), 0);

// --- coerceField: enums fall back rather than storing junk ---
eq("a known priority survives", coerceField("priority", "High"), "High");
eq("an unknown priority resets", coerceField("priority", "Urgent"), "Medium");
eq("an unknown status resets", coerceField("status", "Nearly"), "Not Started");
eq("an unknown type resets", coerceField("type", "Vibes"), "Other");

// --- editableFields: Personal is seven fields wide and stays that way ---
const personalKeys = editableFields("Personal").map(([k]) => k);
const courseKeys = editableFields("CS440").map(([k]) => k);
eq("Personal cannot edit an estimate", personalKeys.includes("estMin"), false);
eq("Personal cannot edit a type", personalKeys.includes("type"), false);
eq("Personal cannot edit a surface date", personalKeys.includes("activeFrom"), false);
eq("Personal can still edit priority/status/due",
  ["priority", "status", "due"].every((k) => personalKeys.includes(k)), true);
eq("a course can edit every field", courseKeys.length, Object.keys(FIELD_SPEC).length);

// --- taskPatch: the status <-> completed coupling, in both directions ---
const open = { status: "In Progress", completed: null };
eq("entering Done stamps the completion date",
  taskPatch(open, { status: "Done" }, "CS440", REF), { status: "Done", completed: REF });

const doneEarlier = { status: "Done", completed: "2026-08-01" };
eq("re-saving Done keeps the original date",
  taskPatch(doneEarlier, { status: "Done" }, "CS440", REF), { status: "Done", completed: "2026-08-01" });

eq("leaving Done clears the date",
  taskPatch(doneEarlier, { status: "Not Started" }, "CS440", REF), { status: "Not Started", completed: null });

eq("a patch that doesn't touch status doesn't touch completed",
  taskPatch(doneEarlier, { priority: "High" }, "CS440", REF), { priority: "High" });

// --- taskPatch: the list decides what may be written ---
eq("a course task keeps its estimate",
  taskPatch({}, { estMin: "90" }, "CS440", REF), { estMin: 90 });
eq("the same write on Personal is dropped",
  taskPatch({}, { estMin: "90" }, "Personal", REF), {});
eq("Personal still takes a due date",
  taskPatch({}, { due: "2026-09-07" }, "Personal", REF), { due: "2026-09-07" });

// --- taskPatch: derived fields are never writable directly ---
eq("completed cannot be set by hand",
  taskPatch({ status: "Done", completed: null }, { completed: "2020-01-01" }, "CS440", REF), {});
eq("an unknown field is ignored",
  taskPatch({}, { colour: "red" }, "CS440", REF), {});

// --- taskPatch: coercion applies on the way in ---
eq("a bad estimate is nulled, not stored as NaN",
  taskPatch({}, { estMin: "soon" }, "CS440", REF), { estMin: null });
eq("an out-of-range status resets rather than corrupting the pill",
  taskPatch({ status: "Done", completed: "2026-08-01" }, { status: "Almost" }, "CS440", REF),
  { status: "Not Started", completed: null });

console.log(fails ? `\n${fails} FAILED` : "\nAll task-path checks passed.");
process.exit(fails ? 1 : 0);
