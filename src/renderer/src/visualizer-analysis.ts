export const MAX_VISUALIZER_BARS = 256;
const MAX_FFT_SIZE = 8192;

export interface VisualizerAnalysisSettings {
  mode: "spectrum" | "waveform" | "energy";
  barCount: number;
  responsivenessMs: number;
  sensitivity: number;
  beatSensitivity: number;
  beatMode: "detected" | "bpm";
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

export function mapFrequencyRanges(
  frequency: Uint8Array<ArrayBuffer>,
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
  private readonly frequencyBuffer = new Uint8Array(MAX_FFT_SIZE / 2);
  private readonly timeBuffer = new Float32Array(MAX_FFT_SIZE);
  private frequency = this.frequencyBuffer.subarray(0, 1024);
  private time = this.timeBuffer.subarray(0, 2048);
  private readonly bands = new Float32Array(MAX_VISUALIZER_BARS);
  private readonly previousBeatBands = new Float32Array(8);
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
  private beatDurationMs = 140;
  private playbackStartMs: number | null = null;
  private bassAverage = 0;
  private beatFluxAverage = 0;
  private previousBass = 0;
  private previousEnergy = 0;
  private readonly highHistory = new Float32Array(3);
  private readonly highHistoryTimes = new Float64Array(3);
  private highHistoryIndex = 0;
  private lowEnergyPeak = 0;
  private bassDipArmed = true;
  private lastBassDipMs = -Infinity;
  private bassDipPeriodMs: number | null = null;
  private bassDipRun = 0;
  private nextBassPulseMs = Infinity;
  private previousMode: VisualizerAnalysisSettings["mode"] | null = null;
  private previousBeatMode: VisualizerAnalysisSettings["beatMode"] | null =
    null;
  private previousTrackKey: string | undefined;

  reset(): void {
    this.transitions.reset();
    this.waveTransitions.reset();
    this.frame.bass = 0;
    this.frame.energy = 0;
    this.frame.beat = 0;
    this.previousMs = null;
    this.lastBeat = -Infinity;
    this.beatDurationMs = 140;
    this.playbackStartMs = null;
    this.bassAverage = 0;
    this.beatFluxAverage = 0;
    this.previousBass = 0;
    this.previousEnergy = 0;
    this.highHistory.fill(0);
    this.highHistoryTimes.fill(-Infinity);
    this.highHistoryIndex = 0;
    this.lowEnergyPeak = 0;
    this.bassDipArmed = true;
    this.lastBassDipMs = -Infinity;
    this.bassDipPeriodMs = null;
    this.bassDipRun = 0;
    this.nextBassPulseMs = Infinity;
    this.previousBeatBands.fill(0);
  }

  update(
    analyser: AnalyserNode,
    settings: VisualizerAnalysisSettings,
    nowMs: number,
    playing: boolean,
    trackKey?: string,
    trackBpm?: number,
    playbackMs = nowMs,
  ): VisualizerFrame {
    const count = Math.round(clamp(settings.barCount, 8, MAX_VISUALIZER_BARS));
    if (
      count !== this.frame.count ||
      settings.mode !== this.previousMode ||
      settings.beatMode !== this.previousBeatMode
    ) {
      this.reset();
      this.frame.count = count;
      this.previousMode = settings.mode;
      this.previousBeatMode = settings.beatMode;
    }
    if (trackKey !== this.previousTrackKey) {
      this.playbackStartMs = 0;
      this.lastBeat = -Infinity;
      this.beatDurationMs = 140;
      this.bassAverage = 0;
      this.beatFluxAverage = 0;
      this.previousBass = 0;
      this.previousEnergy = 0;
      this.highHistory.fill(0);
      this.highHistoryTimes.fill(-Infinity);
      this.highHistoryIndex = 0;
      this.lowEnergyPeak = 0;
      this.bassDipArmed = true;
      this.lastBassDipMs = -Infinity;
      this.bassDipPeriodMs = null;
      this.bassDipRun = 0;
      this.nextBassPulseMs = Infinity;
      this.previousBeatBands.fill(0);
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
    analyser.maxDecibels = 0;
    analyser.getByteFrequencyData(this.frequency);
    analyser.getFloatTimeDomainData(this.time);

    const elapsed =
      this.previousMs === null ? 0 : Math.max(0, nowMs - this.previousMs);
    this.previousMs = nowMs;
    const sensitivity = clamp(settings.sensitivity, 0.1, 5);
    const sampleRate = analyser.context.sampleRate;
    const lowPassAlpha = (2 * Math.PI * 180) / (sampleRate + 2 * Math.PI * 180);
    let lowSample = 0;
    let lowSum = 0;
    let highSum = 0;
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) {
      const sample = this.time[i];
      sum += sample ** 2;
      lowSample += lowPassAlpha * (sample - lowSample);
      lowSum += lowSample ** 2;
      highSum += (sample - lowSample) ** 2;
    }
    this.frame.energy = clamp(Math.sqrt(sum / this.time.length) * sensitivity);
    const lowEnergy = Math.sqrt(lowSum / this.time.length);
    const highEnergy = Math.sqrt(highSum / this.time.length);
    this.lowEnergyPeak = Math.max(
      lowEnergy,
      this.lowEnergyPeak * Math.exp(-elapsed / 650),
    );
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
    const beatSensitivity = clamp(settings.beatSensitivity / 100);
    const minimumBass = 0.1 + (1 - beatSensitivity) * 0.15;
    const minimumRise = 0.025 + (1 - beatSensitivity) * 0.04;
    const relativeRise = 1.03 + (1 - beatSensitivity) * 0.15;
    const refractoryMs = 100 + (1 - beatSensitivity) * 100;
    let beatFlux = 0;
    for (let band = 0; band < this.previousBeatBands.length; band++) {
      const startHz = 30 * Math.pow(2500 / 30, band / 8);
      const endHz = 30 * Math.pow(2500 / 30, (band + 1) / 8);
      const start = Math.min(
        this.frequency.length - 1,
        Math.floor((startHz * fftSize) / sampleRate),
      );
      const end = Math.min(
        this.frequency.length,
        Math.max(start + 1, Math.ceil((endHz * fftSize) / sampleRate)),
      );
      let energy = 0;
      for (let bin = start; bin < end; bin++)
        energy += this.frequency[bin] ** 2;
      const level = Math.sqrt(energy / (end - start)) / 255;
      beatFlux += Math.max(0, level - this.previousBeatBands[band]);
      this.previousBeatBands[band] = level;
    }
    beatFlux /= this.previousBeatBands.length;
    const fluxThreshold = 0.015 + (1 - beatSensitivity) * 0.05;
    const fluxOnset =
      beatFlux > fluxThreshold &&
      beatFlux > this.beatFluxAverage * 1.5 &&
      this.frame.energy > 0.08 + (1 - beatSensitivity) * 0.27 &&
      this.frame.energy - this.previousEnergy >
        0.02 + (1 - beatSensitivity) * 0.05;
    const bassOnset =
      bass > minimumBass &&
      bass - this.previousBass > minimumRise &&
      bass > this.bassAverage * relativeRise;
    const minimumLowPeak = 0.08 + (1 - beatSensitivity) * 0.25;
    const dipRatio = 0.8 - (1 - beatSensitivity) * 0.25;
    const lowRatio = lowEnergy / Math.max(this.lowEnergyPeak, 0.0001);
    // Sidechain-heavy tracks mark kicks by briefly ducking the bass.
    if (lowRatio > dipRatio + 0.1) this.bassDipArmed = true;
    const bassDip =
      this.bassDipArmed &&
      this.lowEnergyPeak > minimumLowPeak &&
      lowRatio < dipRatio;
    if (bassDip) {
      this.bassDipArmed = false;
      const interval = nowMs - this.lastBassDipMs;
      if (interval >= 220 && interval <= 1200) {
        const steps = this.bassDipPeriodMs
          ? Math.max(1, Math.round(interval / this.bassDipPeriodMs))
          : 1;
        const candidate = interval / steps;
        if (
          candidate >= 220 &&
          candidate <= 550 &&
          (!this.bassDipPeriodMs ||
            Math.abs(candidate - this.bassDipPeriodMs) <
              this.bassDipPeriodMs * 0.3)
        ) {
          this.bassDipPeriodMs = this.bassDipPeriodMs
            ? this.bassDipPeriodMs * 0.7 + candidate * 0.3
            : candidate;
          this.bassDipRun = Math.min(4, this.bassDipRun + 1);
        } else {
          this.bassDipPeriodMs = null;
          this.bassDipRun = 1;
        }
      } else if (interval > 1200) {
        this.bassDipPeriodMs = null;
        this.bassDipRun = 1;
      }
      if (interval >= 220) {
        this.lastBassDipMs = nowMs;
        this.nextBassPulseMs = this.bassDipPeriodMs
          ? nowMs + this.bassDipPeriodMs
          : Infinity;
      }
    }
    const bassRhythmActive =
      this.bassDipRun >= 3 &&
      this.bassDipPeriodMs !== null &&
      nowMs - this.lastBassDipMs < this.bassDipPeriodMs * 6 &&
      lowEnergy > minimumLowPeak * 0.5;
    // Bridge missed dips briefly, then return to audio onset detection.
    const timedBassPulse =
      bassRhythmActive &&
      !bassDip &&
      nowMs >= this.nextBassPulseMs &&
      nowMs - this.lastBeat >= refractoryMs &&
      this.lowEnergyPeak > minimumLowPeak;
    if (timedBassPulse) this.nextBassPulseMs += this.bassDipPeriodMs!;
    const distanceToBassBeat = Math.min(
      Math.abs(nowMs - this.nextBassPulseMs),
      Math.abs(nowMs - (this.nextBassPulseMs - (this.bassDipPeriodMs ?? 0))),
    );
    let recentHighMinimum = highEnergy;
    for (let i = 0; i < this.highHistory.length; i++) {
      if (nowMs - this.highHistoryTimes[i] <= 90) {
        recentHighMinimum = Math.min(recentHighMinimum, this.highHistory[i]);
      }
    }
    const offbeatOnset =
      bassRhythmActive &&
      !bassDip &&
      !timedBassPulse &&
      distanceToBassBeat > 75 &&
      highEnergy > 0.1 &&
      lowEnergy > minimumLowPeak &&
      highEnergy - recentHighMinimum > 0.022 + (1 - beatSensitivity) * 0.06;
    if (
      settings.beatMode === "detected" &&
      beatSensitivity > 0 &&
      (bassDip ||
        timedBassPulse ||
        offbeatOnset ||
        (!bassRhythmActive && (bassOnset || fluxOnset))) &&
      nowMs - this.lastBeat >= (offbeatOnset ? 75 : refractoryMs)
    ) {
      if (this.lastBeat > -Infinity) {
        const interval = nowMs - this.lastBeat;
        if (interval >= 75 && interval <= 1200)
          this.beatDurationMs = clamp(interval * 0.6, 60, 180);
      }
      this.lastBeat = nowMs;
    }
    this.bassAverage += (bass - this.bassAverage) * Math.min(1, elapsed / 500);
    this.beatFluxAverage +=
      (beatFlux - this.beatFluxAverage) * Math.min(1, elapsed / 650);
    this.previousBass = bass;
    this.previousEnergy = this.frame.energy;
    this.highHistory[this.highHistoryIndex] = highEnergy;
    this.highHistoryTimes[this.highHistoryIndex] = nowMs;
    this.highHistoryIndex =
      (this.highHistoryIndex + 1) % this.highHistory.length;
    if (settings.beatMode === "bpm") {
      this.playbackStartMs ??= 0;
      if (trackBpm !== undefined && Number.isFinite(trackBpm) && trackBpm > 0) {
        const interval = 60000 / clamp(trackBpm, 30, 300);
        const phase =
          (((playbackMs - this.playbackStartMs) % interval) + interval) %
          interval;
        const pulseDuration = interval * 0.3;
        this.frame.beat = clamp(1 - phase / pulseDuration);
      } else {
        this.frame.beat = 0;
      }
    } else {
      this.frame.beat =
        clamp(1 - (nowMs - this.lastBeat) / this.beatDurationMs) *
        beatSensitivity;
    }

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
