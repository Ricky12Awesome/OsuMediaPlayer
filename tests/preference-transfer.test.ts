import assert from "node:assert/strict";
import test from "node:test";
import {
  exportFavorites,
  exportVisualizerSettings,
  importFavorites,
  importVisualizerSettings,
  mergeFavorites,
} from "../src/renderer/src/preference-transfer";
import {
  defaultVisualizerSettings,
  parseVisualizerSettings,
} from "../src/renderer/src/visualizer-settings";

test("favorites export and import merge unique song IDs", () => {
  const current = new Set(["existing", "shared"]);
  const incoming = importFavorites(exportFavorites(new Set(["shared", "new"])));
  assert.deepEqual(
    [...mergeFavorites(current, incoming)],
    ["existing", "shared", "new"],
  );
  assert.deepEqual([...current], ["existing", "shared"]);
  assert.deepEqual(
    importFavorites(
      JSON.stringify({
        type: "osu-media-player-favorites",
        version: 1,
        favorites: ["one", "one", "two"],
      }),
    ),
    ["one", "two"],
  );
});

test("favorites import rejects malformed files without a partial merge", () => {
  for (const value of [
    "not json",
    "[]",
    JSON.stringify({ type: "osu-media-player-visualizer", version: 1 }),
    JSON.stringify({
      type: "osu-media-player-favorites",
      version: 1,
      favorites: ["valid", 42],
    }),
  ]) {
    assert.throws(() => importFavorites(value));
  }
});

test("visualizer import replaces settings and validates the export", () => {
  const exported = parseVisualizerSettings({
    enabled: false,
    style: "ring",
    color1: "#123456",
  });
  assert.deepEqual(
    importVisualizerSettings(exportVisualizerSettings(exported)),
    exported,
  );
  assert.notDeepEqual(exported, defaultVisualizerSettings);
  assert.throws(() => importVisualizerSettings("{}"));
  assert.throws(() =>
    importVisualizerSettings(
      JSON.stringify({
        type: "osu-media-player-visualizer",
        version: 1,
        settings: { style: "ring" },
      }),
    ),
  );
});
