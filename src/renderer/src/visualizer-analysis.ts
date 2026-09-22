export const MAX_VISUALIZER_BARS = 256;
const MAX_FFT_SIZE = 8192;

export interface VisualizerAnalysisSettings {
  mode: "spectrum" | "waveform" | "energy";
  barCount: number;
  responsivenessMs: number;
  sensitivity: number;
  fftSize: number;
  minFrequency: number;
  maxFrequency: number;
  frequencyScale: "log" | "linear";
  mirror: boolean;
  reverse: boolean;
}

export interface VisualizerFrame {
  values: Float32Array<ArrayBuffer>;
  waveform: Float32Array<ArrayBuffer>;
  count: number;
  bass: number;
  energy: number;
  beat: number;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear ramps have a deadline; held targets do not approach asymptotically. */
export class DurationTransitions {
  readonly values: Float32Array<ArrayBuffer>;
  private readonly starts: Float32Array<ArrayBuffer>;
  private readonly targets: Float32Array<ArrayBuffer>;
  private readonly times: Float64Array<ArrayBuffer>;
  private duration = 0;

  constructor(size: number) {
    this.values = new Float32Array(size);
    this.starts = new Float32Array(size);
    this.targets = new Float32Array(size);
    this.times = new Float64Array(size);
  }

  reset(): void {
    this.values.fill(0);
    this.starts.fill(0);
    this.targets.fill(0);
    this.times.fill(0);
  }

  update(
    targets: Float32Array<ArrayBuffer>,
    count: number,
    nowMs: number,
    durationMs: number,
  ): Float32Array<ArrayBuffer> {
    const duration = Math.max(0, durationMs);
    const changedDuration = duration !== this.duration;
    for (let i = 0; i < count; i++) {
      const progress = this.duration
        ? clamp((nowMs - this.times[i]) / this.duration)
        : 1;
      const current =
        this.starts[i] + (this.targets[i] - this.starts[i]) * progress;
      if (targets[i] !== this.targets[i] || changedDuration) {
        this.starts[i] = current;
        this.targets[i] = targets[i];
        this.times[i] = nowMs;
      }
      this.values[i] = duration === 0 ? targets[i] : current;
    }
    this.duration = duration;
    return this.values;
  }
}

/** Fill normalized frequency bands in-place, bounded by the actual Nyquist limit. */
export function mapFrequencyBands(
  frequency: Uint8Array<ArrayBuffer>,
  sampleRate: number,
  fftSize: number,
  count: number,
  minFrequency: number,
  maxFrequency: number,
  scale: "log" | "linear",
  output: Float32Array<ArrayBuffer>,
): void {
  const nyquist = sampleRate / 2;
  const low = clamp(minFrequency, 1, nyquist);
  const high = clamp(maxFrequency, low, nyquist);
  const binHz = sampleRate / fftSize;
  for (let i = 0; i < count; i++) {
    const startHz =
      scale === "log"
        ? low * Math.pow(high / low, i / count)
        : low + ((high - low) * i) / count;
    const endHz =
      scale === "log"
        ? low * Math.pow(high / low, (i + 1) / count)
        : low + ((high - low) * (i + 1)) / count;
    const start = Math.min(frequency.length - 1, Math.floor(startHz / binHz));
    const end = Math.min(
      frequency.length,
      Math.max(start + 1, Math.ceil(endHz / binHz)),
    );
    let sum = 0;
    for (let bin = start; bin < end; bin++) sum += frequency[bin] ** 2;
    output[i] = Math.sqrt(sum / (end - start)) / 255;
  }
}

/** CPU analysis keeps all buffers bounded and reuses them on every frame. */
export class VisualizerAnalysis {
  private readonly frequencyBuffer = new Uint8Array(MAX_FFT_SIZE / 2);
  private readonly timeBuffer = new Float32Array(MAX_FFT_SIZE);
  private frequency = this.frequencyBuffer.subarray(0, 1024);
  private time = this.timeBuffer.subarray(0, 2048);
  private readonly bands = new Float32Array(MAX_VISUALIZER_BARS);
  private readonly targets = new Float32Array(MAX_VISUALIZER_BARS);
  private readonly waveTargets = new Float32Array(MAX_VISUALIZER_BARS);
  private readonly transitions = new DurationTransitions(MAX_VISUALIZER_BARS);
  private readonly waveTransitions = new DurationTransitions(
    MAX_VISUALIZER_BARS,
  );
  private readonly frame: VisualizerFrame = {
    values: this.transitions.values,
    waveform: this.waveTransitions.values,
    count: 0,
    bass: 0,
    energy: 0,
    beat: 0,
  };
  private previousMs: number | null = null;
  private lastBeat = -Infinity;
  private bassAverage = 0;
  private previousBass = 0;
  private previousMode: VisualizerAnalysisSettings["mode"] | null = null;

  reset(): void {
    this.transitions.reset();
    this.waveTransitions.reset();
    this.frame.bass = 0;
    this.frame.energy = 0;
    this.frame.beat = 0;
    this.previousMs = null;
    this.lastBeat = -Infinity;
    this.bassAverage = 0;
    this.previousBass = 0;
  }

  update(
    analyser: AnalyserNode,
    settings: VisualizerAnalysisSettings,
    nowMs: number,
    playing: boolean,
  ): VisualizerFrame {
    const count = Math.round(clamp(settings.barCount, 8, MAX_VISUALIZER_BARS));
    if (count !== this.frame.count || settings.mode !== this.previousMode) {
      this.reset();
      this.frame.count = count;
      this.previousMode = settings.mode;
    }
    if (!playing) {
      this.reset();
      return this.frame;
    }

    const fftSize =
      2 ** Math.round(Math.log2(clamp(settings.fftSize, 256, MAX_FFT_SIZE)));
    if (analyser.fftSize !== fftSize) analyser.fftSize = fftSize;
    if (this.time.length !== fftSize) {
      this.frequency = this.frequencyBuffer.subarray(0, fftSize / 2);
      this.time = this.timeBuffer.subarray(0, fftSize);
      this.reset();
    }
    analyser.smoothingTimeConstant = 0;
    analyser.getByteFrequencyData(this.frequency);
    analyser.getFloatTimeDomainData(this.time);

    const elapsed =
      this.previousMs === null ? 0 : Math.max(0, nowMs - this.previousMs);
    this.previousMs = nowMs;
    const sensitivity = clamp(settings.sensitivity, 0.1, 5);
    const sampleRate = analyser.context.sampleRate;
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] ** 2;
    this.frame.energy = clamp(Math.sqrt(sum / this.time.length) * sensitivity);
    mapFrequencyBands(
      this.frequency,
      sampleRate,
      fftSize,
      1,
      30,
      180,
      "linear",
      this.bands,
    );
    const bass = this.bands[0];
    this.frame.bass = clamp(bass * sensitivity);
    if (
      bass > 0.15 &&
      bass - this.previousBass > 0.04 &&
      bass > this.bassAverage * 1.2 &&
      nowMs - this.lastBeat >= 140
    )
      this.lastBeat = nowMs;
    this.bassAverage += (bass - this.bassAverage) * Math.min(1, elapsed / 500);
    this.previousBass = bass;
    this.frame.beat = clamp(1 - (nowMs - this.lastBeat) / 300);

    const bandCount = settings.mirror ? Math.ceil(count / 2) : count;
    if (settings.mode === "spectrum") {
      mapFrequencyBands(
        this.frequency,
        sampleRate,
        fftSize,
        bandCount,
        settings.minFrequency,
        settings.maxFrequency,
        settings.frequencyScale,
        this.bands,
      );
    } else if (settings.mode === "waveform") {
      for (let i = 0; i < bandCount; i++) {
        const start = Math.floor((i * this.time.length) / bandCount);
        const end = Math.max(
          start + 1,
          Math.floor(((i + 1) * this.time.length) / bandCount),
        );
        let peak = 0;
        for (let sample = start; sample < end; sample++) {
          if (Math.abs(this.time[sample]) > Math.abs(peak))
            peak = this.time[sample];
        }
        this.bands[i] = peak;
      }
    } else {
      this.bands.fill(this.frame.energy / sensitivity, 0, bandCount);
    }

    for (let i = 0; i < count; i++) {
      let index = settings.mirror ? Math.min(i, count - 1 - i) : i;
      if (settings.reverse) index = bandCount - 1 - index;
      const value = clamp(this.bands[index] * sensitivity, -1, 1);
      this.targets[i] = Math.abs(value);
      this.waveTargets[i] = value;
    }
    this.transitions.update(
      this.targets,
      count,
      nowMs,
      settings.responsivenessMs,
    );
    this.waveTransitions.update(
      this.waveTargets,
      count,
      nowMs,
      settings.responsivenessMs,
    );
    return this.frame;
  }
}
