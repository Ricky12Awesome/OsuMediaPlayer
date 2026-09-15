import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { clearLibraryCache } from "../src/main/library-cache";
import { VideoTranscoder } from "../src/main/video";

test("clearing the library cache removes all cached files", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".library-cache-test-"));
  const cacheDirectory = join(directory, "library-cache");
  try {
    await mkdir(join(cacheDirectory, "library-example"), { recursive: true });
    await writeFile(
      join(cacheDirectory, "library-example", "manifest.json"),
      "{}",
    );

    await clearLibraryCache(cacheDirectory);

    await assert.rejects(stat(cacheDirectory), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("clearing the video cache removes converted video files", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".video-cache-test-"));
  const cacheDirectory = join(directory, "video-cache");
  try {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(join(cacheDirectory, "converted.mp4"), "video");

    await new VideoTranscoder(cacheDirectory).clearCache();

    await assert.rejects(stat(cacheDirectory), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
