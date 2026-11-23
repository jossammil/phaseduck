import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const page = await browser.newPage();
  await page.goto(process.env.PHASE_URL || "http://127.0.0.1:4179/");
  await page.locator('[data-id="rain"]').click();
  await page.waitForFunction(
    () => document.querySelector("#readout").textContent === "Archive replay",
  );
  await page.getByLabel("Radar source").selectOption("live");
  await page.waitForFunction(
    () =>
      /Live observation|Source unavailable/.test(
        document.querySelector("#readout").textContent,
      ),
    {},
    { timeout: 80000 },
  );
  const live = await page.locator("#readout").innerText(),
    frame = await page.locator("#detail").innerText();
  console.log("Live feed:", live, frame);
  await page.route("https://mesonet.agron.iastate.edu/**", (r) => r.abort());
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector("#readout")
      .textContent.includes("Source unavailable"),
  );
  assert.ok(
    (await page.locator("#detail").innerText()).includes(
      frame.split(" · ").at(-1),
    ),
  );
  console.log(
    "Failed refresh retained the previous observation and original timestamp.",
  );
} finally {
  await browser.close();
}
