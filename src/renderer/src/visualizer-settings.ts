export interface VisualizerSettings {
  enabled: boolean;
  bars: number;
  width: number;
  length: number;
  waveformMultiplier: number;
  waveformRetention: number;
  mirrored: boolean;
  flipped: boolean;
  circleMirrored: boolean;
  circleFlipped: boolean;
  mirrorVertically: boolean;
  circleMirrorVertically: boolean;
  circleInwardLength: number;
  layout: "line" | "circle";
  mode: "fft" | "waveform";
}
export const defaultVisualizer: VisualizerSettings = {
  enabled: true,
  bars: 64,
  width: 65,
  length: 70,
  waveformMultiplier: 10,
  waveformRetention: 200,
  mirrored: true,
  flipped: false,
  circleMirrored: true,
  circleFlipped: false,
  mirrorVertically: false,
  circleMirrorVertically: false,
  circleInwardLength: 0,
  layout: "line",
  mode: "fft",
};
export function parseVisualizer(raw: string | null): VisualizerSettings {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return { ...defaultVisualizer };
    const number = (
      key:
        | "bars"
        | "width"
        | "length"
        | "waveformMultiplier"
        | "waveformRetention"
        | "circleInwardLength",
      min: number,
      max: number,
    ) =>
      typeof value[key] === "number" && Number.isFinite(value[key])
        ? Math.round(Math.max(min, Math.min(max, value[key])))
        : defaultVisualizer[key];
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : true,
      mirrored: typeof value.mirrored === "boolean" ? value.mirrored : true,
      flipped: typeof value.flipped === "boolean" ? value.flipped : false,
      circleMirrored:
        typeof value.circleMirrored === "boolean"
          ? value.circleMirrored
          : typeof value.mirrored === "boolean"
            ? value.mirrored
            : true,
      circleFlipped:
        typeof value.circleFlipped === "boolean"
          ? value.circleFlipped
          : typeof value.flipped === "boolean"
            ? value.flipped
            : false,
      mirrorVertically:
        typeof value.mirrorVertically === "boolean"
          ? value.mirrorVertically
          : false,
      circleMirrorVertically:
        typeof value.circleMirrorVertically === "boolean"
          ? value.circleMirrorVertically
          : typeof value.mirrorVertically === "boolean"
            ? value.mirrorVertically
            : false,
      circleInwardLength: number("circleInwardLength", 0, 100),
      bars: number("bars", 8, 256),
      width: number("width", 10, 100),
      length: number("length", 10, 100),
      waveformMultiplier: number("waveformMultiplier", 1, 25),
      waveformRetention: number("waveformRetention", 0, 250),
      layout: value.layout === "circle" ? "circle" : "line",
      mode: value.mode === "waveform" ? "waveform" : "fft",
    };
  } catch {
    return { ...defaultVisualizer };
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
