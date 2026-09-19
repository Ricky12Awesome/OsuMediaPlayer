export type ArtworkThemeVariables = Record<`--${string}`, string>;

export interface ArtworkTheme {
  variables: ArtworkThemeVariables;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

interface ColorBucket extends Rgb {
  count: number;
  hsl: Hsl;
}

const fallbackHue = 280;
const maxColorSamples = 4096;
const hueBucketCount = 24;
const hueBucketSize = 360 / hueBucketCount;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) return { h: fallbackHue, s: 0, l: lightness * 100 };

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  hue *= 60;

  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = ((h % 360) + 360) % 360;
  const segment = hue / 60;
  const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] =
    segment < 1
      ? [chroma, intermediate, 0]
      : segment < 2
        ? [intermediate, chroma, 0]
        : segment < 3
          ? [0, chroma, intermediate]
          : segment < 4
            ? [0, intermediate, chroma]
            : segment < 5
              ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate];
  const match = lightness - chroma / 2;
  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  };
}

function hsl(h: number, s: number, l: number, alpha?: number): string {
  const hue = Math.round((h + 360) % 360);
  const saturation = Math.round(clamp(s, 0, 100));
  const lightness = Math.round(clamp(l, 0, 100));
  return alpha === undefined
    ? `hsl(${hue} ${saturation}% ${lightness}%)`
    : `hsl(${hue} ${saturation}% ${lightness}% / ${alpha})`;
}

function rgb({ r, g, b }: Rgb, alpha?: number): string {
  const red = Math.round(clamp(r, 0, 255));
  const green = Math.round(clamp(g, 0, 255));
  const blue = Math.round(clamp(b, 0, 255));
  return alpha === undefined
    ? `rgb(${red} ${green} ${blue})`
    : `rgb(${red} ${green} ${blue} / ${alpha})`;
}

function hueDistance(first: number, second: number): number {
  const distance = Math.abs(first - second) % 360;
  return Math.min(distance, 360 - distance);
}

function quantize(value: number): number {
  return clamp(Math.round(value / 16) * 16, 0, 255);
}

function colorBucketKey(color: Hsl): number {
  // Keep neutral colors together. A hue for a nearly gray pixel is arbitrary
  // and should not create a competing accent bucket.
  if (color.s < 10) return -1;

  // Center the bins so reds around 0° and 360° end up in the same bucket.
  return Math.floor(
    ((((color.h + hueBucketSize / 2) % 360) + 360) % 360) / hueBucketSize,
  );
}

function addColorSample(
  buckets: Map<number, ColorBucket>,
  color: Rgb,
  hsl: Hsl,
): void {
  const key = colorBucketKey(hsl);
  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { ...color, count: 1, hsl });
    return;
  }

  // Keep a representative color for each hue rather than requiring every
  // shade of a gradient to match the same RGB bucket.
  bucket.count++;
  bucket.r += (color.r - bucket.r) / bucket.count;
  bucket.g += (color.g - bucket.g) / bucket.count;
  bucket.b += (color.b - bucket.b) / bucket.count;
  bucket.hsl = rgbToHsl(bucket);
}

function colorDistance(first: Rgb, second: Rgb): number {
  return (
    Math.sqrt(
      (first.r - second.r) ** 2 +
        (first.g - second.g) ** 2 +
        (first.b - second.b) ** 2,
    ) / Math.sqrt(255 ** 2 * 3)
  );
}

function colorScore(
  color: ColorBucket,
  sampleCount: number,
  average: ColorBucket,
): number {
  const population = clamp(color.count / sampleCount, 0, 1);
  const saturation = color.hsl.s / 100;
  const lightness = color.hsl.l / 100;
  const usableLightness = 0.35 + (1 - Math.abs(lightness - 0.46) / 0.54);
  const contrast = colorDistance(color, average);

  // Area still penalizes isolated noise, but its square-root-like weight keeps
  // a vivid accent from losing to a much larger gray background.
  const populationWeight = population ** 0.45;
  const vividness = 0.16 + saturation * 1.55;
  const contrastWeight = 0.4 + contrast * 1.6;
  return populationWeight * vividness * usableLightness * contrastWeight;
}

function pickColors(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { primary: ColorBucket; secondary: ColorBucket } | null {
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(width * height) ||
    pixels.length < width * height * 4
  )
    return null;

  const buckets = new Map<number, ColorBucket>();
  const pixelCount = width * height;
  const sampleStep = Math.max(1, Math.sqrt(pixelCount / maxColorSamples));
  let sampleWidth = Math.min(
    width,
    maxColorSamples,
    Math.max(1, Math.ceil(width / sampleStep)),
  );
  let sampleHeight = Math.min(
    height,
    maxColorSamples,
    Math.max(1, Math.ceil(height / sampleStep)),
  );
  // Extremely wide or tall images can otherwise exceed the sample budget
  // because one dimension may already be smaller than the calculated step.
  if (sampleWidth * sampleHeight > maxColorSamples) {
    if (sampleWidth >= sampleHeight)
      sampleWidth = Math.max(1, Math.floor(maxColorSamples / sampleHeight));
    else sampleHeight = Math.max(1, Math.floor(maxColorSamples / sampleWidth));
  }
  let sampleCount = 0;
  let totalRed = 0;
  let totalGreen = 0;
  let totalBlue = 0;

  // Use the center of evenly distributed cells. This caps work for large
  // artwork while still covering the full width and height of the image.
  for (let row = 0; row < sampleHeight; row++) {
    const y = Math.min(
      height - 1,
      Math.floor(((row + 0.5) * height) / sampleHeight),
    );
    for (let column = 0; column < sampleWidth; column++) {
      const x = Math.min(
        width - 1,
        Math.floor(((column + 0.5) * width) / sampleWidth),
      );
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3];
      if (alpha < 96) continue;

      const color = {
        r: quantize(pixels[offset]),
        g: quantize(pixels[offset + 1]),
        b: quantize(pixels[offset + 2]),
      };
      addColorSample(buckets, color, rgbToHsl(color));

      sampleCount++;
      totalRed += color.r;
      totalGreen += color.g;
      totalBlue += color.b;
    }
  }

  if (!sampleCount || !buckets.size) return null;

  const average: ColorBucket = {
    r: totalRed / sampleCount,
    g: totalGreen / sampleCount,
    b: totalBlue / sampleCount,
    count: sampleCount,
    hsl: rgbToHsl({
      r: totalRed / sampleCount,
      g: totalGreen / sampleCount,
      b: totalBlue / sampleCount,
    }),
  };
  const ranked = [...buckets.values()].sort(
    (first, second) =>
      colorScore(second, sampleCount, average) -
      colorScore(first, sampleCount, average),
  );
  const primary = ranked[0] ?? average;
  const secondary =
    ranked.find(
      (color) =>
        color !== primary &&
        hueDistance(color.hsl.h, primary.hsl.h) >= 32 &&
        color.count >= Math.max(2, primary.count * 0.06),
    ) ??
    ranked[1] ??
    average;

  return { primary, secondary };
}

/**
 * Builds a dark UI palette from a small RGBA image sample. This is separate
 * from the canvas code so the palette rules can be tested without a browser.
 */
export function createArtworkTheme(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ArtworkTheme | null {
  const colors = pickColors(pixels, width, height);
  if (!colors) return null;

  const primary = colors.primary.hsl;
  const secondary = colors.secondary.hsl;
  const hue = primary.s >= 12 ? primary.h : fallbackHue;
  const secondaryHue = secondary.s >= 12 ? secondary.h : (hue + 42) % 360;
  const surfaceSaturation = clamp(Math.max(primary.s, 24) * 0.42, 12, 36);
  const accentSaturation = clamp(Math.max(primary.s, 48) + 12, 58, 88);
  const accentHsl = {
    h: hue,
    s: accentSaturation,
    l: clamp(primary.l * 0.34 + 51, 57, 68),
  };
  const accent = hsl(accentHsl.h, accentHsl.s, accentHsl.l);
  const accentRgb = hslToRgb(accentHsl);
  const accentBright = hsl(hue, accentSaturation, 74);
  const accentPale = hsl(hue, clamp(accentSaturation - 4, 54, 82), 82);
  const accentText = hsl(hue, clamp(accentSaturation - 12, 45, 76), 79);
  const surfaceHue = hue;
  const border = hsl(hue, surfaceSaturation + 10, 70, 0.13);
  const rangeSong = hsl(hue, surfaceSaturation + 8, 27);

  return {
    variables: {
      "--pink": accent,
      "--pink-rgb": `${Math.round(accentRgb.r)} ${Math.round(
        accentRgb.g,
      )} ${Math.round(accentRgb.b)}`,
      "--pink-bright": accentBright,
      "--pink-pale": accentPale,
      "--pink-text": accentText,
      "--app-background": hsl(surfaceHue, surfaceSaturation, 7),
      "--song-list-background": hsl(surfaceHue, surfaceSaturation, 10, 0.97),
      "--transport-background": hsl(surfaceHue, surfaceSaturation, 11),
      "--panel": hsl(surfaceHue, surfaceSaturation, 10),
      "--panel-raised": hsl(surfaceHue, surfaceSaturation, 11),
      "--panel-deep": hsl(surfaceHue, surfaceSaturation, 7.5),
      "--panel-subtle": hsl(surfaceHue, surfaceSaturation, 13),
      "--panel-option": hsl(surfaceHue, surfaceSaturation, 16),
      "--panel-muted": hsl(surfaceHue, surfaceSaturation, 18),
      "--panel-row": hsl(surfaceHue, surfaceSaturation, 11, 0.5),
      "--panel-hover": hsl(surfaceHue, surfaceSaturation, 16),
      "--panel-selected": hsl(surfaceHue, surfaceSaturation, 19),
      "--panel-current": `linear-gradient(100deg, ${rgb(
        accentRgb,
        0.13,
      )}, ${rgb(accentRgb, 0.04)})`,
      "--song-art-background": `linear-gradient(145deg, ${hsl(
        hue,
        accentSaturation,
        35,
      )}, ${hsl(secondaryHue, Math.max(secondary.s, 32), 20)})`,
      "--placeholder-art-background": hsl(surfaceHue, surfaceSaturation, 16),
      "--placeholder-title-background": hsl(surfaceHue, surfaceSaturation, 19),
      "--placeholder-artist-background": hsl(surfaceHue, surfaceSaturation, 17),
      "--error-background": hsl(hue, Math.max(surfaceSaturation, 22), 18),
      "--border": border,
      "--range-song": rangeSong,
      "--scrollbar": hsl(surfaceHue, surfaceSaturation + 8, 31),
      "--selection": hsl(hue, accentSaturation, 62, 0.4),
    },
  };
}

/** Samples the already-loaded artwork image without downloading it again. */
export function extractArtworkTheme(
  image: HTMLImageElement,
): ArtworkTheme | null {
  if (!image.naturalWidth || !image.naturalHeight) return null;

  // A fixed-size canvas keeps extraction cheap while letting the browser
  // average the complete image before the palette scan runs.
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  try {
    context.drawImage(image, 0, 0, size, size);
    const sample = context.getImageData(0, 0, size, size);
    return createArtworkTheme(sample.data, sample.width, sample.height);
  } catch {
    // Cross-origin or unsupported artwork should never prevent playback.
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
