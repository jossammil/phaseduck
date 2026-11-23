export const musicStyles = [
  ["waveform", "Waveform"],
  ["spectrum", "Radial spectrum"],
  ["ribbons", "Spectral ribbons"],
];

export const musicPalettes = [
  ["cool", "Mint and lilac"],
  ["warm", "Amber and rose"],
  ["mono", "Silver"],
];

const palettes = {
  cool: ["#83efd2", "#a38ff4", "#c4e8ff"],
  warm: ["#fbe099", "#fa8d80", "#cd9aec"],
  mono: ["#eaf4fa", "#a1b4cf", "#f7fbff"],
};

const sourceNames = { local: "Local audio file", safari: "Safari audio", desktop: "Desktop audio" };

export function setupMusic(ui, api, stopTone) {
  const { elt, button, choose, picker, modal } = ui;
  const settings = { style: "waveform", palette: "cool", sensitivity: 1, source: "local" };
  const player = new Audio();
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
    level.oninput = () => { settings.sensitivity = Number(level.value); };
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
      picker(musicStyles, settings.style, (value) => { settings.style = value; }, "Music aesthetic"),
      picker(musicPalettes, settings.palette, (value) => { settings.palette = value; }, "Music palette"),
      ui.label("Sensitivity", level),
      ...(!connections() ? [elt("p", "Live Safari and desktop audio require a verified Mac companion build.", "hint")] : []),
    ]);
  }

  function read() {
    const frames = {};
    if (frame?.source && frame.status === "live") frames[frame.source] = frame;
    if (!analyser || player.paused) return frames;
    analyser.getByteFrequencyData(frequency);
    analyser.getFloatTimeDomainData(waveform);
    const bands = Array.from({ length: 32 }, (_, index) => {
      const target = 55 * (12000 / 55) ** (index / 31);
      return frequency[Math.min(frequency.length - 1, Math.round(target * analyser.fftSize / context.sampleRate))] / 255;
    });
    const wave = Array.from({ length: 64 }, (_, index) => waveform[index * 32]);
    frames.local = { bands, wave, level: Math.sqrt(waveform.reduce((sum, x) => sum + x * x, 0) / waveform.length) };
    return frames;
  }

  return {
    settings, sources, controls, statusFor, read,
    setCapabilities(values) { allowed = values || []; watch(); },
    setVisible(value) { if (visible !== value) { visible = value; watch(); } },
  };
}

export function paintMusic(ctx, width, height, { music, audioFrames, time }) {
  const frame = audioFrames?.[music?.source];
  const colors = palettes[music?.palette] || palettes.cool;
  const gain = music?.sensitivity || 1;
  const tau = 2 * Math.PI;
  const sample = (value) => Math.max(-1, Math.min(1, (value || 0) * gain));
  const level = sample(frame?.level * 4);
  const size = Math.min(width, height);
  const centerX = width / 2, centerY = height / 2;
  const gradient = ctx.createLinearGradient(0, height, width, 0);
  colors.forEach((color, index) => gradient.addColorStop(index / 2, color));
  ctx.strokeStyle = gradient;
  ctx.fillStyle = gradient;
  ctx.lineWidth = 1.4;
  if (music?.style === "spectrum") {
    const base = size * (0.17 + 0.035 * level);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, base, 0, tau);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 64; i++) {
      const angle = i * tau / 64 - Math.PI / 2;
      const peak = sample(frame?.bands?.[i < 32 ? i : 63 - i]);
      const ray = base + size * (0.015 + 0.25 * peak);
      ctx.beginPath();
      ctx.moveTo(centerX + Math.cos(angle) * base, centerY + Math.sin(angle) * base);
      ctx.lineTo(centerX + Math.cos(angle) * ray, centerY + Math.sin(angle) * ray);
      ctx.stroke();
    }
  } else {
    const ribbons = music?.style === "ribbons";
    const lines = ribbons ? 20 : 8;
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
