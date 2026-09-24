import assert from "node:assert/strict";
import test from "node:test";
import {
  SignalSmoothing,
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
  const frequency = new Float32Array(4096).fill(-Infinity);
  const waveform = new Float32Array(8192);
  const analyser = {
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    context: { sampleRate: 48000 },
    getFloatFrequencyData(output: Float32Array) {
      output.set(frequency.subarray(0, output.length));
    },
    getFloatTimeDomainData(output: Float32Array) {
      output.set(waveform.subarray(0, output.length));
    },
  } as AnalyserNode;
  return { analyser, frequency, waveform };
}

test("response follows held audio quickly and supports instant response", () => {
  const transitions = new SignalSmoothing(1);
  const target = new Float32Array([1]);
  assert.equal(transitions.update(target, 1, 0, 90)[0], 0);
  assert.ok(transitions.update(target, 1, 30, 90)[0] > 0.6);
  assert.ok(transitions.update(target, 1, 90, 90)[0] > 0.94);
  target[0] = 0;
  const falling = transitions.update(target, 1, 110, 90)[0];
  assert.ok(falling > 0 && falling < 0.8);
  target[0] = 0.75;
  assert.equal(transitions.update(target, 1, 111, 0)[0], 0.75);
  transitions.reset();
  assert.equal(transitions.values[0], 0);
});

test("changing targets move every frame instead of restarting an interpolation", () => {
  const transitions = new SignalSmoothing(1);
  const target = new Float32Array([1]);
  transitions.update(target, 1, 0, 90);
  const first = transitions.update(target, 1, 16, 90)[0];
  target[0] = 0.8;
  const second = transitions.update(target, 1, 32, 90)[0];
  target[0] = 0.7;
  const third = transitions.update(target, 1, 48, 90)[0];
  assert.ok(first > 0 && second > first && third > second);
});

test("frequency bands respect linear/log spacing, requested range, and Nyquist", () => {
  const bins = new Float32Array(512).fill(-Infinity);
  const output = new Float32Array(4);
  bins[40] = -12; // 400 Hz at 10 Hz per bin.
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

test("a narrow high note remains visible without lifting silent bands", () => {
  const bins = new Float32Array(1024).fill(-Infinity);
  const output = new Float32Array(8);
  bins[300] = -18;
  mapFrequencyBands(bins, 48000, 2048, 8, 30, 16000, "log", output);
  const active = output.findIndex((value) => value > 0);
  assert.ok(active > 0);
  assert.ok(output[active] > 0.25);
  assert.equal(output.filter((value) => value > 0).length, 1);
  bins[300] = -42;
  mapFrequencyBands(bins, 48000, 2048, 8, 30, 16000, "log", output);
  assert.ok(output[active] > 0 && output[active] < 0.1);
});

test("log spacing avoids repeating a low FFT bin across dozens of bars", () => {
  const bins = new Float32Array(1024).fill(-Infinity);
  bins[2] = -3;
  const output = new Float32Array(256);
  mapFrequencyBands(bins, 44100, 2048, 256, 30, 16000, "log", output);
  assert.equal(output.length, 256);
  assert.ok(output.filter((value) => value > 0.01).length <= 4);
  assert.ok(output[0] > 0 && output[1] > 0);
});

test("adjacent low spectrum bars follow a strong bass slope without clipping", () => {
  const fixture = analyserFixture();
  fixture.frequency.set([-3, -6, -12, -20], 1);
  const analysis = new VisualizerAnalysis();
  const frame = analysis.update(
    fixture.analyser,
    { ...settings, barCount: 64, sensitivity: 1.5 },
    0,
    true,
  );
  const head = Array.from(frame.values.slice(0, 12));
  assert.ok(head[0] < 1 && head[0] > 0.8);
  assert.ok(head.slice(1, 6).every((value, index) => value < head[index]));
  assert.ok(head[0] - head[11] > 0.4);
});

test("custom frequency ranges skip gaps and preserve each selected interval", () => {
  const frequency = new Float32Array(1024).fill(-Infinity);
  frequency.fill(-12, 1, 5);
  frequency.fill(-30, 213, 257);
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
  assert.ok(output.slice(0, 4).every((value) => value > 0.4));
  assert.ok(output.slice(4).every((value) => value > 0.05 && value < 0.2));
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

test("waveform bars show local amplitude and the trace preserves polarity and ordering", () => {
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
  assert.deepEqual(Array.from(frame.waveform.slice(0, 8)), Array(8).fill(0.75));
  assert.ok(
    frame.values
      .slice(0, 4)
      .every((value) => Math.abs(value - 0.5 * Math.SQRT2) < 1e-6),
  );
  assert.ok(frame.values.slice(4, 8).every((value) => value === 1));
  analysis.update(
    fixture.analyser,
    { ...settings, mode: "waveform", reverse: true },
    1,
    true,
  );
  assert.equal(frame.values[0], 1);
  analysis.update(
    fixture.analyser,
    { ...settings, mode: "waveform", mirror: true },
    2,
    true,
  );
  assert.equal(frame.values[0], frame.values[7]);
  assert.equal(frame.values[1], frame.values[6]);
});

test("oscilloscope traces real samples and holds a stable phase across audio blocks", () => {
  const fixture = analyserFixture();
  const analysis = new VisualizerAnalysis();
  const waveformSettings = {
    ...settings,
    mode: "waveform" as const,
    barCount: 64,
  };
  const fillTone = (phase: number) => {
    for (let sample = 0; sample < 2048; sample++) {
      fixture.waveform[sample] =
        Math.sin((sample * Math.PI * 2) / 120 + phase) * 0.6;
    }
  };
  fillTone(0);
  const frame = analysis.update(fixture.analyser, waveformSettings, 0, true);
  const first = Array.from(frame.waveform.slice(0, 64));
  assert.ok(first.some((value) => value > 0.5));
  assert.ok(first.some((value) => value < -0.5));
  assert.ok(frame.values.slice(0, 64).every((value) => value > 0.3));
  fillTone(Math.PI / 3);
  analysis.update(fixture.analyser, waveformSettings, 16, true);
  const second = Array.from(frame.waveform.slice(0, 64));
  const difference = first.reduce(
    (sum, value, index) => sum + Math.abs(value - second[index]),
    0,
  );
  assert.ok(difference < 2, `phase-aligned trace changed by ${difference}`);
});

test("energy uses RMS, reuses buffers, and pause/reset remove stale song signals", () => {
  const fixture = analyserFixture();
  fixture.waveform.fill(0.5);
  fixture.frequency.fill(0);
  const analysis = new VisualizerAnalysis();
  const frame = analysis.update(
    fixture.analyser,
    { ...settings, mode: "energy" },
    100,
    true,
  );
  assert.equal(frame.energy, 0.5);
  assert.ok(frame.bass > 0.8 && frame.bass < 1);
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
  fixture.frequency.fill(-12, 1, 8);
  const frame = analysis.update(fixture.analyser, settings, 20, true);
  assert.equal(frame.beat, 1);
  fixture.frequency.fill(-Infinity);
  analysis.update(fixture.analyser, settings, 50, true);
  fixture.frequency.fill(-12, 1, 8);
  analysis.update(fixture.analyser, settings, 80, true);
  assert.equal(frame.beat, 0.8);
  analysis.update(fixture.analyser, settings, 320, true);
  assert.equal(frame.beat, 0);
  fixture.frequency.fill(-Infinity);
  analysis.update(fixture.analyser, settings, 340, true);
  fixture.frequency.fill(-12, 1, 8);
  analysis.update(fixture.analyser, settings, 370, true);
  assert.equal(frame.beat, 1);
});

test("analysis bounds FFT/bars and disables the analyser's implicit smoothing", () => {
  const fixture = analyserFixture();
  fixture.frequency.fill(0);
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
  assert.ok(frame.values.every((value) => value > 0.8 && value < 0.9));
});
