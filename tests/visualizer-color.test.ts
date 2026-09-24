import assert from "node:assert/strict";
import test from "node:test";
import {
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
} from "../src/renderer/src/visualizer-color";

test("visualizer picker preserves selected colors through HSV editing", () => {
  for (const color of [
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#334455",
    "#aa88ff",
    "#808080",
    "#000000",
  ]) {
    const { hue, saturation, brightness } = hexToHsv(color);
    assert.equal(hsvToHex(hue, saturation, brightness), color);
  }
  assert.equal(hsvToHex(120, 100, 100), "#00ff00");
  assert.equal(hsvToHex(480, 100, 100), "#00ff00");
  assert.equal(normalizeHexColor(" 334455 "), "#334455");
  assert.equal(normalizeHexColor("#bad"), null);
});
