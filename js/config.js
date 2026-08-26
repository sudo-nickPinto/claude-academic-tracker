export const taskTypes = [
  "Reading", "Assignment", "Problem Set", "Lab", "Project",
  "Paper", "Exam / Quiz", "Study", "Admin", "Other",
];

export const priorities = ["High", "Medium", "Low"];

export const statuses = ["Not Started", "In Progress", "Waiting / Blocked", "Done"];

/** Types that count as a milestone for the dashboard's "Next Big One". */
export const majorTypes = ["Exam / Quiz", "Paper", "Project"];

export const priorityRank = { High: 0, Medium: 1, Low: 2 };

/** Focused minutes assumed per day when working backward from a due date. */
export const dailyCapacityMin = 90;

/**
 * The length of a usable working day in minutes — the pool that class time and
 * coursework both come out of. Deliberately not 24 hours: the number is only useful
 * if it's a budget you could actually spend. Distinct from dailyCapacityMin, which
 * is the workbook's assumption about *focused* work and stays at 90.
 */
export const workingDayMin = 8 * 60;

/** Hours of work on a single day that make it a "heavy day" on the 14-day chart. */
export const heavyDayHours = 4;

/**
 * How far ahead a task starts counting as active. Anything due beyond this sits in
 * "Later" — still real, still editable, just not in today's list. The one tuning knob
 * for that split; Settings writes an override to prefs.horizonDays.
 */
export const horizonDays = 21;

/**
 * The term's bounds. An Outlook export carries a whole year of life — summer shifts,
 * winter flights — and only what falls inside the term is committed time that
 * competes with coursework. Derived from the CS440/CS360 schedule range in
 * reference.js, not invented; Settings writes an override to prefs.semester.
 */
export const semester = { start: "2026-08-24", end: "2026-12-07" };

export const courseIds = ["CS440", "CS391", "CS360", "ENG216"];

export const courses = {
  CS440: { id: "CS440", name: "Advanced System Design", accent: "#3B5BA5", tint: "#E8EDF7" },
  CS391: { id: "CS391", name: "Cybersecurity", accent: "#1F7A6C", tint: "#E2F2EF" },
  CS360: { id: "CS360", name: "Database Systems", accent: "#B26A16", tint: "#FBF0DF" },
  ENG216: { id: "ENG216", name: "Robin Hood", accent: "#8E3B4E", tint: "#F8E9EC" },
};

export const personalMeta = { id: "Personal", name: "Personal", accent: "#6E7A8A", tint: "#EEF0F3" };

/** Courses with a reference schedule view. */
export const scheduleCourses = ["CS440", "CS360"];

/**
 * The CS360 syllabus lists Fall Break as "no class on Tuesday" and Thanksgiving as
 * "no class on Thursday", but every date in the schedule is a Monday. Surfaced rather
 * than silently resolved — the real meeting days may not line up with the listed dates.
 */
export const cs360ScheduleCaveat =
  "Heads up: the source syllabus says Fall Break is “no class on Tuesday” and " +
  "Thanksgiving is “no class on Thursday,” but every date listed below is a Monday. " +
  "The actual weekly meeting days may not match these dates one-to-one — check the syllabus " +
  "before relying on a specific day.";
