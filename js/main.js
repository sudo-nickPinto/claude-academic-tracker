import { courseIds, courses, scheduleCourses } from "./config.js";
import { load, subscribe } from "./store.js";
import { courseTasks, isDone, isNamed } from "./compute.js";
import { esc, openDialog } from "./ui.js";
import { openPalette, closePalette, isPaletteOpen } from "./ui/palette.js";

import { renderDashboard } from "./views/dashboard.js";
import { renderCalendar } from "./views/calendar.js";
import { renderCourse } from "./views/course.js";
import { renderPersonal } from "./views/personal.js";
import { renderGrades } from "./views/grades.js";
import { renderAnalytics } from "./views/analytics.js";
import { renderGroups } from "./views/groups.js";
import { renderSchedule } from "./views/schedule.js";
import { renderSettings } from "./views/settings.js";

const outlet = document.getElementById("outlet");
const app = document.getElementById("app");

const routes = {
  dashboard: () => renderDashboard(outlet),
  calendar: () => renderCalendar(outlet),
  personal: () => renderPersonal(outlet),
  grades: () => renderGrades(outlet),
  analytics: () => renderAnalytics(outlet),
  groups: () => renderGroups(outlet),
  settings: () => renderSettings(outlet),
  course: (id) => (courses[id] ? renderCourse(outlet, id) : notFound()),
  schedule: (id) => (scheduleCourses.includes(id) ? renderSchedule(outlet, id) : notFound()),
};

function notFound() {
  outlet.innerHTML = `<div class="card card-pad"><h2>Nothing here</h2>
    <p class="muted">That link doesn't match a view. <a href="#/dashboard">Back to the dashboard</a>.</p></div>`;
}

function currentRoute() {
  const [name, param] = (location.hash.replace(/^#\/?/, "") || "dashboard").split("/");
  return { name, param };
}

function render() {
  const { name, param } = currentRoute();
  const view = routes[name];
  outlet.scrollIntoView({ block: "start", behavior: "instant" });
  if (view) view(param);
  else notFound();
  paintNav();
  setNav(false);
}

// ------------------------------------------------------------------- theme

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

/**
 * Resolve the theme preference to a concrete `data-theme` attribute.
 *
 * "system" used to mean *removing* the attribute and letting a
 * `prefers-color-scheme` block in the stylesheet take over. That worked, but it
 * forced the dark palette to be written twice — once in the media query and once
 * under `[data-theme="dark"]` — because CSS can't share a declaration block
 * between them. Resolving here instead means the attribute is always explicit
 * and the palette exists in exactly one place. The same resolution runs inline in
 * <head> so the first paint is already correct.
 */
function applyTheme() {
  const { theme } = load().prefs;
  const resolved = theme === "system" ? (darkQuery.matches ? "dark" : "light") : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

// Following the OS live is the whole point of "system" — without this listener it
// would only mean "whatever the OS said when the page loaded".
darkQuery.addEventListener("change", () => {
  if (load().prefs.theme === "system") applyTheme();
});

// --------------------------------------------------------------------- nav

const NAV_MAIN = [
  { href: "#/dashboard", label: "Dashboard", route: "dashboard" },
  { href: "#/calendar", label: "Calendar", route: "calendar" },
  { href: "#/analytics", label: "Analytics", route: "analytics" },
  { href: "#/grades", label: "Grades", route: "grades" },
];

const NAV_REFERENCE = [
  { href: "#/groups", label: "CS440 Groups", route: "groups", accent: "var(--c-CS440)" },
  { href: "#/schedule/CS440", label: "CS440 Schedule", route: "schedule", param: "CS440", accent: "var(--c-CS440)" },
  { href: "#/schedule/CS360", label: "CS360 Schedule", route: "schedule", param: "CS360", accent: "var(--c-CS360)" },
  { href: "#/settings", label: "Settings", route: "settings" },
];

function link({ href, label, route, param, accent, count }, active) {
  const isCurrent = active.name === route && (param === undefined || active.param === param);
  return `<a class="nav-link" href="${href}" ${isCurrent ? 'aria-current="page"' : ""}
            style="--accent:${accent || "var(--text-faint)"}">
      <span class="nav-dot"></span>${esc(label)}
      ${count ? `<span class="nav-count">${count}</span>` : ""}
    </a>`;
}

function paintNav() {
  const active = currentRoute();
  const state = load();

  const openCount = (id) => state.tasks[id].filter((t) => isNamed(t) && !isDone(t)).length;
  const totalOpen = courseTasks(state).filter((t) => !isDone(t)).length;

  document.getElementById("nav-main").innerHTML =
    `<div class="nav-label">Overview</div>` +
    NAV_MAIN.map((item) =>
      link({ ...item, count: item.route === "dashboard" ? totalOpen : 0 }, active)).join("");

  document.getElementById("nav-courses").innerHTML =
    `<div class="nav-label">Courses</div>` +
    courseIds.map((id) => link({
      href: `#/course/${id}`, label: id, route: "course", param: id,
      accent: `var(--c-${id})`, count: openCount(id),
    }, active)).join("") +
    link({
      href: "#/personal", label: "Personal", route: "personal", accent: "var(--c-Personal)",
      count: state.personal.filter((t) => isNamed(t) && !isDone(t)).length,
    }, active);

  document.getElementById("nav-reference").innerHTML =
    `<div class="nav-label">Reference</div>` +
    NAV_REFERENCE.map((item) => link(item, active)).join("");
}

// ------------------------------------------------------------------- boot

applyTheme();
subscribe(() => { applyTheme(); paintNav(); });
window.addEventListener("hashchange", render);

const navToggle = document.querySelector("[data-nav-open]");

/** One place to move the drawer, so aria-expanded can never drift from it. */
function setNav(open) {
  app.dataset.nav = open ? "open" : "closed";
  navToggle.setAttribute("aria-expanded", String(open));
}

navToggle.addEventListener("click", () => setNav(app.dataset.nav !== "open"));
document.querySelector("[data-nav-close]").addEventListener("click", () => setNav(false));
document.getElementById("open-help").addEventListener("click", () => {
  openDialog(document.getElementById("help-dialog"));
});

// ---------------------------------------------------------------- shortcuts

/** True while the keystroke belongs to something the user is typing into. */
const isTyping = (el) =>
  el instanceof HTMLElement
  && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

// The app's first global keydown handler. Everything before this was per-element,
// which is why there was nowhere to hang a shortcut.
document.addEventListener("keydown", (e) => {
  if (e.altKey) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (isPaletteOpen()) closePalette();
    else openPalette();
    return;
  }

  if (e.metaKey || e.ctrlKey) return;

  // Bare keys only fire when you aren't typing — otherwise "?" in a search box
  // would open the help panel instead of appearing in the box.
  if (isTyping(document.activeElement)) return;

  if (e.key === "?") {
    e.preventDefault();
    openDialog(document.getElementById("help-dialog"));
  }
});

render();
