import assert from "node:assert/strict";
import test from "node:test";
import { createArtworkTheme } from "../src/renderer/src/artwork-theme";

function createPixels(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const [red, green, blue] = colorAt(x, y);
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function themeHue(theme: ReturnType<typeof createArtworkTheme>): number {
  assert.ok(theme);
  const match = theme.variables["--pink"].match(/^hsl\((\d+)/);
  assert.ok(match);
  return Number(match[1]);
}

test("artwork themes keep generated surfaces dark and retain image color", () => {
  const pixels = new Uint8ClampedArray(8 * 4 * 4);
  for (let index = 0; index < 8 * 4; index++) {
    const offset = index * 4;
    const blue = index >= 16;
    pixels[offset] = blue ? 32 : 232;
    pixels[offset + 1] = blue ? 96 : 40;
    pixels[offset + 2] = blue ? 224 : 72;
    pixels[offset + 3] = 255;
  }

  const theme = createArtworkTheme(pixels, 8, 4);
  assert.ok(theme);
  assert.notEqual(theme.variables["--pink-rgb"], "0 0 0");
  assert.match(theme.variables["--app-background"], /7%/);
  assert.match(theme.variables["--panel-option"], /16%/);
  assert.equal(theme.variables["--pink-foreground"], undefined);
  assert.equal(theme.variables["--button-foreground"], undefined);
  assert.equal(theme.variables["--now-playing-background"], undefined);
  assert.equal(theme.variables["--artwork-background"], undefined);
  assert.equal(theme.variables["--artwork-overlay"], undefined);
});

test("artwork themes ignore invalid or empty samples", () => {
  assert.equal(createArtworkTheme(new Uint8ClampedArray(), 0, 0), null);
  assert.equal(createArtworkTheme(new Uint8ClampedArray(3), 1, 1), null);
});

test("artwork themes favor a vivid accent over a larger neutral background", () => {
  const theme = createArtworkTheme(
    createPixels(100, 100, (x, y) =>
      x >= 90 && y >= 90 ? [24, 104, 240] : [120, 120, 120],
    ),
    100,
    100,
  );

  const hue = themeHue(theme);
  assert.ok(hue >= 195 && hue <= 240, `expected a blue hue, got ${hue}`);
});

test("artwork themes favor a contrasting accent over a dominant color field", () => {
  const theme = createArtworkTheme(
    createPixels(100, 100, (x) => (x < 20 ? [240, 100, 20] : [20, 50, 220])),
    100,
    100,
  );

  const hue = themeHue(theme);
  assert.ok(hue >= 5 && hue <= 40, `expected an orange hue, got ${hue}`);
});
