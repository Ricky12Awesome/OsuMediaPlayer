import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0 } });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async (cwd) => {
    const { default: React } = await import(
      `/@fs/${cwd}/node_modules/.vite/deps/react.js`
    );
    const {
      default: { createRoot },
    } = await import(`/@fs/${cwd}/node_modules/.vite/deps/react-dom_client.js`);
    const { AudioVisualizer } = await import("/src/AudioVisualizer.tsx");
    const { defaultVisualizer } = await import("/src/visualizer-settings.ts");
    document.body.innerHTML =
      '<div id="fixture" style="position:relative;width:600px;height:400px"></div>';
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const analyser = context.createAnalyser();
    oscillator.connect(analyser);
    oscillator.start();
    await context.resume();
    const root = createRoot(document.getElementById("fixture"));
    const upload = WebGLRenderingContext.prototype.bufferSubData;
    WebGLRenderingContext.prototype.bufferSubData = function (...args) {
      window.geometry = Array.from(args[2]);
      return upload.apply(this, args);
    };
    const setColor = WebGLRenderingContext.prototype.uniform3f;
    WebGLRenderingContext.prototype.uniform3f = function (...args) {
      window.visualizerColor = args.slice(1);
      return setColor.apply(this, args);
    };
    window.draws = 0;
    window.lit = 0;
    const original = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      original.apply(this, args);
      window.draws++;
      window.vertexCount = args[2];
      const pixels = new Uint8Array(
        this.drawingBufferWidth * this.drawingBufferHeight * 4,
      );
      this.readPixels(
        0,
        0,
        this.drawingBufferWidth,
        this.drawingBufferHeight,
        this.RGBA,
        this.UNSIGNED_BYTE,
        pixels,
      );
      window.lit = pixels.some((value) => value > 0);
    };
    window.renderVisualizer = (settings = {}, playing = true) => {
      const merged = {
        ...defaultVisualizer,
        ...settings,
        line: { ...defaultVisualizer.line, ...(settings.line || {}) },
        circle: { ...defaultVisualizer.circle, ...(settings.circle || {}) },
      };
      merged.profiles = { ...defaultVisualizer.profiles };
      for (const layout of ["line", "circle"]) {
        const profile = merged[layout];
        merged.profiles[`${layout}-${profile.mode}`] = profile;
      }
      root.render(
        React.createElement(AudioVisualizer, {
          analyser,
          playing,
          settings: merged,
        }),
      );
    };
    window.renderVisualizer();
  }, process.cwd());
  for (const layout of ["line", "circle"])
    for (const mode of ["fft", "waveform"])
      for (const mirrored of [false, true]) {
        await page.evaluate(
          (settings) => {
            window.lit = false;
            window.renderVisualizer(settings);
          },
          {
            layout,
            [layout]: { mode, mirrored },
          },
        );
        await page.waitForFunction(() => window.lit);
      }
  for (const mode of ["fft", "waveform"]) {
    await page.evaluate((mode) => {
      window.vertexCount = 0;
      window.renderVisualizer({
        layout: "circle",
        circle: {
          mode,
          mirrored: true,
          mirrorVertically: true,
          rotation: 0,
        },
      });
    }, mode);
    await page.waitForFunction(
      () => window.vertexCount > 0 && window.vertexCount % 12 === 0,
    );
    assert.equal(
      await page.evaluate(() => {
        const vertices = window.geometry;
        const bars = window.vertexCount / 6;
        for (let i = 0; i < bars / 2; i++)
          for (let v = 0; v < 6; v++) {
            const a = i * 12 + v * 2;
            const b = (bars - 1 - i) * 12 + v * 2;
            if (
              vertices[a] !== vertices[b] ||
              vertices[a + 1] !== -vertices[b + 1]
            )
              return false;
          }
        return true;
      }),
      true,
      "circle geometry is reflected exactly across its horizontal diameter",
    );
  }
  for (const color of ["32 160 224", "240 96 48"]) {
    await page.evaluate(
      (color) =>
        document
          .getElementById("fixture")
          .style.setProperty("--pink-rgb", color),
      color,
    );
    await page.waitForFunction(
      (color) =>
        color
          .split(" ")
          .map(Number)
          .every(
            (value, i) =>
              Math.abs(window.visualizerColor[i] - value / 255) < 0.0001,
          ),
      color,
    );
  }
  await page.evaluate(() => window.renderVisualizer({}, false));
  await page.waitForTimeout(100);
  const draws = await page.evaluate(() => window.draws);
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate((before) => window.draws > before, draws),
    true,
    "paused renderer continues with its idle animation",
  );
  await page.evaluate(() => window.renderVisualizer({ enabled: false }));
  await page.waitForFunction(
    () => !document.querySelector(".audio-visualizer"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Visualizer browser checks passed: eight style combinations, nonzero pixels, circle symmetry, dynamic theme, pause, disable.",
  );
} finally {
  await browser.close();
  await server.close();
}
