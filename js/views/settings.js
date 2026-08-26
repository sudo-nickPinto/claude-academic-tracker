import { load, update, exportJSON, importJSON, resetToSeed } from "../store.js";
import { courseIds } from "../config.js";
import { isNamed } from "../compute.js";
import { esc, openDialog } from "../ui.js";

export function renderSettings(outlet) {
  const state = load();
  const counts = courseIds.map((id) => `${id} ${state.tasks[id].filter(isNamed).length}`).join(" · ");

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

  outlet.querySelector("#include-personal").addEventListener("change", (e) => {
    const on = e.target.checked;
    update((draft) => { draft.prefs.includePersonalInWeek = on; });
  });

  outlet.querySelector("#help").addEventListener("click", () =>
    openDialog(document.getElementById("help-dialog")));
}
