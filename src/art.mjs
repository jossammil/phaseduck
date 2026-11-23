/* All geometry is procedural. The caller owns the animation clock and DPR. */
import { paintMusic } from "./music.js";
const TAU = Math.PI * 2;
const clip = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a * (1 - t) + b * t;
const COLOR = {
  ice: "#9cf2dd",
  sky: "#91c9f4",
  iris: "#bfa4fa",
  lilac: "#ebc7f0",
  peach: "#ffc2a1",
  gold: "#efd49b",
};
const number = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;
const feedbackBuffers = new WeakMap();
const rasterCache = new WeakMap();
const clocks = new Map();
const loomScales = new WeakMap();
const signalScales = new WeakMap();
const validArray = (v) =>
  v && typeof v.length === "number" && typeof v !== "string";
const numericArray = (v) => validArray(v) && v.length > 0;

function seed(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}
function signalScale(a) {
  if (!numericArray(a)) return { min: 0, max: 1 };
  if (signalScales.has(a)) return signalScales.get(a);
  let min = Infinity,
    max = -Infinity;
  for (const n of a)
    if (Number.isFinite(+n)) {
      min = Math.min(min, +n);
      max = Math.max(max, +n);
    }
  const result = {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 1,
  };
  signalScales.set(a, result);
  return result;
}
function sample(a, u) {
  if (!numericArray(a)) return 0;
  const x = clip(u) * (a.length - 1),
    i = Math.floor(x);
  return lerp(number(a[i]), number(a[Math.min(i + 1, a.length - 1)]), x - i);
}
function unit(a, u) {
  const { min, max } = signalScale(a);
  if (max === min) return 0.5;
  const value = sample(a, u);
  return clip(Number.isFinite(max - min) ? (value - min) / (max - min) :
    (value / 2 - min / 2) / (max / 2 - min / 2));
}
function mapped(s, key) {
  return s.patch === key && numericArray(s.signal);
}
function place(c, i, x, y) {
  if (i === 0) c.moveTo(x, y);
  else c.lineTo(x, y);
}
function ink(c, color, opacity = 1, width = 1) {
  c.globalAlpha = opacity;
  c.strokeStyle = color;
  c.lineWidth = width;
}
function line(c, x, y, xx, yy) {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(xx, yy);
  c.stroke();
}
function ellipse(c, x, y, a, b, start = 0, end = TAU, turn = 0) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.01, a), Math.max(0.01, b), turn, start, end);
  c.stroke();
}
function dot(c, x, y, r, color, alpha = 1) {
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, Math.max(0.1, r), 0, TAU);
  c.fill();
}
function spectrum(
  c,
  x0,
  y0,
  x1,
  y1,
  colors = [COLOR.ice, COLOR.sky, COLOR.iris, COLOR.lilac, COLOR.peach],
) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  colors.forEach((color, i) => g.addColorStop(i / (colors.length - 1), color));
  return g;
}
function haze(c, x, y, radius, color, opacity) {
  c.globalAlpha = opacity;
  const g = c.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  c.fillStyle = g;
  c.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
}
function backdrop(c, w, h, s) {
  c.globalAlpha = 1;
  c.fillStyle = "#0b0d19";
  c.fillRect(0, 0, w, h);
  const main = Math.min(w * 0.63, h * 0.94);
  haze(c, w * 0.35, h * 0.49, main, "#123444", 0.4);
  haze(c, w * 0.69, h * 0.45, main, "#462946", 0.37);
  if (s.scene === "dunes")
    haze(c, w * 0.63, h * 0.27, main * 0.63, "#674053", 0.54);
}
function bead(c, x, y, r, color) {
  haze(c, x, y, r * 5, color, 0.24);
  dot(c, x, y, r, color);
  dot(c, x - r * 0.14, y - r * 0.14, r * 0.41, "#fff4e4");
}

function phaseClock(c, w, h, s) {
  const date = s.now instanceof Date ? s.now : new Date(s.now ?? Date.now());
  const sec = date.getSeconds() + date.getMilliseconds() / 1000;
  const minutes = date.getMinutes() + sec / 60,
    hours = (date.getHours() % 12) + minutes / 60;
  const aMinute = (minutes * TAU) / 60 - Math.PI / 2,
    aHour = (hours * TAU) / 12 - Math.PI / 2;
  const cx = w * 0.5,
    cy = h * 0.49,
    r = Math.min(w * 0.345, h * 0.377),
    t = number(s.time) * 0.12;
  const p = mapped(s, "clock.drift")
    ? 0.2 + unit(s.signal, minutes / 60) * 1.8
    : 1;
  const grad = spectrum(c, cx - r, cy + r * 0.4, cx + r, cy - r * 0.45);
  // Two readable time tracks are embedded in a slowly breathing braid.
  for (let k = 0; k < 57; k++) {
    const f = k / 56,
      v = 2 * f - 1;
    ink(
      c,
      grad,
      0.18 + 0.25 * Math.pow(1 - Math.abs(v), 0.7),
      w < 480 ? 0.78 : 0.95,
    );
    c.beginPath();
    for (let i = 0; i <= 160; i++) {
      const a = (i * TAU) / 160;
      const bend = Math.sin(a * 2 + t * p * 0.37 + v * 1.2);
      const spread = 0.125 * Math.sin(a * 3 - t * 0.38 + v * 0.44);
      const radius = r * (0.91 + 0.125 * bend + v * (0.096 + spread));
      const x =
        cx + radius * Math.cos(a) * (1 + 0.045 * Math.sin(a - t * 0.12));
      const y =
        cy +
        radius * Math.sin(a) * 0.84 +
        v * r * 0.078 * Math.cos(a * 2.0 - t * 0.21);
      place(c, i, x, y);
    }
    c.stroke();
  }
  function track(a, k) {
    const r1 = r * (k === 0 ? 0.93 : 0.73);
    return [
      cx + r1 * Math.cos(a) * (k === 0 ? 1 : 0.99),
      cy + r1 * Math.sin(a) * (k === 0 ? 0.86 : 1.13),
    ];
  }
  for (let k = 0; k < 2; k++) {
    const a = k === 0 ? aMinute : aHour,
      color = k === 0 ? COLOR.ice : COLOR.peach;
    ink(c, color, 0.35, 1);
    const rr = r * (k === 0 ? 0.93 : 0.73);
    ellipse(c, cx, cy, rr * (k === 0 ? 1 : 0.99), rr * (k === 0 ? 0.86 : 1.13));
    for (let i = 0; i < 16; i++) {
      const u = i / 16,
        v = (i + 1) / 16,
        span = k === 0 ? 0.72 : 1.05;
      const [x, y] = track(a - (1 - u) * span, k),
        [xx, yy] = track(a - (1 - v) * span, k);
      ink(c, color, 0.04 + 0.67 * u, 1.45);
      line(c, x, y, xx, yy);
    }
    const [x, y] = track(a, k);
    bead(c, x, y, k === 0 ? 2.8 : 4, color);
  }
  for (let i = 0; i < 60; i++) {
    const a = (i * TAU) / 60 - Math.PI / 2;
    const axis = i % 15 === 0,
      major = i % 5 === 0,
      rr = 1.19;
    const d = axis ? 0.047 : major ? 0.027 : 0.012;
    ink(
      c,
      axis ? COLOR.lilac : COLOR.sky,
      axis ? 0.68 : major ? 0.47 : 0.21,
      1,
    );
    line(
      c,
      cx + r * rr * Math.cos(a),
      cy + r * rr * 0.9 * Math.sin(a),
      cx + r * (rr - d) * Math.cos(a),
      cy + r * (rr - d) * 0.9 * Math.sin(a),
    );
  }
  const active = (s.jobs || [])
    .filter((job) => ["running", "waiting", "queued"].includes(job.status))
    .slice(0, 3);
  active.forEach((job, j) => {
    const fraction = Number.isFinite(job.progress) ? job.progress : null;
    const end = fraction === null ? TAU : Math.max(0.04, fraction * TAU);
    ink(c, COLOR.ice, 0.46 - j * 0.09, 1.1);
    c.beginPath();
    for (let n = 0; n <= 144; n++) {
      const a = -Math.PI / 2 + (end * n) / 144;
      const rr =
        r *
        (1.27 +
          j * 0.042 +
          0.013 * Math.sin(a * 7 + (job.status === "running" ? t * 2 : 0)));
      place(c, n, cx + rr * Math.cos(a), cy + rr * 0.9 * Math.sin(a));
    }
    c.stroke();
  });
  dot(c, cx, cy, 1.6, COLOR.lilac, 0.59);
}

function silk(c, w, h, s) {
  const t = number(s.time) * 0.28;
  const grad = spectrum(c, 0, h * 0.6, w, h * 0.34);
  const amp = mapped(s, "waves.amplitude")
    ? 0.26 + 1.1 * unit(s.signal, (((t / 16) % 1) + 1) % 1)
    : 0.35 + 0.65 * clip(number(s.intensity, 0.8));
  for (let k = 0; k < 2; k++) {
    const total = k === 0 ? 52 : 34,
      shift = k === 0 ? 0.65 : 3.65;
    for (let j = 0; j < total; j++) {
      const v = (2 * j) / (total - 1) - 1;
      ink(c, grad, (k === 0 ? 0.49 : 0.38) * (1 - 0.42 * v * v), 0.92);
      c.beginPath();
      for (let i = 0; i <= 135; i++) {
        const u = i / 135,
          a = u * TAU,
          p = t + shift;
        const crest =
          Math.sin(a * 1.17 + p + v * 0.69) +
          0.37 * Math.sin(a * 2.05 - p * 0.53 + v * 0.9);
        const fold = Math.cos(a * 0.92 - p * 0.6 + 0.4);
        const y =
          h *
          ((k === 0 ? 0.45 : 0.56) +
            (k === 0 ? 0.15 : 0.12) * amp * crest +
            (k === 0 ? 0.118 : 0.069) * v * fold +
            0.017 * Math.sin(a * 2.9 + p + v * 1.6));
        place(c, i, u * w, y);
      }
      c.stroke();
    }
  }
}
function harmonics(c, w, h, s) {
  const t = number(s.time) * 0.25,
    r = Math.min(w * 0.33, h * 0.34),
    cx = w * 0.5,
    cy = h * 0.5;
  const amp = mapped(s, "orbit.radius")
    ? 0.67 + 0.5 * unit(s.signal, (((t / 12) % 1) + 1) % 1)
    : 1;
  const grad = spectrum(c, cx - r, cy - r, cx + r, cy + r);
  for (let j = 0; j < 60; j++) {
    const v = (j * TAU) / 60;
    ink(c, grad, 0.28 + 0.13 * (1 + Math.sin(v)) * 0.5, 0.97);
    c.beginPath();
    for (let i = 0; i <= 160; i++) {
      const a = (i * TAU) / 160,
        turn = 3 * a + v + t * 0.48;
      const radius =
        0.9 + 0.16 * Math.cos(3 * a - t * 0.55) + 0.25 * Math.cos(turn);
      const x = radius * Math.cos(a),
        y = radius * Math.sin(a);
      const z = 0.25 * Math.sin(turn) + 0.35 * Math.sin(2 * a + t * 0.45);
      place(
        c,
        i,
        cx + r * amp * (1.2 * x + 0.14 * y),
        cy + r * amp * (0.78 * y - 0.19 * x + 0.5 * z),
      );
    }
    c.stroke();
  }
}
function dunes(c, w, h, s) {
  const t = number(s.time) * 0.095,
    cx = w * 0.67,
    cy = h * 0.22,
    r = Math.min(w * 0.051, h * 0.067);
  haze(c, cx, cy, r * 3.8, COLOR.peach, 0.14);
  const sun = spectrum(c, 0, cy - r, 0, cy + r, ["#f6d1b0", "#b98394"]);
  dot(c, cx, cy, r, sun);
  const colors = [
    "#ac91b6",
    "#c38fa4",
    "#e1a6a1",
    "#c3a7d5",
    "#9fc0e1",
    "#93d6cb",
  ];
  const fills = [
    "#2d253b",
    "#2b233a",
    "#262338",
    "#232236",
    "#202233",
    "#172431",
  ];
  const data = mapped(s, "dunes.height");
  for (let k = 0; k < 6; k++) {
    const ridge = (d) => {
      for (let i = 0; i <= 130; i++) {
        const u = i / 130,
          a = u * TAU;
        const base = 0.409 + k * 0.083 + d * 0.086;
        const smooth =
          0.062 *
            Math.sin(a * (0.76 + k * 0.05) + k * 0.98 + t * 0.22 + d * 0.31) +
          0.02 * Math.sin(a * 1.82 - k * 0.61 - t * 0.31 + d * 0.21);
        const offset = data
          ? -0.13 * (unit(s.signal, u) - 0.5) * (1 + k * 0.08)
          : 0;
        place(c, i, u * w, h * (base + smooth + offset));
      }
    };
    c.globalAlpha = 1;
    c.fillStyle = fills[k];
    c.beginPath();
    ridge(0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    c.fill();
    for (let j = 0; j < 15; j++) {
      ink(
        c,
        colors[k],
        j === 0 ? 0.91 : 0.6 - 0.024 * j,
        j === 0 ? 1.17 : 0.73,
      );
      c.beginPath();
      ridge(j / 14);
      c.stroke();
    }
  }
}

function loomMax(days) {
  if (!days || days.length === 0) return 1;
  if (loomScales.has(days)) return loomScales.get(days);
  let max = 1;
  for (const day of days)
    for (const n of day.hours || []) max = Math.max(max, number(n));
  loomScales.set(days, max);
  return max;
}
const loomX = (u) => 0.065 + 0.87 * u;
function loomY(s, index, u) {
  const days = s.days || [],
    v = index / Math.max(1, days.length - 1);
  const val = clip(sample(days[index]?.hours, u) / loomMax(days));
  const grain = mapped(s, "loom.spacing")
    ? 0.68 + 0.3 * unit(s.signal, u)
    : 0.93;
  return (
    0.3 +
    v * 0.49 * grain +
    (u - 0.5) * (0.043 * v - 0.05) +
    0.025 * Math.sin(u * TAU * 0.8 + v * 0.8) -
    0.153 * Math.pow(val, 0.84)
  );
}
function loom(c, w, h, s) {
  const days = s.days || [],
    n = days.length,
    grad = spectrum(c, 0, h, w, 0);
  const center = clip(Math.trunc(number(s.selectedDay, -1)), -1, n - 1),
    hour = clip(number(s.selectedHour), 0, 23);
  for (let j = 0; j <= 23; j++) {
    const x = w * loomX(j / 23);
    ink(c, "#a8c1cb", j % 6 === 0 ? 0.13 : 0.045, 0.75);
    line(c, x, h * 0.145, x, h * 0.85);
  }
  for (let j = 0; j < n; j++) {
    const isSelected = j === center;
    ink(
      c,
      isSelected ? COLOR.ice : grad,
      isSelected ? 0.99 : 0.43 + (0.2 * j) / Math.max(n, 1),
      isSelected ? 1.75 : 0.9,
    );
    c.beginPath();
    for (let i = 0; i <= 115; i++)
      place(c, i, w * loomX(i / 115), h * loomY(s, j, i / 115));
    c.stroke();
  }
  if (n && center >= 0)
    bead(
      c,
      w * loomX(hour / 23),
      h * loomY(s, center, hour / 23),
      2.25,
      COLOR.ice,
    );
  for (let j = 0; j < 24; j++) {
    const x = w * loomX(j / 23);
    ink(c, COLOR.sky, j % 6 === 0 ? 0.56 : 0.25, 0.85);
    line(c, x, h * 0.875, x, h * 0.875 + (j % 6 === 0 ? 6 : 3));
  }
}

const RADAR_RECT = { x: 0.095, y: 0.11, w: 0.81, h: 0.77 };
function radarSample(r, u, v) {
  const col = clip(Math.round(u * (r.cols - 1)), 0, r.cols - 1);
  const row = clip(Math.round(v * (r.rows - 1)), 0, r.rows - 1);
  const value = r.bins[row * r.cols + col];
  return {
    col,
    row,
    value: value == null || !Number.isFinite(+value) ? null : clip(+value),
  };
}
function rasterMesh(r) {
  if (rasterCache.has(r)) return rasterCache.get(r);
  const cols = Math.min(96, r.cols),
    rows = Math.min(80, r.rows);
  const cells = Array.from({ length: rows }, (_, j) =>
    Array.from(
      { length: cols },
      (_, i) =>
        radarSample(r, i / Math.max(1, cols - 1), j / Math.max(1, rows - 1))
          .value,
    ),
  );
  const thresholds = [
    0.055, 0.105, 0.17, 0.24, 0.33, 0.42, 0.53, 0.65, 0.77, 0.87, 0.95,
  ];
  const contours = thresholds.map(() => []);
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const x = i / (cols - 1),
        y = j / (rows - 1),
        xx = (i + 1) / (cols - 1),
        yy = (j + 1) / (rows - 1);
      const verts = [
        [x, y, cells[j][i]],
        [xx, y, cells[j][i + 1]],
        [xx, yy, cells[j + 1][i + 1]],
        [x, yy, cells[j + 1][i]],
      ];
      if (verts.some((p) => p[2] === null)) continue;
      const lo = Math.min(...verts.map((p) => p[2])),
        hi = Math.max(...verts.map((p) => p[2]));
      if (lo === hi) continue;
      thresholds.forEach((level, k) => {
        if (level <= lo || level > hi) return;
        const crossings = [];
        for (let t = 0; t < 4; t++) {
          const a = verts[t],
            b = verts[(t + 1) % 4];
          if (a[2] >= level === b[2] >= level) continue;
          const f = (level - a[2]) / (b[2] - a[2]);
          crossings.push(lerp(a[0], b[0], f), lerp(a[1], b[1], f));
        }
        contours[k].push(...crossings);
      });
    }
  const data = { contours, cells, cols, rows };
  rasterCache.set(r, data);
  return data;
}
function rain(c, w, h, s) {
  const r = s.radar,
    rect = RADAR_RECT,
    x = rect.x * w,
    y = rect.y * h,
    ww = rect.w * w,
    hh = rect.h * h;
  const cx = x + ww / 2,
    cy = y + hh / 2,
    scale = Math.min(ww, hh);
  for (let j = 1; j <= 4; j++) {
    ink(c, "#a9c3be", 0.14 - j * 0.018, 0.8);
    ellipse(c, cx, cy, scale * j * 0.119, scale * j * 0.119);
  }
  for (let j = 0; j < 4; j++) {
    const a = (j * Math.PI) / 2;
    ink(c, COLOR.sky, 0.18, 0.8);
    line(
      c,
      cx + scale * 0.19 * Math.cos(a),
      cy + scale * 0.19 * Math.sin(a),
      cx + scale * 0.47 * Math.cos(a),
      cy + scale * 0.47 * Math.sin(a),
    );
  }
  if (r?.bins && r.rows > 1 && r.cols > 1) {
    const { contours, cells, cols, rows } = rasterMesh(r);
    const grad = spectrum(c, x, y + hh, x + ww, y, [
      COLOR.ice,
      COLOR.sky,
      COLOR.iris,
      COLOR.peach,
    ]);
    // The curtains and all contour paths use the same north-up row ordering.
    const fold = mapped(s, "rain.fold") ? 0.7 + 0.8 * unit(s.signal, 0.5) : 1;
    c.save();
    c.beginPath();
    c.rect(x, y, ww, hh);
    c.clip();
    for (let j = 0; j < rows; j += Math.max(1, Math.floor(rows / 38))) {
      const v = j / (rows - 1);
      ink(c, grad, 0.43, 0.7);
      c.beginPath();
      let fresh = true;
      for (let i = 0; i < cols; i++) {
        const value = cells[j][i],
          u = i / (cols - 1);
        if (value === null || value <= 0.01) {
          fresh = true;
          continue;
        }
        place(
          c,
          fresh ? 0 : 1,
          x + ww * u,
          y + hh * v - scale * 0.047 * value * fold,
        );
        fresh = false;
      }
      c.stroke();
    }
    const palette = [
      "#5caeaf",
      "#6bc4be",
      "#8ed6cc",
      "#9adfe2",
      "#a2caeb",
      "#b3b4ee",
      "#cca8e0",
      "#e7abd1",
      "#f2baab",
      "#f5cf9e",
      "#fae7b8",
    ];
    contours.forEach((list, k) => {
      ink(c, palette[k], 0.63 + k * 0.032, k % 3 === 0 ? 1.23 : 0.78);
      c.beginPath();
      for (let i = 0; i + 3 < list.length; i += 4) {
        c.moveTo(x + ww * list[i], y + hh * list[i + 1]);
        c.lineTo(x + ww * list[i + 2], y + hh * list[i + 3]);
      }
      c.stroke();
    });
    c.restore();
  }
  ink(c, COLOR.ice, 0.64, 0.9);
  for (const dx of [-1, 1]) line(c, cx + dx * 3, cy, cx + dx * 8, cy);
  for (const dy of [-1, 1]) line(c, cx, cy + dy * 3, cx, cy + dy * 8);
  ink(c, COLOR.sky, 0.28, 0.85);
  for (const a of [0, 1])
    for (const b of [0, 1]) {
      const xx = x + ww * a,
        yy = y + hh * b;
      line(c, xx, yy, xx + (a ? -7 : 7), yy);
      line(c, xx, yy, xx, yy + (b ? -7 : 7));
    }
}

function jobSeries(s) {
  return (s.jobs || []).slice(-12);
}
function isResting(j) {
  return /wait|blocked|paus|complet|finish|success|fail|error|cancel|unknown|stale|exit|succeed|queued|stop/i.test(
    j.status || "",
  );
}
function jobPhase(j, t) {
  const id = j.id ?? j.label,
    base = seed(id) * 0.000013,
    moving = !isResting(j);
  let rec = clocks.get(id);
  if (!rec) {
    rec = { phase: base, t, moving };
    clocks.set(id, rec);
  }
  if (t !== rec.t) {
    if (t < rec.t) rec.phase = base;
    else if (moving && rec.moving)
      rec.phase += Math.min(0.35, t - rec.t) * 0.36;
    rec.t = t;
  }
  rec.moving = moving;
  if (clocks.size > 180) clocks.delete(clocks.keys().next().value);
  return rec.phase;
}
function jobRibbon(j, index, n, t) {
  return {
    base: 0.5 + (index - (n - 1) / 2) * Math.min(0.14, 0.65 / Math.max(n, 1)),
    p: jobPhase(j, t),
    freq: 0.8 + (seed(j.id ?? j.label) % 197) / 120,
    amp: Math.min(0.115, 0.3 / (n + 1)),
  };
}
function jobY({ base, p, freq, amp }, u, v) {
  const a = u * TAU;
  return (
    base +
    amp *
      (Math.sin(a * freq + p + v * 0.42) +
        0.46 * Math.sin(2 * a - p * 0.61 + v * 0.68)) +
    amp * v * 0.7 * Math.cos(a - p * 0.55)
  );
}
function jobs(c, w, h, s) {
  const list = jobSeries(s),
    n = list.length,
    t = number(s.time);
  for (let j = 0; j < 5; j++) {
    ink(c, COLOR.sky, 0.052, 1);
    line(c, w * 0.06, h * (0.22 + 0.14 * j), w * 0.94, h * (0.22 + 0.14 * j));
  }
  if (!n) {
    ink(c, COLOR.ice, 0.28, 0.95);
    line(c, w * 0.06, h * 0.5, w * 0.94, h * 0.5);
    return;
  }
  const grad = spectrum(c, w * 0.06, 0, w * 0.94, 0);
  for (let k = 0; k < n; k++) {
    const job = list[k],
      bands = n > 5 ? 8 : 22,
      shape = jobRibbon(job, k, n, t);
    const opacity = isResting(job) ? 0.38 : 0.74;
    for (let j = 0; j < bands; j++) {
      const v = (2 * j) / (bands - 1) - 1;
      ink(c, grad, opacity * (0.64 - 0.27 * v * v), 0.85);
      c.beginPath();
      for (let i = 0; i <= 100; i++) {
        const u = i / 100;
        place(c, i, w * (0.06 + 0.88 * u), h * jobY(shape, u, v));
      }
      c.stroke();
    }
    if (job.progress != null && Number.isFinite(+job.progress)) {
      const u = clip(+job.progress);
      bead(c, w * (0.06 + 0.88 * u), h * jobY(shape, u, 0), 2.7, COLOR.peach);
    }
  }
}
function calendarEntries(s) {
  const now = new Date(s.now ?? Date.now()).getTime(),
    span = 86400000;
  const spans = (s.events || [])
    .map((event) => ({
      event,
      from: clip((Date.parse(event.start) - now) / span),
      to: clip((Date.parse(event.end) - now) / span),
    }))
    .filter(
      (e) => Number.isFinite(e.from) && Number.isFinite(e.to) && e.to > e.from,
    )
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const occupied = [];
  for (const e of spans) {
    let lane = occupied.findIndex((t) => t <= e.from);
    if (lane < 0) lane = occupied.length;
    occupied[lane] = e.to;
    e.lane = lane;
  }
  return spans;
}
function calendarScale(lane) {
  return Math.max(0.48, 1 - (lane % 7) * 0.075);
}
function calendar(c, w, h, s) {
  const cx = w * 0.5,
    cy = h * 0.5,
    rx = w * 0.345,
    ry = h * 0.314;
  const events = calendarEntries(s),
    grad = spectrum(c, cx - rx, cy + ry, cx + rx, cy - ry);
  for (let i = 0; i < 24; i++) {
    const a = (i * TAU) / 24 - Math.PI / 2,
      d = i % 6 === 0 ? 0.065 : 0.03;
    ink(c, COLOR.sky, i % 6 === 0 ? 0.62 : 0.27, 1);
    line(
      c,
      cx + rx * 1.13 * Math.cos(a),
      cy + ry * 1.13 * Math.sin(a),
      cx + rx * (1.13 - d) * Math.cos(a),
      cy + ry * (1.13 - d) * Math.sin(a),
    );
  }
  const laneCount =
    1 +
    Math.min(
      6,
      events.reduce((v, e) => Math.max(v, e.lane), 0),
    );
  for (let i = 0; i < laneCount; i++) {
    const r = calendarScale(i);
    ink(c, grad, 0.16, 0.9);
    ellipse(c, cx, cy, rx * r, ry * r);
  }
  for (const e of events) {
    const radius = calendarScale(e.lane),
      a = e.from * TAU - Math.PI / 2,
      b = e.to * TAU - Math.PI / 2;
    for (let j = 0; j < 10; j++) {
      const r = radius - 0.044 + j * 0.008;
      ink(c, grad, j === 0 || j === 9 ? 0.9 : 0.35, 0.97);
      ellipse(c, cx, cy, rx * r, ry * r, a, b);
    }
    dot(
      c,
      cx + radius * rx * Math.cos(a),
      cy + radius * ry * Math.sin(a),
      2.35,
      COLOR.peach,
    );
  }
  const time = number(s.time) * 0.043;
  for (let j = 0; j < 32; j++) {
    const f = j / 31;
    ink(c, grad, 0.17 + 0.11 * (1 - f), 0.8);
    ellipse(
      c,
      cx,
      cy,
      rx * (0.27 + 0.065 * f),
      ry * (0.205 + 0.075 * Math.sin(f * TAU + time)),
      0,
      TAU,
      (f - 0.5) * 0.66,
    );
  }
  bead(c, cx, cy - ry, 3.5, COLOR.ice);
}

function makeSurface(source, w, h) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  const canvas = source.ownerDocument.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}
function primitives(c, w, h, sketch) {
  if (!Array.isArray(sketch)) return;
  const scale = Math.min(w, h);
  for (const p of sketch.slice(0, 240)) {
    if (!p || typeof p !== "object") continue;
    const color = typeof p.color === "string" ? p.color : COLOR.ice;
    // A fraction of the short edge, or a CSS pixel width when >= 0.1.
    let weight = number(p.width, 1.35);
    if (weight > 0 && weight < 0.1) weight *= scale;
    ink(c, color, 0.88, clip(weight, 0.45, 12));
    if (p.type === "path" && Array.isArray(p.points)) {
      c.beginPath();
      let started = false;
      for (const xy of p.points.slice(0, 900)) {
        if (
          !Array.isArray(xy) ||
          !Number.isFinite(+xy[0]) ||
          !Number.isFinite(+xy[1])
        )
          continue;
        place(
          c,
          started ? 1 : 0,
          clip(+xy[0], -2, 3) * w,
          clip(+xy[1], -2, 3) * h,
        );
        started = true;
      }
      c.stroke();
    } else if (p.type === "ring" || p.type === "point") {
      const x = clip(number(p.x, 0.5), -2, 3) * w,
        y = clip(number(p.y, 0.5), -2, 3) * h;
      const r =
        clip(number(p.r, p.type === "point" ? 0.005 : 0.1), 0, 2) * scale;
      if (p.type === "ring") ellipse(c, x, y, r, r);
      else dot(c, x, y, Math.max(0.5, r), color, 0.92);
    }
  }
}
function feedback(c, w, h, s) {
  const scale = Math.min(1, 1050 / w, 650 / h),
    pw = Math.max(1, Math.round(w * scale)),
    ph = Math.max(1, Math.round(h * scale));
  let mem = feedbackBuffers.get(c.canvas);
  const t = number(s.time);
  if (!mem || mem.w !== pw || mem.h !== ph || t < mem.t) {
    const front = makeSurface(c.canvas, pw, ph),
      back = makeSurface(c.canvas, pw, ph);
    mem = { w: pw, h: ph, front, back, t: null, sketch: null, signal: null };
    feedbackBuffers.set(c.canvas, mem);
  }
  if (mem.t !== t || mem.sketch !== s.sketch || mem.signal !== s.signal) {
    const g = mem.back.getContext("2d"),
      dt = mem.t === null ? 0.05 : clip(t - mem.t, 0.001, 0.2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, pw, ph);
    const gain = mapped(s, "feedback.gain")
      ? 0.91 + 0.075 * unit(s.signal, 0.63)
      : 0.966;
    const decay = Math.pow(gain, dt * 20),
      zoom = Math.pow(0.987, dt * 20);
    g.save();
    g.translate(pw * 0.5, ph * 0.5);
    g.rotate(dt * 0.065);
    g.scale(zoom, zoom);
    g.globalAlpha = decay;
    g.drawImage(mem.front, -pw * 0.5, -ph * 0.5);
    g.restore();
    const r = Math.min(pw * 0.337, ph * 0.32),
      cx = pw * 0.5,
      cy = ph * 0.5;
    const grad = spectrum(g, cx - r, cy + r * 0.5, cx + r, cy - r * 0.4);
    const tone = numericArray(s.signal) ? unit(s.signal, 0.42) : 0.5;
    for (let j = 0; j < 9; j++) {
      const z = j / 8 - 0.5;
      ink(g, grad, 0.32 - 0.15 * Math.abs(z), 0.9);
      g.beginPath();
      for (let i = 0; i <= 148; i++) {
        const a = (i * TAU) / 148;
        const u = (1 + Math.sin(2 * a - t * 0.11)) * 0.5;
        const signal = numericArray(s.signal)
          ? unit(s.signal, u)
          : 0.45 + 0.4 * Math.cos(3 * a + t * 0.16);
        const radius =
          0.8 +
          0.17 * Math.cos(3 * a + t * 0.12 + z * 0.45) +
          0.22 * (signal - 0.5);
        const x = Math.cos(a) * radius + 0.105 * Math.cos(4 * a + t * 0.15 + z);
        const y = Math.sin(a) * radius + 0.125 * Math.sin(2 * a - t * 0.24 + z);
        place(g, i, cx + r * x * (1.22 + 0.13 * tone), cy + r * y * 0.98);
      }
      g.stroke();
    }
    primitives(g, pw, ph, s.sketch);
    [mem.front, mem.back] = [mem.back, mem.front];
    mem.t = t;
    mem.sketch = s.sketch;
    mem.signal = s.signal;
  }
  c.globalAlpha = 1;
  c.drawImage(mem.front, 0, 0, w, h);
}

const painters = {
  clock: phaseClock,
  rain,
  loom,
  jobs,
  calendar,
  feedback,
  silk,
  waves: silk,
  dunes,
  orbit: harmonics,
  harmonics,
  music: paintMusic,
};
export function paint(ctx, w, h, s = {}, background = true) {
  if (!ctx || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return;
  ctx.save();
  try {
    ctx.globalCompositeOperation = "source-over";
    if (background) backdrop(ctx, w, h, s);
    else ctx.clearRect(0, 0, w, h);
    (painters[s.scene] || silk)(ctx, w, h, s);
    if (s.scene !== "feedback") primitives(ctx, w, h, s.sketch);
  } finally {
    ctx.restore();
  }
}

/** x and y are canvas-relative fractions. A hit returns the underlying datum. */
export function inspect(x, y, s = {}) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1
  )
    return null;
  if (s.scene === "loom" && s.days?.length) {
    const u = (x - 0.065) / 0.87;
    if (u < 0 || u > 1) return null;
    const hour = clip(Math.round(u * 23), 0, 23);
    let day = -1,
      nearest = Infinity;
    for (let j = 0; j < s.days.length; j++) {
      const d = Math.abs(loomY(s, j, u) - y);
      if (d < nearest) {
        nearest = d;
        day = j;
      }
    }
    if (nearest > 0.075) return null;
    return {
      day,
      hour,
      date: s.days[day].date,
      value: s.days[day].hours[hour],
    };
  }
  if (s.scene === "dunes" && mapped(s, "dunes.height")) {
    const hour = Math.round(x * (s.signal.length - 1));
    return { hour, value: s.signal[hour] };
  }
  if (s.scene === "rain" && s.radar?.bins) {
    const r = RADAR_RECT,
      u = (x - r.x) / r.w,
      v = (y - r.y) / r.h;
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : radarSample(s.radar, u, v);
  }
  if (s.scene === "jobs" && s.jobs?.length) {
    const u = (x - 0.06) / 0.88;
    if (u < 0 || u > 1) return null;
    const list = jobSeries(s),
      t = number(s.time);
    let winner = null,
      nearest = Infinity;
    list.forEach((j, k) => {
      const dist = Math.abs(jobY(jobRibbon(j, k, list.length, t), u, 0) - y);
      if (dist < nearest) {
        nearest = dist;
        winner = j;
      }
    });
    return nearest < 0.13 ? { job: winner } : null;
  }
  if (s.scene === "calendar") {
    const dx = (x - 0.5) / 0.345,
      dy = (y - 0.5) / 0.314;
    const f = ((Math.atan2(dy, dx) + Math.PI / 2 + TAU) % TAU) / TAU,
      r = Math.hypot(dx, dy);
    const match = calendarEntries(s)
      .filter((e) => f >= e.from && f <= e.to)
      .sort(
        (a, b) =>
          Math.abs(r - calendarScale(a.lane)) -
          Math.abs(r - calendarScale(b.lane)),
      )[0];
    if (match && Math.abs(r - calendarScale(match.lane)) < 0.09)
      return { event: match.event };
  }
  return null;
}
