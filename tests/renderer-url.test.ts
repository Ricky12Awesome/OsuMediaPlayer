import assert from "node:assert/strict";
import test from "node:test";
import {
  developmentRendererOrigin,
  resolveRendererUrl,
} from "../src/main/renderer-url";

test("development renderer URLs use the exact local Vite origin", () => {
  for (const value of [
    developmentRendererOrigin,
    `${developmentRendererOrigin}/`,
    `${developmentRendererOrigin}/index.html?mode=dev#app`,
  ]) {
    assert.equal(resolveRendererUrl(value, false), value);
  }
});

test("renderer URLs are disabled for packaged launches", () => {
  assert.equal(
    resolveRendererUrl(`${developmentRendererOrigin}/`, true),
    undefined,
  );
});

test("renderer URLs reject non-loopback or non-exact origins", () => {
  for (const value of [
    "https://127.0.0.1:5173/",
    "http://localhost:5173/",
    "http://127.0.0.2:5173/",
    "http://127.0.0.1:5172/",
    "https://example.test/",
    "not a URL",
  ]) {
    assert.equal(resolveRendererUrl(value, false), undefined, value);
  }
});
