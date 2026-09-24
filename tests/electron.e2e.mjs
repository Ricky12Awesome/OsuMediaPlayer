import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

// Keep the packaged-app smoke and shared-control geometry checks independent
// of a user's osu!lazer song list.
const electronEnv = { ...process.env, ELECTRON_RENDERER_URL: "" };
delete electronEnv.ELECTRON_RUN_AS_NODE;

const userData = await mkdtemp(join(tmpdir(), "osu-media-player-e2e-"));
const app = await electron.launch({
  args: [".", "--no-sandbox", `--user-data-dir=${userData}`],
  env: electronEnv,
});

try {
  const page = await app.firstWindow();
  await page.waitForSelector(".app-shell");
  assert.equal(await page.title(), "OsuMediaPlayer");
  assert.ok(await page.locator(".transport").count());

  await page.mouse.move(1, 1);
  await page.waitForTimeout(1500);
  const shell = page.locator(".app-shell");
  assert.equal(
    await shell.evaluate((element) =>
      element.classList.contains("controls-always-visible"),
    ),
    true,
  );
  assert.equal(
    await page
      .locator(".transport")
      .evaluate((element) => getComputedStyle(element).opacity),
    "1",
  );
  await page.keyboard.press("Control+e");
  assert.equal(
    await shell.evaluate((element) =>
      element.classList.contains("controls-always-visible"),
    ),
    false,
  );
  await page.waitForTimeout(1500);
  assert.equal(
    await shell.evaluate((element) =>
      element.classList.contains("fullscreen-controls-visible"),
    ),
    false,
  );
  assert.equal(
    await page
      .locator(".transport")
      .evaluate((element) => getComputedStyle(element).opacity),
    "0",
  );

  const panelToggle = page.getByRole("button", {
    name: /Show settings|Hide settings/,
  });
  if ((await panelToggle.getAttribute("aria-expanded")) !== "true") {
    await panelToggle.click();
  }

  const settingsControlMetrics = await page.evaluate(() => {
    const metric = (selector) => {
      const element = document.querySelector(selector);
      assertElement(element, selector);
      return {
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        height: element.getBoundingClientRect().height,
      };
    };
    const assertElement = (element, selector) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing settings control: ${selector}`);
      }
    };
    return {
      choice: metric(".side-panel-content .settings-choice-option"),
      picker: metric(".side-panel-content .settings-picker-trigger"),
      toggle: metric(".side-panel-content .settings-switch"),
    };
  });
  assert.ok(settingsControlMetrics.toggle.fontSize >= 16);
  assert.ok(settingsControlMetrics.toggle.height >= 40);
  assert.equal(
    settingsControlMetrics.choice.height,
    settingsControlMetrics.toggle.height,
  );
  assert.equal(
    settingsControlMetrics.picker.height,
    settingsControlMetrics.toggle.height,
  );
  await page.getByRole("tab", { name: "Visualizer", exact: true }).click();
  const response = page.getByRole("spinbutton", {
    name: "Response time (ms)",
    exact: true,
  });
  await response.fill("15");
  await response.press("Enter");
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("visualizer-settings"))
          .responsivenessMs,
    ),
    15,
  );
  const canvas = page.locator(".artwork-stage .audio-visualizer");
  assert.equal(await canvas.count(), 1);
  assert.equal(
    await canvas.evaluate((element) => getComputedStyle(element).pointerEvents),
    "none",
  );
  await page
    .getByRole("button", { name: "Enable visualizer", exact: true })
    .click();
  assert.equal(await canvas.count(), 0);
  await page
    .getByRole("button", { name: "Enable visualizer", exact: true })
    .click();
  assert.equal(await canvas.count(), 1);
  await page.getByRole("tab", { name: "Visualizer", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page
      .getByRole("tab", { name: "General", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
