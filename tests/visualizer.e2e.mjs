import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// This standalone fixture has its own browser profile and never reads a song
// list. Software WebGPU flags belong to the test, not to Electron's startup.
const fixturePath = resolve("tests/fixtures/visualizer.tsx");
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  plugins: [
    {
      name: "visualizer-browser-fixture",
      configureServer(vite) {
        vite.middlewares.use(
          "/__visualizer-test",
          async (_request, response) => {
            const html = await vite.transformIndexHtml(
              "/__visualizer-test",
              `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Visualizer verification</title></head><body><div id="root"></div><script type="module" src="/@fs/${fixturePath}"></script></body></html>`,
            );
            response.setHeader("Content-Type", "text/html");
            response.end(html);
          },
        );
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=vulkan",
    "--use-vulkan=swiftshader",
    "--use-webgpu-adapter=swiftshader",
    "--disable-vulkan-surface",
  ],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.addInitScript(() => {
  window.gpuTestStats = {
    submits: 0,
    destroys: 0,
    configurations: [],
    errors: [],
    losses: [],
  };
  if (!window.GPUQueue) return;
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (...args) {
    window.gpuTestStats.submits++;
    const result = submit.apply(this, args);
    window.captureVisualizerFrame?.();
    return result;
  };
  const destroy = GPUDevice.prototype.destroy;
  GPUDevice.prototype.destroy = function (...args) {
    window.gpuTestStats.destroys++;
    return destroy.apply(this, args);
  };
  const configure = GPUCanvasContext.prototype.configure;
  GPUCanvasContext.prototype.configure = function (configuration) {
    window.gpuTestDevice = configuration.device;
    window.gpuTestStats.configurations.push(configuration.alphaMode);
    void configuration.device.lost.then((info) =>
      window.gpuTestStats.losses.push({
        reason: info.reason,
        message: info.message,
      }),
    );
    configuration.device.addEventListener("uncapturederror", (event) => {
      window.gpuTestStats.errors.push(event.error.message);
    });
    return configure.call(this, configuration);
  };
});

async function update(settings) {
  await page.evaluate((next) => window.visualizerTest.update(next), settings);
  await page.waitForTimeout(160);
}
async function snapshot() {
  return page.evaluate(() => window.visualizerTest.snapshot());
}
async function assertIdle(message) {
  await page.waitForTimeout(200);
  const count = await page.evaluate(() => window.gpuTestStats.submits);
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => window.gpuTestStats.submits),
    count,
    message,
  );
}

try {
  const port = server.httpServer.address().port;
  await page.goto(`http://127.0.0.1:${port}/__visualizer-test`);
  await page.waitForFunction(() => !!window.visualizerTest);
  assert.ok(
    await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter())),
    "A WebGPU adapter is required; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a compatible Chromium if needed",
  );
  await page
    .getByTestId("visualizer-status")
    .filter({ hasText: /^ready/ })
    .waitFor({ timeout: 10000 });
  assert.ok(
    (await page.evaluate(() => window.gpuTestStats.configurations)).every(
      (mode) => mode === "premultiplied",
    ),
    "The overlay uses transparent premultiplied alpha",
  );
  await assertIdle("Paused media must not keep submitting GPU frames");

  await page.getByRole("tab", { name: "Visualizer", exact: true }).click();
  assert.equal(
    await page
      .getByRole("tab", { name: "Visualizer", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page
    .getByRole("spinbutton", { name: "Response time (ms)", exact: true })
    .fill("15");
  await page
    .getByRole("spinbutton", { name: "Response time (ms)", exact: true })
    .press("Enter");
  assert.equal(
    await page.evaluate(
      () => window.visualizerTest.settings().responsivenessMs,
    ),
    15,
  );
  await page.reload();
  await page.waitForFunction(() => !!window.visualizerTest);
  assert.equal(
    await page.evaluate(
      () => window.visualizerTest.settings().responsivenessMs,
    ),
    15,
    "Configuration survives a reload",
  );
  await page
    .getByTestId("visualizer-status")
    .filter({ hasText: /^ready/ })
    .waitFor({ timeout: 10000 });
  await update({
    style: "circle",
    mode: "waveform",
    responsivenessMs: 0,
    glow: 0,
    boom: 0,
    beatImpact: 0,
    bassImpact: 0,
    barLength: 40,
    rotationSpeed: 0,
    colorMode: "custom",
    color1: "#ff0000",
    color2: "#ff0000",
  });

  await page.evaluate(() => window.visualizerTest.play(0.03));
  await page.waitForTimeout(350);
  const quiet = await snapshot();
  await page.evaluate(() => window.visualizerTest.play(0.75));
  await page.waitForTimeout(350);
  const loud = await snapshot();
  assert.ok(
    (await page.evaluate(() => window.visualizerTest.analyserPeak())) > 0.5,
    "The analyser receives decoded playing audio",
  );
  assert.ok(
    loud.visible > quiet.visible * 1.2,
    `Audio amplitude changes rendered bar lengths (${quiet.visible} → ${loud.visible} pixels)`,
  );
  assert.ok(
    loud.transparent > loud.visible,
    "Artwork remains visible through most of the canvas",
  );
  assert.ok(
    loud.red > loud.green * 5 && loud.red > loud.blue * 5,
    "Custom red colors reach the actual shader output",
  );

  await update({ colorMode: "theme" });
  await page.evaluate(() => window.visualizerTest.theme("#00ff00"));
  await page.waitForTimeout(120);
  const themed = await snapshot();
  assert.ok(
    themed.green > themed.red * 2,
    "Current theme color changes reach the shader",
  );

  for (const style of ["ring", "double-ring", "line"]) {
    await update({ style, mode: "spectrum", colorMode: "custom" });
    assert.ok(
      (await snapshot()).visible > 0,
      `${style} renders actual FFT data`,
    );
  }
  for (const linePosition of [
    "top",
    "bottom",
    "left",
    "right",
    "middle-horizontal",
    "middle-vertical",
  ]) {
    await update({ linePosition, mode: "energy" });
    assert.ok(
      (await snapshot()).visible > 0,
      `${linePosition} renders actual energy data`,
    );
  }

  await update({
    style: "circle",
    mode: "energy",
    barLength: 20,
    sensitivity: 5,
    centerOffset: 0,
  });
  const outward = await snapshot();
  await update({ centerOffset: 50 });
  const centered = await snapshot();
  await update({ centerOffset: 100 });
  const inward = await snapshot();
  assert.ok(
    outward.minRadius >= 167 && outward.maxRadius > 260,
    "0% offset grows away from the circle center",
  );
  assert.ok(
    centered.minRadius < 120 && centered.maxRadius > 220,
    "50% offset divides growth equally across the circle",
  );
  assert.ok(
    inward.maxRadius <= 174 && inward.minRadius < 80,
    "100% offset grows toward the circle center",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await update({
    centerOffset: 50,
    rotationSpeed: 90,
    boom: 100,
    bassImpact: 100,
    beatImpact: 100,
    respectReducedMotion: true,
  });
  const calm = await snapshot();
  await page.waitForTimeout(180);
  assert.equal(
    (await snapshot()).hash,
    calm.hash,
    "Reduced motion suppresses rotation and boom effects on a held signal",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await update({
    rotationSpeed: 0,
    boom: 0,
    bassImpact: 0,
    beatImpact: 0,
    sensitivity: 1.5,
  });

  await update({
    style: "circle",
    mode: "spectrum",
    maxFps: 30,
    resolution: 50,
  });
  const backingSize = await page.locator("canvas").evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
  }));
  assert.ok(Math.abs(backingSize.width - backingSize.cssWidth * 0.5) <= 1);
  assert.ok(Math.abs(backingSize.height - backingSize.cssHeight * 0.5) <= 1);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const before = await cdp.send("Performance.getMetrics");
  const submitsBefore = await page.evaluate(() => window.gpuTestStats.submits);
  await page.waitForTimeout(1000);
  const after = await cdp.send("Performance.getMetrics");
  const submitted =
    (await page.evaluate(() => window.gpuTestStats.submits)) - submitsBefore;
  assert.ok(
    submitted > 0 && submitted <= 35,
    `30 FPS setting bounds submissions (${submitted})`,
  );
  const metric = (metrics, name) =>
    metrics.metrics.find((value) => value.name === name)?.value ?? 0;
  console.log(
    JSON.stringify({
      visualizerPerformance: {
        submittedFrames: submitted,
        sampleSeconds: 1,
        mainThreadTaskMs: Math.round(
          (metric(after, "TaskDuration") - metric(before, "TaskDuration")) *
            1000,
        ),
        scriptMs: Math.round(
          (metric(after, "ScriptDuration") - metric(before, "ScriptDuration")) *
            1000,
        ),
        backend: "Chromium software WebGPU",
      },
    }),
  );
  await update({ maxFps: 0 });
  const uncappedBefore = await page.evaluate(() => window.gpuTestStats.submits);
  await page.waitForTimeout(1000);
  const uncappedSubmitted =
    (await page.evaluate(() => window.gpuTestStats.submits)) - uncappedBefore;
  assert.ok(
    uncappedSubmitted > submitted,
    `Max frame rate removes the 30 FPS cap (${uncappedSubmitted} frames)`,
  );
  await mkdir("test-results", { recursive: true });
  await page.getByRole("tab", { name: "Visualizer", exact: true }).click();
  await page.screenshot({ path: "test-results/visualizer.png" });

  await page.evaluate(() => window.visualizerTest.pause());
  await assertIdle("Pausing releases the animation loop");
  await page
    .getByRole("button", { name: "Restore visualizer defaults", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.visualizerTest.settings().centerOffset),
    50,
  );
  assert.equal(
    await page.evaluate(
      () => window.visualizerTest.settings().responsivenessMs,
    ),
    80,
  );
  await page
    .getByRole("button", { name: "Enable visualizer", exact: true })
    .click();
  await page
    .getByTestId("visualizer-status")
    .filter({ hasText: /^off/ })
    .waitFor();
  await page.evaluate(() => window.visualizerTest.play(0.75));
  await assertIdle("Disabled visualization does not render while audio plays");
  assert.ok(
    (await page.evaluate(() => window.visualizerTest.analyserPeak())) > 0.5,
    "Disabling the visualizer leaves audio playback alive",
  );
  await page
    .getByRole("button", { name: "Enable visualizer", exact: true })
    .click();
  await page
    .getByTestId("visualizer-status")
    .filter({ hasText: /^ready/ })
    .waitFor({ timeout: 10000 });
  await page.waitForTimeout(200);
  assert.ok(
    (await snapshot()).visible > 0,
    "Re-enabling resumes current playback",
  );
  await page.evaluate(() => window.gpuTestDevice.destroy());
  await page
    .getByTestId("visualizer-status")
    .filter({ hasText: /^error/ })
    .waitFor();
  await assertIdle("Losing the device stops rendering");
  assert.ok(
    (await page.evaluate(() => window.visualizerTest.analyserPeak())) > 0.5,
    "Device loss leaves audio running",
  );
  await update({ enabled: false });
  await update({ enabled: true });
  await page
    .getByTestId("visualizer-status")
    .filter({ hasText: /^ready/ })
    .waitFor();
  assert.ok(
    (await snapshot()).visible > 0,
    "Toggling restores rendering after device loss",
  );
  const destroyedBefore = await page.evaluate(
    () => window.gpuTestStats.destroys,
  );
  await page.evaluate(() => window.visualizerTest.unmount());
  await assertIdle("Unmounting cancels scheduled GPU work");
  assert.ok(
    (await page.evaluate(() => window.gpuTestStats.destroys)) > destroyedBefore,
    "Unmounting disposes the GPU device",
  );
  assert.deepEqual(
    await page.evaluate(() => window.gpuTestStats.errors),
    [],
    "No uncaptured WebGPU validation errors",
  );
  assert.deepEqual(errors, [], "No browser runtime errors");
  const unsupported = await browser.newPage();
  await unsupported.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined }),
  );
  await unsupported.goto(`http://127.0.0.1:${port}/__visualizer-test`);
  await unsupported
    .getByTestId("visualizer-status")
    .filter({ hasText: /^unsupported/ })
    .waitFor();
  await unsupported.evaluate(() => window.visualizerTest.play(0.75));
  await unsupported.waitForFunction(
    () => window.visualizerTest.analyserPeak() > 0.5,
  );
  await unsupported.evaluate(() => window.visualizerTest.unmount());
  await unsupported.close();
  console.log("Visualizer browser verification passed.");
} catch (error) {
  console.error(
    "Visualizer failure:",
    await page.evaluate(() => window.gpuTestStats),
    await page
      .getByTestId("visualizer-status")
      .textContent()
      .catch(() => "No status"),
    errors,
  );
  console.error(
    "GPU initialization diagnostic:",
    await page.evaluate(async () => {
      try {
        const { createVisualizerRenderer } =
          await import("/src/visualizer-gpu.ts");
        const renderer = await createVisualizerRenderer(
          document.createElement("canvas"),
          () => {},
        );
        renderer.dispose();
        return "Successful direct initialization";
      } catch (failure) {
        const { default: code } = await import("/src/visualizer.wgsl?raw");
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();
        const info = await device
          .createShaderModule({ code })
          .getCompilationInfo();
        device.destroy();
        return {
          error: String(failure),
          messages: info.messages.map((message) => ({
            message: message.message,
            line: message.lineNum,
            position: message.linePos,
          })),
        };
      }
    }),
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
