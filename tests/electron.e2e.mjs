import assert from "node:assert/strict";
import { _electron as electron } from "playwright";

// Keep the packaged-app smoke and shared-control geometry checks independent
// of a user's osu!lazer library.
const electronEnv = { ...process.env, ELECTRON_RENDERER_URL: "" };
delete electronEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  args: [".", "--no-sandbox"],
  env: electronEnv,
});

try {
  const page = await app.firstWindow();
  await page.waitForSelector(".app-shell");
  assert.equal(await page.title(), "osu! music");
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

  await page.getByRole("tab", { name: "Settings" }).click();
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

  await page.getByRole("tab", { name: "Visualizer" }).click();
  const visualizerMetrics = await page.evaluate(() => {
    const readGroup = (label) => {
      const group = document.querySelector(`[aria-label="${label}"]`);
      const options = group?.querySelector(".settings-choice-group");
      const text = group?.querySelector(".settings-row-label");
      if (
        !(group instanceof HTMLElement) ||
        !(options instanceof HTMLElement) ||
        !(text instanceof HTMLElement)
      ) {
        throw new Error(`Missing visualizer group: ${label}`);
      }
      const groupRect = group.getBoundingClientRect();
      const optionRect = options.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      return {
        buttonsFit: [...options.querySelectorAll("button")].every(
          (button) => button.scrollWidth <= button.clientWidth,
        ),
        rightGap: groupRect.right - optionRect.right,
        sameLine:
          Math.abs(
            textRect.top +
              textRect.height / 2 -
              (optionRect.top + optionRect.height / 2),
          ) < 1,
        separated: textRect.right <= optionRect.left,
      };
    };
    const heading = document.querySelector(
      ".visualizer-settings > .settings-label",
    );
    const visualizerToggle = document.querySelector(
      ".visualizer-settings .settings-switch",
    );
    const visualizerChoice = document.querySelector(
      ".visualizer-settings .settings-choice-option",
    );
    if (
      !(heading instanceof HTMLElement) ||
      !(visualizerToggle instanceof HTMLElement) ||
      !(visualizerChoice instanceof HTMLElement)
    ) {
      throw new Error("Missing visualizer controls");
    }
    return {
      choiceHeight: visualizerChoice.getBoundingClientRect().height,
      headingVisible: getComputedStyle(heading).display !== "none",
      mode: readGroup("Visualizer mode"),
      style: readGroup("Visualizer style"),
      toggleHeight: visualizerToggle.getBoundingClientRect().height,
    };
  });
  assert.equal(visualizerMetrics.headingVisible, true);
  assert.equal(
    visualizerMetrics.toggleHeight,
    settingsControlMetrics.toggle.height,
  );
  assert.equal(
    visualizerMetrics.choiceHeight,
    settingsControlMetrics.choice.height,
  );
  for (const group of [visualizerMetrics.style, visualizerMetrics.mode]) {
    assert.ok(Math.abs(group.rightGap) < 0.5);
    assert.equal(group.sameLine, true);
    assert.equal(group.separated, true);
    assert.equal(group.buttonsFit, true);
  }
} finally {
  await app.close();
}
