export interface VisualizerLayoutSettings {
  mode: "fft" | "waveform";
  bars: number;
  width: number;
  length: number;
  radius: number;
  rotation: number;
  waveformMultiplier: number;
  waveformRetention: number;
  fftRetention: number;
  mirrored: boolean;
  flipped: boolean;
  mirrorVertically: boolean;
  inwardLength: number;
}

export interface VisualizerSettings {
  enabled: boolean;
  layout: "line" | "circle";
  line: VisualizerLayoutSettings;
  circle: VisualizerLayoutSettings;
}

function createDefaultLayout(): VisualizerLayoutSettings {
  return {
    mode: "fft",
    bars: 64,
    width: 65,
    length: 70,
    radius: 23,
    rotation: 0,
    waveformMultiplier: 10,
    waveformRetention: 200,
    fftRetention: 200,
    mirrored: true,
    flipped: false,
    mirrorVertically: false,
    inwardLength: 0,
  };
}

export const defaultVisualizer: VisualizerSettings = {
  enabled: true,
  layout: "line",
  line: createDefaultLayout(),
  circle: createDefaultLayout(),
};

function cloneDefaultVisualizer(): VisualizerSettings {
  return {
    enabled: defaultVisualizer.enabled,
    layout: defaultVisualizer.layout,
    line: { ...defaultVisualizer.line },
    circle: { ...defaultVisualizer.circle },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function booleanValue(
  value: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  return typeof value[key] === "boolean" ? value[key] : fallback;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  step = 1,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.max(min, Math.min(max, value));
  return Math.round(bounded / step) * step;
}

function parseLayout(
  raw: unknown,
  fallback: VisualizerLayoutSettings,
): VisualizerLayoutSettings {
  const value = record(raw);
  return {
    mode:
      value.mode === "waveform"
        ? "waveform"
        : value.mode === "fft"
          ? "fft"
          : fallback.mode,
    bars: boundedNumber(value.bars, fallback.bars, 8, 256),
    width: boundedNumber(value.width, fallback.width, 10, 100),
    length: boundedNumber(value.length, fallback.length, 10, 100),
    radius: boundedNumber(value.radius, fallback.radius, 8, 45),
    rotation: boundedNumber(value.rotation, fallback.rotation, -6, 6, 0.25),
    waveformMultiplier: boundedNumber(
      value.waveformMultiplier,
      fallback.waveformMultiplier,
      1,
      25,
    ),
    waveformRetention: boundedNumber(
      value.waveformRetention,
      fallback.waveformRetention,
      0,
      250,
    ),
    fftRetention: boundedNumber(
      value.fftRetention,
      fallback.fftRetention,
      0,
      250,
    ),
    mirrored: booleanValue(value, "mirrored", fallback.mirrored),
    flipped: booleanValue(value, "flipped", fallback.flipped),
    mirrorVertically: booleanValue(
      value,
      "mirrorVertically",
      fallback.mirrorVertically,
    ),
    inwardLength: boundedNumber(
      value.inwardLength,
      fallback.inwardLength,
      0,
      100,
    ),
  };
}

export function parseVisualizer(raw: string | null): VisualizerSettings {
  try {
    const value = record(JSON.parse(raw ?? "null"));
    if (!Object.keys(value).length) return cloneDefaultVisualizer();

    const legacyMode =
      value.mode === "waveform" || value.mode === "fft"
        ? value.mode
        : defaultVisualizer.line.mode;
    const legacyLine: VisualizerLayoutSettings = {
      ...createDefaultLayout(),
      mode: legacyMode,
      bars: boundedNumber(value.bars, defaultVisualizer.line.bars, 8, 256),
      width: boundedNumber(value.width, defaultVisualizer.line.width, 10, 100),
      length: boundedNumber(
        value.length,
        defaultVisualizer.line.length,
        10,
        100,
      ),
      radius: boundedNumber(value.radius, defaultVisualizer.line.radius, 8, 45),
      rotation: 0,
      waveformMultiplier: boundedNumber(
        value.waveformMultiplier,
        defaultVisualizer.line.waveformMultiplier,
        1,
        25,
      ),
      waveformRetention: boundedNumber(
        value.waveformRetention,
        defaultVisualizer.line.waveformRetention,
        0,
        250,
      ),
      fftRetention: boundedNumber(
        value.fftRetention,
        defaultVisualizer.line.fftRetention,
        0,
        250,
      ),
      mirrored: booleanValue(value, "mirrored", true),
      flipped: booleanValue(value, "flipped", false),
      mirrorVertically: booleanValue(value, "mirrorVertically", false),
      inwardLength: boundedNumber(value.inwardLength, 0, 0, 100),
    };
    const legacyCircle: VisualizerLayoutSettings = {
      ...legacyLine,
      radius: boundedNumber(value.circleRadius, legacyLine.radius, 8, 45),
      rotation: boundedNumber(value.circleRotation, 0, -6, 6, 0.25),
      mirrored: booleanValue(value, "circleMirrored", legacyLine.mirrored),
      flipped: booleanValue(value, "circleFlipped", legacyLine.flipped),
      mirrorVertically: booleanValue(
        value,
        "circleMirrorVertically",
        legacyLine.mirrorVertically,
      ),
      inwardLength: boundedNumber(value.circleInwardLength, 0, 0, 100),
    };

    return {
      enabled: booleanValue(value, "enabled", true),
      layout: value.layout === "circle" ? "circle" : "line",
      line: parseLayout(value.line, legacyLine),
      circle: parseLayout(value.circle, legacyCircle),
    };
  } catch {
    return cloneDefaultVisualizer();
  }
}

/** Reflect the sequence without repeating the bar at the turning point. */
export function visualizerBarIndex(
  index: number,
  bars: number,
  mirrored: boolean,
  flipped = false,
): number {
  const sampleIndex =
    mirrored && index >= bars ? 2 * (bars - 1) - index : index;
  return mirrored && flipped ? bars - 1 - sampleIndex : sampleIndex;
}

/** Remove a repeated leading plateau; an entirely flat spectrum has no bars. */
export function fftLeadingOffset(values: Float32Array, count: number): number {
  let end = 1;
  while (end < count && values[end] === values[0]) end++;
  return end > 1 ? end : 0;
}

/** Time-based smoothing: retention is the time to close half the amplitude gap. */
export function retainWaveform(
  previous: number,
  target: number,
  elapsed: number,
  retention: number,
): number {
  return retention <= 0
    ? target
    : target + (previous - target) * Math.pow(0.5, elapsed / retention);
}
