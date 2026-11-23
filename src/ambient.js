import { jobCard, jobStatus, workActivity, workOutcome } from "./jobs.js";

export function workDisplay() {
  let current = "", initialized = false, stale = false, previousServerTime = 0;
  let jobs = [];
  let previous = new Map();
  let pending = [];
  let cue;
  const seen = new Set();

  function ingest(snapshot, serverTime) {
    const anchor = Date.parse(serverTime);
    const last = previous;
    previous = new Map(snapshot.map((job) => [job.id, job]));
    jobs = snapshot.filter(workActivity);
    if (initialized) {
      for (const job of snapshot) {
        if (!workOutcome(job) || seen.has(job.id)) continue;
        const old = last.get(job.id);
        const finished = Date.parse(job.finished);
        if ((old && !workOutcome(old)) ||
          (!old && previousServerTime && finished >= previousServerTime)) {
          seen.add(job.id);
          pending.push(job);
        }
      }
    } else {
      pending = [];
      cue = null;
      current = "";
      initialized = true;
    }
    previousServerTime = Number.isFinite(anchor) ? anchor : 0;
    stale = false;
  }

  function tick(now) {
    if (stale) return { stale, job: previous.get(current) || cue?.job, held: false };
    if (cue && now < cue.until) return { job: cue.job, held: true, cue: true };
    cue = null;
    const active = jobs.find((job) => job.id === current);
    const finished = pending.findIndex((job) => job.id === current);
    if (finished >= 0 || (!active && pending.length)) {
      const [job] = pending.splice(Math.max(0, finished), 1);
      current = "";
      cue = { job, until: now + 5000 };
      return { job, held: true, cue: true };
    }
    const download = jobs.find((job) => job.kind === "download" ||
      Number.isFinite(job.bytes_per_second));
    const job = active?.kind === "download" ? active : download || active || jobs[0];
    current = job?.id || "";
    return { job, held: !!job };
  }

  return {
    ingest, tick,
    disconnect() {
      initialized = false;
      stale = true;
    },
  };
}

const defaults = {
  dwell: 60,
  favorites: ["clock", "silk", "orbit"].map((id) => ({ type: "scene", id })),
};

export function setupAmbient(ui, options) {
  const { elt, button, picker, modal, getStored, store } = ui;
  const display = new URLSearchParams(location.search).get("view") === "ambient";
  const work = workDisplay();
  const status = jobCard(elt);
  const announcement = elt("p", undefined, "visually-hidden");
  announcement.setAttribute("role", "status");
  const { overlay, sceneDefs, controls } = options;
  let previousCue = "";
  let settings = getStored("ambient", defaults);
  let elapsed = 0, last = null, index = 0, held = false;

  function all() {
    return [
      ...Object.entries(sceneDefs).map(([id, [name]]) => ({ id, name, type: "scene" })),
      ...options.compositions().map(({ id, name }) => ({ id, name, type: "composition" })),
    ];
  }

  const key = (item) => item.type + "/" + item.id;
  const name = (item) => all().find((candidate) => key(candidate) === key(item))?.name || "Missing composition";
  function playlist() {
    const available = new Set(all().map(key));
    return settings.favorites.filter((item) => available.has(key(item)));
  }

  function addFavorite(item) {
    settings = getStored("ambient", defaults);
    if (!settings.favorites.some((favorite) => key(favorite) === key(item))) {
      settings = { ...settings, favorites: [...settings.favorites, { type: item.type, id: item.id }] };
      store("ambient", settings);
    }
  }

  function configure() {
    settings = getStored("ambient", defaults);
    const choices = all();
    const choice = picker(choices.map((item) => [key(item), item.name]), key(choices[0]), () => {}, "Favorite to add");
    const rows = elt("ol", undefined, "ambient-favorites");
    for (const [i, item] of settings.favorites.entries()) {
      const row = elt("li");
      row.append(elt("span", name(item)));
      const move = (next) => {
        [settings.favorites[i], settings.favorites[next]] = [settings.favorites[next], settings.favorites[i]];
        store("ambient", settings);
        configure();
      };
      const up = button("Move up", () => move(i - 1));
      const down = button("Move down", () => move(i + 1));
      up.disabled = i === 0;
      down.disabled = i === settings.favorites.length - 1;
      for (const [control, label] of [[up, "Move up"], [down, "Move down"]]) {
        control.setAttribute("aria-label", label + " " + name(item));
      }
      row.append(up, down, button("Remove", () => {
        settings.favorites.splice(i, 1);
        store("ambient", settings);
        configure();
      }));
      rows.append(row);
    }
    const add = elt("div", undefined, "panel-actions");
    add.append(choice, button("Add favorite", () => {
      const item = choices.find((candidate) => key(candidate) === choice.value);
      if (item) addFavorite(item);
      configure();
    }));
    const optionsRow = elt("div", undefined, "panel-actions");
    optionsRow.append(button("Open ambient display", () => {
      const url = new URL(location.href);
      url.search = "?view=ambient";
      url.hash = "";
      window.open(url, "phase-deck-ambient", "popup,width=1100,height=720")?.focus();
    }));
    modal("Ambient display", [
      optionsRow,
      ui.label("Time per favorite", picker([["30", "30 seconds"], ["60", "60 seconds"], ["120", "120 seconds"]],
        settings.dwell, (value) => {
          settings.dwell = Number(value);
          store("ambient", settings);
        }, "Time per favorite")),
      rows, add,
    ]);
  }

  function select() {
    const favorites = playlist();
    if (index >= favorites.length) index = 0;
    options.select(favorites[index] || { type: "scene", id: "clock" });
  }

  function tick(now = performance.now()) {
    if (!display) return;
    const active = work.tick(now);
    overlay.hidden = !active.job && !active.stale;
    if (!overlay.hidden) status.show(active.job, { stale: active.stale });
    overlay.classList.toggle("completion", !!active.cue);
    const cueKey = active.cue ? active.job.id : "";
    if (cueKey && cueKey !== previousCue) announcement.textContent = active.job.label + " · " + jobStatus(active.job.status);
    previousCue = cueKey;
    if (last !== null && !options.paused() && !document.hidden && !held && !active.held) {
      elapsed += Math.min(now - last, 500);
      if (elapsed >= settings.dwell * 1000) {
        elapsed = 0;
        const count = playlist().length;
        if (count > 1) {
          index = (index + 1) % count;
          select();
        }
      }
    }
    last = now;
    held = active.held;
  }

  function initialize() {
    if (!display) return;
    document.body.classList.add("ambient-display", "focus");
    overlay.append(status.card, announcement);
    const pause = button("Pause motion", () => { options.togglePause(); syncPause(); });
    function syncPause() {
      pause.textContent = options.paused() ? "Resume motion" : "Pause motion";
      pause.setAttribute("aria-pressed", String(options.paused()));
    }
    controls.append(pause, button("Full screen", async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    }), button("Music input", options.music), button("Studio", () => { location.href = location.pathname; }));
    syncPause();
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => queueMicrotask(syncPause));
    addEventListener("storage", (event) => {
      if (event.key === "phase-deck-ambient") {
        const selected = playlist()[index];
        settings = getStored("ambient", defaults);
        const next = selected && playlist().findIndex((item) => key(item) === key(selected));
        if (next >= 0) index = next;
        else { index = 0; elapsed = 0; select(); }
      }
      if (event.key === "phase-deck-compositions" && playlist()[index]?.type === "composition") select();
    });
    select();
    setInterval(tick, 200);
  }

  return {
    display, configure, initialize, addFavorite,
    ingest(jobs, now) { if (display) { work.ingest(jobs, now || new Date().toISOString()); tick(); } },
    disconnect() { if (display) { work.disconnect(); tick(); } },
  };
}
