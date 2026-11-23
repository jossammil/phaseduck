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
async function openFile(page, name, file) {
  const expected = page.waitForEvent("filechooser");
  await button(page, name).click();
  await (await expected).setFiles(file);
}

function tone() {
  const count = 8000 * 6;
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

async function check(browser, base, name) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, acceptDownloads: true, reducedMotion: "no-preference" });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  await button(page, "Export 4K still").click();
  for (const [orientation, dimensions] of [["landscape", [3840, 2160]], ["portrait", [2160, 3840]]]) {
    await page.getByLabel("Export orientation").selectOption(orientation);
    const download = page.waitForEvent("download");
    await button(page, "Download PNG").click();
    const filename = resolve(output, `${name}-${orientation}.png`);
    await (await download).saveAs(filename);
    const png = await readFile(filename);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], dimensions);
  }
  await button(page, "Close panel").click();
  await button(page, "Exit canvas").click();

  await selectScene(page, "terrain");
  await page.getByText("Natchez and the Mississippi River", { exact: true }).waitFor();
  await selectScene(page, "traffic-counts");
  await page.waitForFunction(() => document.querySelector("#detail").textContent.includes("Median vehicles per hour"));
  await openFile(page, "Open hourly counts CSV", { name: "traffic.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByText("Test 42", { exact: true }).waitFor();
  const canvas = page.locator("#art");
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * (0.085 + (0.92 - 0.085) * 6 / 23), y: box.height / 2 } });
  assert.match(await page.locator("#detail").innerText(), /Weekday 140 · Weekend 7 vehicles/);
  await button(page, "Use bundled counts").click();
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
  await page.setViewportSize({ width: 390, height: 780 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  let mapsLoads = 0;
  await page.route("https://maps.googleapis.com/**", (route) => {
    mapsLoads++;
    const key = new URL(route.request().url()).searchParams.get("key");
    return route.fulfill({ contentType: "text/javascript", body: key?.startsWith("invalid")
      ? "window.gm_authFailure();"
      : `window.google = {maps: {importLibrary: async () => ({
        Map: class { constructor(element, options) { element.textContent = 'Map at ' + options.center.lat; } },
        TrafficLayer: class { setMap() { document.body.dataset.traffic = 'on'; } },
      })}};
      window.phaseDeckTrafficReady();`
    });
  });
  await page.goto(base + "traffic.html");
  await button(page, "Load traffic map").click();
  assert.equal(mapsLoads, 0);
  await page.getByLabel("Your Google Maps JavaScript API key").fill("invalid-test-key-no-service");
  await button(page, "Load traffic map").click();
  await page.getByText(/Google rejected this key/).waitFor();
  await button(page, "Reload traffic view").click();
  await page.getByLabel("Your Google Maps JavaScript API key").fill("valid-test-key-no-service");
  await button(page, "Load traffic map").click();
  await page.getByText("Map at 32.299", { exact: true }).waitFor();
  assert.equal(await page.locator("body").getAttribute("data-traffic"), "on");
  assert.equal(mapsLoads, 2);
  assert.deepEqual(errors, []);
  console.log(name + " radar, composition persistence, 4K PNG, traffic counts, spectral history, and Maps UI passed");
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
