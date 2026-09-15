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

export type VisualizerProfileKey =
  "circle-fft" | "circle-waveform" | "line-fft" | "line-waveform";

export interface VisualizerSettings {
  enabled: boolean;
  layout: "line" | "circle";
  line: VisualizerLayoutSettings;
  circle: VisualizerLayoutSettings;
  profiles: Record<VisualizerProfileKey, VisualizerLayoutSettings>;
}

function createDefaultLayout(
  overrides: Partial<VisualizerLayoutSettings> = {},
): VisualizerLayoutSettings {
  return {
    mode: "fft",
    bars: 64,
    width: 50,
    length: 33,
    radius: 40,
    rotation: 0.5,
    waveformMultiplier: 2,
    waveformRetention: 50,
    fftRetention: 15,
    mirrored: true,
    flipped: true,
    mirrorVertically: true,
    inwardLength: 0,
    ...overrides,
  };
}

const defaultVisualizerProfiles: Record<
  VisualizerProfileKey,
  VisualizerLayoutSettings
> = {
  "circle-fft": createDefaultLayout({ inwardLength: 100, flipped: false }),
  "circle-waveform": createDefaultLayout({
    mode: "waveform",
    bars: 138,
    length: 50,
    mirrored: false,
    flipped: false,
    mirrorVertically: false,
    inwardLength: 100,
  }),
  "line-fft": createDefaultLayout({ bars: 48 }),
  "line-waveform": createDefaultLayout({
    mode: "waveform",
    bars: 48,
    length: 50,
  }),
};

function cloneVisualizerProfiles(): Record<
  VisualizerProfileKey,
  VisualizerLayoutSettings
> {
  return Object.fromEntries(
    Object.entries(defaultVisualizerProfiles).map(([key, settings]) => [
      key,
      { ...settings },
    ]),
  ) as Record<VisualizerProfileKey, VisualizerLayoutSettings>;
}

export function visualizerProfileKey(
  layout: "line" | "circle",
  mode: "fft" | "waveform",
): VisualizerProfileKey {
  return `${layout}-${mode}` as VisualizerProfileKey;
}

function withVisualizerMode(
  settings: VisualizerLayoutSettings,
  mode: "fft" | "waveform",
): VisualizerLayoutSettings {
  return { ...settings, mode };
}

export const defaultVisualizer: VisualizerSettings = {
  enabled: true,
  layout: "circle",
  line: { ...defaultVisualizerProfiles["line-fft"] },
  circle: { ...defaultVisualizerProfiles["circle-waveform"] },
  profiles: cloneVisualizerProfiles(),
};

function cloneDefaultVisualizer(): VisualizerSettings {
  return {
    enabled: defaultVisualizer.enabled,
    layout: defaultVisualizer.layout,
    line: { ...defaultVisualizer.line },
    circle: { ...defaultVisualizer.circle },
    profiles: cloneVisualizerProfiles(),
  };
}

export function getVisualizerLayoutSettings(
  settings: VisualizerSettings,
): VisualizerLayoutSettings {
  const layoutSettings = settings[settings.layout];
  return (
    settings.profiles[
      visualizerProfileKey(settings.layout, layoutSettings.mode)
    ] ?? layoutSettings
  );
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
      ...defaultVisualizer.line,
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
      rotation: defaultVisualizer.line.rotation,
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
      ...defaultVisualizer.circle,
      ...legacyLine,
      mode:
        value.mode === "waveform" || value.mode === "fft"
          ? legacyMode
          : defaultVisualizer.circle.mode,
      radius: boundedNumber(value.circleRadius, legacyLine.radius, 8, 45),
      rotation: boundedNumber(
        value.circleRotation,
        defaultVisualizer.circle.rotation,
        -6,
        6,
        0.25,
      ),
      mirrored: booleanValue(value, "circleMirrored", legacyLine.mirrored),
      flipped: booleanValue(value, "circleFlipped", legacyLine.flipped),
      mirrorVertically: booleanValue(
        value,
        "circleMirrorVertically",
        legacyLine.mirrorVertically,
      ),
      inwardLength: boundedNumber(value.circleInwardLength, 0, 0, 100),
    };

    const line = parseLayout(value.line, legacyLine);
    const circle = parseLayout(value.circle, legacyCircle);
    const storedProfiles = record(value.profiles);
    const hasStoredProfiles = Object.keys(storedProfiles).some((key) =>
      Object.hasOwn(defaultVisualizerProfiles, key),
    );
    const profiles = hasStoredProfiles
      ? (Object.fromEntries(
          Object.entries(defaultVisualizerProfiles).map(([key, fallback]) => [
            key,
            parseLayout(storedProfiles[key], fallback),
          ]),
        ) as Record<VisualizerProfileKey, VisualizerLayoutSettings>)
      : {
          "circle-fft": withVisualizerMode(circle, "fft"),
          "circle-waveform": withVisualizerMode(circle, "waveform"),
          "line-fft": withVisualizerMode(line, "fft"),
          "line-waveform": withVisualizerMode(line, "waveform"),
        };
    return {
      enabled: booleanValue(value, "enabled", true),
      layout: value.layout === "circle" ? "circle" : "line",
      line,
      circle,
      profiles,
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
