import assert from "node:assert/strict";
import test from "node:test";
import { LibraryIndex, parseBeatmapVideoEvent } from "../src/main/library";
import type { Track } from "../src/shared/types";

test("beatmap video events parse quoted and unquoted filenames", () => {
  assert.deepEqual(
    parseBeatmapVideoEvent('[Events]\nVideo, -250, "video, opening.mp4"\n'),
    { filename: "video, opening.mp4", offset: -0.25 },
  );
  assert.deepEqual(parseBeatmapVideoEvent("[Events]\n1, 1000, bg.webm\n"), {
    filename: "bg.webm",
    offset: 1,
  });
});

test("library queries search, filter, sort, and paginate tracks", () => {
  const makeTrack = (id: string, title: string, collection: string): Track => ({
    id,
    title,
    artist: "Artist",
    source: "",
    tags: ["electronic"],
    collections: [collection],
    duration: 120,
    bpm: 180,
    stars: 4,
    difficultyCount: 1,
    audioUrl: "osu-media://asset/" + "a".repeat(64),
    addedAt: 0,
  });
  const index = new LibraryIndex(
    [
      makeTrack("1", "Alpha", "Favorites"),
      makeTrack("2", "Beta", "Other"),
      { ...makeTrack("3", "Gamma", "Other"), tags: ["electronic", "vocal"] },
    ],
    new Map(),
    {
      trackCount: 3,
      beatmapCount: 3,
      collectionCount: 2,
      collections: [],
      tags: [],
      installPath: "/osu",
      skippedCount: 0,
    },
  );
  assert.deepEqual(
    index.query({ search: "alpha" }).items.map((track) => track.id),
    ["1"],
  );
  assert.deepEqual(
    index.query({ collection: "favorites" }).items.map((track) => track.id),
    ["1"],
  );
  assert.deepEqual(
    index
      .query({ tags: ["electronic", "vocal"] })
      .items.map((track) => track.id),
    ["3"],
  );
});

test("streamed batches update existing difficulties and invalidate query and facet caches", () => {
  const summary = {
    trackCount: 1,
    beatmapCount: 1,
    collectionCount: 1,
    collections: [{ name: "Favorites", count: 1 }],
    tags: [{ name: "rock", count: 1 }],
    installPath: "/osu",
    skippedCount: 0,
  };
  const track: Track = {
    id: "song",
    title: "Song",
    artist: "Artist",
    source: "",
    tags: ["rock"],
    collections: ["Favorites"],
    difficultyCount: 1,
    duration: 100,
    bpm: 120,
    stars: 1,
    addedAt: 0,
    audioUrl: "osu-media://asset/" + "a".repeat(64),
  };
  const index = new LibraryIndex([], new Map(), {
    ...summary,
    trackCount: 0,
    collections: [],
    tags: [],
  });
  index.applyBatch(new LibraryIndex([track], new Map(), summary).snapshot());
  assert.equal(index.query({ tags: ["vocal"] }).total, 0);
  const updated = {
    ...track,
    difficultyCount: 2,
    duration: 200,
    tags: ["rock", "vocal"],
  };
  index.applyBatch(
    new LibraryIndex([updated], new Map(), {
      ...summary,
      beatmapCount: 2,
    }).snapshot(),
  );
  assert.equal(index.query().total, 1);
  assert.equal(index.query({ tags: ["vocal"] }).items[0].duration, 200);
  assert.equal(index.getTrack("song")?.difficultyCount, 2);
  assert.deepEqual(index.summary.tags, [
    { name: "rock", count: 1 },
    { name: "vocal", count: 1 },
  ]);
  assert.deepEqual(index.summary.collections, [
    { name: "Favorites", count: 1 },
  ]);
});
