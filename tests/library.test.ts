import assert from "node:assert/strict";
import test from "node:test";
import { LibraryIndex, parseBeatmapVideoEvent } from "../electron/library";
import type { Track } from "../shared/types";

test("beatmap video events parse quoted and unquoted filenames", () => {
  assert.deepEqual(
    parseBeatmapVideoEvent(
      "[Events]\nVideo, -250, \"video, opening.mp4\"\n",
    ),
    { filename: "video, opening.mp4", offset: -0.25 },
  );
  assert.deepEqual(
    parseBeatmapVideoEvent("[Events]\n1, 1000, bg.webm\n"),
    { filename: "bg.webm", offset: 1 },
  );
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
    [makeTrack("1", "Alpha", "Favorites"), makeTrack("2", "Beta", "Other")],
    new Map(),
    {
      trackCount: 2,
      beatmapCount: 2,
      collectionCount: 2,
      collections: [],
      tags: [],
      installPath: "/osu",
      skippedCount: 0,
    },
  );
  assert.deepEqual(index.query({ search: "alpha" }).items.map((track) => track.id), ["1"]);
  assert.deepEqual(
    index.query({ collection: "favorites" }).items.map((track) => track.id),
    ["1"],
  );
});
