import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { _electron as electron } from "playwright";
import Realm from "realm";
import { Schema } from "../src/shared/client-model";

const directory = await mkdtemp(join(tmpdir(), "osu-streaming-"));
const songCount = 3000;
try {
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
          DateAdded: new Date(),
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
              LastLocalUpdate: new Date(),
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
  const bootstrap = join(directory, "bootstrap.html");
  await writeFile(bootstrap, "<!doctype html><title>Streaming test</title>");

  for (const closeAt of ["complete", "early", "reading", "indexing"] as const) {
    const env: Record<string, string> = {
      ...process.env,
      ELECTRON_RENDERER_URL: pathToFileURL(bootstrap).href,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      args: [
        ".",
        "--no-sandbox",
        `--user-data-dir=${join(directory, closeAt)}`,
      ],
      env,
    });
    const child = app.process();
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const exited = once(child, "exit");
    try {
      const page = await app.firstWindow();
      await page.addInitScript(
        ({ installPath, closeAt }) => {
          localStorage.setItem(
            "song-list-path",
            JSON.stringify(installPath),
          );
          const state = window as typeof window & { streamedCounts: number[] };
          state.streamedCounts = [];
          window.playerAPI!.onSongListProgress((progress) => {
            if ("summary" in progress)
              state.streamedCounts.push(progress.summary.songCount);
            if (
              (closeAt === "early" && progress.records > 0) ||
              (closeAt === "reading" && "summary" in progress) ||
              (closeAt === "indexing" && progress.phase === "indexing")
            ) {
              window.playerAPI!.windowControl("close");
            }
          });
          // Exercise the shared-promise path: React can issue a second load
          // before the first one has completed during a very early close.
          if (closeAt === "early")
            void window.playerAPI!.loadSongList(installPath).catch(() => {});
        },
        { installPath: directory, closeAt },
      );
      await app.evaluate(
        ({ BrowserWindow }, filename) => {
          void BrowserWindow.getAllWindows()[0].loadFile(filename);
        },
        join(process.cwd(), "dist/index.html"),
      );
      if (closeAt === "complete") {
        await page.waitForSelector(".song-row:not(.row-placeholder)");
        assert.equal(await page.getByText("Finding your rhythm").count(), 0);
        await page.waitForFunction(
          (count) =>
            document
              .querySelector(".song-list-footer")
              ?.textContent?.includes(
                `${count.toLocaleString()} songs in your song list`,
              ),
          songCount,
        );
        const counts = await page.evaluate(
          () =>
            (window as typeof window & { streamedCounts: number[] })
              .streamedCounts,
        );
        assert.equal(counts[0], 1);
        assert.ok(counts.length >= 2);
        assert.equal(counts.at(-1), songCount);
        await page.evaluate(() => window.playerAPI!.windowControl("close"));
      }
      const [code, signal] = await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Timed out closing during ${closeAt}`)),
            15000,
          );
          timer.unref();
        }),
      ]);
      assert.equal(code, 0, stderr);
      assert.equal(signal, null, stderr);
      assert.doesNotMatch(stderr, /FATAL ERROR|Fatal error|SIGABRT/);
      assert.doesNotMatch(
        stderr,
        /Error occurred in handler for 'song-list:load'/,
      );
      console.log(`Song list streaming / close during ${closeAt}: passed`);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        await app.close();
    }
  }
} finally {
  Realm.shutdown();
  await rm(directory, { recursive: true, force: true });
}
