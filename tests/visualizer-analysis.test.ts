import assert from "node:assert/strict";
import test from "node:test";
import {
  DurationTransitions,
  mapFrequencyBands,
  mapFrequencyRanges,
  VisualizerAnalysis,
  type VisualizerAnalysisSettings,
} from "../src/renderer/src/visualizer-analysis";

const settings: VisualizerAnalysisSettings = {
  mode: "spectrum",
  barCount: 8,
  responsivenessMs: 0,
  sensitivity: 1,
  fftSize: 2048,
  frequencyRanges: [{ min: 30, max: 16000 }],
  frequencyScale: "log",
  mirror: false,
  reverse: false,
};

function analyserFixture() {
  const frequency = new Uint8Array(4096);
  const waveform = new Float32Array(8192);
  const analyser = {
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    context: { sampleRate: 48000 },
    getByteFrequencyData(output: Uint8Array) {
      output.set(frequency.subarray(0, output.length));
    },
    getFloatTimeDomainData(output: Float32Array) {
      output.set(waveform.subarray(0, output.length));
    },
  } as AnalyserNode;
  return { analyser, frequency, waveform };
}

test("responsiveness reaches each held target in the requested milliseconds", () => {
  const transitions = new DurationTransitions(1);
  const target = new Float32Array([1]);
  assert.equal(transitions.update(target, 1, 0, 15)[0], 0);
  assert.equal(transitions.update(target, 1, 7.5, 15)[0], 0.5);
  assert.equal(transitions.update(target, 1, 15, 15)[0], 1);
  target[0] = 0;
  assert.equal(transitions.update(target, 1, 20, 15)[0], 1);
  assert.equal(transitions.update(target, 1, 27.5, 15)[0], 0.5);
  assert.equal(transitions.update(target, 1, 35, 15)[0], 0);
  target[0] = 0.75;
  assert.equal(transitions.update(target, 1, 36, 0)[0], 0.75);
});

test("new audio targets start at the current interpolated position", () => {
  const transitions = new DurationTransitions(1);
  const target = new Float32Array([1]);
  transitions.update(target, 1, 0, 100);
  target[0] = 0;
  assert.equal(transitions.update(target, 1, 50, 100)[0], 0.5);
  assert.equal(transitions.update(target, 1, 100, 100)[0], 0.25);
  assert.equal(transitions.update(target, 1, 150, 100)[0], 0);
});

test("frequency bands respect linear/log spacing, requested range, and Nyquist", () => {
  const bins = new Uint8Array(512);
  const output = new Float32Array(4);
  bins[40] = 255; // 400 Hz at 10 Hz per bin.
  mapFrequencyBands(bins, 10240, 1024, 4, 100, 1700, "linear", output);
  assert.ok(output[0] > 0);
  assert.equal(output[1], 0);
  mapFrequencyBands(bins, 10240, 1024, 4, 100, 1600, "log", output);
  assert.ok(output[2] > 0);
  assert.equal(output[0], 0);
  mapFrequencyBands(bins, 10240, 1024, 4, 2000, 90000, "log", output);
  assert.deepEqual(Array.from(output), [0, 0, 0, 0]);
  assert.ok(output.every(Number.isFinite));
});

test("custom frequency ranges skip gaps and preserve each selected interval", () => {
  const frequency = new Uint8Array(1024);
  frequency.fill(255, 1, 5);
  frequency.fill(128, 213, 257);
  const output = new Float32Array(8);
  mapFrequencyRanges(
    frequency,
    48000,
    2048,
    8,
    [
      { min: 20, max: 100 },
      { min: 5000, max: 6000 },
    ],
    "linear",
    output,
  );
  assert.ok(output.slice(0, 4).every((value) => value > 0.6));
  assert.ok(output.slice(4).every((value) => value > 0.4 && value < 0.6));
  mapFrequencyRanges(
    frequency,
    48000,
    2048,
    8,
    Array.from({ length: 12 }, (_, index) => ({
      min: 100 + index * 100,
      max: 150 + index * 100,
    })),
    "linear",
    output,
  );
  assert.ok(output.every(Number.isFinite));
});

test("waveforms preserve polarity, reverse ordering, and symmetric mirroring", () => {
  const fixture = analyserFixture();
  fixture.waveform.fill(-0.5, 0, 1024);
  fixture.waveform.fill(0.75, 1024, 2048);
  const analysis = new VisualizerAnalysis();
  const frame = analysis.update(
    fixture.analyser,
    { ...settings, mode: "waveform" },
    0,
    true,
  );
  assert.deepEqual(
    Array.from(frame.waveform.slice(0, 8)),
    [-0.5, -0.5, -0.5, -0.5, 0.75, 0.75, 0.75, 0.75],
  );
  assert.deepEqual(
    Array.from(frame.values.slice(0, 8)),
    [0.5, 0.5, 0.5, 0.5, 0.75, 0.75, 0.75, 0.75],
  );
  analysis.update(
    fixture.analyser,
    { ...settings, mode: "waveform", reverse: true },
    1,
    true,
  );
  assert.equal(frame.waveform[0], 0.75);
  analysis.update(
    fixture.analyser,
    { ...settings, mode: "waveform", mirror: true },
    2,
    true,
  );
  assert.deepEqual(
    Array.from(frame.waveform.slice(0, 8)),
    [-0.5, -0.5, 0.75, 0.75, 0.75, 0.75, -0.5, -0.5],
  );
});

test("energy uses RMS, reuses buffers, and pause/reset remove stale song signals", () => {
  const fixture = analyserFixture();
  fixture.waveform.fill(0.5);
  fixture.frequency.fill(255);
  const analysis = new VisualizerAnalysis();
  const frame = analysis.update(
    fixture.analyser,
    { ...settings, mode: "energy" },
    100,
    true,
  );
  assert.equal(frame.energy, 0.5);
  assert.equal(frame.bass, 1);
  assert.equal(frame.beat, 1);
  assert.ok(frame.values.slice(0, 8).every((value) => value === 0.5));
  assert.equal(
    analysis.update(
      fixture.analyser,
      { ...settings, mode: "energy" },
      150,
      true,
    ),
    frame,
  );
  assert.equal(analysis.update(fixture.analyser, settings, 200, false), frame);
  assert.ok(frame.values.every((value) => value === 0));
  assert.ok(frame.waveform.every((value) => value === 0));
  assert.equal(frame.energy, 0);
  assert.equal(frame.bass, 0);
  assert.equal(frame.beat, 0);
  analysis.update(fixture.analyser, settings, 300, true);
  analysis.reset();
  assert.equal(frame.beat, 0);
  assert.ok(frame.values.every((value) => value === 0));
});

test("bass pulses react to onsets, decay, and respect their cooldown", () => {
  const fixture = analyserFixture();
  const analysis = new VisualizerAnalysis();
  analysis.update(fixture.analyser, settings, 0, true);
  fixture.frequency.fill(255, 1, 8);
  const frame = analysis.update(fixture.analyser, settings, 20, true);
  assert.equal(frame.beat, 1);
  fixture.frequency.fill(0);
  analysis.update(fixture.analyser, settings, 50, true);
  fixture.frequency.fill(255, 1, 8);
  analysis.update(fixture.analyser, settings, 80, true);
  assert.equal(frame.beat, 0.8);
  analysis.update(fixture.analyser, settings, 320, true);
  assert.equal(frame.beat, 0);
  fixture.frequency.fill(0);
  analysis.update(fixture.analyser, settings, 340, true);
  fixture.frequency.fill(255, 1, 8);
  analysis.update(fixture.analyser, settings, 370, true);
  assert.equal(frame.beat, 1);
});

test("analysis bounds FFT/bars and disables the analyser's implicit smoothing", () => {
  const fixture = analyserFixture();
  fixture.frequency.fill(255);
  const analysis = new VisualizerAnalysis();
  const frame = analysis.update(
    fixture.analyser,
    { ...settings, barCount: 500, fftSize: 50000, responsivenessMs: 15 },
    0,
    true,
  );
  assert.equal(fixture.analyser.fftSize, 8192);
  assert.equal(fixture.analyser.smoothingTimeConstant, 0);
  assert.equal(frame.count, 256);
  assert.equal(frame.values.length, 256);
  assert.ok(frame.values.every((value) => value === 0));
  analysis.update(
    fixture.analyser,
    { ...settings, barCount: 500, fftSize: 50000, responsivenessMs: 15 },
    15,
    true,
  );
  assert.ok(frame.values.every((value) => value === 1));
});
