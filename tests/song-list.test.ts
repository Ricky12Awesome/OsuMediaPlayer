import assert from "node:assert/strict";
import test from "node:test";
import {
  SongListIndex,
  parseBeatmapVideoEvent,
} from "../src/main/song-list/index";
import type { Song } from "../src/shared/types";

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

test("song list queries search, filter, sort, and paginate songs", () => {
  const makeSong = (id: string, title: string, collection: string): Song => ({
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
    audioUrl: "omp://asset/" + "a".repeat(64),
    addedAt: 0,
  });
  const index = new SongListIndex(
    [
      makeSong("1", "Alpha", "Favorites"),
      makeSong("2", "Beta", "Other"),
      { ...makeSong("3", "Gamma", "Other"), tags: ["electronic", "vocal"] },
    ],
    new Map(),
    {
      songCount: 3,
      beatmapCount: 3,
      collectionCount: 2,
      collections: [],
      tags: [],
      installPath: "/osu",
      skippedCount: 0,
    },
  );
  assert.deepEqual(
    index.query({ search: "alpha" }).items.map((song) => song.id),
    ["1"],
  );
  assert.deepEqual(
    index.query({ collection: "favorites" }).items.map((song) => song.id),
    ["1"],
  );
  assert.deepEqual(
    index.query({ tags: ["electronic", "vocal"] }).items.map((song) => song.id),
    ["3"],
  );
  assert.deepEqual(index.getSongLocation("2"), {
    song: index.getSong("2"),
    index: 1,
  });
  assert.equal(
    index.getSongLocation("1", { sort: "title", descending: true })?.index,
    2,
  );
  assert.equal(index.getSongLocation("2", { search: "alpha" }), null);
});

test("song list sorts songs by their most recent play time", () => {
  const makeSong = (id: string, lastPlayedAt: number): Song => ({
    id,
    title: id,
    artist: "Artist",
    source: "",
    tags: [],
    collections: [],
    duration: 120,
    bpm: 180,
    stars: 4,
    difficultyCount: 1,
    audioUrl: "omp://asset/" + id.padEnd(64, "a"),
    addedAt: 0,
    lastPlayedAt,
  });
  const index = new SongListIndex(
    [makeSong("never", 0), makeSong("older", 100), makeSong("newer", 200)],
    new Map(),
    {
      songCount: 3,
      beatmapCount: 3,
      collectionCount: 0,
      collections: [],
      tags: [],
      installPath: "/osu",
      skippedCount: 0,
    },
  );

  assert.deepEqual(
    index.query({ sort: "lastPlayed" }).items.map((song) => song.id),
    ["never", "older", "newer"],
  );
  assert.deepEqual(
    index
      .query({ sort: "lastPlayed", descending: true })
      .items.map((song) => song.id),
    ["newer", "older", "never"],
  );
});

test("song list sorts songs by beatmap set dates", () => {
  const makeSong = (
    id: string,
    dateAddedAt: number,
    dateSubmittedAt: number,
    dateRankedAt: number,
  ): Song => ({
    id,
    title: id,
    artist: "Artist",
    source: "",
    tags: [],
    collections: [],
    duration: 120,
    bpm: 180,
    stars: 4,
    difficultyCount: 1,
    audioUrl: "omp://asset/" + id.padEnd(64, "a"),
    addedAt: 0,
    dateAddedAt,
    dateSubmittedAt,
    dateRankedAt,
  });
  const index = new SongListIndex(
    [
      makeSong("first", 100, 300, 200),
      makeSong("second", 300, 100, 300),
      makeSong("third", 200, 200, 100),
    ],
    new Map(),
    {
      songCount: 3,
      beatmapCount: 3,
      collectionCount: 0,
      collections: [],
      tags: [],
      installPath: "/osu",
      skippedCount: 0,
    },
  );

  for (const [sort, ascending, descending] of [
    ["dateAdded", ["first", "third", "second"], ["second", "third", "first"]],
    [
      "dateSubmitted",
      ["second", "third", "first"],
      ["first", "third", "second"],
    ],
    ["dateRanked", ["third", "first", "second"], ["second", "first", "third"]],
  ] as const) {
    assert.deepEqual(
      index.query({ sort }).items.map((song) => song.id),
      ascending,
    );
    assert.deepEqual(
      index.query({ sort, descending: true }).items.map((song) => song.id),
      descending,
    );
  }
});

test("streamed batches update existing difficulties and invalidate query and facet caches", () => {
  const summary = {
    songCount: 1,
    beatmapCount: 1,
    collectionCount: 1,
    collections: [{ name: "Favorites", count: 1 }],
    tags: [{ name: "rock", count: 1 }],
    installPath: "/osu",
    skippedCount: 0,
  };
  const song: Song = {
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
    audioUrl: "omp://asset/" + "a".repeat(64),
  };
  const index = new SongListIndex([], new Map(), {
    ...summary,
    songCount: 0,
    collections: [],
    tags: [],
  });
  index.applyBatch(new SongListIndex([song], new Map(), summary).snapshot());
  assert.equal(index.query({ tags: ["vocal"] }).total, 0);
  const updated = {
    ...song,
    difficultyCount: 2,
    duration: 200,
    tags: ["rock", "vocal"],
  };
  index.applyBatch(
    new SongListIndex([updated], new Map(), {
      ...summary,
      beatmapCount: 2,
    }).snapshot(),
  );
  assert.equal(index.query().total, 1);
  assert.equal(index.query({ tags: ["vocal"] }).items[0].duration, 200);
  assert.equal(index.getSong("song")?.difficultyCount, 2);
  assert.deepEqual(index.summary.tags, [
    { name: "rock", count: 1 },
    { name: "vocal", count: 1 },
  ]);
  assert.deepEqual(index.summary.collections, [
    { name: "Favorites", count: 1 },
  ]);
});
