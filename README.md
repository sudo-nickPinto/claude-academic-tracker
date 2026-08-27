# Semester Tracker

A static web app that replaces `Course_Tracker.xlsx` — four course task lists, a personal list, a
dashboard, a calendar that reads your Outlook export, analytics, a grade calculator, and read-only
reference tabs for the CS440 groups and the CS440 / CS360 class schedules.

No backend, no accounts, no build step. Plain HTML, CSS, and ES modules. Everything you type lives
in your browser's `localStorage`; JSON export/import is the backup and the way to move to another
device.

## Run it locally

ES modules are blocked over `file://`, so open it through a server rather than double-clicking
`index.html`:

```bash
cd claude-academic-tracker
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

Pushing to `main` publishes automatically: `.github/workflows/deploy.yml` uploads the repo root as
the Pages artifact and deploys it. One-time setup in the GitHub repo — **Settings → Pages → Build
and deployment → Source: GitHub Actions**.

`.nojekyll` is committed so Pages serves the files as-is instead of running them through Jekyll.

## Where your data lives

| | |
| --- | --- |
| Storage | `localStorage`, key `academic-tracker/v1` |
| Scope | One browser on one device. Nothing is uploaded anywhere. |
| Backup | **Settings → Export JSON**. Import restores a file into any browser. |
| Reset | **Settings → Reset to seed data** wipes local edits and reloads the original workbook contents. |

Clearing site data for the Pages domain erases your tasks. Export occasionally.

Every read and write goes through `js/store.js` (`load` / `save` / `update` / `subscribe`). No view
touches `localStorage` directly, so swapping in a real backend later means rewriting that one file.

## How to use it

**Dashboard** is the morning view. *Overdue & the next seven days* is the list to act on; everything
else is context. Personal tasks are excluded from every statistic and chart, and appear in that one
list only when you flip the "include personal" toggle.

**Course tabs** (CS440, CS391, CS360, ENG216) are the full task lists — add, edit, complete, delete.
The checkbox in the first column is the fast path for "I finished this." The filter defaults to
**Active now**; switch it to **Later** to see what's waiting, and the **Order** control next to it
switches between due-date order and one you drag yourself.

### Active vs Later

A December project isn't something you can act on in August, and counting it as "open" all semester
is how a task list becomes wallpaper. So every task has a date it *surfaces* on:

```
surfaces on = earlier of ( due − 21 days ,  Start By )
```

Before that day it sits in **Later** — fully editable, still counted in Analytics and in your
completion percentage, just not in today's list. Add notes, refine the estimate, log what you've
read; it stays quiet. Four things pull a task out of Later early:

- its surface date arrives (automatic, no action needed);
- you set its status to **In Progress** or **Waiting / Blocked** — work has actually started;
- you hit **Surface** on the row, or **Surface now** in the edit dialog;
- it goes overdue, which always surfaces, no exceptions.

You can also **push a task back** to a date you choose from the Timing box in the edit dialog, and
clear that date to return it to automatic. **Settings → Active vs Later** changes the 21 days.

Nothing disappears: the Dashboard's **On the horizon** card always shows what's waiting and the
exact day each item arrives.

**Personal** is deliberately thin: task, notes, due date, priority, status. It never feeds the
dashboard or analytics.

**Grades** needs ten minutes with each syllabus — type the graded items and their weights once, then
fill in scores as they come back and "what do I need on everything left" stays answered all
semester.

**Groups** and the two **Schedule** tabs are read-only reference, copied from the syllabi.

### Calendar and committed time

**Settings → Outlook calendar** takes an `.ics` file exported from Outlook. Imported events stay
events — nothing becomes a task. What they add is **committed time**: hours already spoken for, so
the forecast can say "6h of work due, 5h of that day is class, 1h free" instead of just "6h due."

Exporting from Outlook:

- **Outlook on the web** — Calendar → *Settings ⚙ → Calendar → Shared calendars* → under *Publish a
  calendar* pick your calendar, choose *Can view all details*, publish, then open the `.ics` link
  and save the file.
- **Outlook for Windows** — *File → Save Calendar*, set *More Options* to the whole term and
  *Full details*, save as iCalendar.
- **Outlook for Mac** — *File → Export → Export Calendar*.

The app can't subscribe to a published calendar URL directly. Those endpoints send no
`Access-Control-Allow-Origin` header, so a browser refuses to let a page on another domain fetch
them, and the only workarounds are a proxy server or a Microsoft app registration — a backend and an
account, both of which this app deliberately doesn't have. A saved file keeps everything local.

What the import does and doesn't keep:

| | |
| --- | --- |
| Recurring events | Expanded — one weekly class becomes each of its meetings. `EXDATE` (fall break) and single moved meetings are honored. |
| Outside the term | Skipped. The term window is `2026-08-24 → 2026-12-07`. |
| All-day events | Skipped. A birthday isn't five hours of committed time. |
| Cancelled | Skipped. |
| Shown as *Free* | Kept and listed, but costs no committed time. |
| Time zones | A `Z`-suffixed UTC time is converted; anything else is read as local wall-clock time. |

The import screen reports exactly what it kept and what it skipped, by category. Re-importing the
same file changes nothing, and **Remove calendar** puts every number back where it was.

**Calendar** (the tab) is a month grid: a dot per deadline, a density bar for how much of the day is
already committed. Click a day for its events, its deadlines, and what's left of it.

### Ordering a course tab

Every course tab has an **Order** control next to the filter:

- **By due date** (the default) — soonest first, undated work last, ties broken by the row order the
  workbook had.
- **Mine** — whatever you dragged it into. Each row grows a `⠿` handle: drag it, or give it keyboard
  focus and press <kbd>↑</kbd>/<kbd>↓</kbd>. The setting is per course and is saved, so CS360 can be
  hand-ordered while CS440 stays on dates.

Dragging is implemented with pointer events (`js/dnd.js`), not HTML5 drag-and-drop, because
`dragstart`/`drop` do nothing on a touchscreen — one code path covers mouse, trackpad, pen and
finger, and the arrow keys cover everyone a drag doesn't.

**Reordering while filtered is safe.** Only the rows on screen move, and they only move among the
positions they already occupied between them — a task hidden by the *Active now* filter keeps its
exact place in the list. The whole course is then renumbered `0..n-1`, so the order stays stable
however many times you rearrange it. `reorderCourse()` in `js/compute.js` is that rule, and both
test suites assert it: as a property in `compute.test.mjs`, and end-to-end with a real mouse drag in
`smoke.test.mjs`.

The position is stored as a new `order` field per task, seeded from `seq` — the workbook's own row
number — so the first time you switch to **Mine** the list you see is the one you already had. `seq`
itself is never rewritten: it records which spreadsheet row a task came from, and reordering the
screen shouldn't forge that.

### Two computed columns

```
Days Left = due − today          (blank once the task is Done; negative means overdue)
Start By  = due − max(1, ⌈est. minutes ÷ 90⌉) days
```

`Start By` assumes about 90 focused minutes a day. A three-hour assignment therefore wants two days,
not one evening. When today reaches a task's Start By date and it hasn't been started, it shows up
in *should already be started* on the dashboard.

That formula is the workbook's, and it stays the workbook's — `tools/tests/compute.test.mjs` and the
migration check assert it against Excel's own cached values. Once a calendar is loaded, a second
*advisory* date appears under Start By when the two disagree: the same backward walk, but skipping
over days already full of class. It never moves the date later, and never suggests one in the past.

### Making everything fit

Tables fold rather than scroll. As a table's own container narrows, the lowest-value columns drop out
in a fixed order — Start By and Est. first, then Type, then Priority — and their values reappear as
sub-lines under the task name, so nothing is ever lost, only moved. Below about 620px of table width
each row becomes a card with its column headings inline.

The folding is driven by CSS container queries on each `.table-wrap`, not by the viewport: the
dashboard's week list lives in a narrow column while a course table gets the whole page, so on the
same screen they need to fold at different points.

A hand-ordered course tab carries an extra column for the drag handles, so it folds about 40px
earlier at every tier, and below 700px it also tightens its cell padding — which buys back more than
the handle column costs, and keeps the table a table down to exactly the width it managed before.

### What the colors mean

- **Red** — overdue.
- **Amber** — due within three days.
- **Grey / struck through** — done. Completed tasks are never deleted or hidden, so the completion
  percentage stays honest.

Course colors (CS440 blue, CS391 green, CS360 amber-brown, ENG216 wine) only ever identify a course.
Urgency and status are always carried by the pills, never by the course accent.

## Regenerating the seed data

`js/seed.js` and `js/reference.js` are generated, not hand-written:

```bash
python3 tools/parse_workbook.py /path/to/Course_Tracker.xlsx
```

The script is standard-library only — no `pip install` — and reads the `.xlsx` directly as an OOXML
zip. It skips the `Days Left` and `Start By` columns on purpose: those are formulas in the workbook
and are recomputed at runtime here. IDs are derived deterministically, so re-running on an unchanged
workbook produces an unchanged file.

**Note:** the committed CS440 group roster reduces classmates to initials. Full names never enter
git history; type them into the running app if you want them, where they stay in your browser.

## Known caveats from the source workbook

- **CS360 schedule dates.** The syllabus says there is no class on the *Tuesday* of Fall Break and
  the *Thursday* of Thanksgiving, but every date listed in that table is a Monday. The app shows the
  dates as written with a visible caveat rather than guessing which one is wrong — check against the
  syllabus before relying on it.
- **CS440 groups.** The sheet's own note says the highlighted groups are 1 and 5, but "Nick" also
  appears in the Group 12 roster. The app marks all three as yours, derived from the roster itself,
  and says so on the page.
- **Grades were empty.** No course had any graded items entered, so the calculator ships with the
  structure and the math but no data.

## Tests

All four run against the working tree; the last two need a local server on port 8347 and
Playwright's chromium.

```bash
python3 -m http.server 8347 &          # for the two browser suites

node tools/tests/compute.test.mjs      # pure logic: dates, Start By, Active/Later, grades, committed time
node tools/tests/ical.test.mjs         # the .ics reader, against a synthetic Outlook export
node tools/tests/layout.test.mjs       # zero horizontal overflow, 17 passes x 9 widths
node tools/tests/smoke.test.mjs        # the real app in a real browser, including a calendar import
```

`layout.test.mjs` is the gate that keeps the tables honest: it fails if the page — or any table
inside its card — is even one pixel wider than the box holding it, at any width from 360px up.

## Layout

```
index.html               shell + help panel
css/tokens.css           color, type, spacing tokens (light + dark)
css/base.css             reset, typography, app layout
css/components.css       cards, tables, pills, charts, dialogs
js/store.js              persistence seam — the only module that knows about localStorage
js/config.js             dropdown vocabularies, course colors, constants
js/compute.js            all derived logic; pure functions over plain state
js/charts.js             hand-rolled SVG bar and donut charts
js/dnd.js                pointer-driven row reordering — works with a finger, and with arrow keys
js/ical.js               RFC 5545 reader — unfolding, RRULE/EXDATE expansion, no DOM
js/seed.js               GENERATED — tasks and grade shells
js/reference.js          GENERATED — groups roster and both schedules
js/views/*.js            one module per view
tools/parse_workbook.py  the migration script
tools/tests/             the four test suites and the .ics fixture
```

Routing is hash-based (`#/dashboard`, `#/course/CS440`), which needs no server rewrite rules and no
404 shim on Pages.
