import assert from "node:assert/strict";
import test from "node:test";
import { createArtworkTheme } from "../src/renderer/src/artwork-theme";

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
