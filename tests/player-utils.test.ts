import assert from "node:assert/strict";
import test from "node:test";
import {
  navigateRandomHistory,
  navigateShuffleHistory,
  nextQueueIndex,
  parsePlaybackSettings,
} from "../src/renderer/src/player-utils";

test("queue navigation honors repeat and boundaries", () => {
  assert.equal(
    nextQueueIndex({
      current: 2,
      total: 3,
      direction: 1,
      shuffle: false,
      repeat: "off",
    }),
    null,
  );
  assert.equal(
    nextQueueIndex({
      current: 2,
      total: 3,
      direction: 1,
      shuffle: false,
      repeat: "all",
    }),
    0,
  );
});

test("shuffle history walks backward before selecting a new track", () => {
  const result = navigateShuffleHistory({
    history: { entries: [0, 2], position: 1 },
    current: 2,
    total: 4,
    direction: -1,
    repeat: "off",
  });
  assert.deepEqual(result, {
    index: 0,
    history: { entries: [0, 2], position: 0 },
  });
});

test("random forward navigation drops forward history and can reverse", () => {
  const forward = navigateRandomHistory({
    history: { entries: [0, 2, 1], position: 1 },
    current: 2,
    total: 4,
    direction: 1,
    random: () => 0,
  });
  assert.deepEqual(forward, {
    index: 0,
    history: { entries: [0, 2, 0], position: 2 },
  });

  assert.deepEqual(
    navigateRandomHistory({
      history: forward.history,
      current: 0,
      total: 4,
      direction: -1,
    }),
    {
      index: 2,
      history: { entries: [0, 2, 0], position: 1 },
    },
  );
});

test("stored playback settings are clamped and validated", () => {
  assert.deepEqual(
    parsePlaybackSettings(
      JSON.stringify({
        volume: 2,
        muted: true,
        shuffle: true,
        repeat: "one",
        playVideos: false,
        videoEncodingQuality: "very-high",
        videoMaxFps: 24,
        videoForceRemux: false,
      }),
    ),
    {
      volume: 1,
      muted: true,
      shuffle: true,
      repeat: "one",
      playVideos: false,
      videoEncodingCodec: "auto",
      videoEncodingQuality: "very-high",
      videoMaxFps: 24,
      videoForceRemux: false,
      videoCacheLimitGb: 5,
    },
  );
  assert.deepEqual(parsePlaybackSettings("{bad"), {
    volume: 0.75,
    muted: false,
    shuffle: false,
    repeat: "off",
    playVideos: true,
    videoEncodingCodec: "auto",
    videoEncodingQuality: "medium",
    videoMaxFps: 60,
    videoForceRemux: false,
    videoCacheLimitGb: 5,
  });
});
