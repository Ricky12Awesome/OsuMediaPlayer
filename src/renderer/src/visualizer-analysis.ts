export const MAX_VISUALIZER_BARS = 256;
const MAX_FFT_SIZE = 8192;

export interface VisualizerAnalysisSettings {
  mode: "spectrum" | "waveform" | "energy";
  barCount: number;
  responsivenessMs: number;
  sensitivity: number;
  fftSize: number;
  frequencyRanges: { min: number; max: number }[];
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

function frequencyAmplitude(
  frequency: Float32Array<ArrayBuffer>,
  bin: number,
): number {
  const decibels = frequency[Math.max(0, Math.min(frequency.length - 1, bin))];
  return Number.isFinite(decibels)
    ? Math.pow(10, Math.max(-90, decibels) / 20)
    : 0;
}

/** Follow changing audio every frame, with a quick attack and slower release. */
export class SignalSmoothing {
  readonly values: Float32Array<ArrayBuffer>;
  private previousMs: number | null = null;

  constructor(size: number) {
    this.values = new Float32Array(size);
  }

  reset(): void {
    this.values.fill(0);
    this.previousMs = null;
  }

  update(
    targets: Float32Array<ArrayBuffer>,
    count: number,
    nowMs: number,
    durationMs: number,
  ): Float32Array<ArrayBuffer> {
    const elapsed =
      this.previousMs === null ? 0 : Math.max(0, nowMs - this.previousMs);
    this.previousMs = nowMs;
    const duration = Math.max(0, durationMs);
    for (let i = 0; i < count; i++) {
      const current = this.values[i];
      const timeConstant = targets[i] > current ? duration / 3 : duration / 2;
      const fraction =
        duration === 0 ? 1 : 1 - Math.exp(-elapsed / timeConstant);
      this.values[i] = current + (targets[i] - current) * fraction;
    }
    return this.values;
  }
}

/** Convert FFT decibels to visible bands, keeping narrow musical peaks. */
export function mapFrequencyBands(
  frequency: Float32Array<ArrayBuffer>,
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
    let power = 0;
    let peak = 0;
    for (let bin = start; bin < end; bin++) {
      const amplitude = frequencyAmplitude(frequency, bin);
      power += amplitude * amplitude;
      peak = Math.max(peak, amplitude);
    }
    const wideLevel = peak * 0.7 + Math.sqrt(power / (end - start)) * 0.3;
    // A logarithmic band can be narrower than one FFT bin. Interpolate its
    // center across bin centers so bass bars do not repeat one bin as a plateau.
    const centerBin = (startHz + endHz) / (2 * binHz);
    const left = Math.floor(centerBin);
    const narrowLevel =
      frequencyAmplitude(frequency, left) * (1 - (centerBin - left)) +
      frequencyAmplitude(frequency, left + 1) * (centerBin - left);
    const wideWeight = clamp((endHz - startHz) / binHz - 1);
    const level = narrowLevel * (1 - wideWeight) + wideLevel * wideWeight;
    output[i] = Math.pow(level, 0.7) * 1.35;
  }
}

export function mapFrequencyRanges(
  frequency: Float32Array<ArrayBuffer>,
  sampleRate: number,
  fftSize: number,
  count: number,
  ranges: { min: number; max: number }[],
  scale: "log" | "linear",
  output: Float32Array<ArrayBuffer>,
): void {
  if (!count || !ranges.length) {
    output.fill(0, 0, count);
    return;
  }
  const base = Math.floor(count / ranges.length);
  const extra = count % ranges.length;
  if (base === 0) {
    // When more ranges than bars are configured, spread the available bars
    // across the entire ordered list rather than dropping the upper ranges.
    for (let index = 0; index < count; index++) {
      const range = ranges[Math.floor((index * ranges.length) / count)];
      mapFrequencyBands(
        frequency,
        sampleRate,
        fftSize,
        1,
        range.min,
        range.max,
        scale,
        output.subarray(index, index + 1),
      );
    }
    return;
  }
  let offset = 0;
  ranges.forEach((range, index) => {
    const bars = base + (index < extra ? 1 : 0);
    mapFrequencyBands(
      frequency,
      sampleRate,
      fftSize,
      bars,
      range.min,
      range.max,
      scale,
      output.subarray(offset, offset + bars),
    );
    offset += bars;
  });
}

/** CPU analysis keeps all buffers bounded and reuses them on every frame. */
export class VisualizerAnalysis {
  private readonly frequencyBuffer = new Float32Array(MAX_FFT_SIZE / 2);
  private readonly timeBuffer = new Float32Array(MAX_FFT_SIZE);
  private frequency = this.frequencyBuffer.subarray(0, 1024);
  private time = this.timeBuffer.subarray(0, 2048);
  private readonly bands = new Float32Array(MAX_VISUALIZER_BARS);
  private readonly targets = new Float32Array(MAX_VISUALIZER_BARS);
  private readonly waveTargets = new Float32Array(MAX_VISUALIZER_BARS);
  private readonly transitions = new SignalSmoothing(MAX_VISUALIZER_BARS);
  private readonly waveTransitions = new SignalSmoothing(MAX_VISUALIZER_BARS);
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
  private previousTrackKey: string | undefined;

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
    trackKey?: string,
  ): VisualizerFrame {
    const count = Math.round(clamp(settings.barCount, 8, MAX_VISUALIZER_BARS));
    if (count !== this.frame.count || settings.mode !== this.previousMode) {
      this.reset();
      this.frame.count = count;
      this.previousMode = settings.mode;
    }
    if (trackKey !== this.previousTrackKey) {
      this.lastBeat = -Infinity;
      this.bassAverage = 0;
      this.previousBass = 0;
      this.previousTrackKey = trackKey;
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
    analyser.getFloatFrequencyData(this.frequency);
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
    this.frame.bass = Math.tanh(bass * sensitivity);
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
      mapFrequencyRanges(
        this.frequency,
        sampleRate,
        fftSize,
        bandCount,
        settings.frequencyRanges,
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
        let power = 0;
        for (let sample = start; sample < end; sample++) {
          power += this.time[sample] ** 2;
        }
        this.bands[i] = Math.sqrt(power / (end - start)) * Math.SQRT2;
      }
    } else {
      this.bands.fill(this.frame.energy / sensitivity, 0, bandCount);
    }

    // Use a short, contiguous window for the oscilloscope. Independent peaks
    // from wide buckets cannot form a real waveform and visibly jump in phase.
    const traceLength = Math.min(1024, this.time.length);
    const windowStart = this.time.length - traceLength;
    let traceStart = windowStart;
    if (settings.mode === "waveform" && windowStart > 0) {
      const searchStart = Math.max(0, windowStart - traceLength);
      for (let sample = searchStart + 1; sample <= windowStart; sample++) {
        if (this.time[sample - 1] <= 0 && this.time[sample] > 0) {
          traceStart = sample;
        }
      }
    }
    for (let i = 0; i < count; i++) {
      let index = settings.mirror ? Math.min(i, count - 1 - i) : i;
      if (settings.reverse) index = bandCount - 1 - index;
      this.targets[i] =
        settings.mode === "spectrum"
          ? Math.tanh(this.bands[index] * sensitivity)
          : clamp(this.bands[index] * sensitivity);
      const sampleIndex =
        traceStart +
        Math.floor((index * (traceLength - 1)) / Math.max(1, bandCount - 1));
      this.waveTargets[i] =
        settings.mode === "waveform"
          ? clamp(this.time[sampleIndex] * sensitivity, -1, 1)
          : this.targets[i];
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
