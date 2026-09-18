import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { LibraryIndex } from "../src/main/library/index";
import { assetUrl } from "../src/main/media";
import {
  convertedVideoUrl,
  orderedVideoEncoders,
  parseAvailableVideoEncoders,
  videoEncodingProfileHash,
  VideoTranscoder,
} from "../src/main/video/transcoder";
import type { VideoEncodingSettings } from "../src/shared/types";

const videoSettings: VideoEncodingSettings = {
  codec: "h264-software",
  quality: "medium",
  maxFps: 60,
  forceRemux: false,
  cacheLimitGb: 5,
};

const profiledVideoUrl = (
  hash: string,
  settings: VideoEncodingSettings = videoSettings,
): string => convertedVideoUrl(hash, videoEncodingProfileHash(settings));

async function writeCachedVideo(
  cache: string,
  hash: string,
  settings: VideoEncodingSettings,
  contents: string,
): Promise<string> {
  const filename = join(cache, `${hash}.mp4`);
  await writeFile(filename, contents);
  await writeFile(
    join(cache, `${hash}.manifest.json`),
    JSON.stringify({
      hash,
      profileHash: videoEncodingProfileHash(settings),
      profile: {
        encoderVersion: 1,
        codec: settings.codec,
        quality: settings.quality,
        maxFps: settings.maxFps,
        forceRemux: settings.forceRemux,
      },
      encoder: "libx264",
    }),
  );
  return filename;
}

test("video cache profiles include every encoding choice but not the LRU limit", () => {
  const original = videoEncodingProfileHash(videoSettings);
  assert.notEqual(
    videoEncodingProfileHash({ ...videoSettings, quality: "high" }),
    original,
  );
  assert.notEqual(
    videoEncodingProfileHash({ ...videoSettings, maxFps: 24 }),
    original,
  );
  assert.notEqual(
    videoEncodingProfileHash({ ...videoSettings, forceRemux: true }),
    original,
  );
  assert.equal(
    videoEncodingProfileHash({ ...videoSettings, cacheLimitGb: -1 }),
    original,
  );
});

test("video encoders follow codec and hardware priority", () => {
  const available = parseAvailableVideoEncoders(`
 V....D libx264              H.264
 V....D h264_nvenc           NVIDIA NVENC H.264
 V..... hevc_qsv             Intel Quick Sync HEVC
 V....D av1_vaapi            VAAPI AV1
 A....D aac                  AAC
  `);

  assert.deepEqual(
    orderedVideoEncoders(available).map((encoder) => encoder.name),
    ["av1_vaapi", "hevc_qsv", "h264_nvenc", "libx264"],
  );
  assert.deepEqual(
    orderedVideoEncoders(available).map((encoder) => encoder.hardware),
    [true, true, true, false],
  );
});

test("a changed encoding profile invalidates the source-hash cache", async () => {
  const root = await mkdtemp(join(process.cwd(), ".video-profile-test-"));
  const cache = join(root, "video-cache");
  const hash = "c".repeat(64);
  try {
    await mkdir(cache, { recursive: true });
    const cached = await writeCachedVideo(cache, hash, videoSettings, "cached");
    const library = {
      summary: { installPath: root },
      assets: new Map([[hash, { hash, filename: "video.avi" }]]),
      getTrack: () => ({ videoUrl: assetUrl(hash) }),
    } as unknown as LibraryIndex;
    const transcoder = new VideoTranscoder(cache, "missing-ffmpeg");

    await assert.rejects(
      transcoder.prepare(library, "track", {
        ...videoSettings,
        quality: "high",
        cacheLimitGb: -1,
      }),
      /could not be found/i,
    );
    await assert.rejects(stat(cached), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a changed encoding profile discards the old same-source HLS stream", async () => {
  const root = await mkdtemp(
    join(process.cwd(), ".video-stream-profile-test-"),
  );
  const cache = join(root, "video-cache");
  const stream = join(cache, "stream");
  const hash = "9".repeat(64);
  const playlist = join(stream, "playlist.m3u8");
  try {
    await mkdir(stream, { recursive: true });
    await writeFile(
      join(cache, "stream.json"),
      JSON.stringify({
        hash,
        profileHash: videoEncodingProfileHash(videoSettings),
        profile: {
          encoderVersion: 1,
          codec: videoSettings.codec,
          quality: videoSettings.quality,
          maxFps: videoSettings.maxFps,
          forceRemux: videoSettings.forceRemux,
        },
        cacheLimitBytes: 5 * 1024 ** 3,
        encoder: "libx264",
      }),
    );
    await writeFile(playlist, "#EXTM3U\n");
    const library = {
      summary: { installPath: root },
      assets: new Map([[hash, { hash, filename: "video.avi" }]]),
      getTrack: () => ({ videoUrl: assetUrl(hash) }),
    } as unknown as LibraryIndex;
    const transcoder = new VideoTranscoder(cache, "missing-ffmpeg");

    await assert.rejects(
      transcoder.prepare(library, "track", {
        ...videoSettings,
        forceRemux: true,
      }),
      /could not be found/i,
    );
    await assert.rejects(stat(playlist), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the video cache evicts the least recently used conversion", async () => {
  const root = await mkdtemp(join(process.cwd(), ".video-lru-test-"));
  const cache = join(root, "video-cache");
  const oldHash = "d".repeat(64);
  const recentHash = "e".repeat(64);
  try {
    await mkdir(cache, { recursive: true });
    const oldFile = await writeCachedVideo(
      cache,
      oldHash,
      videoSettings,
      "old!",
    );
    const recentFile = await writeCachedVideo(
      cache,
      recentHash,
      videoSettings,
      "new!",
    );
    await utimes(oldFile, new Date(1_000), new Date(1_000));
    await utimes(recentFile, new Date(2_000), new Date(2_000));
    const library = {
      summary: { installPath: root },
      assets: new Map([
        [recentHash, { hash: recentHash, filename: "video.avi" }],
      ]),
      getTrack: () => ({ videoUrl: assetUrl(recentHash) }),
    } as unknown as LibraryIndex;
    const transcoder = new VideoTranscoder(cache, "missing-ffmpeg");

    assert.deepEqual(
      await transcoder.prepare(library, "track", {
        ...videoSettings,
        cacheLimitGb: 6 / 1024 ** 3,
      }),
      { url: profiledVideoUrl(recentHash), streaming: false },
    );
    await assert.rejects(stat(oldFile), { code: "ENOENT" });
    assert.equal(await readFile(recentFile, "utf8"), "new!");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "a zero cache limit keeps HLS streaming and reports encoder progress",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(process.cwd(), ".video-no-cache-test-"));
    const cache = join(root, "video-cache");
    const installPath = join(root, "osu");
    const hash = "f".repeat(64);
    const source = join(
      installPath,
      "files",
      hash.slice(0, 1),
      hash.slice(0, 2),
      hash,
    );
    const ffmpeg = join(root, "ffmpeg");
    const ffprobe = join(root, "ffprobe");
    try {
      await mkdir(join(source, ".."), { recursive: true });
      await writeFile(source, "source");
      await writeFile(
        ffmpeg,
        `#!/usr/bin/env node
const fs = await import("node:fs");
const path = await import("node:path");
const args = process.argv.slice(2);
if (args.includes("-encoders")) {
  process.stdout.write(" V....D libx264\\n");
  process.exit(0);
}
const playlist = args.at(-1);
fs.mkdirSync(path.dirname(playlist), { recursive: true });
fs.writeFileSync(path.join(path.dirname(playlist), "init.mp4"), "init");
fs.writeFileSync(path.join(path.dirname(playlist), "segment-000000.m4s"), "segment");
fs.writeFileSync(playlist, "#EXTM3U\\n#EXT-X-MAP:URI=\\\"init.mp4\\\"\\n#EXTINF:1,\\nsegment-000000.m4s\\n#EXT-X-ENDLIST\\n");
process.stdout.write("out_time_us=5000000\\nprogress=continue\\nout_time_us=10000000\\nprogress=end\\n");
`,
      );
      await writeFile(
        ffprobe,
        `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  streams: [{ codec_name: "h264", avg_frame_rate: "30/1" }],
  format: { duration: "10" }
}));
`,
      );
      await chmod(ffmpeg, 0o755);
      await chmod(ffprobe, 0o755);
      const library = {
        summary: { installPath },
        assets: new Map([[hash, { hash, filename: "video.avi" }]]),
        getTrack: () => ({ videoUrl: assetUrl(hash) }),
      } as unknown as LibraryIndex;
      const statuses: Array<{
        encoding: boolean;
        encoder?: string;
        progress?: number;
      }> = [];
      const transcoder = new VideoTranscoder(cache, ffmpeg, (status) => {
        statuses.push(status);
      });

      assert.deepEqual(
        await transcoder.prepare(library, "track", {
          ...videoSettings,
          cacheLimitGb: 0,
        }),
        { url: profiledVideoUrl(hash), streaming: true },
      );
      for (let attempt = 0; attempt < 100; attempt++) {
        if (statuses.some((status) => !status.encoding)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await assert.rejects(stat(join(cache, `${hash}.mp4`)), {
        code: "ENOENT",
      });
      assert.ok(
        statuses.some(
          (status) => status.encoder === "libx264" && status.progress === 1,
        ),
      );
      assert.equal(
        (await transcoder.serve(new Request(profiledVideoUrl(hash)))).status,
        200,
      );
      transcoder.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("an existing shared HLS stream is reused and served through the hash URL", async () => {
  const root = await mkdtemp(join(process.cwd(), ".video-hls-test-"));
  const cache = join(root, "video-cache");
  const stream = join(cache, "stream");
  const hash = "a".repeat(64);
  try {
    await mkdir(stream, { recursive: true });
    await writeFile(
      join(cache, "stream.json"),
      JSON.stringify({
        hash,
        profileHash: videoEncodingProfileHash(videoSettings),
        profile: {
          encoderVersion: 1,
          codec: videoSettings.codec,
          quality: videoSettings.quality,
          maxFps: videoSettings.maxFps,
          forceRemux: videoSettings.forceRemux,
        },
        cacheLimitBytes: 5 * 1024 ** 3,
        encoder: "libx264",
      }),
    );
    await writeFile(join(stream, "init.mp4"), "init");
    await writeFile(join(stream, "segment-000000.m4s"), "segment");
    await writeFile(
      join(stream, "playlist.m3u8"),
      [
        "#EXTM3U",
        '#EXT-X-MAP:URI="init.mp4"',
        "#EXTINF:2,",
        "segment-000000.m4s",
      ].join("\n"),
    );
    const library = {
      summary: { installPath: root },
      assets: new Map([[hash, { hash, filename: "video.avi" }]]),
      getTrack: () => ({ videoUrl: assetUrl(hash) }),
    } as unknown as LibraryIndex;
    const transcoder = new VideoTranscoder(cache, "missing-ffmpeg");

    assert.deepEqual(
      await transcoder.prepare(library, "track", videoSettings),
      {
        url: profiledVideoUrl(hash),
        streaming: true,
      },
    );
    const playlist = await transcoder.serve(
      new Request(profiledVideoUrl(hash)),
    );
    assert.equal(
      playlist.headers.get("content-type"),
      "application/vnd.apple.mpegurl",
    );
    assert.match(
      await playlist.text(),
      new RegExp(
        `profile=${videoEncodingProfileHash(videoSettings)}&file=init\\.mp4`,
      ),
    );
    const segmentUrl = new URL(profiledVideoUrl(hash));
    segmentUrl.searchParams.set("file", "segment-000000.m4s");
    const segment = await transcoder.serve(new Request(segmentUrl));
    assert.equal(segment.status, 200);
    assert.equal(segment.headers.get("cache-control"), "no-store");
    const staleProfile = await transcoder.serve(
      new Request(
        profiledVideoUrl(hash, { ...videoSettings, quality: "high" }),
      ),
    );
    assert.equal(staleProfile.status, 404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "cancelling an in-flight preparation resolves without a superseded error",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(process.cwd(), ".video-cancel-test-"));
    const cache = join(root, "video-cache");
    const installPath = join(root, "osu");
    const hash = "b".repeat(64);
    const source = join(
      installPath,
      "files",
      hash.slice(0, 1),
      hash.slice(0, 2),
      hash,
    );
    const ffmpeg = join(root, "ffmpeg");
    const ffprobe = join(root, "ffprobe");
    let transcoder: VideoTranscoder | null = null;
    try {
      await mkdir(
        join(installPath, "files", hash.slice(0, 1), hash.slice(0, 2)),
        { recursive: true },
      );
      await writeFile(source, "source");
      await writeFile(
        ffmpeg,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("-encoders")) {
  process.stdout.write(" V....D libx264\\n");
  process.exit(0);
}
await new Promise(() => {});
`,
      );
      await writeFile(
        ffprobe,
        `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  streams: [{ codec_name: "h264", avg_frame_rate: "30/1" }]
}));
`,
      );
      await chmod(ffmpeg, 0o755);
      await chmod(ffprobe, 0o755);

      const library = {
        summary: { installPath },
        assets: new Map([[hash, { hash, filename: "video.avi" }]]),
        getTrack: () => ({ videoUrl: assetUrl(hash) }),
      } as unknown as LibraryIndex;
      transcoder = new VideoTranscoder(cache, ffmpeg);
      const preparing = transcoder.prepare(library, "track");
      for (let attempt = 0; attempt < 100; attempt++) {
        if (transcoder.encodingStatus) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(transcoder.encodingStatus, { hash, encoding: true });
      await transcoder.cancelEncoding();
      assert.equal(await preparing, null);
    } finally {
      transcoder?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
