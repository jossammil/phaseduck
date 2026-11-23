const base = new URL("./data/radar/", document.baseURI);
let config;
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
export async function archive(index) {
  const [info, palette] = await metadata();
  const frame = info.frames[index];
  return decode(
    await (await checked(new URL(frame.file, base))).blob(),
    frame,
    palette,
    "Archive replay",
  );
}
export async function latest() {
  const [info, palette] = await metadata();
  const slot = Math.floor(Date.now() / 300000) * 300000;
  for (let ago = 0; ago < 5; ago++) {
    const at = new Date(slot - ago * 300000).toISOString();
    const digits = at.replace(/[-:T]/g, "").slice(0, 12);
    const dir = at.slice(0, 10).replaceAll("-", "/");
    const head =
      "https://mesonet.agron.iastate.edu/archive/data/" +
      dir +
      "/GIS/uscomp/n0q_" +
      digits +
      ".png";
    const presence = await fetch(head, {
      method: "HEAD",
      signal: AbortSignal.timeout(7000),
    });
    if (presence.status === 404) continue;
    if (!presence.ok) throw Error("Radar archive " + presence.status);
    const url = new URL(info.frames[0].url);
    url.searchParams.set("TIME", at);
    const r = await checked(url);
    return decode(
      await r.blob(),
      { at, url: url.href },
      palette,
      "Live observation",
    );
  }
  throw Error("No recent observation available");
}
