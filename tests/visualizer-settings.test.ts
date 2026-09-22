import assert from "node:assert/strict";
import test from "node:test";
import { createPreferencesStore } from "../src/renderer/src/preferences";
import {
  applyVisualizerPreset,
  defaultVisualizerSettings,
  parseVisualizerSettings,
} from "../src/renderer/src/visualizer-settings";

test("visualizer settings recover independently from malformed persisted fields", () => {
  const settings = parseVisualizerSettings({
    style: "ring",
    mode: "unsafe",
    enabled: "false",
    fftSize: 1234,
    barCount: 1e9,
    barLength: -10,
    sensitivity: Infinity,
    rotationSpeed: NaN,
    color1: "url(https://example.com)",
    color2: "#Ab12EF",
    maxFps: 900,
    resolution: 200,
    unknownField: "discard",
  });
  assert.equal(settings.style, "ring");
  assert.equal(settings.mode, defaultVisualizerSettings.mode);
  assert.equal(settings.enabled, true);
  assert.equal(settings.fftSize, 2048);
  assert.equal(settings.barCount, 256);
  assert.equal(settings.barLength, 0);
  assert.equal(settings.sensitivity, defaultVisualizerSettings.sensitivity);
  assert.equal(settings.rotationSpeed, 0);
  assert.equal(settings.color1, defaultVisualizerSettings.color1);
  assert.equal(settings.color2, "#ab12ef");
  assert.equal(settings.maxFps, 60);
  assert.equal(settings.resolution, 100);
  assert.equal("unknownField" in settings, false);
});

test("max frame rate option disables the visualizer FPS cap", () => {
  assert.equal(parseVisualizerSettings({ maxFps: 0 }).maxFps, 0);
  assert.equal(parseVisualizerSettings({ maxFps: -1 }).maxFps, 60);
});

test("visualizer radius can be reduced to one percent", () => {
  assert.equal(parseVisualizerSettings({ radius: 1 }).radius, 1);
});

test("wire line and ripple line are supported visualizer styles", () => {
  assert.equal(
    parseVisualizerSettings({ style: "line-ripple" }).style,
    "wire-line",
  );
  assert.equal(
    parseVisualizerSettings({ style: "ripple-line" }).style,
    "ripple-line",
  );
});

test("line padding is persisted and clamped", () => {
  assert.equal(parseVisualizerSettings({ linePadding: 24 }).linePadding, 24);
  assert.equal(parseVisualizerSettings({ linePadding: 100 }).linePadding, 40);
});

test("visualizer supports instant response and both center-offset limits", () => {
  const settings = parseVisualizerSettings({
    enabled: false,
    responsivenessMs: 0,
    centerOffset: 0,
    rotationSpeed: -180,
    barCount: 12.8,
    glow: 0,
    boom: 0,
  });
  assert.equal(settings.enabled, false);
  assert.equal(settings.responsivenessMs, 0);
  assert.equal(settings.centerOffset, 0);
  assert.equal(settings.rotationSpeed, -180);
  assert.equal(settings.barCount, 13);
  assert.equal(settings.glow, 0);
  assert.equal(settings.boom, 0);
  assert.equal(
    parseVisualizerSettings({ centerOffset: 100 }).centerOffset,
    100,
  );
});

test("custom frequency ranges are validated and migrate old windows", () => {
  assert.deepEqual(
    parseVisualizerSettings({
      frequencyRanges: [
        { min: 15000, max: 20000 },
        { min: 5000, max: 10000 },
        { min: 20, max: 1000 },
      ],
    }).frequencyRanges,
    [
      { min: 20, max: 1000 },
      { min: 5000, max: 10000 },
      { min: 15000, max: 20000 },
    ],
  );
  assert.deepEqual(
    parseVisualizerSettings({
      frequencyRanges: [
        { min: -10, max: 30 },
        { min: 50, max: 50000 },
      ],
    }).frequencyRanges,
    [
      { min: 20, max: 30 },
      { min: 50, max: 22050 },
    ],
  );
  assert.equal(
    parseVisualizerSettings({
      frequencyRanges: [
        { min: 20, max: 1000 },
        { min: 500, max: 1500 },
      ],
    }).frequencyRanges.length,
    2,
  );
  assert.deepEqual(
    parseVisualizerSettings({ minFrequency: 80, maxFrequency: 400 })
      .frequencyRanges,
    [{ min: 80, max: 400 }],
  );
});

test("missing visualizer settings return fresh defaults", () => {
  for (const value of [null, undefined, "invalid", 42, [], {}]) {
    const settings = parseVisualizerSettings(value);
    assert.deepEqual(settings, defaultVisualizerSettings);
    assert.notEqual(settings, defaultVisualizerSettings);
  }
});

test("visualizer presets retain every setting they do not define", () => {
  const settings = parseVisualizerSettings({
    enabled: false,
    colorMode: "custom",
    color1: "#123456",
    color2: "#abcdef",
    resolution: 50,
    maxFps: 30,
    respectReducedMotion: false,
    rotationSpeed: -90,
  });
  const next = applyVisualizerPreset(settings, 2);
  assert.equal(next.style, "line");
  assert.equal(next.linePosition, "bottom");
  assert.equal(next.centerOffset, 0);
  assert.equal(next.rotationSpeed, settings.rotationSpeed);
  for (const key of [
    "enabled",
    "colorMode",
    "color1",
    "color2",
    "resolution",
    "maxFps",
    "respectReducedMotion",
  ] as const) {
    assert.equal(next[key], settings[key]);
  }
  assert.equal(next.gap, settings.gap);
  assert.equal(next.centerOffset, 0);
  assert.equal(next.boom, settings.boom);
  assert.equal(applyVisualizerPreset(settings, -1), settings);
});

test("visualizer preferences persist and recover from old or corrupted storage", () => {
  const data = new Map<string, string>();
  const preferences = createPreferencesStore({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  });
  assert.deepEqual(preferences.get("visualizer"), defaultVisualizerSettings);
  const settings = parseVisualizerSettings({
    style: "ring",
    responsivenessMs: 15,
    centerOffset: 100,
  });
  preferences.set("visualizer", settings);
  assert.deepEqual(preferences.get("visualizer"), settings);
  data.set(
    "visualizer-settings",
    JSON.stringify({ enabled: false, barCount: 10000 }),
  );
  assert.equal(preferences.get("visualizer").enabled, false);
  assert.equal(preferences.get("visualizer").barCount, 256);
  assert.equal(preferences.get("visualizer").style, "circle");
  data.set("visualizer-settings", "{broken");
  assert.deepEqual(preferences.get("visualizer"), defaultVisualizerSettings);
});
