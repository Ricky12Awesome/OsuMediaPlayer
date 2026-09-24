export type VisualizerColorField = "color1" | "color2";

export const VISUALIZER_COLOR_PREVIEW_EVENT = "visualizer-color-preview";

export function previewVisualizerColor(
  field: VisualizerColorField,
  value: string,
): void {
  document.dispatchEvent(
    new CustomEvent(VISUALIZER_COLOR_PREVIEW_EVENT, {
      detail: { field, value },
    }),
  );
}

export function normalizeHexColor(value: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function hexToHsv(hex: string): {
  hue: number;
  saturation: number;
  brightness: number;
} {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const brightest = Math.max(red, green, blue);
  const darkest = Math.min(red, green, blue);
  const difference = brightest - darkest;
  let hue = 0;
  if (difference > 0) {
    if (brightest === red) hue = ((green - blue) / difference) % 6;
    else if (brightest === green) hue = (blue - red) / difference + 2;
    else hue = (red - green) / difference + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return {
    hue,
    saturation: brightest === 0 ? 0 : (difference / brightest) * 100,
    brightness: brightest * 100,
  };
}

export function hsvToHex(
  hue: number,
  saturation: number,
  brightness: number,
): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, saturation / 100));
  const v = Math.max(0, Math.min(1, brightness / 100));
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = v - chroma;
  const sector = Math.floor(h / 60);
  const channels = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector];
  return `#${channels
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
