import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import Realm from "realm";
import { hashedFilePath, mimeForFilename, serveMedia } from "../src/main/media";
import { loadSongListFromRealm } from "../src/main/song-list/index";
import { VideoTranscoder } from "../src/main/video/transcoder";

type Asset = { filename: string; hash: string };
type FixtureSong = {
  title: string;
  color: string;
  audio: Asset;
  background?: Asset;
  video?: Asset;
  beatmap: Asset;
};

const environment = resolve("tests/environment");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";

after(() => Realm.shutdown());

async function output(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, 4096 - stderr.length);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolveOutput(Buffer.concat(chunks));
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}

async function probe(filename: string): Promise<{
  streams: { codec_name: string; width?: number; height?: number }[];
  format: { duration?: string; format_name: string };
}> {
  return JSON.parse(
    (
      await output(ffprobe, [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height:format=duration,format_name",
        "-of",
        "json",
        filename,
      ])
    ).toString(),
  );
}

test("generated Realm and hashed assets cover media containers without an osu! installation", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(environment, "manifest.json"), "utf8"),
  ) as { songs: FixtureSong[] };
  assert.deepEqual(
    manifest.songs.map((song) => song.audio.filename.split(".").at(-1)),
    ["mp3", "ogg", "wav", "mp3"],
  );
  assert.deepEqual(
    manifest.songs.flatMap((song) =>
      song.video ? [song.video.filename.split(".").at(-1)] : [],
    ),
    ["mp4", "avi", "flv"],
  );
  assert.equal(new Set(manifest.songs.map((song) => song.color)).size, 4);

  const index = await loadSongListFromRealm(environment);
  try {
    assert.equal(index.summary.songCount, manifest.songs.length);
    assert.equal(index.summary.skippedCount, 0);
    const backgroundColors = new Set<string>();
    const videoColors = new Set<string>();
    const loaded = new Map(
      index.query({ limit: 10 }).items.map((song) => [song.title, song]),
    );
    for (const expected of manifest.songs) {
      const song = loaded.get(expected.title);
      assert.ok(song, `Missing ${expected.title}`);
      assert.equal(song.duration, 10);
      assert.equal(song.audioHash, expected.audio.hash);
      assert.equal(song.backgroundHash, expected.background?.hash);
      assert.equal(song.videoHash, expected.video?.hash);
      assert.equal(song.videoOffset, expected.video ? 0 : undefined);

      for (const asset of [
        expected.audio,
        expected.background,
        expected.video,
        expected.beatmap,
      ]) {
        if (!asset) continue;
        const bytes = await readFile(hashedFilePath(environment, asset.hash));
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          asset.hash,
        );
        if (asset === expected.beatmap) continue;
        const response = await serveMedia(
          new Request(`omp://asset/${asset.hash}`, {
            headers: { Range: "bytes=0-31" },
          }),
          index,
        );
        assert.equal(response.status, 206);
        assert.equal(
          response.headers.get("content-type"),
          mimeForFilename(asset.filename),
        );
        assert.deepEqual(
          Buffer.from(await response.arrayBuffer()),
          bytes.subarray(0, 32),
        );
      }

      const audioPath = hashedFilePath(environment, expected.audio.hash);
      const audio = await probe(audioPath);
      const audioExtension = expected.audio.filename.split(".").at(-1);
      assert.equal(
        audio.streams[0].codec_name,
        { mp3: "mp3", ogg: "vorbis", wav: "pcm_s16le" }[audioExtension!],
      );
      assert.ok(Math.abs(Number(audio.format.duration) - 10) < 0.1);
      const samples = await output(ffmpeg, [
        "-v",
        "error",
        "-i",
        audioPath,
        "-t",
        "0.1",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ]);
      assert.ok(
        samples.some((sample) => sample !== 0),
        `${expected.title} is silent`,
      );

      if (expected.background) {
        const backgroundPath = hashedFilePath(
          environment,
          expected.background.hash,
        );
        const image = await probe(backgroundPath);
        assert.equal(image.streams[0].width, 640);
        assert.equal(image.streams[0].height, 360);
        const pixels = await output(ffmpeg, [
          "-v",
          "error",
          "-i",
          backgroundPath,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ]);
        assert.equal(pixels.length, 640 * 360 * 3);
        const top = pixels.subarray(0, 3).toString("hex");
        const bottom = pixels
          .subarray(359 * 640 * 3, 359 * 640 * 3 + 3)
          .toString("hex");
        assert.notEqual(top, bottom, `${expected.title} background is flat`);
        backgroundColors.add(top);
      }
      if (expected.video) {
        const videoPath = hashedFilePath(environment, expected.video.hash);
        const video = await probe(videoPath);
        const videoExtension = expected.video.filename.split(".").at(-1);
        assert.match(video.format.format_name, new RegExp(videoExtension!));
        assert.equal(video.streams[0].codec_name, "h264");
        assert.equal(video.streams[0].width, 640);
        assert.equal(video.streams[0].height, 360);
        assert.ok(Math.abs(Number(video.format.duration) - 10) < 0.1);
        assert.ok((await stat(videoPath)).size < 100_000);
        const pixelAt = (time: string) =>
          output(ffmpeg, [
            "-v",
            "error",
            "-ss",
            time,
            "-i",
            videoPath,
            "-frames:v",
            "1",
            "-vf",
            "scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
          ]);
        const first = await pixelAt("0");
        assert.notDeepEqual(first, await pixelAt("8"));
        videoColors.add(first.toString("hex"));
      }
    }
    assert.equal(backgroundColors.size, 3);
    assert.equal(videoColors.size, 3);
  } finally {
    index.close();
  }
});

test("generated MP4 plays directly while AVI and FLV encode or remux to HLS", async () => {
  const index = await loadSongListFromRealm(environment);
  const cache = await mkdtemp(join(tmpdir(), "osu-fixture-video-"));
  const transcoder = new VideoTranscoder(cache, ffmpeg);
  try {
    for (const song of index.query({ limit: 10 }).items) {
      if (!song.videoHash) continue;
      const extension = index.assets
        .get(song.videoHash)
        ?.filename.split(".")
        .at(-1);
      const prepared = await transcoder.prepare(index, song.id, {
        codec: "h264-software",
        quality: "very-low",
        maxFps: 0,
        forceRemux: extension === "flv",
        cacheLimitGb: 0,
      });
      assert.ok(prepared, `Could not prepare ${extension} video`);
      if (extension === "mp4") {
        assert.deepEqual(prepared, {
          url: song.videoUrl,
          streaming: false,
        });
        const timingChecks = JSON.parse(
          await readFile(join(cache, "timing-checks.json"), "utf8"),
        ) as { results: Array<[string, boolean]> };
        assert.ok(
          timingChecks.results.some(
            ([hash, needsRepair]) => hash === song.videoHash && !needsRepair,
          ),
        );
      } else {
        assert.ok(extension === "avi" || extension === "flv");
        assert.equal(prepared.streaming, true);
        const playlist = await transcoder.serve(new Request(prepared.url));
        assert.equal(playlist.status, 200);
        const playlistText = await playlist.text();
        assert.match(playlistText, /#EXTM3U/);
        assert.match(playlistText, /#EXTINF:/);
        const segmentUrl = playlistText
          .split("\n")
          .find((line) => line.startsWith("omp://"));
        assert.ok(segmentUrl);
        const segment = await transcoder.serve(new Request(segmentUrl));
        assert.equal(segment.status, 200);
        assert.ok((await segment.arrayBuffer()).byteLength > 0);
        await transcoder.cancelEncoding();
      }
    }
  } finally {
    await transcoder.cancelEncoding();
    transcoder.dispose();
    index.close();
    await rm(cache, { recursive: true, force: true });
  }
});
