import assert from "node:assert/strict";
import test from "node:test";
import {
  SongListIndex,
  parseBeatmapVideoEvent,
} from "../src/main/song-list/index";
import {
  deserializeSongs,
  serializeSongs,
} from "../src/main/song-list/cache-format";
import { matchesSearch, parseSearch } from "../src/main/song-list/search";
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
  assert.deepEqual(
    index
      .query({ tags: ["electronic", "vocal"], tagMatch: "any" })
      .items.map((song) => song.id),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    index
      .query({ tags: ["vocal", "missing"], tagMatch: "any" })
      .items.map((song) => song.id),
    ["3"],
  );
  assert.equal(index.query({ tags: [], tagMatch: "any" }).total, 3);
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

test("advanced search combines text, numeric, status, and user-tag filters on one difficulty", () => {
  const song: Song = {
    id: "42-" + "a".repeat(64),
    title: "Christmas Song",
    artist: "First Artist",
    artistUnicode: "Second Artist",
    source: "Game Series",
    tags: ["j-pop", "rock"],
    collections: [],
    duration: 320,
    bpm: 180,
    stars: 4,
    difficultyCount: 2,
    audioUrl: "omp://asset/" + "a".repeat(64),
    audioHash: "a".repeat(64),
    addedAt: 0,
    dateSubmittedAt: Date.UTC(2024, 4, 15),
    dateRankedAt: Date.UTC(2024, 7, 20),
    beatmapSearch: [
      {
        duration: 150,
        bpm: 180,
        lastPlayedAt: 0,
        status: 1,
        userTags: ["meta/custom skin"],
      },
      {
        duration: 320,
        bpm: 120,
        lastPlayedAt: Date.now() - 86_400_000,
        status: 4,
        userTags: ["other"],
      },
    ],
  };
  const index = new SongListIndex([song], new Map(), {
    songCount: 1,
    beatmapCount: 2,
    collectionCount: 0,
    collections: [],
    tags: [],
    installPath: "/osu",
    skippedCount: 0,
  });
  for (const search of [
    'j-pop tag="meta/custom skin"',
    "length>=120 length<=300 bpm=180 status=r,l unplayed= christmas",
    'artist="First Artist" title:Christmas source="Game Series"',
    "artist!=missing created=2024-05 ranked>=2024-08",
    "played=yes status=l length>300",
    "played=no status=r",
    "played=0 status=r",
    "played=1 status=l",
    "played!=no status=l",
    "status>=r played>yes",
    "lastplayed<2d played=true",
  ]) {
    assert.equal(index.query({ search }).total, 1, search);
  }
  for (const search of [
    "length>=300 bpm=180", // Values must belong to the same difficulty.
    "tag=rock", // Mapper tags are separate from user tags.
    "status=r played=yes",
    "artist!=First",
    "created<2024-05",
    "ranked>2024-08",
    "status=toString",
  ]) {
    assert.equal(index.query({ search }).total, 0, search);
  }
  assert.equal(index.query({ search: "status!=r played=yes" }).total, 1);
  assert.equal(index.query({ search: "length!=150" }).total, 1);
});

test("relative lastplayed units keep months distinct from minutes", () => {
  const now = Date.UTC(2026, 8, 24, 12);
  const song: Song = {
    id: "song",
    title: "Song",
    artist: "Artist",
    source: "",
    tags: [],
    collections: [],
    duration: 120,
    bpm: 150,
    stars: 2,
    difficultyCount: 1,
    audioUrl: "",
    addedAt: 0,
    beatmapSearch: [
      {
        duration: 120,
        bpm: 150,
        lastPlayedAt: now - 90 * 60_000,
        status: 0,
        userTags: [],
      },
    ],
  };
  assert.equal(
    matchesSearch(song, "song", parseSearch("lastplayed<2h", now)),
    true,
  );
  assert.equal(
    matchesSearch(song, "song", parseSearch("lastplayed>2m", now)),
    true,
  );
  assert.equal(
    matchesSearch(song, "song", parseSearch("lastplayed<2M5h", now)),
    true,
  );
  assert.equal(
    matchesSearch(song, "song", parseSearch("lastplayed>1y", now)),
    false,
  );
  song.beatmapSearch![0].lastPlayedAt = 0;
  assert.equal(
    matchesSearch(song, "song", parseSearch("lastplayed>1y", now)),
    true,
  );
  const monthEnd = Date.UTC(2026, 2, 31, 12);
  song.beatmapSearch![0].lastPlayedAt = Date.UTC(2026, 1, 28, 12);
  assert.equal(
    matchesSearch(song, "song", parseSearch("lastplayed=1M", monthEnd)),
    true,
  );
});

test("cached songs preserve advanced search metadata", () => {
  const hash = "a".repeat(64);
  const song: Song = {
    id: `42-${hash}`,
    title: "Song",
    artist: "Artist",
    source: "",
    tags: [],
    collections: [],
    duration: 180,
    bpm: 200,
    stars: 3,
    difficultyCount: 1,
    audioUrl: `omp://asset/${hash}`,
    audioHash: hash,
    addedAt: 0,
    beatmapSearch: [
      {
        duration: 180,
        bpm: 200,
        lastPlayedAt: 0,
        status: 1,
        userTags: ["meta/custom skin"],
      },
    ],
  };
  const assets = new Map([[hash, { hash, filename: "audio.mp3" }]]);
  const index = new SongListIndex([song], assets, {
    songCount: 1,
    beatmapCount: 1,
    collectionCount: 0,
    collections: [],
    tags: [],
    installPath: "/osu",
    skippedCount: 0,
  });
  const data = serializeSongs(index.snapshot());
  assert.ok(data);
  const decoded = deserializeSongs(data);
  assert.deepEqual(decoded?.songs[0].song.beatmapSearch, song.beatmapSearch);
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
