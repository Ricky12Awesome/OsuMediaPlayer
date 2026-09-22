export interface VisualizerSettings {
  enabled: boolean;
  style: "circle" | "ring" | "line" | "double-ring";
  mode: "spectrum" | "waveform" | "energy";
  linePosition:
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "middle-horizontal"
    | "middle-vertical";
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
  minFrequency: number;
  maxFrequency: number;
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

export type VisualizerStatus =
  "off" | "loading" | "ready" | "unsupported" | "error";

export const defaultVisualizerSettings: VisualizerSettings = {
  enabled: true,
  style: "circle",
  mode: "spectrum",
  linePosition: "bottom",
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
  minFrequency: 30,
  maxFrequency: 16000,
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
    { value: "double-ring", label: "Double ring" },
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
  centerOffset: {
    min: 0,
    max: 100,
    step: 1,
    label: "Center offset",
    unit: "%",
  },
  radius: { min: 5, max: 45, step: 1, label: "Radius", unit: "%" },
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
  sensitivity: { min: 0.1, max: 5, step: 0.1, label: "Sensitivity", unit: "×" },
  minFrequency: {
    min: 20,
    max: 20000,
    step: 1,
    label: "Lowest frequency",
    unit: "Hz",
  },
  maxFrequency: {
    min: 20,
    max: 22050,
    step: 1,
    label: "Highest frequency",
    unit: "Hz",
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
  if (parsed.maxFrequency <= parsed.minFrequency) {
    parsed.maxFrequency = parsed.minFrequency + 1;
  }
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
      style: "double-ring",
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
