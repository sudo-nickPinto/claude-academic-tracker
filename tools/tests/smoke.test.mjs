// End-to-end smoke suite. Run: node tools/tests/smoke.test.mjs
//
// Drives the real app in a real browser: every route renders, the task CRUD cycle
// round-trips through localStorage, the Active/Later split holds, an Outlook .ics
// import turns into committed time on the Dashboard, and nothing scrolls sideways.
//
// Needs a local server (python3 -m http.server 8347) and Playwright's chromium.
// BASE=, PLAYWRIGHT= and SHOT= override the defaults.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PW = process.env.PLAYWRIGHT
  || "/Users/nicholaspinto/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const { chromium } = await import(PW);

const BASE = process.env.BASE || "http://localhost:8347";
const SHOT = process.env.SHOT || fileURLToPath(new URL("./shots", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./outlook.ics", import.meta.url));
mkdirSync(SHOT, { recursive: true });

const ROUTES = [
  ["dashboard", "#/dashboard"],
  ["calendar", "#/calendar"],
  ["course-cs440", "#/course/CS440"],
  ["course-cs360", "#/course/CS360"],
  ["personal", "#/personal"],
  ["grades", "#/grades"],
  ["analytics", "#/analytics"],
  ["groups", "#/groups"],
  ["schedule-cs440", "#/schedule/CS440"],
  ["schedule-cs360", "#/schedule/CS360"],
  ["settings", "#/settings"],
];

const browser = await chromium.launch();
const errors = [];
let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${m.text()}`); });
  return page;
}

// ---------------------------------------------------------------- desktop pass
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await newPage(ctx);

for (const [name, hash] of ROUTES) {
  await page.goto(BASE + "/" + hash, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  const h1 = await page.locator("#outlet h1").first().textContent().catch(() => null);
  const rows = await page.locator("#outlet tbody tr").count();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`${name.padEnd(15)} renders`, Boolean(h1), `h1="${h1}" rows=${rows}`);
  check(`${name.padEnd(15)} no horizontal page scroll`, !overflow);
  await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true });
}

// ------------------------------------------------------------------ CRUD cycle

// Dates relative to the run, never baked in. A fixed due date quietly becomes
// overdue the day after it passes, so "due-soon styled" and "startBy = due - 2d"
// both start failing on a calendar date rather than on a code change — which is
// exactly what they did. These mirror compute.js: local date parts, not UTC.
const shiftDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtShort = (iso) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
};

// +2 days is inside rowState's 3-day "soon" window, and 180 min of work puts the
// start-by date two days earlier — i.e. today.
const SMOKE_DUE = shiftDays(2);
const SMOKE_START_BY = fmtShort(shiftDays(0));

await page.goto(BASE + "/#/course/CS391", { waitUntil: "networkidle" });
const before = await page.locator("#outlet tbody tr").count();

await page.click("#add-task");
await page.fill("#f-task", "Playwright smoke task");
await page.fill("#f-due", SMOKE_DUE);
await page.fill("#f-est", "180");
await page.selectOption("#f-priority", "High");
await page.click("#task-form button[type=submit]");
await page.waitForTimeout(200);
check("CRUD add", (await page.locator("#outlet tbody tr").count()) === before + 1);

const added = page.locator("tbody tr", { hasText: "Playwright smoke task" });
check("new row is due-soon styled", (await added.getAttribute("data-state")) === "soon",
  `state=${await added.getAttribute("data-state")} due=${SMOKE_DUE}`);
check("startBy = due - 2d for 180min",
  (await added.locator("td").nth(8).textContent()).trim() === SMOKE_START_BY,
  `${(await added.locator("td").nth(8).textContent()).trim()} (expected ${SMOKE_START_BY})`);

// persistence across reload
await page.reload({ waitUntil: "networkidle" });
check("survives reload", await page.locator("tbody tr", { hasText: "Playwright smoke task" }).count() === 1);

// complete -> leaves the default "open" filter, but is NOT deleted
await page.locator("tbody tr", { hasText: "Playwright smoke task" }).locator(".toggle").click();
await page.waitForTimeout(250);
check("completing removes it from the open filter",
  await page.locator("tbody tr", { hasText: "Playwright smoke task" }).count() === 0);
await page.click('[data-filter="all"]');
await page.waitForTimeout(250);
const doneRow = page.locator("tbody tr", { hasText: "Playwright smoke task" });
check("completed row stays visible", await doneRow.count() === 1);
check("completed row styled done", (await doneRow.getAttribute("data-state")) === "done");
check("Days Left blanks when done", (await doneRow.locator("td").nth(6).textContent()).trim() === "—");
check("completed date stamped", await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("academic-tracker/v1"));
  return Boolean(s.tasks.CS391.find(t => t.task === "Playwright smoke task")?.completed);
}));

// un-complete clears it
await doneRow.locator(".toggle").click();
await page.waitForTimeout(250);
check("un-completing clears completed date", await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("academic-tracker/v1"));
  return s.tasks.CS391.find(t => t.task === "Playwright smoke task")?.completed === null;
}));

// delete
await page.locator("tbody tr", { hasText: "Playwright smoke task" }).locator(".edit").click();
page.once("dialog", (d) => d.accept());
await page.click("#f-delete");
await page.waitForTimeout(250);
check("CRUD delete", await page.locator("tbody tr", { hasText: "Playwright smoke task" }).count() === 0);

// ------------------------------------------------------- personal toggle scope
await page.goto(BASE + "/#/dashboard", { waitUntil: "networkidle" });
const openStat = () => page.locator(".stat").first().locator(".stat-value").textContent();
const before7 = await page.locator(".card", { hasText: "Overdue & the next seven days" })
  .locator("tbody tr").count();
const openBefore = await openStat();
await page.check("#include-personal");
await page.waitForTimeout(300);
const after7 = await page.locator(".card", { hasText: "Overdue & the next seven days" })
  .locator("tbody tr").count();
check("personal toggle adds rows to the week list", after7 > before7, `${before7} -> ${after7}`);
check("personal toggle does NOT change Open stat", (await openStat()) === openBefore,
  `${openBefore} -> ${await openStat()}`);
check("Personal chip appears in week list",
  await page.locator(".card", { hasText: "Overdue & the next seven days" })
    .locator("tbody .chip", { hasText: "Personal" }).count() > 0);
await page.screenshot({ path: `${SHOT}/dashboard-with-personal.png`, fullPage: true });
await page.uncheck("#include-personal");

// ------------------------------------------------------------------- grades math
await page.goto(BASE + "/#/grades", { waitUntil: "networkidle" });
await page.locator('[data-add="CS440"]').click();
await page.waitForTimeout(150);
const block = page.locator('[data-course="CS440"]');
await block.locator('[data-f="item"]').first().fill("Midterm");
await block.locator('[data-f="weight"]').first().fill("30");
await block.locator('[data-f="weight"]').first().blur();
await page.waitForTimeout(200);
await page.locator('[data-course="CS440"] [data-f="score"]').first().fill("90");
await page.locator('[data-course="CS440"] [data-f="score"]').first().blur();
await page.waitForTimeout(250);
const kv = await page.locator('[data-course="CS440"] .kv').textContent();
check("current grade = 90%", kv.includes("90%"), kv.replace(/\s+/g, " ").trim());
check("weights-don't-total-100 warning shows",
  await page.locator('[data-course="CS440"] .banner').count() === 1);
await page.screenshot({ path: `${SHOT}/grades-filled.png`, fullPage: true });

// ------------------------------------------------------- active / later split
await page.goto(BASE + "/#/dashboard", { waitUntil: "networkidle" });
const statVal = async (label) => (await page.locator(".stat", { hasText: label }).first()
  .locator(".stat-value").textContent()).trim();
check("dashboard leads with Active", await statVal("Active tasks") === "14", await statVal("Active tasks"));
check("dashboard shows Later count", await statVal("Later") === "24", await statVal("Later"));
check("On the horizon card lists what's waiting",
  await page.locator("#horizon-card tbody tr").count() === 6);
check("horizon card names the next arrival",
  (await page.locator("#horizon-card .hint").textContent()).includes("24 tasks waiting"));

await page.goto(BASE + "/#/course/CS360", { waitUntil: "networkidle" });
const activeRows = await page.locator("#outlet tbody tr").count();
check("CS360 defaults to the active filter only", activeRows === 4, `${activeRows} rows`);
await page.click('[data-filter="later"]');
await page.waitForTimeout(200);
const laterRows = await page.locator("#outlet tbody tr").count();
check("CS360 Later filter holds the rest", laterRows === 14, `${laterRows} rows`);
check("every Later row is tagged with its surface date",
  await page.locator("#outlet tbody tr .tag-later").count() === laterRows);
await page.click('[data-filter="all"]');
await page.waitForTimeout(200);
check("active + later + done === all",
  await page.locator("#outlet tbody tr").count() === activeRows + laterRows);

// Surface now moves a task into the active list, and it stays there across a reload.
await page.click('[data-filter="later"]');
await page.waitForTimeout(200);
const firstLater = await page.locator("#outlet tbody tr").first().locator(".cell-main").textContent();
await page.locator("#outlet tbody tr").first().locator(".surface").click();
await page.waitForTimeout(250);
check("Surface removes it from Later",
  await page.locator("#outlet tbody tr").count() === laterRows - 1);
await page.click('[data-filter="active"]');
await page.waitForTimeout(200);
check("Surface adds it to Active",
  await page.locator("#outlet tbody tr").count() === activeRows + 1);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(250);
check("surfaced task survives a reload",
  await page.locator("tbody tr", { hasText: firstLater.trim() }).count() === 1);

// Marking a Later task In Progress surfaces it without any explicit override.
await page.click('[data-filter="later"]');
await page.waitForTimeout(200);
const laterBefore = await page.locator("#outlet tbody tr").count();
await page.locator("#outlet tbody tr").first().locator(".edit").click();
await page.waitForTimeout(200);
await page.selectOption("#task-dialog #f-status", "In Progress");
await page.click("#task-form button[type=submit]");
await page.waitForTimeout(250);
check("In Progress surfaces a Later task",
  await page.locator("#outlet tbody tr").count() === laterBefore - 1);

// The horizon setting re-splits the lists.
await page.goto(BASE + "/#/settings", { waitUntil: "networkidle" });
await page.selectOption("#horizon", "60");
await page.waitForTimeout(250);
await page.goto(BASE + "/#/dashboard", { waitUntil: "networkidle" });
const active60 = Number(await statVal("Active tasks"));
check("a 60-day horizon surfaces more than 21 did", active60 > 14, `active=${active60}`);
await page.goto(BASE + "/#/settings", { waitUntil: "networkidle" });
await page.selectOption("#horizon", "21");

// ------------------------------------------------------------- Outlook import
// The whole feature, end to end: a real file through the real file input, the month
// grid, the day panel, the Dashboard forecast, a repeat import, and removal.
await page.goto(BASE + "/#/dashboard", { waitUntil: "networkidle" });
const forecastBefore = (await page.locator(".card", { hasText: "Next 14 days" })
  .locator(".hint").first().textContent()).trim();
check("forecast says nothing about committed time before an import",
  !forecastBefore.includes("committed"), forecastBefore);

await page.goto(BASE + "/#/settings", { waitUntil: "networkidle" });
await page.setInputFiles("#ics-file", FIXTURE);
await page.waitForTimeout(500);
const msg = (await page.locator("#ics-msg").textContent()).trim();
check("import reports what it kept", /Imported\s+\d+\s+events/.test(msg), msg);
check("import reports what it skipped, and why",
  msg.includes("all-day") && msg.includes("outside the term"), msg);

const stored = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("academic-tracker/v1"));
  return { v: s.version, n: s.calendar.events.length, file: s.calendar.filename,
           stats: s.calendar.stats };
});
check("events land in the calendar slice, not in tasks", stored.n > 0, `${stored.n} events`);
check("state migrated to v4", stored.v === 4, `version=${stored.v}`);
check("every VEVENT in the file was accounted for",
  stored.stats.entries === 11 && stored.stats.unreadable === 0, JSON.stringify(stored.stats));
check("free events are a subset of the imported ones, not a separate skip",
  stored.stats.free <= stored.stats.imported, JSON.stringify(stored.stats));

// The fixture is a Fall 2026 export, so its classes land in the term window.
await page.goto(BASE + "/#/calendar", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
check("month grid renders a full month", await page.locator(".cal-cell[data-date]").count() >= 28);
const busyDays = await page.locator(".cal-busy").count();
check("committed time shows as density on the month grid", busyDays > 0, `${busyDays} days`);

// September has the recurring lecture in it; navigate there and open a class day.
await page.click("#next");
await page.waitForTimeout(250);
check("next month navigates", (await page.locator("#outlet h1").textContent()).includes("September"));
const classDay = page.locator(".cal-cell[data-date]").filter({ has: page.locator(".cal-busy") }).first();
const classDate = await classDay.getAttribute("data-date");
await classDay.click();
await page.waitForTimeout(250);
check("clicking a day opens its detail", (await page.locator("#day-detail h2").textContent()).length > 0);
check("the day panel lists the day's events",
  await page.locator("#day-detail .cal-list .cal-ev").count() > 0, classDate);
const budget = (await page.locator("#day-detail .cal-budget").textContent()).replace(/\s+/g, " ");
check("the day panel shows committed / free / due", budget.includes("Committed")
  && budget.includes("Free for work") && budget.includes("Due this day"), budget);
await page.screenshot({ path: `${SHOT}/calendar-imported.png`, fullPage: true });

await page.click("#today");
await page.waitForTimeout(250);
check("Today returns to the current month",
  (await page.locator(".cal-cell[data-today='true']").count()) === 1);

// The forecast is the point of the whole exercise.
await page.goto(BASE + "/#/dashboard", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
const forecastAfter = (await page.locator(".card", { hasText: "Next 14 days" })
  .locator(".hint").first().textContent()).trim();
check("the forecast now names committed hours", forecastAfter.includes("committed"), forecastAfter);
check("the chart legend explains the second colour",
  (await page.locator(".card", { hasText: "Next 14 days" }).locator(".legend").textContent())
    .includes("Committed"));
check("the day table gains Class and Free columns",
  (await page.locator(".card", { hasText: "Next 14 days" }).locator("thead").textContent())
    .includes("Free"));
await page.screenshot({ path: `${SHOT}/dashboard-committed.png`, fullPage: true });

// Importing the same file again must not double anything.
await page.goto(BASE + "/#/settings", { waitUntil: "networkidle" });
await page.setInputFiles("#ics-file", FIXTURE);
await page.waitForTimeout(500);
const reimported = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("academic-tracker/v1")).calendar.events.length);
check("re-importing the same file changes nothing", reimported === stored.n,
  `${stored.n} -> ${reimported}`);

// And removing it puts the forecast back exactly as it was.
page.once("dialog", (d) => d.accept());
await page.click("#ics-clear");
await page.waitForTimeout(400);
check("removing the calendar empties it", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("academic-tracker/v1")).calendar.events.length) === 0);
await page.goto(BASE + "/#/dashboard", { waitUntil: "networkidle" });
const forecastRestored = (await page.locator(".card", { hasText: "Next 14 days" })
  .locator(".hint").first().textContent()).trim();
check("the forecast returns to exactly what it said before", forecastRestored === forecastBefore,
  `${forecastBefore} -> ${forecastRestored}`);

// ----------------------------------------------------------- manual ordering
// The one property worth proving in a browser: a drag under a filter must not move
// anything the filter is hiding.
await page.goto(BASE + "/#/course/CS360", { waitUntil: "networkidle" });
const idsOf = () => page.$$eval("#outlet tbody tr", (rows) => rows.map((r) => r.dataset.id));

check("no grab handles in due-date order", await page.locator("#outlet .grip").count() === 0);
await page.selectOption("#f-sort", "manual");
await page.waitForTimeout(150);
check("switching to my order gives every row a handle",
  await page.locator("#outlet .grip").count() === await page.locator("#outlet tbody tr").count());

await page.click('[data-filter="all"]');
await page.waitForTimeout(150);
const allBefore = await idsOf();
await page.click('[data-filter="active"]');
await page.waitForTimeout(150);
const activeBefore = await idsOf();
check("the course has both visible and hidden rows to test with",
  activeBefore.length > 1 && allBefore.length > activeBefore.length,
  `${activeBefore.length} of ${allBefore.length}`);

// Drag the top row down past the last one.
const grip = page.locator("#outlet .grip").first();
const lastRow = page.locator("#outlet tbody tr").last();
const from = await grip.boundingBox();
const to = await lastRow.boundingBox();
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(from.x + from.width / 2, from.y + 24, { steps: 4 });
await page.mouse.move(from.x + from.width / 2, to.y + to.height - 4, { steps: 24 });
await page.mouse.up();
await page.waitForTimeout(250);

const activeAfter = await idsOf();
check("dragging the top row to the bottom puts it at the bottom",
  activeAfter.at(-1) === activeBefore[0], `${activeBefore[0]} -> ${activeAfter.at(-1)}`);
check("and leaves every other visible row in its relative order",
  activeAfter.slice(0, -1).join() === activeBefore.slice(1).join());

await page.click('[data-filter="all"]');
await page.waitForTimeout(150);
const allAfter = await idsOf();
const hidden = allBefore.filter((id) => !activeBefore.includes(id));
check("rows hidden by the filter keep their exact positions",
  hidden.every((id) => allBefore.indexOf(id) === allAfter.indexOf(id)),
  `${hidden.length} hidden rows`);
check("no row was lost or duplicated",
  allAfter.length === allBefore.length && new Set(allAfter).size === allAfter.length);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(250);
check("the sort mode survives a reload", await page.inputValue("#f-sort") === "manual");
await page.click('[data-filter="all"]'); // the filter itself is per-session, not saved
await page.waitForTimeout(150);
check("so does the order", (await idsOf()).join() === allAfter.join());

// Keyboard, because a drag-only feature is one some people simply can't use.
const kbBefore = await idsOf();
await page.locator("#outlet .grip").first().focus();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
const kbAfter = await idsOf();
check("arrow keys move a row one place",
  kbAfter[0] === kbBefore[1] && kbAfter[1] === kbBefore[0], kbAfter.slice(0, 2).join(" "));
check("focus follows the row it moved",
  await page.evaluate(() => document.activeElement?.closest("tr")?.dataset.id) === kbBefore[0]);
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(200);
check("and undo it", (await idsOf()).join() === kbBefore.join());

check("one course's order doesn't touch another", await page.evaluate(async () => {
  const raw = JSON.parse(localStorage.getItem("academic-tracker/v1"));
  return raw.prefs.courseSort.CS360 === "manual" && !raw.prefs.courseSort.CS440;
}));

await page.goto(BASE + "/#/course/CS360", { waitUntil: "networkidle" });
await page.selectOption("#f-sort", "due");
await page.waitForTimeout(150);
check("going back to due-date order still sorts by date", await page.evaluate(() => {
  const dates = [...document.querySelectorAll('#outlet tbody td[data-label="Due"]')]
    .map((td) => td.textContent.trim()).filter((t) => t && t !== "\u2014");
  return dates.every((d, i) => i === 0 || new Date(dates[i - 1]) <= new Date(d));
}));

// ------------------------------------------------------------- export/import
await page.goto(BASE + "/#/settings", { waitUntil: "networkidle" });
const dl = page.waitForEvent("download");
await page.click("#export");
const file = await dl;
check("export produces a .json download", (await file.suggestedFilename()).endsWith(".json"),
  await file.suggestedFilename());

// ------------------------------------------------------------------- dark mode
await page.selectOption("#theme", "dark");
await page.waitForTimeout(250);
check("dark theme applied", (await page.getAttribute("html", "data-theme")) === "dark");
await page.goto(BASE + "/#/dashboard", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOT}/dashboard-dark.png`, fullPage: true });
await page.goto(BASE + "/#/settings", { waitUntil: "networkidle" });
await page.selectOption("#theme", "system");

// --------------------------------------------------------------------- mobile
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const mpage = await newPage(mctx);
for (const [name, hash] of [["dashboard", "#/dashboard"], ["course-cs440", "#/course/CS440"]]) {
  await mpage.goto(BASE + "/" + hash, { waitUntil: "networkidle" });
  await mpage.waitForTimeout(250);
  const overflow = await mpage.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`mobile ${name.padEnd(13)} no horizontal page scroll`, !overflow);
  await mpage.screenshot({ path: `${SHOT}/mobile-${name}.png`, fullPage: true });
}
await mpage.click("[data-nav-open]");
await mpage.waitForTimeout(350);
check("mobile nav drawer opens",
  await mpage.evaluate(() => document.getElementById("app").dataset.nav === "open"));
await mpage.screenshot({ path: `${SHOT}/mobile-nav.png` });

// ----------------------------------------------------------------- quick edit
// Deliberately the last section. It creates rows and deletes them again, and every
// earlier assertion counts what is on screen — inserting this above them shifts
// the Active/Later/horizon totals the rest of the file hardcodes.
const QE_DUE = shiftDays(5);

const qeStored = (name) => page.evaluate((n) => {
  const s = JSON.parse(localStorage.getItem("academic-tracker/v1"));
  return s.tasks.CS391.find((t) => t.task === n) || null;
}, name);

const qeAdd = async (name) => {
  await page.click("#add-task");
  await page.fill("#f-task", name);
  await page.fill("#f-due", QE_DUE);
  await page.fill("#f-est", "60");
  await page.selectOption("#f-priority", "Medium");
  await page.selectOption("#task-dialog #f-status", "Not Started");
  await page.click("#task-form button[type=submit]");
  await page.waitForTimeout(200);
};

// Toasts are fixed to a corner and stack; clearing them between steps keeps a
// stale Undo button from being the one a later click lands on.
const qeClearToasts = async () => {
  await page.evaluate(() => document.querySelectorAll(".toast-close").forEach((b) => b.click()));
  await page.waitForTimeout(150);
};

await page.goto(BASE + "/#/course/CS391", { waitUntil: "networkidle" });
await page.click('[data-filter="active"]');
await page.waitForTimeout(200);
await qeAdd("QE smoke task");

const qeRow = page.locator("tbody tr", { hasText: "QE smoke task" });
// Every editable cell has a folded twin inside the main cell for narrow layouts,
// so a bare [data-qe] matches twice. Only one of the pair is ever displayed.
const qeCell = (field) => qeRow.locator(`[data-qe="${field}"]:visible`);
const qeText = async (field) => (await qeCell(field).textContent()).trim();

// --- the popover opens focused on the current value, and Escape changes nothing
await qeCell("priority").click();
await page.waitForTimeout(200);
check("quick-edit popover opens", (await page.locator("#pop .pop-item").count()) > 0);
const qeFocused = await page.evaluate(() => document.activeElement?.dataset?.value);
check("the current value is the focused option", qeFocused === "Medium", `focused=${qeFocused}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Escape closes the popover", (await page.locator("#pop .pop-item").count()) === 0);
check("Escape leaves the value alone", (await qeStored("QE smoke task")).priority === "Medium");

// --- picking a value writes it through and repaints the cell in place
await qeCell("priority").click();
await page.waitForTimeout(200);
await page.click('#pop .pop-item[data-value="High"]');
await page.waitForTimeout(250);
check("picking a value writes it to the store",
  (await qeStored("QE smoke task")).priority === "High");
check("the cell repaints without a re-render", (await qeText("priority")) === "High");

// --- and the toast undoes exactly that one edit
check("an edit raises an undo toast", (await page.locator(".toast-action").count()) === 1);
await page.click(".toast-action");
await page.waitForTimeout(300);
check("undo restores the previous value",
  (await qeStored("QE smoke task")).priority === "Medium");
check("undo repaints the cell too", (await qeText("priority")) === "Medium");
await qeClearToasts();

// --- an edit survives a reload
await qeCell("priority").click();
await page.waitForTimeout(200);
await page.click('#pop .pop-item[data-value="High"]');
await page.waitForTimeout(250);
await qeClearToasts();
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(300);
check("the inline edit survives a reload", (await qeText("priority")) === "High");

// --- a date edit repaints the derived cells beside it
await qeCell("due").click();
await page.waitForTimeout(200);
await page.fill("#pop-input", shiftDays(3));
await page.click("#pop [data-save]");
await page.waitForTimeout(300);
check("an inline due date is stored", (await qeStored("QE smoke task")).due === shiftDays(3));
check("days-left repaints from the new date",
  (await qeRow.locator('[data-derived="days"]:visible').textContent()).trim() === "3d",
  (await qeRow.locator('[data-derived="days"]:visible').textContent()).trim());
await qeClearToasts();

// --- status carries the completed date with it, both ways
await qeCell("status").click();
await page.waitForTimeout(200);
await page.click('#pop .pop-item[data-value="Done"]');
await page.waitForTimeout(300);
check("an inline status edit stamps completed",
  Boolean((await qeStored("QE smoke task")).completed),
  String((await qeStored("QE smoke task")).completed));
check("the row that left the filter stays put",
  (await page.locator("tbody tr", { hasText: "QE smoke task" }).count()) === 1);
check("and says where it is going",
  (await qeRow.locator(".stale-cue").count()) === 1,
  await qeRow.getAttribute("data-stale"));
await qeClearToasts();

await qeCell("status").click();
await page.waitForTimeout(200);
await page.click('#pop .pop-item[data-value="In Progress"]');
await page.waitForTimeout(300);
check("leaving Done clears the completed date",
  (await qeStored("QE smoke task")).completed === null);
check("the stale cue clears with it", (await qeRow.locator(".stale-cue").count()) === 0);
await qeClearToasts();

// --- the dashboard edits the same row, and keeps it on screen when it drops out
await page.goto(BASE + "/#/dashboard", { waitUntil: "networkidle" });
await page.waitForTimeout(250);
const dashRow = page.locator("tbody tr", { hasText: "QE smoke task" });
check("the task reaches the dashboard week table", (await dashRow.count()) === 1);
await dashRow.locator('[data-qe="status"]:visible').click();
await page.waitForTimeout(200);
await page.click('#pop .pop-item[data-value="Done"]');
await page.waitForTimeout(300);
check("a dashboard edit writes through", (await qeStored("QE smoke task")).status === "Done");
check("the completed row stays on the dashboard", (await dashRow.count()) === 1);
check("marked as leaving the list", (await dashRow.locator(".stale-cue").count()) === 1,
  await dashRow.getAttribute("data-stale"));
await page.click(".toast-action");
await page.waitForTimeout(300);
check("undo works from the dashboard too",
  (await qeStored("QE smoke task")).status === "In Progress");
await qeClearToasts();

// --- bulk select: one write, one undo, however many rows
await page.goto(BASE + "/#/course/CS391", { waitUntil: "networkidle" });
await page.click('[data-filter="active"]');
await page.waitForTimeout(200);
await qeAdd("QE bulk one");
await qeAdd("QE bulk two");

await page.click("#select-mode");
await page.waitForTimeout(200);
await page.locator("tbody tr", { hasText: "QE bulk one" }).locator(".toggle").click();
await page.locator("tbody tr", { hasText: "QE bulk two" }).locator(".toggle").click();
await page.waitForTimeout(250);
check("the bulk bar counts the selection",
  (await page.locator("#bulkbar .bulk-count").textContent()).includes("2 selected"),
  await page.locator("#bulkbar .bulk-count").textContent());

await page.click('#bulkbar [data-act="done"]');
await page.waitForTimeout(350);
const bulkDone = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("academic-tracker/v1"));
  return s.tasks.CS391.filter((t) => t.task?.startsWith("QE bulk")).map((t) => t.status);
});
check("bulk mark-done writes every selected row",
  bulkDone.length === 2 && bulkDone.every((s) => s === "Done"), bulkDone.join(", "));

await page.click(".toast-action");
await page.waitForTimeout(350);
const bulkUndone = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("academic-tracker/v1"));
  return s.tasks.CS391.filter((t) => t.task?.startsWith("QE bulk")).map((t) => t.status);
});
check("one undo reverts the whole batch",
  bulkUndone.length === 2 && bulkUndone.every((s) => s === "Not Started"), bulkUndone.join(", "));
await page.click("#select-mode");
await qeClearToasts();

// --- put CS391 back the way it was found
for (const name of ["QE smoke task", "QE bulk one", "QE bulk two"]) {
  await page.click('[data-filter="all"]');
  await page.waitForTimeout(200);
  await page.locator("tbody tr", { hasText: name }).locator(".edit").click();
  page.once("dialog", (d) => d.accept());
  await page.click("#f-delete");
  await page.waitForTimeout(250);
}
check("quick-edit fixtures cleaned up", (await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("academic-tracker/v1"));
  return s.tasks.CS391.filter((t) => t.task?.startsWith("QE ")).length;
})) === 0);


await browser.close();

console.log("\n--- console/page errors ---");
console.log(errors.length ? errors.join("\n") : "none");
if (errors.length) fails += errors.length;
console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll browser checks passed.");
process.exit(fails ? 1 : 0);
