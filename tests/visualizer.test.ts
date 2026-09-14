import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultVisualizer,
  parseVisualizer,
  fftLeadingOffset,
  retainWaveform,
  visualizerBarIndex,
} from "../src/renderer/src/visualizer-settings";

test("visualizer settings recover from invalid storage", () => {
  for (const value of [null, "{", "null", "42"])
    assert.deepEqual(parseVisualizer(value), defaultVisualizer);
});
test("visualizer settings bound rendering work and preserve supported options", () => {
  const settings = parseVisualizer(
    JSON.stringify({
      enabled: false,
      bars: 10000,
      width: -4,
      length: "bad",
      mirrored: false,
      layout: "circle",
      mode: "waveform",
    }),
  );
  assert.equal(settings.enabled, false);
  assert.equal(settings.layout, "circle");
  assert.deepEqual(settings.line, {
    mode: "waveform",
    bars: 256,
    width: 10,
    length: 70,
    radius: 23,
    waveformMultiplier: 10,
    waveformRetention: 200,
    fftRetention: 200,
    mirrored: false,
    flipped: false,
    mirrorVertically: false,
    inwardLength: 0,
  });
  assert.deepEqual(settings.circle, settings.line);
});

test("mirroring reflects the sequence without duplicating the peak", () => {
  const signal = [1, 2, 3, 4, 5];
  assert.deepEqual(
    Array.from(
      { length: 5 },
      (_, i) => signal[visualizerBarIndex(i, 5, false)],
    ),
    signal,
  );
  assert.deepEqual(
    Array.from({ length: 9 }, (_, i) => signal[visualizerBarIndex(i, 5, true)]),
    [1, 2, 3, 4, 5, 4, 3, 2, 1],
  );
});

test("flipped mirroring puts the lowest index at the center", () => {
  assert.deepEqual(
    Array.from(
      { length: 9 },
      (_, i) => visualizerBarIndex(i, 5, true, true) + 1,
    ),
    [5, 4, 3, 2, 1, 2, 3, 4, 5],
  );
  assert.equal(visualizerBarIndex(0, 5, false, true), 0);
  assert.equal(parseVisualizer('{"flipped":true}').line.flipped, true);
  assert.equal(parseVisualizer('{"flipped":"true"}').line.flipped, false);
});

test("FFT trimming keeps the first different bar and all following bars", () => {
  const values = new Float32Array([1, 1, 1, 1, 2, 3, 2, 3, 1, 3]);
  assert.deepEqual(
    Array.from(values.slice(fftLeadingOffset(values, values.length))),
    [2, 3, 2, 3, 1, 3],
  );
  assert.equal(fftLeadingOffset(new Float32Array([1, 2, 3]), 3), 0);
  assert.equal(fftLeadingOffset(new Float32Array([0, 0, 0]), 3), 3);
});

test("circle mirroring settings are independent and migrate existing preferences", () => {
  const settings = parseVisualizer(
    JSON.stringify({
      mirrored: false,
      flipped: false,
      circleMirrored: true,
      circleFlipped: true,
    }),
  );
  assert.equal(settings.line.mirrored, false);
  assert.equal(settings.line.flipped, false);
  assert.equal(settings.circle.mirrored, true);
  assert.equal(settings.circle.flipped, true);
  const legacy = parseVisualizer('{"mirrored":false,"flipped":true}');
  assert.equal(legacy.circle.mirrored, false);
  assert.equal(legacy.circle.flipped, true);
});

test("circle inward length is a persisted percentage capped at 100", () => {
  assert.equal(
    parseVisualizer('{"circleInwardLength":75}').circle.inwardLength,
    75,
  );
  assert.equal(
    parseVisualizer('{"circleInwardLength":1000}').circle.inwardLength,
    100,
  );
  assert.equal(
    parseVisualizer('{"circleInwardLength":-1}').circle.inwardLength,
    0,
  );
});

test("vertical mirroring is independent per layout and preserves legacy settings", () => {
  const settings = parseVisualizer(
    '{"mirrorVertically":true,"circleMirrorVertically":false}',
  );
  assert.equal(settings.line.mirrorVertically, true);
  assert.equal(settings.circle.mirrorVertically, false);
  assert.equal(
    parseVisualizer('{"mirrorVertically":true}').circle.mirrorVertically,
    true,
  );
});

test("waveform retention is frame-rate independent and can be disabled", () => {
  assert.equal(retainWaveform(1, 0, 200, 200), 0.5);
  assert.equal(retainWaveform(0, 1, 200, 200), 0.5);
  assert.equal(retainWaveform(1, 0, 16, 0), 0);
  const once = retainWaveform(1, 0, 100, 200);
  const twice = retainWaveform(retainWaveform(1, 0, 50, 200), 0, 50, 200);
  assert.ok(Math.abs(once - twice) < 1e-10);
  const settings = parseVisualizer(
    '{"waveformMultiplier":999,"waveformRetention":-1}',
  );
  assert.equal(settings.line.waveformMultiplier, 25);
  assert.equal(
    parseVisualizer('{"waveformMultiplier":0}').line.waveformMultiplier,
    1,
  );
  assert.equal(settings.line.waveformRetention, 0);
  assert.equal(
    parseVisualizer('{"waveformRetention":1000}').line.waveformRetention,
    250,
  );
});

test("line and circle visualizer settings stay independent", () => {
  const settings = parseVisualizer(
    JSON.stringify({
      line: {
        mode: "waveform",
        bars: 24,
        width: 35,
        length: 45,
        waveformMultiplier: 7,
        waveformRetention: 80,
        fftRetention: 20,
        mirrored: false,
        flipped: true,
        mirrorVertically: true,
      },
      circle: {
        mode: "fft",
        bars: 96,
        width: 75,
        length: 90,
        waveformMultiplier: 18,
        waveformRetention: 210,
        fftRetention: 150,
        mirrored: true,
        flipped: false,
        mirrorVertically: true,
        inwardLength: 60,
        radius: 30,
      },
    }),
  );
  assert.equal(settings.line.mode, "waveform");
  assert.equal(settings.line.bars, 24);
  assert.equal(settings.line.fftRetention, 20);
  assert.equal(settings.circle.mode, "fft");
  assert.equal(settings.circle.bars, 96);
  assert.equal(settings.circle.fftRetention, 150);
  assert.equal(settings.circle.inwardLength, 60);
  assert.equal(settings.circle.radius, 30);
});
