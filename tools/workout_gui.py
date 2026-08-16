#!/usr/bin/env python3
"""A small local web GUI for building structured workouts (wanarun.net-style step builder -
`training_program_andre.md` Finding 8's realistic shape: GUI -> source generator -> live
compiler). The generator and compiler client are `workout.py`, imported here unchanged - this
file only adds a browser-facing front end on top, stdlib-only (no framework, no build step,
matching this project's existing style of small standalone tools).

**Deliberately scoped back, 2026-08-06** (`training_program_andre.md` Finding 19's stopping
point): this project's own flash writer (`workout_install.py`) hit an unresolved, real "app
error" on hardware after ruling out every hypothesis it could test - so this tool no longer
tries to write to the watch's flash at all. Instead it targets the *documented, community-used*
path instead: compile, then append the result straight into SuuntoLink's own bundled
`suunto-apps/index.json` (confirmed exact mechanism, forum.suunto.com/topic/7592's first post)
so SuuntoLink's own already-working "Add Suunto App" install flow does the rest -
`suuntolink_catalog.py` is that half, kept as its own file since it's desktop-OS-specific file
surgery, a different concern from this tool's otherwise-portable generator.

    ./tools/workout_gui.py               # serves http://127.0.0.1:8765, opens your browser
    ./tools/workout_gui.py --port 9000 --no-browser
"""

import argparse
import json
import platform
import re
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import suuntolink_catalog
from workout import COMPILE_SITE_URL, build_compile_request, generate_source

# Real, 2026-08-08 ("app is installed in some strange directory, please install it in
# Downloads directory"): was Path.home() / "AmbitWorkouts" (e.g. C:\Users\<user>\AmbitWorkouts
# on Windows) - moved under Downloads so saved workouts land somewhere the user actually
# expects to look, keeping the same named subfolder for organization.
SAVE_DIR = Path.home() / "Downloads" / "AmbitWorkouts"
README_PATH = SAVE_DIR / "README - read this on Linux.txt"

LINUX_README = """Ambit3 Workout Builder - using a compiled workout on Linux
============================================================

SuuntoLink doesn't run on Linux at all, so this app can't add a compiled workout straight
into it the way the Windows/Mac builds can ("Add to SuuntoLink"). Here's the real way to get
a workout you compiled here onto your watch:

1. Your compiled workout .json files are saved right in this folder:
   {save_dir}

2. Copy the .json file for the workout you want onto a Windows or Mac computer that has
   SuuntoLink installed - USB drive, cloud storage, email, whatever's easiest.

3. On that computer, open the Ambit3 Workout Builder app (the same app, built for that OS -
   see tools/packaging/README.md in the project if it isn't built yet).

4. Click "Advanced", then "Import compiled JSON", and pick the file you copied over.

5. Click "Add to SuuntoLink". It'll show up next time you connect the watch to SuuntoLink.

**Never replace SuuntoLink's own index.json by hand with this file.** SuuntoLink expects that
file to stay a list of every app it knows about; a compiled workout on its own is meant to be
added to that list, not to replace it - overwriting the whole file breaks SuuntoLink outright
("apps not iterable", blank sport-mode screens, confirmed on real hardware). The "Add to
SuuntoLink" button in the app does this correctly and automatically; hand-editing does not.

About Wine: SuuntoLink is an Electron app (Chromium + Node.js), and those are historically
unreliable under Wine - GPU/graphics and native-module quirks are common. This hasn't been
tried or tested for SuuntoLink specifically as part of this project, so it isn't a supported
or expected path here - the copy-the-file route above is the one that's actually verified.
"""


def save_compiled(name, compiled):
    """Every successful compile also lands here, independent of SuuntoLink/History - alongside
    the README (Linux) explaining what to actually do with it."""
    SAVE_DIR.mkdir(exist_ok=True)
    README_PATH.write_text(LINUX_README.format(save_dir=SAVE_DIR))
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_") or "workout"
    path = SAVE_DIR / f"{safe_name}_{int(time.time())}.json"
    path.write_text(json.dumps(compiled, indent=2))
    return path


HTML_PAGE = r"""<!doctype html>
<html data-theme="system">
<head>
<meta charset="utf-8">
<title>Ambit3 Workout Builder</title>
<style>
  /* Explicit light/dark palettes (2026-08-08 request: "have a light mode... switch from
     light mode, to dark to system") rather than the old bare `color-scheme: light dark`,
     which only ever nudged native form-control colors and left everything else to
     whatever the browser's own default page background happened to be - no real "light
     mode" to switch to on a browser whose default is already dark. `data-theme` on <html>
     picks the palette: "light"/"dark" force one, "system" (the default) follows the OS via
     prefers-color-scheme, same three-state idea as AmbitApp's own Theme.qml `override`. */
  :root {
    --bg: #F6F8F9; --card: #FFFFFF; --text: #1A1D22; --muted: #5B6270;
    --border: #00000022; --code-bg: #00000010; --primary: #167E6A;
    --primary-text: #FFFFFF; --ok: #1A7F37; --err: #C0392B;
  }
  :root[data-theme="dark"] {
    --bg: #14171C; --card: #1B1F27; --text: #E9EBEE; --muted: #9AA3AF;
    --border: #FFFFFF2A; --code-bg: #FFFFFF14; --primary: #57C9B3;
    --primary-text: #14171C; --ok: #4CAF6D; --err: #E0655A;
  }
  @media (prefers-color-scheme: dark) {
    :root[data-theme="system"] {
      --bg: #14171C; --card: #1B1F27; --text: #E9EBEE; --muted: #9AA3AF;
      --border: #FFFFFF2A; --code-bg: #FFFFFF14; --primary: #57C9B3;
      --primary-text: #14171C; --ok: #4CAF6D; --err: #E0655A;
    }
  }
  html { background: var(--bg); }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 780px; margin: 2rem auto;
         padding: 0 1rem; line-height: 1.4; background: var(--bg); color: var(--text); }
  a { color: var(--primary); }
  h1 { font-size: 1.3rem; display: flex; align-items: center; justify-content: space-between;
       gap: 1rem; }
  #themeToggle { font-size: .8rem; padding: .35rem .7rem; border-radius: 999px;
                 border: 1px solid var(--border); background: var(--card); color: var(--text); }
  .meta input { width: 100%; box-sizing: border-box; padding: .4rem; margin-bottom: .5rem;
                background: var(--card); color: var(--text); border: 1px solid var(--border); }
  .step { border: 1px solid var(--border); border-radius: 8px; padding: .6rem .8rem;
          margin-bottom: .5rem; display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
  .step.marker { background: var(--code-bg); font-weight: 600; }
  .step select, .step input[type=number] { padding: .3rem; background: var(--card);
                                            color: var(--text); border: 1px solid var(--border); }
  .step input[type=number] { width: 5.5rem; }
  .step .grow { flex: 1 1 auto; }
  .step button.remove { margin-left: auto; }
  .row-buttons { display: flex; gap: .5rem; margin: .8rem 0; flex-wrap: wrap; }
  button { cursor: pointer; padding: .4rem .8rem; background: var(--card); color: var(--text);
           border: 1px solid var(--border); border-radius: 6px; }
  code { background: var(--code-bg); border-radius: 4px; padding: .1rem .3rem; }
  pre { background: var(--code-bg); padding: .8rem; border-radius: 8px; overflow-x: auto;
        white-space: pre-wrap; word-break: break-word; }
  .result-ok { color: var(--ok); }
  .result-err { color: var(--err); }
  label { font-size: .8rem; opacity: .8; }
  .field { display: flex; flex-direction: column; gap: .1rem; }
  .primary { font-size: 1rem; padding: .6rem 1.2rem; font-weight: 600;
             background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
  .secondary { font-size: .85rem; opacity: .85; }
  details { margin: .5rem 0; }
  .history-entry { display: flex; gap: .6rem; align-items: center; border-top: 1px solid var(--border);
                    padding: .4rem 0; }
  .history-entry .grow { flex: 1 1 auto; }
  .hint { font-size: .8rem; opacity: .7; }
  #notes { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); }
  #notes h2 { font-size: 1rem; }
</style>
</head>
<body>
<h1>
  Ambit3 Workout Builder
  <button id="themeToggle" onclick="cycleTheme()"></button>
</h1>

<p>Builds a structured workout into App Zone source. The actual compile happens on the
community compiler <strong>website</strong>, which you open and paste into yourself - this
tool never sends anything to that server. The flow is: <strong>1)</strong> "Get source to
paste" &rarr; <strong>2)</strong> "Open compiler website", paste, compile, download the
result JSON &rarr; <strong>3)</strong> "Import compiled JSON" below to bring it back.</p>
<p><strong>"Add to SuuntoLink"</strong> (shown once you import the compiled JSON) appends the
result straight into your local SuuntoLink's own app catalog. From there, it shows up in
<strong>SuuntoLink's own "Add Suunto App"</strong> picker next time you connect the watch -
that's SuuntoLink's own install step, not something this tool does directly.</p>
<p>Each creation is saved below so you can come back for it later.</p>
<p class="hint">The compiler is proprietary to Suunto, shared by the community at
<a href="https://forum.suunto.com/topic/7592/ambit-apps-compilation" target="_blank">forum.suunto.com/topic/7592</a>.
This tool does not include or call it - you compile on the website there yourself.</p>

<div id="linuxNote" style="display:none">
  <p class="hint"><strong>Linux note:</strong> SuuntoLink has no native Linux build, so
  there's no "Add to SuuntoLink" button here - every compiled workout is still saved to
  <code>~/Downloads/AmbitWorkouts</code>, ready to use another way.</p>
  <p class="hint">Either copy the saved <code>.json</code> to a Windows or Mac machine that
  runs SuuntoLink and use its own "Advanced &rarr; Import compiled JSON" + "Add to
  SuuntoLink" there, or run SuuntoLink yourself under Wine or in a VM on this machine and do
  the same "Import compiled JSON" + "Add to SuuntoLink" steps inside that - genuinely
  untested and unsupported by this project either way (Electron apps like SuuntoLink are
  historically unreliable under Wine), so treat it as your own experiment, not a documented
  path.</p>
</div>

<div class="meta">
  <label>Workout name</label>
  <input id="wname" value="My workout">
  <label>Description</label>
  <input id="wdesc" value="">
</div>

<div id="steps"></div>

<div class="row-buttons">
  <button onclick="addStep()">+ Add step</button>
  <button onclick="addRepeatStart()">+ Start repeat</button>
  <button onclick="addRepeatEnd()">+ End repeat</button>
</div>

<div class="row-buttons">
  <button class="primary" onclick="doGetSource()">Get source to paste</button>
</div>

<details>
  <summary class="secondary">Advanced (source preview, save/load files)</summary>
  <div class="row-buttons">
    <button class="secondary" onclick="doGenerate()">Show generated source</button>
    <button class="secondary" onclick="exportJson()">Export workout JSON</button>
    <button class="secondary" onclick="document.getElementById('importFile').click()">Import workout JSON</button>
    <input type="file" id="importFile" style="display:none" onchange="importJson(event)">
    <button class="secondary" onclick="document.getElementById('importCompiledFile').click()">Import compiled JSON</button>
    <input type="file" id="importCompiledFile" style="display:none" onchange="importCompiledJson(event)">
  </div>
  <p class="hint">"Import compiled JSON" is for a file compiled on a <em>different</em> machine
  (e.g. built on Linux, where there's no SuuntoLink to add it to) - load it here to get the
  "Add to SuuntoLink" button for it.</p>
</details>

<div id="output"></div>

<h2>History</h2>
<p class="hint">Every app you create is kept here (in this browser only) so you can revisit or
re-download it later.</p>
<div id="history"></div>

<div id="notes">
  <h2>Important notes</h2>
  <p class="hint"><strong>Always use the "Add to SuuntoLink" button for this</strong> - never
  replace SuuntoLink's <code>index.json</code> with a downloaded/saved file by hand.
  SuuntoLink expects that file to stay a list of <em>every</em> app it knows about; a compiled
  app on its own is deliberately just one entry meant to be added to that list, not a
  replacement for it. Overwriting the whole file breaks SuuntoLink ("apps not iterable", blank
  sport-mode screens) until you restore <code>index_old.json</code> back over it.</p>
  <p class="hint"><strong>macOS permission note:</strong> the first time you click "Add to
  SuuntoLink", macOS may silently block it (it can look like nothing happened, or you'll see a
  permission-style error). Go to System Settings &rarr; Privacy &amp; Security &rarr;
  <strong>App Management</strong> (use Full Disk Access instead if your macOS doesn't have
  that section), enable "Ambit3 Workout Builder" there, then fully quit the app
  (<code>killall "Ambit3 Workout Builder"</code>, or Cmd+Q from its Dock icon - closing the
  browser tab alone doesn't quit it) and reopen it before trying again. Also worth knowing: if
  SuuntoLink is already open when you click the button, it may just come to the front instead
  of re-reading the catalog - quit and reopen SuuntoLink too if a newly added app doesn't show
  up right away.</p>
  <p class="hint">This is an independent, unofficial tool, not affiliated with, endorsed by,
  or supported by Suunto. "Suunto", "Ambit", "Traverse" and the watch names shown above are
  trademarks of their respective owner, used here only to describe compatibility. Provided
  as-is, with no warranty of any kind - test carefully before relying on it, and the people
  who built it aren't responsible for any malfunction, data loss, or damage to your watch
  from using it.</p>
</div>

<script>
// Theme (2026-08-08 request: "have a light mode... a button to switch from light mode, to
// dark to system") - three-state cycle, persisted so it survives a reload, same idea as
// AmbitApp's own Theme.qml `override` property.
const THEME_KEY = "ambit_workout_theme";
const THEME_ORDER = ["light", "dark", "system"];
const THEME_LABELS = {light: "Theme: Light", dark: "Theme: Dark", system: "Theme: System"};
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("themeToggle").textContent = THEME_LABELS[theme];
}
function cycleTheme() {
  const current = localStorage.getItem(THEME_KEY) || "system";
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}
applyTheme(localStorage.getItem(THEME_KEY) || "system");

let steps = [];

// The compiler reports compatibility using Suunto's internal engineering codenames
// (history.md) - translated here to the names people actually buy so "compatible with"
// is readable. Left untranslated (falls through to the raw name) for anything not in
// this project's own confirmed codename table.
// Spacing between "Ambit" and its generation number matches ambitapp-v2's own
// HomeViewModel.qml _modelNames table (2026-08-08 request, applied in both places for the
// same reason: "Ambit3" -> "Ambit 3").
const VARIANT_NAMES = {
  Bluebird: "Ambit", Duck: "Ambit 2", Colibri: "Ambit 2 S", Greentit: "Ambit 2 R",
  Emu: "Ambit 3 Peak", Finch: "Ambit 3 Sport", Ibisbill: "Ambit 3 Run", Kaka: "Ambit 3 Vertical",
  Jabiru: "Traverse", Loon: "Traverse Alpha",
};
function variantName(codename) { return VARIANT_NAMES[codename] || codename; }

const TYPE_NAMES = ["warmup", "interval", "recovery", "cooldown"];
const DURATION_NAMES = ["time", "distance", "ascent", "lap"];
const TARGET_NAMES = ["none", "hr", "pace", "speed", "vertical_speed", "power"];

// value/unit -> base units (seconds for time, meters for distance/ascent) this project's
// generator expects (SUUNTO_DURATION is seconds, SUUNTO_DISTANCE/SUUNTO_ASCENT are meters).
const TIME_UNITS = {seconds: 1, minutes: 60};
const DISTANCE_UNITS = {meters: 1, kilometers: 1000};

function unitsFor(durationName) {
  if (durationName === "time") return TIME_UNITS;
  if (durationName === "distance" || durationName === "ascent") return DISTANCE_UNITS;
  return null;
}
function defaultUnit(durationName) {
  return durationName === "time" ? "seconds" : "meters";
}

// SUUNTO_PACE's native unit is decimal minutes/km (SuuntoAppZoneDeveloperManual.pdf) - "6:30"
// is friendlier to type than "6.5", so pace fields are mm:ss text, converted at the edges.
function parsePace(text) {
  const m = /^(\d+):([0-5]?\d)$/.exec((text || "").trim());
  if (!m) return 0;
  return +m[1] + (+m[2]) / 60;
}
function formatPace(decimalMinPerKm) {
  const v = +decimalMinPerKm || 0;
  const min = Math.floor(v);
  const sec = Math.round((v - min) * 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function addStep() {
  steps.push({type: {typeName: "interval"}, duration: {durationName: "time", value: 60, unit: "seconds"},
              target: {targetName: "none", valueRange: {min: 0, max: 0}},
              notify: {beep: true, light: true}});
  render();
}
function addRepeatStart() { steps.push({type: {typeName: "repeatStart", value: 3}}); render(); }
function addRepeatEnd() { steps.push({type: {typeName: "repeatEnd"}}); render(); }
function removeStep(i) { steps.splice(i, 1); render(); }
function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  render();
}
function setDurationName(i, name) {
  steps[i].duration.durationName = name;
  steps[i].duration.unit = defaultUnit(name);
  render();
}
function setDurationValue(i, displayValue) {
  const units = unitsFor(steps[i].duration.durationName);
  const factor = units ? units[steps[i].duration.unit] : 1;
  steps[i].duration.value = Math.round((+displayValue || 0) * factor);
}
function setDurationUnit(i, unit) {
  steps[i].duration.unit = unit;
  render();
}

function optionList(names, current) {
  return names.map(n => `<option value="${n}" ${n === current ? "selected" : ""}>${n}</option>`).join("");
}

function render() {
  const el = document.getElementById("steps");
  el.innerHTML = steps.map((s, i) => {
    const t = s.type.typeName;
    if (t === "repeatStart") {
      return `<div class="step marker">
        Start repeat
        <input type="number" min="1" value="${s.type.value}" onchange="steps[${i}].type.value=+this.value">
        times
        ${stepButtons(i)}
      </div>`;
    }
    if (t === "repeatEnd") {
      return `<div class="step marker">End repeat ${stepButtons(i)}</div>`;
    }
    const dur = s.duration, tgt = s.target;
    const notify = s.notify || (s.notify = {beep: true, light: true});
    const units = unitsFor(dur.durationName);
    const unit = dur.unit || defaultUnit(dur.durationName);
    const factor = units ? units[unit] : 1;
    const displayValue = units ? (dur.value || 0) / factor : "";
    const showRange = tgt.targetName !== "none";
    const isPace = tgt.targetName === "pace";
    return `<div class="step">
      <div class="field"><label>Phase</label>
        <select onchange="steps[${i}].type.typeName=this.value">${optionList(TYPE_NAMES, t)}</select>
      </div>
      <div class="field"><label>Duration</label>
        <select onchange="setDurationName(${i}, this.value)">${optionList(DURATION_NAMES, dur.durationName)}</select>
      </div>
      ${units ? `
      <div class="field"><label>Value</label>
        <input type="number" step="any" value="${displayValue}" onchange="setDurationValue(${i}, this.value)">
      </div>
      <div class="field"><label>Unit</label>
        <select onchange="setDurationUnit(${i}, this.value)">${optionList(Object.keys(units), unit)}</select>
      </div>` : ""}
      <div class="field"><label>Target</label>
        <select onchange="steps[${i}].target.targetName=this.value; render()">${optionList(TARGET_NAMES, tgt.targetName)}</select>
      </div>
      ${showRange && isPace ? `
      <div class="field"><label>Min pace (min/km)</label>
        <input type="text" size="5" placeholder="6:30" value="${formatPace(tgt.valueRange.min)}"
               onchange="steps[${i}].target.valueRange.min=parsePace(this.value); this.value=formatPace(steps[${i}].target.valueRange.min)">
      </div>
      <div class="field"><label>Max pace (min/km)</label>
        <input type="text" size="5" placeholder="6:00" value="${formatPace(tgt.valueRange.max)}"
               onchange="steps[${i}].target.valueRange.max=parsePace(this.value); this.value=formatPace(steps[${i}].target.valueRange.max)">
      </div>` : ""}
      ${showRange && !isPace ? `
      <div class="field"><label>Min</label>
        <input type="number" value="${tgt.valueRange.min}" onchange="steps[${i}].target.valueRange.min=+this.value">
      </div>
      <div class="field"><label>Max</label>
        <input type="number" value="${tgt.valueRange.max}" onchange="steps[${i}].target.valueRange.max=+this.value">
      </div>` : ""}
      <div class="field"><label>On entering this step</label>
        <label><input type="checkbox" ${notify.beep ? "checked" : ""}
          onchange="steps[${i}].notify.beep=this.checked">Beep</label>
        <label><input type="checkbox" ${notify.light ? "checked" : ""}
          onchange="steps[${i}].notify.light=this.checked">Light</label>
      </div>
      ${stepButtons(i)}
    </div>`;
  }).join("");
}

function stepButtons(i) {
  return `<span class="grow"></span>
    <button onclick="moveStep(${i},-1)" title="move up">^</button>
    <button onclick="moveStep(${i},1)" title="move down">v</button>
    <button class="remove" onclick="removeStep(${i})">remove</button>`;
}

function currentWorkout() {
  return {name: document.getElementById("wname").value,
          workoutDescription: document.getElementById("wdesc").value,
          steps: steps};
}

async function doGenerate() {
  const out = document.getElementById("output");
  out.innerHTML = "generating...";
  const resp = await fetch("/api/generate", {method: "POST", body: JSON.stringify(currentWorkout())});
  const data = await resp.json();
  if (!resp.ok) { out.innerHTML = `<p class="result-err">${data.error}</p>`; return; }
  out.innerHTML = `<h3>Generated source</h3><pre>${data.source.replace(/</g, "&lt;")}</pre>`;
}

let lastCompiled = null;

// SuuntoLink has no Linux build at all, so on Linux there's nothing for a button to actually
// do - no SuuntoLink to add to, not even a doomed attempt at it. Real request 2026-08-08:
// removed the "Open instructions" button that used to stand in for it - the same guidance is
// now inline on the page itself (#linuxNote, shown below) rather than needing a click to open
// a separate README file.
let platformSystem = null;
async function detectPlatform() {
  const resp = await fetch("/api/platform");
  platformSystem = (await resp.json()).system;
  if (platformSystem === "Linux") document.getElementById("linuxNote").style.display = "";
}
function installButtonHtml(historyIndex) {
  if (platformSystem === "Linux") return "";
  const call = historyIndex === undefined ? "lastCompiled" : `loadHistory()[${historyIndex}].compiled`;
  const cls = historyIndex === undefined ? "" : ' class="secondary"';
  return `<button${cls} onclick="doAddToSuuntoLink(${call}, this)">Add to SuuntoLink</button>`;
}

// Hand-off compile: this tool never calls the compiler server itself. It produces the
// paste-ready source and lets the user compile it on the community website, then import the
// result back below via "Import compiled JSON".
const COMPILE_SITE_URL = "__COMPILE_SITE_URL__";

async function doGetSource() {
  const out = document.getElementById("output");
  out.innerHTML = "generating...";
  const resp = await fetch("/api/generate", {method: "POST", body: JSON.stringify(currentWorkout())});
  const data = await resp.json();
  if (!resp.ok) { out.innerHTML = `<p class="result-err">${data.error}</p>`; return; }
  out.innerHTML = `
    <h3>Source to compile</h3>
    <p>Copy this, open the compiler website, paste it in and compile, then download the
       result JSON and use <strong>"Import compiled JSON"</strong> above to bring it back here.</p>
    <div class="row-buttons">
      <button class="primary" onclick="copySource(this)">Copy source</button>
      <button onclick="window.open(COMPILE_SITE_URL, '_blank')">Open compiler website</button>
    </div>
    <pre id="pasteSource">${data.source.replace(/</g, "&lt;")}</pre>`;
}

function copySource(btn) {
  const text = document.getElementById("pasteSource").textContent;
  navigator.clipboard.writeText(text).then(
    () => { btn.insertAdjacentHTML("afterend", ' <span class="result-ok">Copied.</span>'); },
    () => { btn.insertAdjacentHTML("afterend", ' <span class="result-err">Copy failed - select the text and copy manually.</span>'); });
}

function renderCompiledResult(name, data, extraNote) {
  lastCompiled = data;
  document.getElementById("output").innerHTML = `<p class="result-ok">"${name}" - binary
    length ${data.binary.length} bytes, compatible with:
    ${data.compatibleVariants.map(variantName).join(", ")}.
    ${extraNote}</p>
    ${installButtonHtml()}`;
}

function importCompiledJson(event) {
  const file = event.target.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) { alert(`Not valid JSON: ${e}`); return; }
    if (!data.binary || !data.compatibleVariants) {
      alert('Doesn\'t look like a compiled app JSON (expected "binary" and "compatibleVariants" fields).');
      return;
    }
    renderCompiledResult(file.name.replace(/\.json$/i, ""), data, "Imported from a file.");
    window.scrollTo({top: document.getElementById("output").offsetTop, behavior: "smooth"});
  };
  reader.readAsText(file);
  event.target.value = "";  // so importing the same file twice still fires onchange
}

// Both handlers take the clicked button and show their result right next to it - not a fixed
// element ID, since the same buttons render both after a fresh compile and in each History row.
async function doAddToSuuntoLink(compiled, btn) {
  btn.disabled = true;
  const resp = await fetch("/api/add-to-suuntolink", {method: "POST", body: JSON.stringify(compiled)});
  const data = await resp.json();
  btn.disabled = false;
  btn.insertAdjacentHTML("afterend", resp.ok
    ? ` <span class="result-ok">Done.</span>`
    : ` <span class="result-err">${data.error}</span>`);
}

function download(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type: "application/json"}));
  a.download = filename;
  a.click();
}

function exportJson() { download("workout.json", JSON.stringify(currentWorkout(), null, 2)); }

function importJson(event) {
  const file = event.target.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    const w = JSON.parse(reader.result);
    document.getElementById("wname").value = w.name || "";
    document.getElementById("wdesc").value = w.workoutDescription || "";
    steps = (w.steps || []).map(s => {
      if (s.duration && s.duration.durationName && !s.duration.unit) {
        s.duration.unit = defaultUnit(s.duration.durationName);
      }
      return s;
    });
    render();
  };
  reader.readAsText(file);
}

// --- history (localStorage only - nothing server-side to keep this tool stateless) ---
const HISTORY_KEY = "ambit_workout_history";

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch (e) { return []; }
}
function saveHistory(workout, compiled) {
  const history = loadHistory();
  history.unshift({
    at: new Date().toISOString(), workout: workout, compiled: compiled,
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  renderHistory();
}
function renderHistory() {
  const history = loadHistory();
  const el = document.getElementById("history");
  if (history.length === 0) { el.innerHTML = '<p class="hint">Nothing created yet.</p>'; return; }
  el.innerHTML = history.map((h, i) => `
    <div class="history-entry">
      <div class="grow">
        <strong>${h.workout.name}</strong>
        <span class="hint">${new Date(h.at).toLocaleString()} - ${h.workout.steps.length} step(s),
        ${h.compiled.binary.length} byte binary</span>
      </div>
      <button class="secondary" onclick="loadFromHistory(${i})">Load into editor</button>
      <button class="secondary" onclick="downloadFromHistory(${i})">Download compiled</button>
      ${installButtonHtml(i)}
      <button class="secondary" onclick="deleteFromHistory(${i})">Delete</button>
    </div>`).join("");
}
function loadFromHistory(i) {
  const h = loadHistory()[i];
  document.getElementById("wname").value = h.workout.name || "";
  document.getElementById("wdesc").value = h.workout.workoutDescription || "";
  steps = h.workout.steps;
  render();
  window.scrollTo({top: 0, behavior: "smooth"});
}
function downloadFromHistory(i) {
  const h = loadHistory()[i];
  download(`${h.workout.name.replace(/[^a-z0-9]+/gi, "_")}_compiled.json`, JSON.stringify(h.compiled, null, 2));
}
function deleteFromHistory(i) {
  const history = loadHistory();
  history.splice(i, 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

render();
detectPlatform().then(renderHistory);  // History's buttons depend on platformSystem
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep stdout clean; errors still surface via response bodies

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/platform":
            self._send_json(200, {"system": platform.system()})  # "Linux"/"Darwin"/"Windows"
            return
        if self.path != "/":
            self.send_response(404)
            self.end_headers()
            return
        body = HTML_PAGE.replace("__COMPILE_SITE_URL__", COMPILE_SITE_URL).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path not in ("/api/generate", "/api/add-to-suuntolink"):
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length)) if length else {}
        except json.JSONDecodeError as e:
            self._send_json(400, {"error": f"invalid JSON body: {e}"})
            return

        if self.path == "/api/add-to-suuntolink":
            self._handle_add_to_suuntolink(body)
            return

        workout = body
        try:
            source, own_vars = generate_source(workout)
            request_text = build_compile_request(source, own_vars, workout.get("name", "Workout"))
        except (KeyError, ValueError, NotImplementedError) as e:
            self._send_json(400, {"error": f"couldn't generate source: {e}"})
            return

        # /api/generate is the only workout endpoint now: it returns the paste-ready source.
        # Compiling is done by the user on the community website (see COMPILE_SITE_URL); this
        # tool never calls that server.
        self._send_json(200, {"source": request_text})

    def _handle_add_to_suuntolink(self, compiled):
        candidates = suuntolink_catalog.find_index_json()
        if not candidates:
            self._send_json(404, {
                "error": "couldn't find SuuntoLink's suunto-apps/index.json automatically. "
                         "Make sure SuuntoLink is installed, then check the path for your OS "
                         "in suuntolink_catalog.py's module docstring."})
            return
        try:
            backup, rule_id = suuntolink_catalog.add_entry(candidates[-1], compiled)
        except (OSError, ValueError, json.JSONDecodeError) as e:
            self._send_json(500, {"error": f"couldn't update {candidates[-1]}: {e}"})
            return
        suuntolink_catalog.open_suuntolink()
        self._send_json(200, {"path": candidates[-1], "backup": backup, "ruleId": rule_id})


def _log_startup_failure(exc):
    """The packaged app runs with console=False (no terminal window, so print() goes
    nowhere) - without this, a startup failure when double-clicked from Finder is
    completely silent, just "nothing happens". Logged instead of just swallowed."""
    SAVE_DIR.mkdir(exist_ok=True)
    with (SAVE_DIR / "app.log").open("a") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} - failed to start: {exc!r}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true",
                     help="don't open a browser automatically (default: open one)")
    args = ap.parse_args()
    url = f"http://{args.host}:{args.port}/"

    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        # Most likely cause: an earlier launch is still running in the background (e.g.
        # the icon was double-clicked more than once). Open the browser at the existing
        # instance rather than dying invisibly - and log it either way, since that
        # guess could be wrong.
        _log_startup_failure(e)
        if not args.no_browser:
            webbrowser.open(url)
        return 0

    print(f"Workout builder running at {url} (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        _log_startup_failure(e)
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
