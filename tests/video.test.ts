import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { LibraryIndex } from "../src/main/library";
import { assetUrl } from "../src/main/media";
import {
  convertedVideoUrl,
  orderedVideoEncoders,
  parseAvailableVideoEncoders,
  VideoTranscoder,
} from "../src/main/video";

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

test("an existing shared HLS stream is reused and served through the hash URL", async () => {
  const root = await mkdtemp(join(process.cwd(), ".video-hls-test-"));
  const cache = join(root, "video-cache");
  const stream = join(cache, "stream");
  const hash = "a".repeat(64);
  try {
    await mkdir(stream, { recursive: true });
    await writeFile(join(cache, "stream.json"), JSON.stringify({ hash }));
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

    assert.deepEqual(await transcoder.prepare(library, "track"), {
      url: convertedVideoUrl(hash),
      streaming: true,
    });
    const playlist = await transcoder.serve(
      new Request(convertedVideoUrl(hash)),
    );
    assert.equal(
      playlist.headers.get("content-type"),
      "application/vnd.apple.mpegurl",
    );
    assert.match(
      await playlist.text(),
      new RegExp(`${convertedVideoUrl(hash)}\\?file=init\\.mp4`),
    );
    const segment = await transcoder.serve(
      new Request(`${convertedVideoUrl(hash)}?file=segment-000000.m4s`),
    );
    assert.equal(segment.status, 200);
    assert.equal(segment.headers.get("cache-control"), "no-store");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
