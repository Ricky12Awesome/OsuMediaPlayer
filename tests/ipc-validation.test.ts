import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLibraryQuery,
  parseVideoEncodingSettings,
} from "../src/main/ipc-validation";

test("library IPC queries are validated and detached", () => {
  const input = {
    search: "a".repeat(1100),
    collection: "Favorites",
    tags: ["electronic", 12, "vocal"],
    sort: "dateRanked",
    descending: true,
    favoriteIds: ["one", null, "two"],
    offset: 12.5,
    limit: 80,
  };

  const parsed = parseLibraryQuery(input);
  assert.deepEqual(parsed, {
    search: "a".repeat(1000),
    collection: "Favorites",
    tags: ["electronic", "vocal"],
    sort: "dateRanked",
    descending: true,
    favoriteIds: ["one", "two"],
    offset: 12.5,
    limit: 80,
  });
  assert.notEqual(parsed?.tags, input.tags);
  assert.notEqual(parsed?.favoriteIds, input.favoriteIds);
});

test("library IPC queries reject non-record payloads and omit invalid fields", () => {
  assert.throws(() => parseLibraryQuery(null), /invalid library query/i);
  assert.throws(() => parseLibraryQuery([]), /invalid library query/i);
  assert.equal(parseLibraryQuery(undefined, true), undefined);
  assert.deepEqual(
    parseLibraryQuery({
      search: false,
      sort: "unknown",
      offset: Number.POSITIVE_INFINITY,
      limit: "all",
    }),
    {},
  );
});

test("video IPC settings normalize every untrusted field", () => {
  assert.deepEqual(
    parseVideoEncodingSettings({
      codec: "not-a-codec",
      quality: "high",
      maxFps: 120,
      forceRemux: "yes",
      cacheLimitGb: Number.NaN,
    }),
    {
      codec: "auto",
      quality: "high",
      maxFps: 60,
      forceRemux: false,
      cacheLimitGb: 5,
    },
  );
  assert.equal(parseVideoEncodingSettings(undefined), undefined);
  assert.throws(
    () => parseVideoEncodingSettings("high"),
    /invalid video encoding settings/i,
  );
});
