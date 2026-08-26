// Horizontal-overflow gate. Run: node tools/tests/layout.test.mjs
//
// The app is dense and tabular, and the failure mode that actually hurts is a table
// wider than the box holding it: you scroll sideways to read a due date. This asserts
// that never happens — not on the page, not inside any .table-wrap — at any of the
// widths a laptop, tablet or phone actually uses.
//
// Needs a local server (python3 -m http.server 8347) and Playwright's chromium.
// Override either with BASE= and PLAYWRIGHT= if they live somewhere else.
const PW = process.env.PLAYWRIGHT
  || "/Users/nicholaspinto/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const BASE = process.env.BASE || "http://localhost:8347";

const { chromium } = await import(PW);

const ROUTES = [
  "#/dashboard", "#/calendar", "#/course/CS440", "#/course/CS391", "#/course/CS360",
  "#/course/ENG216", "#/personal", "#/grades", "#/analytics", "#/groups",
  "#/schedule/CS440", "#/schedule/CS360", "#/settings",
];
const WIDTHS = [360, 390, 640, 768, 1024, 1280, 1600];

const browser = await chromium.launch();
const page = await browser.newPage();
let fails = 0;

console.log("route".padEnd(20) + WIDTHS.map((w) => String(w).padStart(11)).join(""));
for (const route of ROUTES) {
  const cells = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      let worst = 0, which = "";
      document.querySelectorAll(".table-wrap").forEach((el) => {
        const over = el.scrollWidth - el.clientWidth;
        if (over > worst) { worst = over; which = el.querySelector("th")?.textContent?.trim() || "?"; }
      });
      return { doc, worst, which };
    });
    if (m.doc > 0 || m.worst > 0) fails++;
    cells.push((m.doc > 0 ? `PAGE+${m.doc}` : m.worst > 0 ? `${m.which}+${m.worst}` : "ok").padStart(11));
  }
  console.log(route.padEnd(20) + cells.join(""));
}

await browser.close();
console.log(fails
  ? `\n${fails} width(s) overflow horizontally.`
  : `\nNo horizontal overflow anywhere (${ROUTES.length} routes x ${WIDTHS.length} widths).`);
process.exit(fails ? 1 : 0);
