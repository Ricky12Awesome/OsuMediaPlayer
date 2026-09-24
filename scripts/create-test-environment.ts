import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import Realm from "realm";
import { Schema } from "../src/shared/client-model";

type FixtureAsset = { filename: string; hash: string };
type FixtureSong = {
  title: string;
  color: string;
  audio: FixtureAsset;
  background?: FixtureAsset;
  video?: FixtureAsset;
  beatmap: FixtureAsset;
};

const cases = [
  {
    title: "Coral Circuit",
    color: "coral",
    start: "#ff6b6b",
    end: "#571353",
    audio: "mp3",
    video: "mp4",
    tone: 220,
  },
  {
    title: "Emerald Current",
    color: "emerald",
    start: "#45d483",
    end: "#123d65",
    audio: "ogg",
    video: "avi",
    tone: 330,
  },
  {
    title: "Azure Orbit",
    color: "azure",
    start: "#54aaff",
    end: "#342080",
    audio: "wav",
    video: "flv",
    tone: 440,
  },
] as const;

const environment = resolve("tests/environment");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, 4096 - stderr.length);
    });
    child.once("error", (error) => {
      reject(new Error(`Could not run ${command}: ${error.message}`));
    });
    child.once("close", (code) => {
      if (code === 0) resolveRun();
      else
        reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

async function storeAsset(
  directory: string,
  filename: string,
  contents: Buffer | string,
): Promise<FixtureAsset> {
  const bytes = typeof contents === "string" ? Buffer.from(contents) : contents;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const target = join(directory, "files", hash.slice(0, 1), hash.slice(0, 2));
  await mkdir(target, { recursive: true });
  await writeFile(join(target, hash), bytes);
  return { filename, hash };
}

async function generate(directory: string): Promise<FixtureSong[]> {
  const working = join(directory, "generated");
  await mkdir(working, { recursive: true });
  const songs: FixtureSong[] = [];
  for (const [index, item] of cases.entries()) {
    const audioPath = join(working, `audio-${index}.${item.audio}`);
    const audioCodec =
      item.audio === "mp3"
        ? ["-c:a", "libmp3lame", "-b:a", "48k"]
        : item.audio === "ogg"
          ? ["-c:a", "libvorbis", "-q:a", "1"]
          : ["-c:a", "pcm_s16le"];
    await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=0.14*sin(2*PI*${item.tone}*t)+0.08*sin(2*PI*${item.tone * 1.5}*t):s=22050:d=10`,
      "-ac",
      "1",
      ...audioCodec,
      audioPath,
    ]);

    const backgroundPath = join(working, `background-${index}.png`);
    await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `gradients=s=640x360:c0=${item.start}:c1=${item.end}:x0=0:y0=0:x1=0:y1=359:type=linear`,
      "-frames:v",
      "1",
      "-c:v",
      "png",
      "-pix_fmt",
      "rgb24",
      backgroundPath,
    ]);

    const videoPath = join(working, `video-${index}.${item.video}`);
    await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${item.start}:s=640x360:r=12:d=10`,
      "-vf",
      "hue=h=36*t",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryslow",
      "-crf",
      "44",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "120",
      "-bf",
      item.video === "flv" ? "0" : "3",
      videoPath,
    ]);

    const prefix = `set-${index + 1}`;
    const audio = await storeAsset(
      directory,
      `${prefix}/audio.${item.audio}`,
      await readFile(audioPath),
    );
    const background = await storeAsset(
      directory,
      `${prefix}/background.png`,
      await readFile(backgroundPath),
    );
    const video = await storeAsset(
      directory,
      `${prefix}/video.${item.video}`,
      await readFile(videoPath),
    );
    const beatmap = await storeAsset(
      directory,
      `${prefix}/map.osu`,
      `osu file format v14\n\n[General]\nAudioFilename: audio.${item.audio}\n\n[Events]\nVideo,0,"video.${item.video}"\n`,
    );
    songs.push({
      title: item.title,
      color: item.color,
      audio,
      background,
      video,
      beatmap,
    });
  }

  // A fourth song covers a valid map with audio but no optional art or video.
  const audio = songs[0].audio;
  const beatmap = await storeAsset(
    directory,
    "set-4/map.osu",
    "osu file format v14\n\n[General]\nAudioFilename: audio.mp3\n",
  );
  songs.push({
    title: "Quiet Sky",
    color: "none",
    audio: { filename: "set-4/audio.mp3", hash: audio.hash },
    beatmap,
  });
  await rm(working, { recursive: true, force: true });
  return songs;
}

function createRealm(directory: string, songs: FixtureSong[]): void {
  const realm = new Realm({
    path: join(directory, "client.realm"),
    schema: Schema,
    schemaVersion: 52,
  });
  try {
    realm.write(() => {
      for (const [index, song] of songs.entries()) {
        const files = [song.audio, song.background, song.video, song.beatmap]
          .filter((asset): asset is FixtureAsset => asset !== undefined)
          .map((asset) => ({
            Filename: asset.filename,
            File: realm.objectForPrimaryKey("File", asset.hash) ?? {
              Hash: asset.hash,
            },
          }));
        const set = realm.create("BeatmapSet", {
          ID: new Realm.BSON.UUID(),
          OnlineID: 900001 + index,
          DateAdded: new Date(`2025-01-0${index + 1}T00:00:00Z`),
          Status: 0,
          DeletePending: false,
          Protected: false,
          Files: files,
          Beatmaps: [
            {
              ID: new Realm.BSON.UUID(),
              Hash: song.beatmap.hash,
              MD5Hash: createHash("md5").update(song.title).digest("hex"),
              DifficultyName: "Test",
              Status: 0,
              OnlineID: 900001 + index,
              Hidden: false,
              EndTimeObjectCount: 0,
              TotalObjectCount: 0,
              BeatDivisor: 4,
              Length: 10000,
              BPM: 110 + index * 20,
              StarRating: 2 + index,
              LastLocalUpdate: new Date(`2025-01-0${index + 1}T00:00:00Z`),
              Metadata: {
                PreviewTime: 0,
                Title: song.title,
                Artist: "Fixture Artist",
                AudioFile: `audio.${song.audio.filename.split(".").at(-1)}`,
                BackgroundFile: song.background ? "background.png" : undefined,
                Tags: `fixture ${song.color}`,
              },
            },
          ],
        }) as unknown as { Beatmaps: { BeatmapSet: unknown }[] };
        set.Beatmaps[0].BeatmapSet = set;
      }
    });
  } finally {
    realm.close();
  }
}

await mkdir(resolve("tests"), { recursive: true });
const staging = await mkdtemp(resolve("tests/.environment-build-"));
try {
  const songs = await generate(staging);
  createRealm(staging, songs);
  await writeFile(
    join(staging, "manifest.json"),
    JSON.stringify({ songs }, null, 2),
  );
  Realm.shutdown();
  await rm(environment, { recursive: true, force: true });
  await rename(staging, environment);
  console.log(`Created ${songs.length} fake songs in ${environment}`);
} catch (error) {
  Realm.shutdown();
  await rm(staging, { recursive: true, force: true });
  throw error;
}
