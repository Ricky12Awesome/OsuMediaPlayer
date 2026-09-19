import assert from "node:assert/strict";
import test from "node:test";
import {
  directMediaImageUrl,
  fallbackMediaArtwork,
  resolveMediaArtwork,
} from "../src/renderer/src/media-artwork";

test("MediaImage accepts standard URL schemes only", () => {
  assert.equal(directMediaImageUrl("omp://asset/" + "a".repeat(64)), undefined);
  assert.equal(
    directMediaImageUrl("https://example.test/cover.png"),
    "https://example.test/cover.png",
  );
  assert.equal(
    directMediaImageUrl("data:image/png;base64,AAAA"),
    "data:image/png;base64,AAAA",
  );
  assert.equal(
    directMediaImageUrl("blob:https://example.test/cover"),
    "blob:https://example.test/cover",
  );
});

test("songs without background art use the music-note fallback artwork", async () => {
  assert.equal(await resolveMediaArtwork(undefined), undefined);
  assert.match(
    fallbackMediaArtwork.url,
    /^data:image\/svg\+xml;charset=UTF-8,/,
  );
  assert.equal(fallbackMediaArtwork.type, "image/svg+xml");
});
