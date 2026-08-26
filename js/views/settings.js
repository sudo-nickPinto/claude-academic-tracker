import { load, update, exportJSON, importJSON, resetToSeed } from "../store.js";
import { courseIds } from "../config.js";
import { isNamed, horizonOf, dashboardStats, semesterWindow } from "../compute.js";
import { parseICS } from "../ical.js";
import { esc, openDialog } from "../ui.js";

export function renderSettings(outlet) {
  const state = load();
  const counts = courseIds.map((id) => `${id} ${state.tasks[id].filter(isNamed).length}`).join(" · ");
  const stats = dashboardStats(state);
  const cal = state.calendar;

  outlet.style.cssText = "";
  outlet.innerHTML = `
    <header class="view-head">
      <div>
        <div class="eyebrow">Settings</div>
        <h1>Data &amp; appearance</h1>
      </div>
    </header>

    <div class="stack">
      <div class="card">
        <div class="card-head"><h2>Your data</h2>
          <span class="hint">${esc(counts)} · Personal ${state.personal.filter(isNamed).length}</span></div>
        <div class="card-pad stack">
          <div class="banner" data-tone="warning" style="margin:0">
            <div><strong>This data lives in this browser only.</strong>
            It isn't synced to a server or to your other devices, and clearing site data will erase it.
            Export a copy now and then — that file is your backup and your way onto another machine.</div>
          </div>
          <div class="row">
            <button class="btn btn-primary" id="export">Export JSON</button>
            <button class="btn" id="import">Import JSON…</button>
            <span class="spacer" style="flex:1"></span>
            <button class="btn btn-danger" id="reset">Reset to workbook data</button>
          </div>
          <input type="file" id="file" accept="application/json,.json" hidden>
          <p class="small faint" id="io-msg"></p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Appearance</h2></div>
        <div class="card-pad">
          <div class="field" style="max-width:240px">
            <label for="theme">Theme</label>
            <select id="theme">
              ${["system", "light", "dark"].map((t) =>
                `<option value="${t}" ${state.prefs.theme === t ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Active vs Later</h2></div>
        <div class="card-pad">
          <div class="field" style="max-width:240px">
            <label for="horizon">Show a task as active</label>
            <select id="horizon">
              ${[14, 21, 30, 60].map((d) =>
                `<option value="${d}" ${horizonOf(state) === d ? "selected" : ""}>${d} days before it's due</option>`).join("")}
            </select>
          </div>
          <p class="small faint" style="margin-top:var(--sp-2)">
            Anything due further out waits in <strong>Later</strong> — still editable, still counted in
            Analytics, just not in today's list. A task also surfaces early if its start-by date arrives
            first, the moment you mark it In Progress, or if it ever goes overdue. Currently
            <strong>${stats.active} active</strong> and <strong>${stats.later} later</strong>.
          </p>
        </div>
      </div>


      <div class="card">
        <div class="card-head"><h2>Outlook calendar</h2>
          ${cal.importedAt ? `<span class="hint">${esc(cal.filename || "calendar")} · ${cal.events.length} events</span>` : ""}</div>
        <div class="card-pad stack">
          <p class="small muted" style="margin:0">
            Your classes and meetings become <strong>committed time</strong>, so the workload forecast
            can tell you what's actually left in a day. Events never become tasks.
          </p>

          <div class="dropzone" id="ics-drop" tabindex="0" role="button"
               aria-label="Choose or drop an .ics calendar file">
            <strong>Drop an .ics file here</strong>
            <span class="small faint">or click to choose one · nothing is uploaded anywhere</span>
          </div>
          <input type="file" id="ics-file" accept=".ics,text/calendar" hidden>

          ${cal.importedAt ? `
            <div class="row" style="align-items:center">
              <span class="small faint">Imported ${esc(cal.importedAt.slice(0, 10))}${
                cal.stats ? ` · ${cal.stats.imported} kept, ${cal.stats.allDay + cal.stats.outside + cal.stats.cancelled} skipped` : ""}</span>
              <span class="spacer" style="flex:1"></span>
              <button class="btn btn-danger btn-sm" id="ics-clear">Remove calendar</button>
            </div>` : ""}

          <details class="small">
            <summary>How to export from Outlook</summary>
            <div class="stack" style="margin-top:var(--sp-2)">
              <p><strong>Outlook on the web</strong> — Calendar → <em>Settings ⚙ → Calendar → Shared
              calendars</em> → under <em>Publish a calendar</em> pick your calendar, choose
              <em>Can view all details</em>, publish, then open the <code>.ics</code> link and save the file.</p>
              <p><strong>Outlook for Windows</strong> — <em>File → Save Calendar</em>, set
              <em>More Options</em> to the whole term and <em>Full details</em>, save as iCalendar.</p>
              <p><strong>Outlook for Mac</strong> — <em>File → Export → Export Calendar</em>.</p>
              <p class="faint">The app can't read a published calendar link directly: those servers
              don't allow another site to fetch them from a browser, and working around it would need
              a server of our own. A saved file keeps everything on your machine.</p>
            </div>
          </details>

          <p class="small" id="ics-msg"></p>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Dashboard</h2></div>
        <div class="card-pad">
          <label class="switch">
            <input type="checkbox" id="include-personal" ${state.prefs.includePersonalInWeek ? "checked" : ""}>
            Include Personal items in the “overdue &amp; next seven days” list
          </label>
          <p class="small faint" style="margin-top:var(--sp-2)">
            Personal items never appear in Dashboard stats, per-course figures, charts, or Analytics —
            this only affects that one list.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>How this tracker works</h2></div>
        <div class="card-pad">
          <button class="btn" id="help">Open help &amp; colour legend</button>
        </div>
      </div>
    </div>`;

  wire(outlet);
}

function wire(outlet) {
  const msg = outlet.querySelector("#io-msg");
  const say = (text, bad = false) => {
    msg.textContent = text;
    msg.style.color = bad ? "var(--danger)" : "var(--success)";
  };

  outlet.querySelector("#export").addEventListener("click", () => {
    const blob = new Blob([exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `semester-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    say("Exported.");
  });

  const file = outlet.querySelector("#file");
  outlet.querySelector("#import").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    try {
      importJSON(await chosen.text());
      renderSettings(outlet);
      say(`Imported ${chosen.name}.`);
    } catch (err) {
      say(`Could not import that file: ${err.message}`, true);
    }
    file.value = "";
  });

  outlet.querySelector("#reset").addEventListener("click", () => {
    if (!confirm("Replace everything with the original workbook data? Your edits will be lost.")) return;
    resetToSeed();
    renderSettings(outlet);
    say("Reset to the workbook's data.");
  });

  outlet.querySelector("#theme").addEventListener("change", (e) => {
    update((draft) => { draft.prefs.theme = e.target.value; });
  });

  outlet.querySelector("#horizon").addEventListener("change", (e) => {
    update((draft) => { draft.prefs.horizonDays = Number(e.target.value); });
    renderSettings(outlet); // the active/later counts in the description move with it
  });

  outlet.querySelector("#include-personal").addEventListener("change", (e) => {
    const on = e.target.checked;
    update((draft) => { draft.prefs.includePersonalInWeek = on; });
  });


  // ------------------------------------------------------------------ calendar
  const icsFile = outlet.querySelector("#ics-file");
  const icsMsg = outlet.querySelector("#ics-msg");
  const drop = outlet.querySelector("#ics-drop");

  const report = (text, tone) => {
    icsMsg.innerHTML = text;
    icsMsg.style.color = tone === "bad" ? "var(--danger)" : tone === "good" ? "var(--success)" : "var(--text-muted)";
  };

  async function ingest(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      report("That file is over 20MB — larger than any real calendar export. Nothing was imported.", "bad");
      return;
    }
    const term = semesterWindow(load());
    let result;
    try {
      result = parseICS(await file.text(), { from: term.start, to: term.end });
    } catch (err) {
      report(`Could not read that file: ${err.message}`, "bad");
      return;
    }
    if (result.error) { report(result.error, "bad"); return; }
    if (!result.events.length) {
      report(`Read ${result.stats.entries} calendar entries, but nothing in them fell inside
        the term (${term.start} → ${term.end}). Check the date range you exported.`, "bad");
      return;
    }

    const { stats } = result;
    update((draft) => {
      draft.calendar = {
        events: result.events,
        importedAt: new Date().toISOString(),
        filename: file.name,
        stats,
      };
    });
    renderSettings(outlet);
    const skipped = [
      stats.allDay ? `${stats.allDay} all-day` : "",
      stats.outside ? `${stats.outside} outside the term` : "",
      stats.cancelled ? `${stats.cancelled} cancelled` : "",
      stats.unreadable ? `${stats.unreadable} unreadable` : "",
    ].filter(Boolean).join(", ");
    outlet.querySelector("#ics-msg").innerHTML =
      `Imported <strong>${stats.imported}</strong> events from ${esc(file.name)}${
        skipped ? ` · skipped ${skipped}` : ""}.`;
    outlet.querySelector("#ics-msg").style.color = "var(--success)";
  }

  drop.addEventListener("click", () => icsFile.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); icsFile.click(); }
  });
  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.dataset.over = "true"; }));
  ["dragleave", "drop"].forEach((type) =>
    drop.addEventListener(type, () => delete drop.dataset.over));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    ingest(e.dataTransfer?.files?.[0]);
  });
  icsFile.addEventListener("change", () => { ingest(icsFile.files?.[0]); icsFile.value = ""; });

  outlet.querySelector("#ics-clear")?.addEventListener("click", () => {
    if (!confirm("Remove the imported calendar? Your tasks are not affected.")) return;
    update((draft) => { draft.calendar = { events: [], importedAt: null, filename: null, stats: null }; });
    renderSettings(outlet);
  });

  outlet.querySelector("#help").addEventListener("click", () =>
    openDialog(document.getElementById("help-dialog")));
}
