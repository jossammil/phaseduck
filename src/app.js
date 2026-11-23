import { paint, inspect } from "./art.mjs";
import { targets, validateSignal, validateMarks } from "./signals.js";
import { archive, latest, metadata } from "./radar.js";
import { setupConsole } from "./workbench.js";

const $ = (id) => document.getElementById(id);
const sceneDefs = {
  clock: ["Phase Clock", "Time", "◷"],
  silk: ["Silk Waves", "Waveforms", "∿"],
  orbit: ["Harmonics", "Geometry", "◎"],
  dunes: ["Dunes", "Landscape", "≋"],
  rain: ["Rain Glass", "Observed radar", "◌"],
  loom: ["Data Loom", "Parquet series", "▧"],
  jobs: ["Job Interference", "Process monitor", "≀"],
  calendar: ["Calendar Orrery", "Next 24 hours", "◴"],
  feedback: ["Patch Feedback", "Live sketch", "⟲"],
};
const state = {
  scene: "clock",
  time: 0,
  now: new Date(),
  intensity: 0.7,
  signal: [],
  patch: "",
  days: [],
  jobs: [],
  events: [],
  radar: null,
  selectedDay: 0,
  selectedHour: 12,
  sketch: [],
};
const signals = Object.create(null);
const measureFrames = new URLSearchParams(location.search).has("measure");
let lastRateId = "",
  lastRate = null;
let loomTitle = "NYC yellow taxi",
  loomQuery = "SELECT date,hour,trips FROM trips";
let speedName = "",
  patchName = "",
  native = false,
  workspace = "",
  lastNativeError = "",
  displayTime = false,
  selectedJob = "",
  calendarSource = "Example schedule",
  calendarAnchor = 0;
let radarMode = "archive",
  radarIndex = 0,
  radarEpoch = 0,
  radarError = "",
  radarPlaying = false,
  radarLoading = false,
  radarSelection = null;
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  relativePhase = 0,
  reduce = matchMedia("(prefers-reduced-motion: reduce)");
let raf = 0,
  visible = true,
  previous = null,
  due = 0,
  lastReadout = 0,
  lastWall = 0,
  audio = null,
  osc = null,
  gain = null,
  volume = 0.045;
const stage = $("art"),
  ctx = stage.getContext("2d", { alpha: false });
let w = 0,
  h = 0;
const stamp = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const shortTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const calendarDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});
const getStored = (key, def) => {
  try {
    return JSON.parse(localStorage.getItem("phase-deck-" + key)) ?? def;
  } catch {
    return def;
  }
};
const store = (key, value) =>
  localStorage.setItem("phase-deck-" + key, JSON.stringify(value));
function elt(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function button(text, fn) {
  const n = elt("button", text);
  n.type = "button";
  n.onclick = () => Promise.resolve().then(fn).catch(showError);
  return n;
}
function picker(options, chosen, onChange, label) {
  const s = elt("select");
  s.setAttribute("aria-label", label);
  for (const [value, text] of options) {
    const o = elt("option", text);
    o.value = value;
    s.append(o);
  }
  s.value = String(chosen);
  s.onchange = () => Promise.resolve(onChange(s.value)).catch(showError);
  return s;
}
function modal(title, items) {
  $("panel-title").textContent = title;
  $("panel-body").replaceChildren(...items);
  if (!$("panel").open) $("panel").showModal();
}
function showError(error) {
  const msg = error?.message || String(error);
  workbench.line(msg, "error");
  modal("Message", [elt("p", msg)]);
}
$("panel-close").onclick = () => $("panel").close();
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" })),
    a = elt("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
async function choose(accept) {
  return new Promise((resolve) => {
    const input = $("file-input");
    input.value = "";
    input.accept = accept;
    input.onchange = () => resolve(input.files[0]);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
function tableQuery() {
  const day = state.days[state.selectedDay];
  return day
    ? "SELECT trips FROM (" +
        loomQuery +
        ") AS woven WHERE CAST(date AS DATE) = DATE '" +
        day.date +
        "' AND hour = " +
        state.selectedHour
    : "SELECT * FROM trips LIMIT 5";
}
async function makeLoom(query) {
  const clean = query.trim().replace(/;+\s*$/, "");
  const rows = await (
    await import("./database.js")
  ).sql(
    "SELECT CAST(CAST(date AS DATE) AS VARCHAR) AS date,hour,trips FROM (" +
      clean +
      ") AS woven ORDER BY date,hour",
    1489,
  );
  if (!rows.length || rows.length > 1488)
    throw Error("Select one to 62 days of hourly rows.");
  const days = new Map();
  for (const row of rows) {
    if (
      !row.date ||
      !Number.isInteger(row.hour) ||
      row.hour < 0 ||
      row.hour > 23 ||
      !Number.isFinite(row.trips) ||
      row.trips < 0
    )
      throw Error(
        "Use date, integer hour (0–23), and a nonnegative numeric trips column.",
      );
    const hours = days.get(row.date) || Array(24).fill(null);
    if (hours[row.hour] !== null)
      throw Error("Aggregate to one value per date and hour.");
    hours[row.hour] = row.trips;
    days.set(row.date, hours);
  }
  if ([...days.values()].some((hours) => hours.includes(null)))
    throw Error(
      "Select complete days or explicitly fill missing hours in SQL.",
    );
  state.days = [...days].map(([date, hours]) => ({ date, hours }));
  state.selectedDay = 0;
  loomTitle = "Local query";
  loomQuery = clean;
  setScene("loom");
}
function snapshot() {
  return {
    version: 1,
    speed: speedName ? { name: speedName, signal: signals[speedName] } : null,
    scene: state.scene,
    name: patchName,
    target: state.patch,
    signal: patchName ? signals[patchName] : null,
    marks: state.sketch,
  };
}
function restore(p) {
  if (p?.version !== 1 || !Object.hasOwn(sceneDefs, p.scene))
    throw Error("Unrecognized Phase Deck patch");
  const marks = validateMarks(p.marks || []);
  let sig = null;
  if (p.name) {
    if (!Object.hasOwn(targets, p.target)) throw Error("Unknown patch target");
    sig = validateSignal(p.name, p.signal?.values, p.signal?.unit);
  }
  const speed = p.speed
    ? validateSignal(p.speed.name, p.speed.signal?.values, p.speed.signal?.unit)
    : null;
  speedName = speed ? p.speed.name : "";
  if (speed) signals[speedName] = speed;
  if (sig) signals[p.name] = sig;
  state.sketch = marks;
  state.patch = sig ? p.target : "";
  patchName = sig ? p.name : "";
  state.signal = sig ? sig.values : [];
  state.time = 0;
  setScene(p.scene);
}
function preset(action, name) {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(name || ""))
    throw Error("Use a short patch name.");
  const saved = getStored("presets", {});
  if (action === "save") {
    Object.defineProperty(saved, name, {
      value: snapshot(),
      enumerable: true,
      configurable: true,
    });
    store("presets", saved);
  } else {
    if (!Object.hasOwn(saved, name)) throw Error("Unknown patch");
    restore(saved[name]);
  }
}
function apply(events) {
  const updates = [],
    sketches = [];
  for (const e of events) {
    if (e.type === "signal")
      updates.push([e.name, validateSignal(e.name, e.values, e.unit)]);
    else if (e.type === "sketch") sketches.push(validateMarks(e.marks));
    else throw Error("Unknown drawing event");
  }
  updates.forEach(([name, s]) => (signals[name] = s));
  if (patchName) state.signal = signals[patchName].values;
  if (sketches.length) {
    state.sketch = sketches.at(-1);
    setScene("feedback");
  }
  updateReadout();
  draw();
}
function patch(name, target) {
  if (!name) {
    speedName = "";
    patchName = "";
    state.patch = "";
    state.signal = [];
    updateReadout();
    draw();
    return;
  }
  if (!Object.hasOwn(signals, name) || !Object.hasOwn(targets, target))
    throw Error("Select a known signal and target.");
  if (target === "motion.speed") {
    speedName = name;
    updateReadout();
    return;
  }
  patchName = name;
  state.signal = signals[name].values;
  state.patch = target;
  setScene(targets[target]);
}
async function patchPanel() {
  if (!Object.keys(signals).length) throw Error("Loading data signals");
  const s = picker(
    Object.keys(signals).map((n) => [n, n]),
    patchName || "trip_hours",
    () => {},
    "Source signal",
  );
  const t = picker(
    Object.keys(targets).map((t) => [t, t]),
    state.patch || "dunes.height",
    () => {},
    "Destination",
  );
  const label = (name, field) => {
    const l = elt("label", name);
    l.append(field);
    return l;
  };
  const actions = elt("div", undefined, "panel-actions");
  actions.append(
    button("Apply patch", () => {
      patch(s.value, t.value);
      $("panel").close();
    }),
    button("Export patch", () =>
      download("instrument.phase.json", JSON.stringify(snapshot(), null, 2)),
    ),
    button("Import patch", async () => {
      const f = await choose(".json");
      if (f) {
        restore(JSON.parse(await f.text()));
        $("panel").close();
      }
    }),
  );
  const response = await fetch("./data/patches.json");
  if (!response.ok) throw Error("Could not load the starter patches");
  const starters = await response.json(),
    presets = getStored("presets", {});
  const choices = { ...starters, ...presets },
    names = Object.keys(choices);
  const saved = picker(
    names.map((n) => [n, n]),
    names[0],
    () => {},
    "Saved patches",
  );
  const savedRow = elt("div", undefined, "panel-actions");
  savedRow.append(
    saved,
    button("Recall patch", () => {
      restore(choices[saved.value]);
      $("panel").close();
    }),
  );
  modal("Patch signals", [
    label("Signal", s),
    label("Destination", t),
    actions,
    savedRow,
    elt(
      "p",
      "Publish a new signal with R, Python, or a SQL query in the terminal.",
      "hint",
    ),
  ]);
}
async function api(path, data, auth = true) {
  if (auth && !native)
    throw Error(
      "Open the private link printed by the Mac launcher to use native jobs.",
    );
  const r = await fetch(
    path,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : { cache: "no-store" },
  );
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Mac service unavailable");
  return j;
}
async function refreshJobs() {
  if (!native) return;
  try {
    const v = await api("/api/status");
    state.jobs = v.jobs;
    workspace = v.workspace;
    lastNativeError = "";
    const j = v.jobs.find((j) => Number.isFinite(j.bytes_per_second));
    if (j && (lastRateId !== j.id || lastRate !== j.bytes_per_second)) {
      const history =
        lastRateId === j.id ? signals.download_rate?.values || [] : [];
      lastRateId = j.id;
      lastRate = j.bytes_per_second;
      signals.download_rate = validateSignal(
        "download_rate",
        [...history.slice(-119), lastRate],
        "bytes/s",
      );
      if (patchName === "download_rate")
        state.signal = signals.download_rate.values;
    }
  } catch (e) {
    lastNativeError = "Monitor disconnected · last known state";
  }
  updateReadout();
  draw();
}
async function connect() {
  if (location.hostname !== "127.0.0.1") return;
  const key = new URLSearchParams(location.hash.slice(1)).get("session");
  if (key) history.replaceState(null, "", location.pathname + location.search);
  try {
    if (key) await api("/api/connect", { key }, false);
    const r = await fetch("/api/status", { cache: "no-store" });
    if (!r.ok || !r.headers.get("content-type")?.includes("application/json"))
      return;
    const result = await r.json();
    native = true;
    state.jobs = result.jobs;
    workspace = result.workspace;
    $("connection").textContent = "Mac Studio · local";
    updateReadout();
    setInterval(() => {
      if (!document.hidden) refreshJobs();
    }, 1700);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshJobs();
    });
  } catch (e) {
    if (key) workbench.line(e.message, "error");
  }
}
async function useJob(id) {
  const log = await api("/api/log?id=" + encodeURIComponent(id));
  const events = log.text
    .split("\n")
    .filter((x) => x.startsWith("@DECK@"))
    .map((x) => JSON.parse(x.slice(6)));
  if (!events.length)
    throw Error(
      "This job has no published instrument output in its recent log.",
    );
  apply(events);
}
function jobsPanel() {
  const items = [];
  if (lastNativeError) items.push(elt("p", lastNativeError, "error"));
  if (!native) {
    items.push(
      elt(
        "p",
        "Start Phase Deck on the Mac and open its private sign-in link to monitor native jobs.",
      ),
    );
  } else {
    items.push(
      elt("p", "Workspace · " + workspace, "hint"),
      button("Run pulse.py", async () => {
        const { id } = await api("/api/jobs", {
          kind: "run",
          path: "pulse.py",
        });
        await refreshJobs();
        selectedJob = id;
        jobsPanel();
      }),
    );
    for (const job of state.jobs) {
      const b = button(job.label + " · " + job.status, async () => {
        selectedJob = job.id;
        const log = await api("/api/log?id=" + job.id);
        modal(job.label, [
          elt(
            "p",
            [job.status, job.stage, job.id].filter(Boolean).join(" · "),
            "hint",
          ),
          elt("pre", log.text || "No output yet.", "log-output"),
          ...(log.text.includes("@DECK@")
            ? [
                button("Use published output", async () => {
                  await useJob(job.id);
                  await patchPanel();
                }),
              ]
            : []),
          button("Solo waveform", () => {
            $("panel").close();
            setScene("jobs");
          }),
        ]);
      });
      b.className = "job-row";
      items.push(b);
    }
    if (!state.jobs.length) items.push(elt("p", "No recorded jobs yet."));
  }
  modal("Job monitor", items);
}
function calendarRestore() {
  const list = getStored("calendar", null);
  if (Array.isArray(list)) {
    state.events = list;
    calendarSource = "Local calendar";
    return;
  }
  fetch("./data/calendar.json")
    .then((r) => r.json())
    .then((v) => {
      calendarAnchor = getStored("calendarAnchor", 0);
      if (!calendarAnchor || Date.now() - calendarAnchor > 86400000) {
        calendarAnchor = Math.floor(Date.now() / 3600000) * 3600000;
        store("calendarAnchor", calendarAnchor);
      }
      if (calendarSource !== "Example schedule") return;
      state.events = v.events.map((e) => ({
        start: new Date(calendarAnchor + e.inMinutes * 60000).toISOString(),
        end: new Date(
          calendarAnchor + (e.inMinutes + e.duration) * 60000,
        ).toISOString(),
      }));
      draw();
    })
    .catch(showError);
}
async function importCalendar() {
  const f = await choose(".json");
  if (!f) return;
  const v = JSON.parse(await f.text());
  const items = Array.isArray(v) ? v : v.events;
  if (!Array.isArray(items) || items.length > 2000)
    throw Error(
      "Use a JSON array of up to 2,000 events with start and end timestamps.",
    );
  const cleaned = items.map((e) => {
    if (
      ![e.start, e.end].every(
        (t) =>
          typeof t === "string" &&
          /(Z|[+-]\d\d:\d\d)$/i.test(t) &&
          Number.isFinite(Date.parse(t)),
      ) ||
      Date.parse(e.end) <= Date.parse(e.start)
    )
      throw Error("Each event needs start and end timestamps with time zones.");
    return { start: e.start, end: e.end };
  });
  store("calendar", cleaned);
  state.events = cleaned;
  calendarSource = "Local calendar";
  updateReadout();
  draw();
}
async function loadRadar() {
  const epoch = ++radarEpoch;
  if (radarMode === "live") lastWall = Date.now();
  radarLoading = true;
  radarSelection = null;
  try {
    const r = radarMode === "live" ? await latest() : await archive(radarIndex);
    if (epoch !== radarEpoch) return;
    state.radar = r;
    radarError = "";
  } catch (e) {
    if (epoch !== radarEpoch) return;
    radarError = "Source unavailable · " + e.message;
  } finally {
    if (epoch === radarEpoch) {
      radarLoading = false;
      updateReadout();
      draw();
    }
  }
}
function radarOriginal() {
  if (!state.radar) throw Error("No observation loaded yet.");
  const img = elt("img");
  img.src = state.radar.raw;
  img.alt =
    "Original north-up IEM base-reflectivity mosaic around Jackson, Mississippi";
  img.className = "radar-original";
  const a = elt("a", "IEM source frame");
  a.href = state.radar.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  modal("Observed radar", [
    img,
    elt("p", state.radar.at + " · North up · Jackson region"),
    a,
    elt(
      "p",
      "Transparent areas indicate no visible echoes or unknown coverage. The abstract view uses each cell’s peak palette-matched reflectivity.",
      "hint",
    ),
  ]);
}
function controlBar() {
  const list = [];
  const tip = (t) => elt("span", t, "hint");
  if (state.scene === "clock")
    list.push(
      button(displayTime ? "Hide digits" : "Show digits", () => {
        displayTime = !displayTime;
        controlBar();
        updateReadout();
      }),
      tip(Intl.DateTimeFormat().resolvedOptions().timeZone),
    );
  if (state.scene === "rain") {
    list.push(
      picker(
        [
          ["archive", "Storm archive"],
          ["live", "Latest observation"],
        ],
        radarMode,
        (v) => {
          radarMode = v;
          radarPlaying = false;
          controlBar();
          loadRadar();
        },
        "Radar source",
      ),
    );
    if (radarMode === "archive") {
      list.push(
        button("Previous", () => {
          radarIndex = (radarIndex + 5) % 6;
          loadRadar();
        }),
        button(radarPlaying ? "Stop replay" : "Replay storm", () => {
          radarPlaying = !radarPlaying;
          controlBar();
        }),
        button("Next", () => {
          radarIndex = (radarIndex + 1) % 6;
          loadRadar();
        }),
      );
    } else list.push(button("Refresh", loadRadar));
    list.push(
      button("Source frame", radarOriginal),
      tip("North up · Jackson, MS"),
    );
  }
  if (state.scene === "loom")
    list.push(
      button("Inspect sample", () =>
        modal("Hourly pickup count", [
          elt("p", $("readout").textContent),
          elt("pre", tableQuery(), "log-output"),
          button("Open SQL", () => {
            $("panel").close();
            workbench.seed("sql " + tableQuery());
          }),
        ]),
      ),
      button("Open Parquet", async () => {
        const f = await choose(".parquet");
        if (f) {
          await (await import("./database.js")).addFile(f);
          workbench.seed("sql SELECT * FROM user_data LIMIT 5");
          workbench.line(
            "To weave your table: loom SELECT date, hour, trips FROM user_data",
          );
        }
      }),
      tip("Select a strand to inspect its hour"),
    );
  if (state.scene === "jobs")
    list.push(
      button("Job history", jobsPanel),
      button("All waveforms", () => {
        selectedJob = "";
        draw();
        updateReadout();
      }),
    );
  if (state.scene === "feedback")
    list.push(
      button("Edit sketch", () => workbench.edit("shell.py")),
      button("Replay patch", replay),
      button(paused ? "Resume" : "Freeze", freeze),
    );
  if (state.scene === "calendar")
    list.push(
      button("Import calendar JSON", importCalendar),
      button("Inspect schedule", () =>
        modal(calendarSource, [
          ...state.events.map((e) =>
            elt(
              "p",
              shortTime.format(Date.parse(e.start)) +
                " – " +
                shortTime.format(Date.parse(e.end)),
            ),
          ),
        ]),
      ),
      tip("Titles hidden in ambient view"),
    );
  if (["silk", "dunes", "orbit"].includes(state.scene))
    list.push(
      button("Map a signal", patchPanel),
      tip(
        state.scene === "dunes"
          ? "Select a ridge to inspect a mapped value"
          : "Select a signal to shape the motion",
      ),
    );
  $("instrument-controls").replaceChildren(...list);
}
function setScene(id) {
  radarSelection = null;
  if (!Object.hasOwn(sceneDefs, id))
    throw Error("Choose one of " + Object.keys(sceneDefs).join(", "));
  state.scene = id;
  $("title").textContent = sceneDefs[id][0];
  $("category").textContent = sceneDefs[id][1];
  for (const b of $("library").children)
    b.setAttribute("aria-current", String(b.dataset.id === id));
  stage.setAttribute("aria-label", sceneDefs[id][0] + " generative instrument");
  controlBar();
  updateReadout();
  draw();
  if (id === "rain" && !state.radar && !radarLoading) loadRadar();
}
function activeJobs() {
  return state.jobs.filter((j) =>
    ["queued", "watching", "running", "waiting"].includes(j.status),
  );
}
function updateReadout() {
  let text = "",
    sub = "";
  const scene = state.scene;
  if (scene === "clock") {
    text = displayTime
      ? stamp.format(state.now)
      : calendarDate.format(state.now);
    sub = "Mint · minutes   /   Apricot · hours";
  }
  if (scene === "loom") {
    const d = state.days[state.selectedDay];
    if (d) {
      text = d.hours[state.selectedHour].toLocaleString() + " pickups";
      sub =
        d.date +
        " · " +
        String(state.selectedHour).padStart(2, "0") +
        ":00 · " +
        loomTitle;
    }
  }
  if (scene === "rain") {
    const r = state.radar,
      old =
        r?.source === "Live observation" &&
        Date.now() - Date.parse(r.at) > 15 * 60000;
    text =
      radarError ||
      (radarLoading
        ? "Loading observation"
        : r
          ? r.source + (old ? " · stale" : "")
          : "Loading radar");
    sub = r
      ? (radarError || radarLoading ? r.source + " · " : "") +
        r.at.replace("T", " ").replace(/\.000Z|Z$/, " UTC") +
        (radarSelection ? " · " + radarSelection : "")
      : "";
  }
  if (scene === "calendar") {
    const upcoming = state.events.filter(
      (e) =>
        Date.parse(e.end) > Date.now() &&
        Date.parse(e.start) < Date.now() + 86400000,
    );
    text = upcoming.length + " time block" + (upcoming.length === 1 ? "" : "s");
    sub = calendarSource + " · next 24 hours";
  }
  if (scene === "jobs") {
    const j = state.jobs.find((j) => j.id === selectedJob);
    text = j ? j.label : activeJobs().length + " active jobs";
    sub =
      lastNativeError ||
      (j
        ? [j.status, j.stage].filter(Boolean).join(" · ")
        : native
          ? "Local job history"
          : "Browser studio · native jobs available on the Mac");
  }
  if (["orbit", "silk", "dunes", "feedback"].includes(scene)) {
    text =
      state.patch && targets[state.patch] === scene
        ? patchName + " → " + state.patch
        : scene === "feedback"
          ? (state.sketch.length || 0) + " custom marks"
          : "Ambient motion";
    sub =
      scene === "feedback"
        ? "Feedback buffer · " + (paused ? "frozen" : "live")
        : sceneDefs[scene][1];
    if (scene === "dunes" && targets[state.patch] === scene && radarSelection)
      sub = radarSelection;
  }
  $("readout").textContent = text;
  $("detail").textContent = sub;
  const current = activeJobs()[0];
  $("job-readout").textContent =
    lastNativeError ||
    (current
      ? [
          current.label,
          current.stage || current.status,
          Number.isFinite(current.progress)
            ? Math.round(current.progress * 100) + "%"
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : state.jobs.length + " recorded");
  $("patch-readout").textContent =
    [
      state.patch ? patchName + " → " + state.patch : "",
      speedName ? speedName + " → motion.speed" : "",
    ]
      .filter(Boolean)
      .join(" · ") || "No signal patched";
}
function draw() {
  if (!w || !ctx) return;
  const rendered =
    selectedJob && state.scene === "jobs"
      ? { ...state, jobs: state.jobs.filter((j) => j.id === selectedJob) }
      : state;
  paint(ctx, w, h, rendered);
  if (measureFrames) window.dispatchEvent(new Event("phase-frame"));
}
function resize() {
  const box = stage.getBoundingClientRect();
  w = box.width;
  h = box.height;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  stage.width = Math.round(w * dpr);
  stage.height = Math.round(h * dpr);
  ctx.setTransform(stage.width / w, 0, 0, stage.height / h, 0, 0);
  draw();
}
function tick(now) {
  if (!visible || document.hidden) {
    raf = 0;
    return;
  }
  const interval = paused ? 1000 : 1000 / 24;
  if (previous === null || now + 0.5 >= due) {
    due =
      previous === null || now - due > interval
        ? now + interval
        : due + interval;
    const dt = previous === null ? 0 : Math.min((now - previous) / 1000, 0.25);
    previous = now;
    if (!paused) {
      relativePhase += dt;
      let speed = 1;
      if (speedName) {
        const series = signals[speedName].values;
        const i =
          speedName === "download_rate"
            ? series.length - 1
            : Math.floor(relativePhase) % series.length;
        speed =
          0.12 +
          (1.8 * Math.abs(series[i])) / Math.max(1, ...series.map(Math.abs));
      }
      state.time += dt * speed;
    }
    state.now = new Date();
    if (!paused || state.scene === "clock" || state.scene === "calendar")
      draw();
    if (now - lastReadout > 700) {
      updateReadout();
      lastReadout = now;
      updateAudio();
    }
  }
  if (paused) {
    raf = 0;
    return;
  }
  raf = requestAnimationFrame(tick);
}
function restart() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  previous = null;
  if (visible && !document.hidden) raf = requestAnimationFrame(tick);
}
function setPause(value) {
  paused = value;
  $("pause").textContent = paused ? "Resume motion" : "Pause motion";
  $("pause").setAttribute("aria-pressed", String(paused));
  controlBar();
  updateReadout();
  restart();
}
function freeze() {
  setPause(!paused);
}
function replay() {
  state.time = 0;
  relativePhase = 0;
  state.sketch = [...state.sketch];
  if (paused) setPause(false);
  else draw();
}
function updateAudio() {
  if (!osc) return;
  const values = state.signal,
    idx = Math.floor(state.time) % Math.max(1, values.length);
  const x = values.length
    ? Math.min(1, Math.abs(values[idx]) / Math.max(1, ...values.map(Math.abs)))
    : state.now.getMinutes() / 60;
  osc.frequency.setTargetAtTime(110 * Math.pow(2, x), audio.currentTime, 0.35);
}
async function toggleAudio() {
  if (audio) {
    const old = audio;
    audio = null;
    osc = null;
    gain = null;
    await old.close();
  } else {
    audio = new AudioContext();
    await audio.resume();
    gain = audio.createGain();
    gain.gain.value = volume;
    gain.connect(audio.destination);
    osc = audio.createOscillator();
    osc.type = "sine";
    osc.connect(gain);
    osc.start();
    updateAudio();
  }
  $("audio").textContent = audio ? "Mute sound" : "Sound off";
  $("audio").setAttribute("aria-pressed", String(!!audio));
  let slider = $("volume");
  if (audio && !slider) {
    const l = elt("label", "Volume");
    l.id = "volume";
    const v = elt("input");
    v.type = "range";
    v.min = 0;
    v.max = 0.12;
    v.step = 0.002;
    v.value = volume;
    v.setAttribute("aria-label", "Master volume");
    v.oninput = () => {
      volume = Number(v.value);
      gain?.gain.setTargetAtTime(volume, audio.currentTime, 0.03);
    };
    l.append(v);
    $("audio").after(l);
  } else if (!audio) slider?.remove();
}
const workbench = setupConsole({
  signals: () => signals,
  apply,
  patch,
  scene: setScene,
  preset,
  freeze,
  replay,
  download,
  useJob,
  makeLoom,
  jobs: () => state.jobs,
  api,
  refreshJobs,
});
for (const [id, [name, , glyph]] of Object.entries(sceneDefs)) {
  const b = button("", () => setScene(id));
  const i = elt("i", glyph);
  i.setAttribute("aria-hidden", "true");
  b.dataset.id = id;
  b.append(i, elt("span", name));
  $("library").append(b);
}
$("audio").onclick = () => toggleAudio().catch(showError);
$("pause").onclick = freeze;
$("patch-button").onclick = () => patchPanel().catch(showError);
$("jobs-button").onclick = jobsPanel;
function focusMode() {
  const f = document.body.classList.toggle("focus");
  $("unfocus").hidden = !f;
  $("focus").setAttribute("aria-pressed", String(f));
}
$("focus").onclick = $("unfocus").onclick = focusMode;
stage.onclick = (e) => {
  const rect = stage.getBoundingClientRect();
  const shown =
    selectedJob && state.scene === "jobs"
      ? { ...state, jobs: state.jobs.filter((j) => j.id === selectedJob) }
      : state;
  const data = inspect(
    (e.clientX - rect.left) / rect.width,
    (e.clientY - rect.top) / rect.height,
    shown,
  );
  if (!data) return;
  if (state.scene === "loom") {
    state.selectedDay = data.day;
    state.selectedHour = data.hour;
  }
  if (state.scene === "rain") {
    const value = state.radar.levels[data.row * state.radar.cols + data.col];
    radarSelection =
      value === null
        ? "No visible echo · coverage unknown"
        : value + " dBZ peak";
  }
  if (state.scene === "jobs") selectedJob = data.job.id;
  if (state.scene === "dunes")
    radarSelection =
      "Bin " + data.hour + " · " + data.value + " " + signals[patchName]?.unit;
  if (state.scene === "calendar")
    modal("Busy interval", [
      elt(
        "p",
        new Date(data.event.start).toLocaleString() +
          " – " +
          new Date(data.event.end).toLocaleString(),
      ),
    ]);
  draw();
  updateReadout();
};
let heldSource = false;
document.addEventListener("keydown", (e) => {
  if (
    e.target.closest("input,select,textarea,[contenteditable],.xterm") ||
    !$("drawer").hidden
  )
    return;
  if (
    e.key === "Escape" &&
    document.body.classList.contains("focus") &&
    !$("panel").open
  )
    focusMode();
  if (
    e.key === "o" &&
    state.scene === "rain" &&
    !e.repeat &&
    state.radar &&
    !$("panel").open
  ) {
    heldSource = true;
    radarOriginal();
  }
  if (e.key === "t" && state.scene === "clock") {
    displayTime = !displayTime;
    controlBar();
    updateReadout();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key === "o" && heldSource) {
    heldSource = false;
    $("panel").close();
  }
});
new ResizeObserver(resize).observe(stage);
new IntersectionObserver((entries) => {
  visible = entries[0].isIntersecting;
  restart();
}).observe(stage);
document.addEventListener("visibilitychange", restart);
reduce.addEventListener("change", (e) => setPause(e.matches));
setInterval(() => {
  if (document.hidden) return;
  if (paused) {
    state.now = new Date();
    updateReadout();
    if (["calendar", "clock"].includes(state.scene)) draw();
  }
  if (state.scene === "rain" && !radarLoading) {
    if (radarPlaying && radarMode === "archive") {
      radarIndex = (radarIndex + 1) % 6;
      loadRadar();
    } else if (radarMode === "live" && Date.now() - lastWall >= 300000) {
      lastWall = Date.now();
      loadRadar();
    }
  }
}, 1800);
fetch("./data/days.json")
  .then((r) => r.json())
  .then((days) => {
    state.days = days;
    signals.trip_hours = validateSignal(
      "trip_hours",
      Array.from({ length: 24 }, (_, i) =>
        days.reduce((n, d) => n + d.hours[i], 0),
      ),
      "trips",
    );
    updateReadout();
    draw();
  })
  .catch(showError);
calendarRestore();
setScene("clock");
setPause(paused);
connect().catch(showError);
