export interface VisualizerSettings {
  enabled: boolean;
  style: "circle" | "ring" | "line" | "wire-line" | "ripple-line";
  mode: "spectrum" | "waveform" | "energy";
  linePosition:
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "middle-horizontal"
    | "middle-vertical";
  linePadding: number;
  barCount: number;
  responsivenessMs: number;
  barWidth: number;
  barLength: number;
  gap: number;
  centerOffset: number;
  radius: number;
  lineThickness: number;
  positionX: number;
  positionY: number;
  scale: number;
  rotationSpeed: number;
  rotation: number;
  sensitivity: number;
  fftSize: 256 | 512 | 1024 | 2048 | 4096 | 8192;
  frequencyRanges: FrequencyRange[];
  frequencyScale: "log" | "linear";
  mirror: boolean;
  reverse: boolean;
  boom: number;
  bassImpact: number;
  beatImpact: number;
  glow: number;
  opacity: number;
  colorMode: "theme" | "custom";
  color1: string;
  color2: string;
  /** 0 disables the animation frame-rate cap. */
  maxFps: 0 | 30 | 60;
  resolution: 50 | 75 | 100;
  respectReducedMotion: boolean;
}

export interface FrequencyRange {
  min: number;
  max: number;
}

export type VisualizerStatus =
  "off" | "loading" | "ready" | "unsupported" | "error";

export const defaultVisualizerSettings: VisualizerSettings = {
  enabled: true,
  style: "circle",
  mode: "spectrum",
  linePosition: "bottom",
  linePadding: 0,
  barCount: 64,
  responsivenessMs: 80,
  barWidth: 75,
  barLength: 20,
  gap: 2,
  centerOffset: 50,
  radius: 25,
  lineThickness: 2,
  positionX: 50,
  positionY: 50,
  scale: 100,
  rotationSpeed: 0,
  rotation: 0,
  sensitivity: 1.5,
  fftSize: 2048,
  frequencyRanges: [{ min: 30, max: 16000 }],
  frequencyScale: "log",
  mirror: false,
  reverse: false,
  boom: 25,
  bassImpact: 50,
  beatImpact: 40,
  glow: 25,
  opacity: 85,
  colorMode: "theme",
  color1: "#ff66aa",
  color2: "#aa88ff",
  maxFps: 60,
  resolution: 100,
  respectReducedMotion: true,
};

export const visualizerOptions = {
  style: [
    { value: "circle", label: "Circle bars" },
    { value: "ring", label: "Ripple ring" },
    { value: "line", label: "Line bars" },
    { value: "wire-line", label: "Wire line" },
    { value: "ripple-line", label: "Ripple line" },
  ],
  mode: [
    { value: "spectrum", label: "FFT spectrum" },
    { value: "waveform", label: "Waveform" },
    { value: "energy", label: "Loudness / energy" },
  ],
  linePosition: [
    { value: "top", label: "Top" },
    { value: "bottom", label: "Bottom" },
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
    { value: "middle-horizontal", label: "Middle horizontal" },
    { value: "middle-vertical", label: "Middle vertical" },
  ],
  frequencyScale: [
    { value: "log", label: "Logarithmic" },
    { value: "linear", label: "Linear" },
  ],
  fftSize: [256, 512, 1024, 2048, 4096, 8192].map((value) => ({
    value,
    label: String(value),
  })),
  colorMode: [
    { value: "theme", label: "Current theme" },
    { value: "custom", label: "Custom gradient" },
  ],
  maxFps: [
    { value: 0, label: "Max frame rate" },
    { value: 30, label: "30 FPS" },
    { value: 60, label: "60 FPS" },
  ],
  resolution: [
    { value: 50, label: "50%" },
    { value: 75, label: "75%" },
    { value: 100, label: "100%" },
  ],
} as const;

export const visualizerRanges = {
  barCount: { min: 8, max: 256, step: 1, label: "Bars / bumps", unit: "" },
  responsivenessMs: {
    min: 0,
    max: 1000,
    step: 1,
    label: "Response time",
    unit: "ms",
  },
  barWidth: { min: 10, max: 100, step: 1, label: "Bar width", unit: "%" },
  barLength: { min: 0, max: 100, step: 1, label: "Bar length", unit: "%" },
  gap: { min: 0, max: 40, step: 0.5, label: "Gap", unit: "px" },
  linePadding: {
    min: 0,
    max: 40,
    step: 1,
    label: "Line padding",
    unit: "%",
  },
  centerOffset: {
    min: 0,
    max: 100,
    step: 1,
    label: "Center offset",
    unit: "%",
  },
  radius: { min: 1, max: 45, step: 1, label: "Radius", unit: "%" },
  lineThickness: {
    min: 0.5,
    max: 12,
    step: 0.5,
    label: "Stroke thickness",
    unit: "px",
  },
  positionX: {
    min: 0,
    max: 100,
    step: 1,
    label: "Horizontal position",
    unit: "%",
  },
  positionY: {
    min: 0,
    max: 100,
    step: 1,
    label: "Vertical position",
    unit: "%",
  },
  scale: { min: 25, max: 150, step: 1, label: "Overall size", unit: "%" },
  rotationSpeed: {
    min: -180,
    max: 180,
    step: 1,
    label: "Rotation speed",
    unit: "°/s",
  },
  rotation: { min: 0, max: 360, step: 1, label: "Starting angle", unit: "°" },
  sensitivity: {
    min: 0.1,
    max: 15,
    step: 0.1,
    label: "Sensitivity",
    unit: "×",
  },
  boom: { min: 0, max: 100, step: 1, label: "Boom / size pulse", unit: "%" },
  bassImpact: { min: 0, max: 100, step: 1, label: "Bass impact", unit: "%" },
  beatImpact: { min: 0, max: 100, step: 1, label: "Beat highlight", unit: "%" },
  glow: { min: 0, max: 100, step: 1, label: "Glow", unit: "%" },
  opacity: { min: 0, max: 100, step: 1, label: "Opacity", unit: "%" },
} as const;

export type VisualizerRangeKey = keyof typeof visualizerRanges;

/** Read only supported values; persisted settings must never size unbounded GPU buffers. */
export function parseVisualizerSettings(value: unknown): VisualizerSettings {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const parsed = { ...defaultVisualizerSettings };
  for (const key of Object.keys(visualizerRanges) as VisualizerRangeKey[]) {
    const candidate = record[key];
    const range = visualizerRanges[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      parsed[key] = Math.min(range.max, Math.max(range.min, candidate));
    }
  }
  parsed.barCount = Math.round(parsed.barCount);
  for (const key of [
    "enabled",
    "mirror",
    "reverse",
    "respectReducedMotion",
  ] as const) {
    if (typeof record[key] === "boolean") parsed[key] = record[key];
  }
  for (const key of Object.keys(
    visualizerOptions,
  ) as (keyof typeof visualizerOptions)[]) {
    const candidate = record[key];
    if (visualizerOptions[key].some((option) => option.value === candidate)) {
      Object.assign(parsed, { [key]: candidate });
    }
  }
  if (record.style === "line-ripple") parsed.style = "wire-line";
  const legacyRanges = [
    {
      min:
        record.minFrequency ?? defaultVisualizerSettings.frequencyRanges[0].min,
      max:
        record.maxFrequency ?? defaultVisualizerSettings.frequencyRanges[0].max,
    },
  ];
  const rangeCandidates = Array.isArray(record.frequencyRanges)
    ? record.frequencyRanges
    : legacyRanges;
  const ranges = rangeCandidates
    .flatMap((candidate): FrequencyRange[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const range = candidate as Record<string, unknown>;
      if (
        typeof range.min !== "number" ||
        !Number.isFinite(range.min) ||
        typeof range.max !== "number" ||
        !Number.isFinite(range.max)
      )
        return [];
      const min = Math.min(22050, Math.max(20, range.min));
      const max = Math.min(22050, Math.max(20, range.max));
      return min < max ? [{ min, max }] : [];
    })
    .sort((a, b) => a.min - b.min);
  parsed.frequencyRanges = ranges.length
    ? ranges
    : defaultVisualizerSettings.frequencyRanges.map((range) => ({ ...range }));
  for (const key of ["color1", "color2"] as const) {
    const candidate = record[key];
    if (typeof candidate === "string" && /^#[0-9a-f]{6}$/i.test(candidate)) {
      parsed[key] = candidate.toLowerCase();
    }
  }
  return parsed;
}

export const visualizerPresets = [
  {
    label: "Orbit",
    settings: {
      style: "circle",
      mode: "spectrum",
      barCount: 64,
      rotationSpeed: 8,
      responsivenessMs: 80,
    },
  },
  {
    label: "Ripple",
    settings: {
      style: "ring",
      mode: "spectrum",
      barCount: 96,
      barLength: 14,
      lineThickness: 3,
      responsivenessMs: 100,
    },
  },
  {
    label: "Spectrum",
    settings: {
      style: "line",
      linePosition: "bottom",
      mode: "spectrum",
      barCount: 80,
      centerOffset: 0,
      barLength: 35,
      responsivenessMs: 45,
    },
  },
  {
    label: "Oscilloscope",
    settings: {
      style: "line",
      linePosition: "middle-horizontal",
      mode: "waveform",
      barCount: 128,
      barWidth: 100,
      gap: 0,
      barLength: 30,
      boom: 0,
      responsivenessMs: 0,
    },
  },
  {
    label: "Pulse",
    settings: {
      style: "ring",
      mode: "energy",
      barCount: 48,
      boom: 65,
      bassImpact: 75,
      beatImpact: 60,
      responsivenessMs: 60,
    },
  },
] satisfies { label: string; settings: Partial<VisualizerSettings> }[];

export function applyVisualizerPreset(
  settings: VisualizerSettings,
  index: number,
): VisualizerSettings {
  const preset = visualizerPresets[index];
  if (!preset) return settings;
  return parseVisualizerSettings({
    // Presets change only the values they define. Keeping the complete
    // current object here means switching styles never discards a user's
    // geometry, response, color, accessibility, or performance choices.
    ...settings,
    ...preset.settings,
  });
}
