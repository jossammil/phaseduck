export const musicStyles = [
  ["waveform", "Waveform"],
  ["spectrum", "Radial spectrum"],
  ["ribbons", "Spectral ribbons"],
  ["history", "Spectral history"],
];

export const musicPalettes = [
  ["theme", "Theme colors"],
  ["cool", "Mint and lilac"],
  ["warm", "Amber and rose"],
  ["mono", "Silver"],
];

const palettes = {
  cool: ["#83efd2", "#a38ff4", "#c4e8ff"],
  warm: ["#fbe099", "#fa8d80", "#cd9aec"],
  mono: ["#eaf4fa", "#a1b4cf", "#f7fbff"],
};

export const musicThemes = [
  ["classic", "Classic"],
  ["graphite", "Graphite"],
  ["phosphor", "Phosphor"],
];

const themes = {
  classic: { colors: palettes.cool, width: 1.4, waveLines: 8, ribbonLines: 20, rays: 64 },
  graphite: {
    colors: ["#a7aeb5", "#d7dbe0", "#fafafa"], background: "#17181b",
    width: 0.9, waveLines: 4, ribbonLines: 10, rays: 32, crispHistory: true,
  },
  phosphor: {
    colors: ["#45ce91", "#b7ec76", "#ffd486"], background: "#06130f",
    width: 2.1, waveLines: 6, ribbonLines: 14, rays: 64, radialDash: [4, 3],
  },
};

const defaultAppearance = { theme: "classic", palette: "theme", style: "waveform", sensitivity: 1 };
function musicAppearance(value) {
  const { theme, palette, style, sensitivity } = value || {};
  return {
    theme: Object.hasOwn(themes, theme) ? theme : defaultAppearance.theme,
    palette: Object.hasOwn(palettes, palette) ? palette : defaultAppearance.palette,
    style: musicStyles.some(([key]) => key === style) ? style : defaultAppearance.style,
    sensitivity: Number.isFinite(sensitivity) && sensitivity >= 0.25 && sensitivity <= 3
      ? sensitivity : defaultAppearance.sensitivity,
  };
}

const sourceNames = { local: "Local audio file", safari: "Safari audio", desktop: "Desktop audio" };

export function musicLayerSettings(value) {
  return {
    ...musicAppearance(value),
    source: Object.hasOwn(sourceNames, value?.source) ? value.source : "local",
  };
}

function themeFor(music) {
  return Object.hasOwn(themes, music?.theme) ? themes[music.theme] : themes.classic;
}

export const musicBackground = (music) => themeFor(music).background;

export function setupMusic(ui, api, stopTone, redraw) {
  const { elt, button, choose, picker, modal } = ui;
  const settings = { ...musicAppearance(ui.getStored("music-appearance", null)), source: "local" };
  const player = new Audio();
  const history = {};
  let context, analyser, frequency, waveform, url, filename;
  let stream, frame, visible = false, allowed = [];
  let message = "";
  const connections = () => allowed.length > 0;
  const sources = () => [["local", sourceNames.local], ...allowed.map((id) => [id, sourceNames[id]])];

  async function openFile() {
    const file = await choose("audio/*,.wav,.mp3,.m4a,.ogg,.flac");
    if (!file) return;
    if (!context) {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      frequency = new Uint8Array(analyser.frequencyBinCount);
      waveform = new Float32Array(analyser.fftSize);
      context.createMediaElementSource(player).connect(analyser).connect(context.destination);
    }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);
    filename = file.name;
    delete history.local;
    player.src = url;
    await Promise.all([context.resume(), player.play()]);
  }

  function watch() {
    if (!visible || !connections()) {
      stream?.close();
      stream = null;
      frame = null;
      return;
    }
    if (stream) return;
    stream = new EventSource("/api/audio/events");
    stream.onmessage = (event) => {
      frame = JSON.parse(event.data);
      const status = ui.isPanel("Music input") && document.getElementById("music-status");
      if (status) status.textContent = statusFor(settings.source);
    };
    stream.onerror = () => { frame = null; };
  }

  async function live(source) {
    await stopTone();
    player.pause();
    await api("/api/audio/start", { source });
    message = "";
    controls(false);
  }

  async function stop() {
    if (settings.source === "local") player.pause();
    else await api("/api/audio/stop", {});
    controls(false);
  }

  function statusFor(source) {
    if (source === "local") {
      if (!filename) return "Open an audio file to begin";
      if (player.error) return "This audio file could not be played";
      return player.paused ? filename + " · paused" : filename;
    }
    if (!allowed.includes(source)) return "Live audio is unavailable in this build";
    if (!frame || frame.source !== source) return "Capture is off";
    if (frame.status === "error") return frame.message || "Audio capture failed";
    if (frame.status === "waiting") return frame.message || "Waiting for audio · check macOS audio permission";
    return frame.status === "silent" ? sourceNames[source] + " · silent" : sourceNames[source] + " · listening";
  }

  function saveAppearance() {
    const { theme, palette, style, sensitivity } = settings;
    ui.store("music-appearance", { theme, palette, style, sensitivity });
  }

  function changeAppearance(key, value) {
    settings[key] = value;
    redraw();
    saveAppearance();
  }

  function controls(open = true) {
    if (!open && !ui.isPanel("Music input")) return;
    const source = picker(sources(), settings.source, (value) => {
      settings.source = value;
      message = "";
      controls(false);
    }, "Audio source");
    const status = elt("p", message || statusFor(settings.source), "hint");
    status.id = "music-status";
    const level = elt("input");
    level.type = "range";
    level.min = "0.25";
    level.max = "3";
    level.step = "0.05";
    level.value = settings.sensitivity;
    level.oninput = () => {
      settings.sensitivity = Number(level.value);
      redraw();
    };
    level.onchange = saveAppearance;
    level.setAttribute("aria-label", "Audio sensitivity");
    const actions = elt("div", undefined, "panel-actions");
    const act = (label, action) => button(label, async () => {
      try {
        await action();
        message = "";
      } catch (error) {
        message = error.message;
      }
      controls(false);
    });
    if (settings.source === "local") {
      actions.append(act("Open audio file", openFile));
      if (filename) actions.append(act(player.paused ? "Play file" : "Pause file", async () => {
        if (player.paused) await Promise.all([context.resume(), player.play()]);
        else player.pause();
      }));
    } else actions.append(act("Start capture", () => live(settings.source)), act("Stop capture", stop));
    if (frame?.source && frame.source !== settings.source) {
      actions.append(act("Stop " + sourceNames[frame.source], () => api("/api/audio/stop", {})));
    }
    modal("Music input", [
      source, actions, status,
      ui.label("Theme pack", picker(musicThemes, settings.theme, (value) => changeAppearance("theme", value), "Music theme pack")),
      picker(musicStyles, settings.style, (value) => changeAppearance("style", value), "Music aesthetic"),
      picker(musicPalettes, settings.palette, (value) => changeAppearance("palette", value), "Music palette"),
      ui.label("Sensitivity", level),
      ...(!connections() ? [elt("p", "Live Safari and desktop audio require a verified Mac companion build.", "hint")] : []),
    ]);
  }

  function read() {
    const frames = {};
    if (frame?.source && frame.status === "live") frames[frame.source] = frame;
    if (analyser && !player.paused) {
      analyser.getByteFrequencyData(frequency);
      analyser.getFloatTimeDomainData(waveform);
      const bands = Array.from({ length: 32 }, (_, index) => {
        const target = 55 * (12000 / 55) ** (index / 31);
        return frequency[Math.min(frequency.length - 1, Math.round(target * analyser.fftSize / context.sampleRate))] / 255;
      });
      const wave = Array.from({ length: 64 }, (_, index) => waveform[index * 32]);
      frames.local = { bands, wave, level: Math.sqrt(waveform.reduce((sum, x) => sum + x * x, 0) / waveform.length) };
    }
    const now = performance.now();
    for (const [source, summary] of Object.entries(frames)) {
      const series = history[source] ??= [];
      if (now - (series.at(-1)?.at ?? -Infinity) < 63) continue;
      series.push({ at: now, bands: summary.bands });
      while (series.length && now - series[0].at > 12000) series.shift();
    }
    return frames;
  }

  return {
    settings, sources, controls, statusFor, read, history,
    setCapabilities(values) { allowed = values || []; watch(); },
    setVisible(value) { if (visible !== value) { visible = value; watch(); } },
  };
}

const historySurfaces = new WeakMap();
function paintHistory(ctx, width, height, series, colors, sensitivity, theme, hideLabels) {
  const x = width * 0.12, y = height * 0.19, w = width * 0.78, h = height * 0.63;
  if (series.length) {
    let surface = historySurfaces.get(ctx.canvas);
    if (!surface) {
      const canvas = ctx.canvas.ownerDocument?.createElement("canvas") || new OffscreenCanvas(192, 32);
      canvas.width = 192;
      canvas.height = 32;
      const target = canvas.getContext("2d");
      surface = { canvas, target, pixels: target.createImageData(192, 32) };
      historySurfaces.set(ctx.canvas, surface);
    }
    const end = series.at(-1).at;
    if (surface.end !== end || surface.colors !== colors || surface.sensitivity !== sensitivity) {
      Object.assign(surface, { end, colors, sensitivity });
      const rgb = colors.map((color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)));
      const { data } = surface.pixels;
      data.fill(0);
      for (const { at, bands } of series) {
        const col = Math.max(0, 191 - Math.round((end - at) / 62.5));
        bands.forEach((band, index) => {
          const strength = Math.min(1, band * sensitivity);
          const tint = strength * 2, low = Math.min(1, Math.floor(tint)), fraction = tint - low;
          const offset = (192 * (31 - index) + col) * 4;
          for (let channel = 0; channel < 3; channel++)
            data[offset + channel] = rgb[low][channel] * (1 - fraction) + rgb[low + 1][channel] * fraction;
          data[offset + 3] = Math.round(255 * strength ** 0.75);
        });
      }
      surface.target.putImageData(surface.pixels, 0, 0);
    }
    ctx.imageSmoothingEnabled = !theme.crispHistory;
    ctx.drawImage(surface.canvas, x, y, w, h);
  }
  ctx.strokeStyle = "#91a7bf";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.30;
  ctx.strokeRect(x, y, w, h);
  if (hideLabels) return;
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = "#d7e5f2";
  ctx.font = `500 ${Math.max(10, Math.min(width * 0.02, 18))}px system-ui`;
  ctx.fillText("12 kHz", x, y + 15);
  ctx.fillText("55 Hz", x, y + h - 6);
  ctx.fillText("12 seconds ago", x, y + h + 19);
  ctx.textAlign = "right";
  ctx.fillText("Latest sample", x + w, y + h + 19);
}

export function paintMusic(ctx, width, height, { music, audioFrames, audioHistory, time, hideLabels }) {
  const frame = audioFrames?.[music?.source];
  const theme = themeFor(music);
  const colors = Object.hasOwn(palettes, music?.palette) ? palettes[music.palette] : theme.colors;
  const gain = music?.sensitivity || 1;
  if (music?.style === "history") {
    paintHistory(ctx, width, height, audioHistory?.[music.source] || [], colors, gain, theme, hideLabels);
    return;
  }
  const tau = 2 * Math.PI;
  const sample = (value) => Math.max(-1, Math.min(1, (value || 0) * gain));
  const level = sample(frame?.level * 4);
  const size = Math.min(width, height);
  const centerX = width / 2, centerY = height / 2;
  const gradient = ctx.createLinearGradient(0, height, width, 0);
  colors.forEach((color, index) => gradient.addColorStop(index / 2, color));
  ctx.strokeStyle = gradient;
  ctx.fillStyle = gradient;
  ctx.lineWidth = theme.width;
  if (music?.style === "spectrum") {
    const base = size * (0.17 + 0.035 * level);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, base, 0, tau);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    if (theme.radialDash) ctx.setLineDash(theme.radialDash);
    ctx.beginPath();
    for (let i = 0; i < theme.rays; i++) {
      const angle = i * tau / theme.rays - Math.PI / 2;
      const band = Math.min(31, Math.floor(64 * Math.min(i, theme.rays - 1 - i) / theme.rays));
      const peak = sample(frame?.bands?.[band]);
      const ray = base + size * (0.015 + 0.25 * peak);
      ctx.moveTo(centerX + Math.cos(angle) * base, centerY + Math.sin(angle) * base);
      ctx.lineTo(centerX + Math.cos(angle) * ray, centerY + Math.sin(angle) * ray);
    }
    ctx.stroke();
    if (theme.radialDash) ctx.setLineDash([]);
  } else {
    const ribbons = music?.style === "ribbons";
    const lines = ribbons ? theme.ribbonLines : theme.waveLines;
    for (let j = 0; j < lines; j++) {
      const offset = (j - (lines - 1) / 2) / lines;
      ctx.globalAlpha = 0.3 + (1 - Math.abs(offset) * 2) * 0.5;
      ctx.beginPath();
      for (let i = 0; i <= 128; i++) {
        const u = i / 128;
        const peak = ribbons
          ? sample(frame?.bands?.[Math.min(31, Math.floor(u * 32))]) *
            Math.sin(u * tau * 2 + time * 0.7 + offset * 2)
          : sample(frame?.wave?.[Math.min(63, Math.floor(u * 64))]);
        const y = centerY + size * (offset * (ribbons ? 0.35 : 0.15) +
          peak * (0.24 + 0.09 * offset) * Math.sin(u * Math.PI));
        ctx[i ? "lineTo" : "moveTo"](width * (0.06 + 0.88 * u), y);
      }
      ctx.stroke();
    }
  }
}
