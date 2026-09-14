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
  assert.deepEqual(
    parseVisualizer(
      JSON.stringify({
        enabled: false,
        bars: 10000,
        width: -4,
        length: "bad",
        mirrored: false,
        layout: "circle",
        mode: "waveform",
      }),
    ),
    {
      enabled: false,
      bars: 256,
      width: 10,
      length: 70,
      waveformMultiplier: 10,
      waveformRetention: 200,
      mirrored: false,
      flipped: false,
      circleMirrored: false,
      circleFlipped: false,
      mirrorVertically: false,
      circleMirrorVertically: false,
      circleInwardLength: 0,
      layout: "circle",
      mode: "waveform",
    },
  );
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
  assert.equal(parseVisualizer('{"flipped":true}').flipped, true);
  assert.equal(parseVisualizer('{"flipped":"true"}').flipped, false);
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
  assert.equal(settings.mirrored, false);
  assert.equal(settings.flipped, false);
  assert.equal(settings.circleMirrored, true);
  assert.equal(settings.circleFlipped, true);
  const legacy = parseVisualizer('{"mirrored":false,"flipped":true}');
  assert.equal(legacy.circleMirrored, false);
  assert.equal(legacy.circleFlipped, true);
});

test("circle inward length is a persisted percentage capped at 100", () => {
  assert.equal(
    parseVisualizer('{"circleInwardLength":75}').circleInwardLength,
    75,
  );
  assert.equal(
    parseVisualizer('{"circleInwardLength":1000}').circleInwardLength,
    100,
  );
  assert.equal(
    parseVisualizer('{"circleInwardLength":-1}').circleInwardLength,
    0,
  );
});

test("vertical mirroring is independent per layout and preserves legacy settings", () => {
  const settings = parseVisualizer(
    '{"mirrorVertically":true,"circleMirrorVertically":false}',
  );
  assert.equal(settings.mirrorVertically, true);
  assert.equal(settings.circleMirrorVertically, false);
  assert.equal(
    parseVisualizer('{"mirrorVertically":true}').circleMirrorVertically,
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
  assert.equal(settings.waveformMultiplier, 25);
  assert.equal(
    parseVisualizer('{"waveformMultiplier":0}').waveformMultiplier,
    1,
  );
  assert.equal(settings.waveformRetention, 0);
  assert.equal(
    parseVisualizer('{"waveformRetention":1000}').waveformRetention,
    250,
  );
});
