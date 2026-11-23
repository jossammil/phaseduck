const base = new URL("./data/radar/", document.baseURI);
let config;
export const radarRegions = [
  ["jackson", "Jackson, Mississippi"],
  ["gulf", "Mississippi Gulf Coast"],
];
export const radarModes = [["archive", "Storm archive"], ["live", "Latest observation"]];
export const radarStyles = [["glass", "Glass"], ["contours", "Contours"]];
export const defaultRadar = { region: "jackson", mode: "archive", style: "glass" };
const interval = 5 * 60000;
const frameLimit = 6;

function regionInfo(info, region) {
  return info.regions?.[region] || info;
}

export function radarSettings(value) {
  return {
    region: radarRegions.some(([id]) => id === value?.region) ? value.region : defaultRadar.region,
    mode: value?.mode === "live" ? "live" : "archive",
    style: value?.style === "contours" ? "contours" : "glass",
  };
}
async function checked(url, options) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    ...options,
  });
  if (!r.ok) throw new Error("Radar source returned " + r.status);
  return r;
}
export function metadata() {
  return (config ??= Promise.all(
    ["index.json", "palette.json"].map((f) =>
      checked(new URL(f, base)).then((r) => r.json()),
    ),
  ).catch((e) => {
    config = null;
    throw e;
  }));
}
async function decode(blob, frame, palette, source) {
  const image = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  image.close();
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const cols = 64,
    rows = 51,
    levels = Array(cols * rows).fill(null);
  let seen = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (!data[i + 3]) continue;
      const key = ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
        .toString(16)
        .padStart(6, "0");
      const dbz = palette[key];
      if (dbz === undefined) continue;
      seen++;
      const cell =
        Math.floor((y * rows) / c.height) * cols +
        Math.floor((x * cols) / c.width);
      levels[cell] = levels[cell] === null ? dbz : Math.max(levels[cell], dbz);
    }
  return {
    ...frame,
    source,
    cols,
    rows,
    levels,
    bins: levels.map((n) =>
      n === null ? null : Math.max(0, Math.min(1, (n + 30) / 105)),
    ),
    raw: c.toDataURL("image/png"),
    seen,
  };
}
export async function archive(index, region = "jackson") {
  const [info, palette] = await metadata();
  const selected = regionInfo(info, region);
  const frame = selected.frames[index];
  return decode(
    await (await checked(new URL(frame.file, base))).blob(),
    { ...frame, region: selected.region, bounds: selected.bounds },
    palette,
    "Archive replay",
  );
}
const availability = new Map();
function observationExists(timestamp, now) {
  for (const [key, item] of availability) if (now >= item.expires) availability.delete(key);
  if (availability.has(timestamp)) return availability.get(timestamp).promise;
  const at = new Date(timestamp).toISOString();
  const digits = at.replace(/[-:T]/g, "").slice(0, 12);
  const folder = at.slice(0, 10).replaceAll("-", "/");
  const entry = { expires: now + 60000 };
  entry.promise = fetch(
    "https://mesonet.agron.iastate.edu/archive/data/" + folder + "/GIS/uscomp/n0q_" + digits + ".png",
    { method: "HEAD", signal: AbortSignal.timeout(7000) },
  ).then((response) => {
    if (response.status === 404) return false;
    if (!response.ok) throw Error("Radar archive " + response.status);
    entry.expires = now + 12 * interval;
    return true;
  }).catch((error) => {
    availability.delete(timestamp);
    throw error;
  });
  availability.set(timestamp, entry);
  return entry.promise;
}

async function recent(region, previous, now, force) {
  const [info, palette] = await metadata();
  const area = regionInfo(info, region);
  const slot = Math.floor(now / interval) * interval;
  const known = new Map(previous.map((frame) => [Date.parse(frame.at), frame]));
  if (force && previous.length) {
    const timestamp = Date.parse(previous.at(-1).at);
    availability.delete(timestamp);
    await observationExists(timestamp, now);
  }
  const candidates = Array.from({ length: 11 }, (_, index) => slot - index * interval);
  const observations = await Promise.allSettled(candidates.map(async (time) =>
    known.has(time) || await observationExists(time, now) ? time : null,
  ));
  const available = observations.flatMap((item) => item.status === "fulfilled" && item.value != null ? [item.value] : []);
  const error = observations.find((item) => item.status === "rejected")?.reason;
  if (!available.length) throw error || Error("No recent observation available");
  const frames = await Promise.allSettled(available.slice(0, frameLimit).map(async (time) => {
    if (known.has(time)) return known.get(time);
    const at = new Date(time).toISOString();
    const url = new URL(area.frames[0].url);
    url.searchParams.set("TIME", at);
    return decode(await (await checked(url)).blob(),
      { at, url: url.href, region: area.region, bounds: area.bounds }, palette, "Live observation");
  }));
  const good = frames.flatMap((item) => item.status === "fulfilled" ? [item.value] : []).reverse();
  const frameError = frames.find((item) => item.status === "rejected")?.reason;
  if (!good.length) throw frameError || Error("No recent observation available");
  return { frames: good, error: error?.message || frameError?.message || "" };
}

export function setupRadar(changed) {
  const entries = new Map();
  function get(settings) {
    const { region, mode } = radarSettings(settings);
    const key = region + "/" + mode;
    if (!entries.has(key)) entries.set(key, { frames: [], pending: null, next: 0, error: "" });
    return entries.get(key);
  }
  function refresh(settings, force = false) {
    const { region, mode } = radarSettings(settings);
    const entry = get(settings);
    const now = Date.now();
    if (entry.pending || (!force && now < entry.next)) return entry.pending;
    if (mode === "archive" && entry.frames.length) return;
    entry.next = now + (mode === "live" ? interval : 15000);
    entry.pending = (mode === "live"
      ? recent(region, entry.frames, now, force)
      : Promise.all(Array.from({ length: frameLimit }, (_, index) => archive(index, region)))
        .then((frames) => ({ frames, error: "" })))
      .then(({ frames, error }) => {
        entry.frames = frames;
        if (mode === "archive") entry.next = Infinity;
        entry.error = error;
      })
      .catch((error) => { entry.error = error.message; })
      .finally(() => { entry.pending = null; changed(); });
    return entry.pending;
  }
  return { get, refresh };
}
