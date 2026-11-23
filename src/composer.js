import { paint, inspect } from "./art.mjs";
import { histogram } from "./explorer.js";
import { jobCard, workActivity } from "./jobs.js";
import { musicPalettes, musicStyles } from "./music.js";
import { targets } from "./signals.js";

const maxLayers = 6;
const blendModes = [["normal", "Normal"], ["screen", "Screen"], ["multiply", "Multiply"]];
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const copyData = (value) => JSON.parse(JSON.stringify(value));
const id = () => crypto.randomUUID();

export function setupComposer(ui, options) {
  const { elt, button, picker, label, getStored, store, modal } = ui;
  const { stack, tools, sceneDefs, music } = options;
  const sceneChoices = Object.entries(sceneDefs).map(([key, [name]]) => [key, name]);
  const types = [...sceneChoices, ["job-card", "Job status card"]];
  const views = new Map();
  let working, remembered, selected, editing = false, gesture;
  let insertion = "silk";
  let settingsPane;
  let nameBox;
  let message;
  let addButton;
  let favoriteMessage;

  const saved = () => getStored("compositions", []).filter((c) => c?.version === 1);
  const layerName = (layer) =>
    layer.kind === "histogram" ? "Histogram · " + layer.histogram.field :
      types.find(([kind]) => layer.kind === kind)?.[1] || layer.kind;
  const active = () => !!working;
  const isEditing = () => editing && active();
  const has = (kind) => !!working?.layers.some((layer) => layer.kind === kind && layer.visible);
  function make(kind, full = false, overrides = {}) {
    return {
      id: id(), kind, x: full ? 0 : 0.23, y: full ? 0 : 0.23,
      w: full ? 1 : 0.54, h: full ? 1 : 0.54, opacity: 1, blend: "normal",
      visible: true, background: full, patch: "", source: "", signal: null,
      music: { ...music.settings }, ...overrides,
    };
  }

  function update() {
    const layers = working?.layers || [];
    for (const [key, view] of views) {
      if (!layers.some((layer) => layer.id === key)) {
        view.box.remove();
        views.delete(key);
      }
    }
    stack.hidden = !active();
    tools.hidden = !isEditing();
    stack.classList.toggle("editing", isEditing());
    if (active()) {
      for (const layer of layers) {
        const view = views.get(layer.id) || createView(layer);
        layout(layer, view);
      }
      const boxes = layers.map((layer) => views.get(layer.id).box);
      if (boxes.some((box, index) => stack.children[index] !== box)) stack.replaceChildren(...boxes);
    }
    panel();
    options.changed();
  }

  function layout(layer, view) {
    const { box, content, handle } = view;
    for (const [property, value] of Object.entries({ left: layer.x, top: layer.y, width: layer.w, height: layer.h })) {
      box.style[property] = (value * 100) + "%";
    }
    box.style.mixBlendMode = layer.blend;
    content.style.opacity = layer.opacity;
    box.hidden = !layer.visible;
    box.classList.toggle("selected-layer", isEditing() && selected === layer.id);
    handle.hidden = !isEditing() || selected !== layer.id;
  }

  function createView(layer) {
    const box = elt("div", undefined, "composition-layer");
    const content = elt("div", undefined, "layer-content");
    const handle = elt("button", "", "resize-layer");
    handle.type = "button";
    handle.setAttribute("aria-label", "Resize " + layerName(layer));
    let context, job, chart;
    if (layer.kind === "job-card") {
      job = jobCard(elt);
      content.append(job.card);
    } else if (layer.kind === "histogram") {
      chart = histogram(elt, layer.histogram);
      content.append(chart);
    } else {
      const canvas = elt("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", layerName(layer));
      context = canvas.getContext("2d");
      content.append(canvas);
    }
    box.append(content, handle);
    box.onpointerdown = (event) => pointerDown(event, layer.id, event.target === handle);
    box.onclick = (event) => {
      if (isEditing() || !context) return;
      const current = working?.layers.find((item) => item.id === layer.id);
      if (!current) return;
      const rect = box.getBoundingClientRect();
      const data = inspect((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height,
        options.layerState(current));
      if (data) options.inspect(current, data);
    };
    const view = { box, content, handle, context, job };
    views.set(layer.id, view);
    return view;
  }

  function pointerDown(event, key, resizing) {
    if (!isEditing() || event.button !== 0) return;
    const layer = working.layers.find((item) => item.id === key);
    const rect = stack.getBoundingClientRect();
    const box = views.get(key).box;
    event.preventDefault();
    selected = key;
    gesture = { pointer: event.pointerId, layer, resizing, rect, start: { ...layer }, x: event.clientX, y: event.clientY };
    box.setPointerCapture(event.pointerId);
    for (const item of working.layers) layout(item, views.get(item.id));
    panel();
  }

  stack.onpointermove = (event) => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const { layer, start, resizing, rect, x, y } = gesture;
    const dx = (event.clientX - x) / rect.width, dy = (event.clientY - y) / rect.height;
    if (resizing) {
      layer.w = clamp(start.w + dx, 0.08, 1 - layer.x);
      layer.h = clamp(start.h + dy, 0.08, 1 - layer.y);
    } else {
      layer.x = clamp(start.x + dx, 0, 1 - layer.w);
      layer.y = clamp(start.y + dy, 0, 1 - layer.h);
    }
    layout(layer, views.get(layer.id));
    options.redraw();
  };
  stack.onlostpointercapture = (event) => {
    if (gesture?.pointer !== event.pointerId) return;
    gesture = null;
    panel();
  };

  function paintLayers(width, height) {
    for (const layer of working?.layers || []) {
      if (!layer.visible) continue;
      const view = views.get(layer.id);
      if (view.job) {
        const jobs = options.jobs();
        const selectedJob = layer.jobId
          ? jobs.find((job) => job.id === layer.jobId)
          : jobs.find((job) => job.kind === "download" && workActivity(job)) || jobs.find(workActivity);
        view.job.show(selectedJob, { stale: !!options.connectionError() });
      }
      if (!view.context) continue;
      const w = Math.max(width * layer.w, 1), h = Math.max(height * layer.h, 1);
      const ratio = Math.min(devicePixelRatio || 1, 1.25, Math.sqrt(1800000 / (w * h)));
      const pixelsX = Math.max(1, Math.round(w * ratio)), pixelsY = Math.max(1, Math.round(h * ratio));
      const canvas = view.context.canvas;
      if (canvas.width !== pixelsX || canvas.height !== pixelsY) {
        canvas.width = pixelsX;
        canvas.height = pixelsY;
      }
      view.context.setTransform(pixelsX / w, 0, 0, pixelsY / h, 0, 0);
      paint(view.context, w, h, options.layerState(layer), layer.background);
    }
  }

  function start() {
    if (editing) {
      editing = false;
      update();
      return;
    }
    if (!working) {
      working = remembered || { name: "Untitled composition", layers: [options.initial(make)] };
    }
    editing = true;
    selected = working.layers.find((layer) => layer.id === selected)?.id || working.layers.at(-1)?.id;
    buildPanel();
    update();
  }

  function leave() {
    if (!working) return;
    if (editing || !options.display()) remembered = working;
    working = null;
    editing = false;
    gesture = null;
    update();
  }

  function show(key, edit = false) {
    const composition = saved().find((item) => item.id === key);
    if (!composition) return false;
    working = copyData(composition);
    selected = working.layers.at(-1)?.id;
    editing = edit;
    if (edit) buildPanel();
    update();
    return true;
  }

  function add(kind, overrides) {
    if (!editing) start();
    if (working.layers.length >= maxLayers) throw Error("Remove a layer before adding another.");
    const layer = make(kind, !working.layers.length, overrides);
    working.layers.push(layer);
    selected = layer.id;
    update();
  }

  function change(layer, values, rebuild = false) {
    Object.assign(layer, values);
    layout(layer, views.get(layer.id));
    if (rebuild) panel();
    options.changed();
  }

  function field(name, value, min, max, callback) {
    const input = elt("input");
    input.type = "number";
    input.min = min;
    input.max = max;
    input.step = 1;
    input.value = Math.round(value);
    input.onchange = () => callback(clamp(input.valueAsNumber || min, min, max));
    return label(name, input);
  }

  function inspector(layer, index) {
    const items = elt("div", undefined, "layer-inspector");
    const dimensions = elt("div", undefined, "layer-dimensions");
    dimensions.append(
      field("Left %", layer.x * 100, 0, Math.round((1 - layer.w) * 100), (x) => change(layer, { x: Math.min(x / 100, 1 - layer.w) })),
      field("Top %", layer.y * 100, 0, Math.round((1 - layer.h) * 100), (y) => change(layer, { y: Math.min(y / 100, 1 - layer.h) })),
      field("Width %", layer.w * 100, 8, Math.round((1 - layer.x) * 100), (w) => change(layer, { w: Math.min(w / 100, 1 - layer.x) }, true)),
      field("Height %", layer.h * 100, 8, Math.round((1 - layer.y) * 100), (h) => change(layer, { h: Math.min(h / 100, 1 - layer.y) }, true)),
      field("Opacity %", layer.opacity * 100, 0, 100, (opacity) => change(layer, { opacity: opacity / 100 })),
    );
    items.append(dimensions, label("Blend", picker(blendModes, layer.blend, (blend) => change(layer, { blend }), "Blend mode")));
    if (layer.kind === "job-card") {
      const jobs = options.jobs().map(({ id, label: text }) => [id, text + " · " + id.slice(0, 6)]);
      if (layer.jobId && !jobs.some(([id]) => id === layer.jobId)) jobs.push([layer.jobId, "Earlier job"]);
      items.append(label("Job source", picker([["", "Current activity"], ...jobs], layer.jobId || "", (jobId) => change(layer, { jobId }), "Job source")));
    } else if (layer.kind === "music") {
      const sources = music.sources();
      if (!sources.some(([value]) => value === layer.music.source)) sources.push([layer.music.source, "Saved live source · unavailable"]);
      items.append(
        label("Audio source", picker(sources, layer.music.source, (source) => change(layer, { music: { ...layer.music, source } }), "Layer audio source")),
        label("Aesthetic", picker(musicStyles, layer.music.style, (style) => change(layer, { music: { ...layer.music, style } }), "Layer aesthetic")),
        label("Palette", picker(musicPalettes, layer.music.palette, (palette) => change(layer, { music: { ...layer.music, palette } }), "Layer palette")),
        field("Sensitivity %", layer.music.sensitivity * 100, 25, 300, (sensitivity) => change(layer, { music: { ...layer.music, sensitivity: sensitivity / 100 } })),
      );
    } else if (layer.kind !== "histogram") {
      const patch = Object.keys(targets).find((name) => targets[name] === layer.kind);
      if (patch) {
        const signals = options.signals();
        const choices = Object.keys(signals).map((name) => [name, name]);
        if (layer.source && !choices.some(([name]) => name === layer.source)) choices.push([layer.source, layer.source]);
        items.append(label("Signal source", picker([["", "Procedural"], ...choices], layer.source, (source) =>
          change(layer, { source, patch: source ? patch : "", signal: source ? signals[source] || layer.signal : null }), "Layer signal")));
      }
    }
    if (views.get(layer.id).context) {
      const background = elt("input");
      background.type = "checkbox";
      background.checked = layer.background;
      background.onchange = () => change(layer, { background: background.checked });
      items.append(label("Background", background));
    }
    const row = elt("div", undefined, "panel-actions");
    const move = (next) => {
      [working.layers[index], working.layers[next]] = [working.layers[next], working.layers[index]];
      update();
    };
    const back = button("Send backward", () => move(index - 1));
    const front = button("Bring forward", () => move(index + 1));
    const duplicate = button("Duplicate", () => add(layer.kind, { ...copyData(layer), id: id() }));
    back.disabled = index === 0;
    front.disabled = index === working.layers.length - 1;
    duplicate.disabled = working.layers.length >= maxLayers;
    row.append(back, front, duplicate, button(layer.visible ? "Hide" : "Show", () => change(layer, { visible: !layer.visible }, true)),
      button("Remove layer", () => {
        working.layers.splice(index, 1);
        selected = working.layers[Math.min(index, working.layers.length - 1)]?.id;
        update();
      }));
    items.append(row);
    return items;
  }

  function panel() {
    if (!isEditing() || !settingsPane) return;
    addButton.disabled = working.layers.length >= maxLayers;
    const list = elt("div", undefined, "layer-list");
    const activeLayer = working.layers.find((layer) => layer.id === selected);
    [...working.layers].reverse().forEach((layer) => {
      const item = button(layerName(layer) + (layer.visible ? "" : " · hidden"), () => {
        selected = layer.id;
        update();
        settingsPane.querySelector('[aria-pressed="true"]')?.focus();
      });
      item.setAttribute("aria-pressed", String(layer.id === selected));
      list.append(item);
    });
    settingsPane.replaceChildren(list);
    if (activeLayer) settingsPane.append(inspector(activeLayer, working.layers.indexOf(activeLayer)));
  }

  function buildPanel() {
    nameBox = elt("input");
    nameBox.value = working.name;
    nameBox.maxLength = 60;
    nameBox.setAttribute("aria-label", "Composition name");
    message = elt("p", undefined, "hint");
    favoriteMessage = elt("p", undefined, "hint");
    addButton = button("Add layer", () => add(insertion));
    const row = elt("div", undefined, "panel-actions");
    row.append(
      nameBox,
      button("Save composition", () => {
        const name = nameBox.value.trim();
        if (!name || !working.layers.length) throw Error("Name the composition and add a layer.");
        const all = saved();
        working.name = name;
        working.id = all.find((entry) => entry.name === name)?.id || id();
        const record = { ...working, version: 1 };
        store("compositions", [...all.filter((entry) => entry.id !== record.id), record]);
        message.textContent = "Saved " + name;
        options.changed();
      }),
      button("Add to favorites", () => {
        if (!working.id || !saved().some((entry) => entry.id === working.id)) throw Error("Save the composition first.");
        options.favorite({ type: "composition", id: working.id });
        favoriteMessage.textContent = "Added to ambient favorites";
      }),
      button("Saved compositions", library),
      button("Hide editor", start),
      button("Exit canvas", options.exit),
    );
    const insertRow = elt("div", undefined, "panel-actions");
    insertRow.append(picker(types, insertion, (choice) => { insertion = choice; }, "Layer type"),
      addButton, button("Explore data", options.explore), button("Music input", music.controls));
    settingsPane = elt("div", undefined, "composition-settings");
    tools.replaceChildren(row, insertRow, settingsPane, message, favoriteMessage);
  }

  function library() {
    const all = saved();
    modal("Saved compositions", all.length ? all.map((entry) =>
      button(entry.name, () => {
        ui.close();
        show(entry.id, true);
      })) : [elt("p", "Save a composition to see it here.", "hint")]);
  }

  return { active, isEditing, has, start, leave, show, add, saved, paint: paintLayers,
    title: () => working?.name, refreshControls: panel };
}
