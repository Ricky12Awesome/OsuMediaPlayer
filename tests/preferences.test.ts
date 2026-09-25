import assert from "node:assert/strict";
import test from "node:test";
import { createPreferencesStore } from "../src/renderer/src/preferences";

test("background dim preference persists and clamps invalid values", () => {
  const data = new Map<string, string>();
  const preferences = createPreferencesStore({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  });

  assert.equal(preferences.get("backgroundDim"), 0);
  preferences.set("backgroundDim", 40);
  assert.equal(preferences.get("backgroundDim"), 40);

  data.set("background-dim", "-10");
  assert.equal(preferences.get("backgroundDim"), 0);
  data.set("background-dim", "150");
  assert.equal(preferences.get("backgroundDim"), 100);
  data.set("background-dim", '"invalid"');
  assert.equal(preferences.get("backgroundDim"), 0);
});

test("background blur settings persist and reject invalid values", () => {
  const data = new Map<string, string>();
  const preferences = createPreferencesStore({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  });

  assert.equal(preferences.get("backgroundBlur"), 1);
  assert.equal(preferences.get("backgroundBlurStyle"), "none");
  assert.equal(preferences.get("backgroundBlurDirection"), "horizontal");
  preferences.set("backgroundBlur", 12);
  preferences.set("backgroundBlurStyle", "focus");
  preferences.set("backgroundBlurDirection", "vertical");
  assert.equal(preferences.get("backgroundBlur"), 12);
  assert.equal(preferences.get("backgroundBlurStyle"), "focus");
  assert.equal(preferences.get("backgroundBlurDirection"), "vertical");
  preferences.set("backgroundBlurStyle", "directional");
  assert.equal(preferences.get("backgroundBlurStyle"), "directional");
  preferences.set("backgroundBlurStyle", "frosted");
  assert.equal(preferences.get("backgroundBlurStyle"), "frosted");
  preferences.set("backgroundBlurStyle", "none");
  assert.equal(preferences.get("backgroundBlurStyle"), "none");

  data.set("background-blur", "-2");
  assert.equal(preferences.get("backgroundBlur"), 0);
  data.set("background-blur", "0");
  assert.equal(preferences.get("backgroundBlur"), 0);
  data.set("background-blur", "999");
  assert.equal(preferences.get("backgroundBlur"), 24);
  data.set("background-blur", '"bad"');
  assert.equal(preferences.get("backgroundBlur"), 1);
  data.set("background-blur-style", '"unknown"');
  assert.equal(preferences.get("backgroundBlurStyle"), "none");
  data.set("background-blur-direction", '"diagonal"');
  assert.equal(preferences.get("backgroundBlurDirection"), "horizontal");
});
