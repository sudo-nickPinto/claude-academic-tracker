# Semester Tracker

A static web app that replaces `Course_Tracker.xlsx` — four course task lists, a personal list, a
dashboard, analytics, a grade calculator, and read-only reference tabs for the CS440 groups and the
CS440 / CS360 class schedules.

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
**Active now**; switch it to **Later** to see what's waiting.

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

### Two computed columns

```
Days Left = due − today          (blank once the task is Done; negative means overdue)
Start By  = due − max(1, ⌈est. minutes ÷ 90⌉) days
```

`Start By` assumes about 90 focused minutes a day. A three-hour assignment therefore wants two days,
not one evening. When today reaches a task's Start By date and it hasn't been started, it shows up
in *should already be started* on the dashboard.

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
js/seed.js               GENERATED — tasks and grade shells
js/reference.js          GENERATED — groups roster and both schedules
js/views/*.js            one module per view
tools/parse_workbook.py  the migration script
```

Routing is hash-based (`#/dashboard`, `#/course/CS440`), which needs no server rewrite rules and no
404 shim on Pages.
