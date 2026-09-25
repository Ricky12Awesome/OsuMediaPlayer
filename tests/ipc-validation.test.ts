import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSongListQuery,
  parseVideoEncodingSettings,
} from "../src/main/ipc-validation";

test("song list IPC queries are validated and detached", () => {
  const input = {
    search: "a".repeat(1100),
    collection: "Favorites",
    tags: ["electronic", 12, "vocal"],
    tagMatch: "any",
    sort: "dateRanked",
    descending: true,
    favoriteIds: ["one", null, "two"],
    offset: 12.5,
    limit: 80,
  };

  const parsed = parseSongListQuery(input);
  assert.deepEqual(parsed, {
    search: "a".repeat(1000),
    collection: "Favorites",
    tags: ["electronic", "vocal"],
    tagMatch: "any",
    sort: "dateRanked",
    descending: true,
    favoriteIds: ["one", "two"],
    offset: 12.5,
    limit: 80,
  });
  assert.notEqual(parsed?.tags, input.tags);
  assert.notEqual(parsed?.favoriteIds, input.favoriteIds);
});

test("song list IPC queries reject non-record payloads and omit invalid fields", () => {
  assert.throws(() => parseSongListQuery(null), /invalid song list query/i);
  assert.throws(() => parseSongListQuery([]), /invalid song list query/i);
  assert.equal(parseSongListQuery(undefined, true), undefined);
  assert.deepEqual(
    parseSongListQuery({
      search: false,
      sort: "unknown",
      tagMatch: "neither",
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
