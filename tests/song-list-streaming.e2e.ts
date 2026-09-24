import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { build } from "esbuild";
import Realm from "realm";
import { Schema } from "../src/shared/client-model";
import type { loadSongListInWorker } from "../src/main/song-list/loader";

const directory = await mkdtemp(join(process.cwd(), ".streaming-test-"));
const songCount = 3000;
try {
  await build({
    entryPoints: [
      "src/main/song-list/worker.ts",
      "src/main/song-list/loader.ts",
    ],
    outdir: directory,
    entryNames: "song-list-[name]",
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["realm"],
  });
  const loader = createRequire(import.meta.url)(
    join(directory, "song-list-loader.cjs"),
  ) as {
    loadSongListInWorker: typeof loadSongListInWorker;
    waitForSongListWorkers: () => Promise<void>;
  };
  const fixture = new Realm({
    path: join(directory, "client.realm"),
    schema: Schema,
    schemaVersion: 52,
  });
  try {
    fixture.write(() => {
      for (let i = 0; i < songCount; i++) {
        const set = fixture.create("BeatmapSet", {
          ID: new Realm.BSON.UUID(),
          OnlineID: i + 1,
          DateAdded: new Date("2025-01-01T00:00:00Z"),
          Status: 0,
          DeletePending: false,
          Protected: false,
          Files: [
            {
              Filename: "song.mp3",
              File: { Hash: (i + 1).toString(16).padStart(64, "0") },
            },
          ],
          Beatmaps: [
            {
              ID: new Realm.BSON.UUID(),
              MD5Hash: i.toString(16).padStart(32, "0"),
              Status: 0,
              OnlineID: i + 1,
              Hidden: false,
              EndTimeObjectCount: 0,
              TotalObjectCount: 0,
              BeatDivisor: 4,
              Length: 60000,
              BPM: i % 200,
              StarRating: i % 10,
              LastLocalUpdate: new Date("2025-01-01T00:00:00Z"),
              Metadata: {
                PreviewTime: 0,
                Title: `Song ${String(i).padStart(5, "0")}`,
                Artist: "Artist",
                AudioFile: "song.mp3",
              },
            },
          ],
        }) as unknown as { Beatmaps: { BeatmapSet: unknown }[] };
        set.Beatmaps[0].BeatmapSet = set;
      }
    });
  } finally {
    fixture.close();
  }
  for (const stopAt of ["complete", "early", "reading", "indexing"] as const) {
    const controller = new AbortController();
    const counts: number[] = [];
    let stopped = false;
    const stop = () => {
      stopped = true;
      controller.abort(new Error(`Stopped during ${stopAt}`));
    };
    const load = loader.loadSongListInWorker(
      directory,
      (progress) => {
        if (stopAt === "reading" && progress.phase === "reading") stop();
        if (stopAt === "indexing" && progress.phase === "indexing") stop();
      },
      controller.signal,
      (index) => {
        counts.push(index.summary.songCount);
        if (stopAt === "early" && counts.length === 1) stop();
      },
    );
    if (stopAt === "complete") {
      const index = await load;
      assert.equal(index.summary.songCount, songCount);
      assert.equal(index.query().total, songCount);
      assert.equal(counts[0], 1);
      assert.equal(counts.at(-1), songCount);
    } else {
      await assert.rejects(load, new RegExp(`Stopped during ${stopAt}`));
      assert.equal(stopped, true);
    }
    await loader.waitForSongListWorkers();
    console.log(`Song list worker / ${stopAt}: passed`);
  }
} finally {
  Realm.shutdown();
  await rm(directory, { recursive: true, force: true });
}
