import assert from "node:assert/strict";
import test from "node:test";
import {
  discordActivity,
  parseDiscordPlaybackState,
} from "../src/main/discord-presence";
import type { DiscordPlaybackState, Song } from "../src/shared/types";

const song: Song = {
  id: "song-1",
  title: "Test track",
  artist: "Test artist",
  source: "",
  tags: [],
  collections: [],
  duration: 120,
  bpm: 180,
  stars: 1,
  difficultyCount: 1,
  audioUrl: "omp://audio/test",
  addedAt: 0,
  onlineId: 12345,
};
const playbackState: DiscordPlaybackState = {
  songId: song.id,
  position: 30,
  duration: 120,
  useTitleUnicode: true,
  useArtistUnicode: true,
};

test("Discord playback IPC accepts bounded playback data and clear requests", () => {
  assert.equal(parseDiscordPlaybackState(null), null);
  assert.deepEqual(
    parseDiscordPlaybackState({
      songId: "song-1",
      position: 130,
      duration: 120,
      useTitleUnicode: true,
      useArtistUnicode: false,
      ignored: "not forwarded",
    }),
    {
      songId: "song-1",
      position: 120,
      duration: 120,
      useTitleUnicode: true,
      useArtistUnicode: false,
    },
  );
  for (const invalid of [
    undefined,
    [],
    { ...playbackState, songId: "" },
    { ...playbackState, songId: "a".repeat(257) },
    { ...playbackState, position: -1 },
    { ...playbackState, position: Number.NaN },
    { ...playbackState, duration: 86_401 },
    { ...playbackState, useTitleUnicode: "yes" },
    { ...playbackState, useArtistUnicode: undefined },
  ])
    assert.throws(() => parseDiscordPlaybackState(invalid));
});

test("Discord activity shows track, beatmap, and playback progress", () => {
  const activity = discordActivity(
    { ...song, titleUnicode: "テスト曲", artistUnicode: "テスト歌手" },
    playbackState,
    1_000_000,
    1_010_000,
  );
  assert.equal(activity.type, 2);
  assert.equal(activity.details, "テスト曲");
  assert.equal(activity.state, "テスト歌手");
  assert.equal(activity.startTimestamp, 970_000);
  assert.equal(activity.endTimestamp, 1_090_000);
  assert.equal(activity.largeImageKey, "https://b.ppy.sh/thumb/12345l.jpg");
  assert.equal(activity.largeImageText, undefined);
  assert.equal(activity.largeImageUrl, "https://osu.ppy.sh/beatmapsets/12345");
  assert.deepEqual(activity.buttons, [
    { label: "View beatmap", url: "https://osu.ppy.sh/beatmapsets/12345" },
  ]);
});

test("Discord activity uses standard text when Unicode is disabled", () => {
  const activity = discordActivity(
    { ...song, titleUnicode: "テスト曲", artistUnicode: "テスト歌手" },
    { ...playbackState, useTitleUnicode: false, useArtistUnicode: false },
    0,
    0,
  );
  assert.equal(activity.details, "Test track");
  assert.equal(activity.state, "Test artist");
});

test("Discord activity selects title and artist Unicode independently", () => {
  const activity = discordActivity(
    { ...song, titleUnicode: "テスト曲", artistUnicode: "テスト歌手" },
    { ...playbackState, useArtistUnicode: false },
    0,
    0,
  );
  assert.equal(activity.details, "テスト曲");
  assert.equal(activity.state, "Test artist");
});

test("Discord activity falls back to standard text when Unicode is unavailable", () => {
  const activity = discordActivity(
    { ...song, titleUnicode: "", artistUnicode: undefined },
    { ...playbackState, position: 0 },
    0,
    0,
  );
  assert.equal(activity.details, "Test track");
  assert.equal(activity.state, "Test artist");
  assert.equal(activity.largeImageText, undefined);
});

test("Discord activity omits missing artwork and invalid timeline data", () => {
  const activity = discordActivity(
    { ...song, onlineId: undefined, title: "", artist: "" },
    { ...playbackState, position: 0, duration: 0 },
    0,
    0,
  );
  assert.equal(activity.details, "Unknown title");
  assert.equal(activity.state, "Unknown artist");
  assert.equal(activity.largeImageKey, undefined);
  assert.equal(activity.largeImageText, undefined);
  assert.equal(activity.largeImageUrl, undefined);
  assert.equal(activity.buttons, undefined);
  assert.equal(activity.startTimestamp, undefined);
  assert.equal(activity.endTimestamp, undefined);
});
