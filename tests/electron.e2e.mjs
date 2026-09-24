import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { startElectronBootstrap } from "./fixtures/electron-bootstrap.mjs";

const mediaTypes = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  png: "image/png",
  mp4: "video/mp4",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
};

const installPath = resolve("tests/environment");
const manifest = JSON.parse(
  await readFile(join(installPath, "manifest.json"), "utf8"),
);
const userData = await mkdtemp(join(tmpdir(), "osu-media-player-e2e-"));
let bootstrap;
let app;
try {
  bootstrap = await startElectronBootstrap();
  const electronEnv = {
    ...process.env,
    ELECTRON_RENDERER_URL: bootstrap.url,
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [".", "--no-sandbox", `--user-data-dir=${userData}`],
    env: electronEnv,
  });
  const page = await app.firstWindow();
  await page.addInitScript((path) => {
    localStorage.setItem("song-list-path", JSON.stringify(path));
  }, installPath);
  await app.evaluate(
    ({ BrowserWindow }, filename) => {
      void BrowserWindow.getAllWindows()[0].loadFile(filename);
    },
    join(process.cwd(), "dist/index.html"),
  );
  await page.waitForSelector(".app-shell");
  await page.waitForFunction(
    (count) =>
      document
        .querySelector(".song-list-footer")
        ?.textContent?.includes(`${count} songs in your song list`),
    manifest.songs.length,
  );
  const loadedSongs = await page.evaluate(async () =>
    (await window.playerAPI.querySongList({ limit: 10 })).items.map((song) => ({
      title: song.title,
      audioHash: song.audioHash,
      backgroundHash: song.backgroundHash,
      videoHash: song.videoHash,
    })),
  );
  for (const expected of manifest.songs) {
    const song = loadedSongs.find((item) => item.title === expected.title);
    assert.ok(song, `Missing ${expected.title}`);
    assert.equal(song.audioHash, expected.audio.hash);
    assert.equal(song.backgroundHash, expected.background?.hash);
    assert.equal(song.videoHash, expected.video?.hash);
    for (const asset of [expected.audio, expected.background, expected.video]) {
      if (!asset) continue;
      const response = await page.evaluate(async (hash) => {
        const result = await fetch(`omp://asset/${hash}`, {
          headers: { Range: "bytes=0-31" },
        });
        return {
          status: result.status,
          type: result.headers.get("content-type"),
          length: (await result.arrayBuffer()).byteLength,
        };
      }, asset.hash);
      assert.deepEqual(response, {
        status: 206,
        type: mediaTypes[asset.filename.split(".").at(-1)],
        length: 32,
      });
    }
  }
  assert.equal(await page.title(), "OsuMediaPlayer");
  assert.ok(await page.locator(".transport").count());

  await page.mouse.move(1, 1);
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".transport")).opacity === "1",
  );
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
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".app-shell")
        ?.classList.contains("fullscreen-controls-visible"),
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".transport")).opacity === "0",
  );
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
  await page.keyboard.press("Control+e");
  await page.waitForFunction(() =>
    document
      .querySelector(".app-shell")
      ?.classList.contains("controls-always-visible"),
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
  await app?.close();
  await bootstrap?.close();
  await rm(userData, { recursive: true, force: true });
}
