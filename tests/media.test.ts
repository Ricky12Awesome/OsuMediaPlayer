import assert from "node:assert/strict";
import test from "node:test";
import {
  assetUrl,
  hashedFilePath,
  isAssetHash,
  mimeForFilename,
  parseRange,
} from "../src/main/media";

const hash = "0123456789abcdef".repeat(4);

test("asset URLs and hashed paths use normalized hashes", () => {
  assert.equal(isAssetHash(hash), true);
  assert.equal(assetUrl(hash.toUpperCase()), "omp://asset/" + hash);
  assert.equal(hashedFilePath("/osu", hash), "/osu/files/0/01/" + hash);
});

test("media MIME types and byte ranges are browser compatible", () => {
  assert.equal(mimeForFilename("song.MP3"), "audio/mpeg");
  assert.deepEqual(parseRange("bytes=10-", 100), { start: 10, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=5-10", 100), { start: 5, end: 10 });
  assert.equal(parseRange("bytes=100-101", 100), null);
});
