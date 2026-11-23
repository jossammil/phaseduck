import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { profileTraffic } from "../src/traffic-counts.js";

const root = resolve("dist");
const types = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".csv": "text/csv", ".wasm": "application/wasm",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const path = resolve(root, "." + url.pathname + (url.pathname.endsWith("/") ? "index.html" : ""));
  try {
    if (!path.startsWith(root + "/")) throw Error("invalid path");
    const file = await readFile(path);
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" }).end(file);
  } catch {
    res.writeHead(404).end();
  }
});
const listen = () => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const csv = "station_id,date,hour,vehicles\nTest 42,2024-01-04,6,80\nTest 42,2024-01-05,6,200\nTest 42,2024-01-06,6,7\n";
const rows = csv.trim().split("\n").slice(1).map((line) => {
  const [station_id, date, hour, vehicles] = line.split(",");
  return { station_id, date, hour, vehicles };
});
const expected = profileTraffic(rows);
assert.equal(expected.weekday[6], 140);
assert.equal(expected.weekend[6], 7);
assert.equal(expected.weekday[5], null);
assert.throws(() => profileTraffic([...rows, rows[0]]), /Duplicate/);
assert.throws(() => profileTraffic([{ ...rows[0], date: "2024-02-30" }]), /Data row/);

const observed = (await readFile("dist/data/fhwa-hourly-counts.csv", "utf8"))
  .trimEnd().split("\n").slice(1).map((line) => {
    const [station_id, date, hour, vehicles] = line.split(",");
    return { station_id, date, hour, vehicles };
  });
const bundled = JSON.parse(await readFile("dist/data/traffic-patterns.json", "utf8"));
assert.equal(observed.length, 744);
const { source, url, sample } = bundled;
assert.deepEqual(profileTraffic(observed, { source, url, sample }), bundled);

const tile = await readFile("dist/data/radar/gulf-2.png");
const output = await mkdtemp(resolve(tmpdir(), "phase-places-"));
const runners = [];
const button = (page, name) => page.getByRole("button", { name, exact: true }).first();
const selectScene = (page, id) => page.locator(`[data-id="${id}"]`).click();
const checkBox = (page, name) => page.getByRole("checkbox", { name, exact: true });
const hiddenExit = (page) => page.locator("#unfocus").evaluate((node) => getComputedStyle(node).clipPath !== "none");
async function openFile(page, name, file) {
  const expected = page.waitForEvent("filechooser");
  await button(page, name).click();
  await (await expected).setFiles(file);
}

function tone() {
  const count = 8000 * 12;
  const data = Buffer.alloc(44 + count * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(12000 * Math.sin(i * 2 * Math.PI * 441 / 8000)), 44 + i * 2);
  return { name: "test.wav", mimeType: "audio/wav", buffer: data };
}

async function focusOptions(page, settings) {
  await button(page, "Focus view").click();
  if (settings === "artwork") await button(page, "Artwork only").click();
  else for (const [name, checked] of Object.entries(settings)) await checkBox(page, name).setChecked(checked);
  await page.evaluate(() => { window.sceneText = []; });
  await button(page, "Enter Focus").click();
}

async function saveStill(page, name, orientation) {
  await page.getByLabel("Export orientation").selectOption(orientation);
  const download = page.waitForEvent("download");
  await button(page, "Download PNG").click();
  const filename = resolve(output, `${name}-${orientation}.png`);
  await (await download).saveAs(filename);
  const png = await readFile(filename);
  const size = orientation === "portrait" ? [2160, 3840] : [3840, 2160];
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], size);
  return png;
}

async function checkTouchFocus(browser, base) {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, hasTouch: true, reducedMotion: "reduce" });
  await page.goto(base);
  await button(page, "Focus view").click();
  await button(page, "Enter Focus").click();
  assert.ok(await hiddenExit(page));
  const box = await page.locator("#frame").boundingBox();
  await page.touchscreen.tap(box.x + 24, box.y + 19);
  await page.locator("#unfocus.revealed").waitFor();
  assert.equal(await hiddenExit(page), false);
  await button(page, "Exit Focus").tap();
  await button(page, "Focus view").waitFor();
  await page.close();
}

async function checkMusicThemes(page, name) {
  const stage = page.locator("#art");
  const corner = (canvas) => canvas.evaluate((node) => Array.from(node.getContext("2d").getImageData(0, 0, 1, 1).data));
  await button(page, "Pause motion").click();
  await focusOptions(page, "artwork");
  assert.deepEqual(await page.evaluate(() => window.sceneText), []);
  await page.keyboard.press("Escape");
  await button(page, "Music input").click();
  const theme = page.getByLabel("Music theme pack", { exact: true });
  const aesthetic = page.getByLabel("Music aesthetic", { exact: true });
  const palette = page.getByLabel("Music palette", { exact: true });
  const graphite = [23, 24, 27, 255];
  const phosphor = [6, 19, 15, 255];
  await theme.selectOption("phosphor");
  assert.deepEqual(await corner(stage), phosphor);
  const differentPaints = new Set();
  for (const style of ["waveform", "spectrum", "ribbons", "history"]) {
    await aesthetic.selectOption(style);
    differentPaints.add(await stage.evaluate((node) => node.toDataURL()));
  }
  assert.equal(differentPaints.size, 4);
  await palette.selectOption("warm");
  await theme.selectOption("graphite");
  assert.equal(await palette.inputValue(), "warm");
  assert.deepEqual(await corner(stage), graphite);
  await palette.selectOption("theme");
  await page.reload();
  await selectScene(page, "music");
  await button(page, "Music input").click();
  assert.equal(await theme.inputValue(), "graphite");
  assert.equal(await aesthetic.inputValue(), "history");
  await button(page, "Close panel").click();

  await button(page, "Compose").click();
  const layerTheme = page.getByLabel("Layer theme pack", { exact: true });
  assert.equal(await layerTheme.inputValue(), "graphite");
  const musicLayers = page.getByRole("img", { name: "Music Visualizer", exact: true });
  await page.getByLabel("Layer type").selectOption("music");
  await button(page, "Add layer").click();
  await layerTheme.selectOption("phosphor");
  assert.deepEqual(await corner(musicLayers.first()), graphite);
  assert.deepEqual(await corner(musicLayers.last()), [0, 0, 0, 0]);
  await checkBox(page, "Background").check();
  assert.deepEqual(await corner(musicLayers.last()), phosphor);
  await page.getByLabel("Layer type").selectOption("job-card");
  await button(page, "Add layer").click();
  await button(page, "Explore data").click();
  await openFile(page, "Open CSV or Parquet", {
    name: "bins.csv", mimeType: "text/csv", buffer: Buffer.from("reading\n1\n2\n3\n"),
  });
  await page.getByLabel("Numeric field").selectOption("reading");
  await button(page, "Add histogram layer").click();
  await focusOptions(page, "artwork");
  assert.equal(await page.locator(".job-layer").isVisible(), false);
  assert.equal(await page.locator(".histogram figcaption").isVisible(), false);
  assert.ok((await page.locator(".histogram-bars").boundingBox()).height > 0);
  assert.deepEqual(await page.evaluate(() => window.sceneText), []);
  await page.keyboard.press("Escape");
  assert.ok(await page.locator(".job-layer").isVisible());
  const compositionName = page.getByLabel("Composition name");
  await compositionName.fill("Music Studio");
  await button(page, "Save composition").click();
  await page.evaluate(() => {
    const key = "phase-deck-compositions";
    const records = JSON.parse(localStorage.getItem(key));
    const original = records.find(({ name }) => name === "Music Studio");
    const layer = structuredClone(original.layers[0]);
    delete layer.music.theme;
    layer.music.palette = "warm";
    records.push({ ...original, id: crypto.randomUUID(), name: "Original music layer", layers: [layer] });
    localStorage.setItem(key, JSON.stringify(records));
  });
  await page.reload();
  await button(page, "Compose").click();
  await button(page, "Saved compositions").click();
  await button(page, "Original music layer").click();
  assert.equal(await layerTheme.inputValue(), "classic");
  assert.equal(await page.getByLabel("Layer palette").inputValue(), "warm");
  await button(page, "Saved compositions").click();
  await button(page, "Music Studio").click();
  assert.deepEqual(await corner(musicLayers.first()), graphite);
  assert.deepEqual(await corner(musicLayers.last()), phosphor);
  await button(page, "Export 4K still").click();
  for (const orientation of ["landscape", "portrait"]) {
    const png = await saveStill(page, name + "-music", orientation);
    const pixel = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    }, png.toString("base64"));
    assert.deepEqual(pixel, graphite);
  }
  await button(page, "Close panel").click();
}

async function check(browser, base, name) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, acceptDownloads: true, reducedMotion: "no-preference" });
  page.setDefaultTimeout(12000);
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (this.canvas.closest?.(".focus .frame")) window.sceneText?.push(text);
      return fillText.call(this, text, ...args);
    };
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mapRequests = [];
  page.on("request", (request) => {
    if (/maps\.googleapis\.com|maps\.gstatic\.com/.test(request.url())) mapRequests.push(request.url());
  });
  let offlineRadar = false, radarRequests = 0;
  await page.route("https://mesonet.agron.iastate.edu/**", (route) => {
    radarRequests++;
    if (offlineRadar) return route.abort();
    return route.fulfill({
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" },
      body: route.request().method() === "HEAD" ? "" : tile,
    });
  });
  await page.goto(base);
  await selectScene(page, "rain");
  await page.getByLabel("Radar region", { exact: true }).selectOption("gulf");
  await page.getByLabel("Radar style", { exact: true }).selectOption("contours");
  await page.waitForFunction(() => document.querySelector("#detail").textContent.includes("Gulf Coast"));
  await button(page, "Source frame").click();
  await page.getByText(/2024-04-10T13:00:00Z/).waitFor();
  await button(page, "Close panel").click();
  await button(page, "Next").click();
  assert.match(await page.locator("#detail").innerText(), /13:30:00 UTC/);

  await button(page, "Pause motion").click();
  await focusOptions(page, { "Title and category": false });
  assert.equal(await page.locator(".scene-head").isVisible(), false);
  assert.ok(await page.locator(".readout").isVisible());
  assert.ok(await page.evaluate(() => window.sceneText.includes("50 dBZ")));
  assert.ok(await hiddenExit(page));
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "unfocus");
  assert.equal(await hiddenExit(page), false);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement.id), "focus");
  await focusOptions(page, { "Title and category": true, "Live readout": false });
  assert.ok(await page.locator(".scene-head").isVisible());
  assert.equal(await page.locator(".readout").isVisible(), false);
  await page.keyboard.press("Escape");
  await focusOptions(page, "artwork");
  assert.equal(await page.locator(".scene-head").isVisible(), false);
  assert.equal(await page.locator(".readout").isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.sceneText), []);
  await page.keyboard.down("o");
  await page.getByRole("heading", { name: "Observed radar", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator("#panel").waitFor({ state: "hidden" });
  assert.equal(await button(page, "Focus view").isVisible(), false);
  await page.keyboard.up("o");
  await page.keyboard.press("Escape");
  await button(page, "Focus view").waitFor();
  await button(page, "Resume motion").click();

  await page.getByLabel("Radar source", { exact: true }).selectOption("live");
  await page.getByText("Live observation", { exact: true }).waitFor();
  assert.ok(radarRequests >= 7);
  const last = await page.locator("#detail").innerText();
  offlineRadar = true;
  await button(page, "Refresh").click();
  await page.getByText("Source unavailable · stale", { exact: true }).waitFor();
  assert.equal(await page.locator("#detail").innerText(), last);

  await button(page, "Compose").click();
  assert.equal(await page.getByLabel("Layer radar region").inputValue(), "gulf");
  assert.equal(await page.getByLabel("Layer radar style").inputValue(), "contours");
  assert.equal(await page.getByLabel("Layer radar source").inputValue(), "live");
  await page.getByLabel("Layer radar source").selectOption("archive");
  await page.getByLabel("Composition name").fill("Coastline");
  await button(page, "Save composition").click();
  await page.reload();
  await button(page, "Compose").click();
  await button(page, "Saved compositions").click();
  await button(page, "Coastline").click();
  assert.equal(await page.getByLabel("Layer radar source").inputValue(), "archive");
  assert.equal(await page.getByLabel("Layer radar region").inputValue(), "gulf");
  await button(page, "Focus view").click();
  for (const label of ["Title and category", "Live readout", "Labels inside visuals"])
    assert.equal(await checkBox(page, label).isChecked(), false);
  await button(page, "Enter Focus").click();
  assert.equal(await page.locator(".resize-layer").isVisible(), false);
  await page.keyboard.press("Escape");
  assert.ok(await page.locator(".resize-layer").isVisible());
  assert.equal(await page.getByLabel("Composition name").inputValue(), "Coastline");
  await button(page, "Export 4K still").click();
  await saveStill(page, name + "-radar", "landscape");
  await button(page, "Close panel").click();
  await button(page, "Exit canvas").click();

  await selectScene(page, "terrain");
  await page.getByText("Natchez and the Mississippi River", { exact: true }).waitFor();
  await page.reload();
  await selectScene(page, "traffic-counts");
  await page.waitForFunction(() => document.querySelector("#detail").textContent.includes("Median vehicles per hour"));
  await openFile(page, "Open hourly counts CSV", { name: "traffic.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByText("Test 42", { exact: true }).waitFor();
  const canvas = page.locator("#art");
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * (0.085 + (0.92 - 0.085) * 6 / 23), y: box.height / 2 } });
  assert.match(await page.locator("#detail").innerText(), /Weekday 140 · Weekend 7 vehicles/);
  await button(page, "Compose").click();
  await page.getByLabel("Composition name").fill("Traffic sample");
  await button(page, "Save composition").click();
  await page.reload();
  await button(page, "Compose").click();
  await button(page, "Saved compositions").click();
  await button(page, "Traffic sample").click();
  const trafficLayer = page.getByRole("img", { name: "Traffic Patterns", exact: true });
  await trafficLayer.waitFor();
  await button(page, "Hide editor").click();
  const layerBox = await trafficLayer.boundingBox();
  await trafficLayer.click({ position: { x: layerBox.width * (0.085 + (0.92 - 0.085) * 6 / 23), y: layerBox.height / 2 } });
  await page.getByText(/Weekday 140 · Weekend 7 vehicles/).waitFor();
  await button(page, "Close panel").click();
  await page.reload();
  await selectScene(page, "traffic-counts");
  await page.waitForFunction(() => document.querySelector("#detail").textContent.includes("Median vehicles per hour"));
  assert.notEqual(await page.locator("#readout").innerText(), "Test 42");

  await selectScene(page, "music");
  await button(page, "Music input").click();
  await page.getByLabel("Music aesthetic").selectOption("history");
  await openFile(page, "Open audio file", tone());
  const status = page.locator("#music-status");
  if ((await status.textContent()).includes("paused")) await button(page, "Play file").click();
  await page.getByText("test.wav", { exact: true }).first().waitFor();
  await button(page, "Close panel").click();
  try {
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#art");
      const ctx = canvas.getContext("2d");
      const { data } = ctx.getImageData(canvas.width * 0.84, canvas.height * 0.54, canvas.width * 0.057, canvas.height * 0.06);
      return data.some((value, index) => index % 4 === 2 && value > 100);
    });
  } catch (error) {
    const detail = await page.locator("#detail").innerText();
    throw new Error(`${name} did not render spectral samples. ${detail}. ${errors.join(" ")}`, { cause: error });
  }
  await checkMusicThemes(page, name);
  await page.setViewportSize({ width: 390, height: 780 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await checkTouchFocus(browser, base);
  assert.equal((await page.request.get(base + "traffic.html")).status(), 404);
  assert.equal((await page.request.get(base + "traffic.js")).status(), 404);
  assert.deepEqual(mapRequests, []);
  assert.deepEqual(errors, []);
  console.log(name + " radar, offline traffic, Focus, themes, composition persistence, and 4K PNG passed");
}

try {
  await listen();
  const base = "http://127.0.0.1:" + server.address().port + "/";
  for (const [name, engine, path] of [
    ["Chrome", chromium, process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    ["WebKit", webkit, process.env.WEBKIT_BIN],
  ]) {
    if (name === "WebKit" && process.env.PHASE_WEBKIT === "0") continue;
    const runner = await engine.launchServer({ executablePath: path, timeout: 20000 });
    runners.push(runner);
    const browser = await engine.connect(runner.wsEndpoint(), { timeout: 10000 });
    await check(browser, base, name);
  }
} finally {
  server.closeAllConnections();
  server.close();
  await Promise.all(runners.map(async (runner) => {
    const deadline = setTimeout(() => runner.process().kill("SIGKILL"), 3500);
    try { await runner.close(); } finally { clearTimeout(deadline); }
  }));
  await rm(output, { recursive: true, force: true });
}
