import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import Realm from "realm";
import { Schema } from "../src/shared/client-model";
import {
  LibraryIndex,
  loadLibraryFromRealm,
  readLibraryFingerprint,
} from "../src/main/library";
import {
  libraryCachePath,
  libraryCachePaths,
  libraryFingerprintsEqual,
  readLibraryCache,
  writeLibraryCache,
} from "../src/main/library-cache";
import type { loadLibraryInWorker } from "../src/main/library-loader";
import type { SortKey } from "../src/shared/types";

test("worker imports Realm and transfers canonical sort orders; errors and cancellation reject", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".worker-test-"));
  try {
    await build({
      entryPoints: ["src/main/library-worker.ts", "src/main/library-loader.ts"],
      outdir: directory,
      outExtension: { ".js": ".cjs" },
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["realm"],
    });
    const load: typeof loadLibraryInWorker = createRequire(import.meta.url)(
      join(directory, "library-loader.cjs"),
    ).loadLibraryInWorker;
    const fixture = new Realm({
      path: join(directory, "client.realm"),
      schema: Schema,
      schemaVersion: 52,
    });
    fixture.write(() => {
      for (let i = 0; i < 3; i++) {
        const set = fixture.create("BeatmapSet", {
          ID: new Realm.BSON.UUID(),
          OnlineID: i + 1,
          DateAdded: new Date(),
          Status: 0,
          DeletePending: false,
          Protected: false,
          Files: [
            { Filename: "song.mp3", File: { Hash: String(i + 1).repeat(64) } },
          ],
          Beatmaps: [
            {
              ID: new Realm.BSON.UUID(),
              MD5Hash: String(i + 1).repeat(32),
              Status: 0,
              OnlineID: i + 1,
              Hidden: false,
              EndTimeObjectCount: 0,
              TotalObjectCount: 0,
              BeatDivisor: 4,
              Length: (3 - i) * 60000,
              BPM: 100 + i,
              StarRating: 5 - i,
              LastLocalUpdate: new Date(2025, 0, i + 1),
              Metadata: {
                PreviewTime: 0,
                Title: ["Zulu", "Alpha", "Middle"][i],
                Artist: ["B", "C", "A"][i],
                AudioFile: "song.mp3",
                Tags: ["rock", "pop", "jazz"][i],
              },
            },
          ],
        }) as unknown as { Beatmaps: { BeatmapSet: unknown }[] };
        set.Beatmaps[0].BeatmapSet = set;
      }
      fixture.create("BeatmapCollection", {
        ID: new Realm.BSON.UUID(),
        Name: "Favorites",
        BeatmapMD5Hashes: ["1".repeat(32)],
        LastModified: new Date(2025, 0, 1),
      });
    });
    fixture.close();
    const direct = await loadLibraryFromRealm(directory);
    try {
      const progress: unknown[] = [];
      const batches: { index: LibraryIndex; indexingStarted: boolean }[] = [];
      let indexingStarted = false;
      const loaded = await load(
        directory,
        (value) => {
          progress.push(value);
          indexingStarted ||= value.phase === "indexing";
        },
        undefined,
        (index) =>
          batches.push({
            index: LibraryIndex.fromSnapshot(structuredClone(index.snapshot())),
            indexingStarted,
          }),
      );
      assert.ok(batches.length >= 2);
      assert.equal(batches[0].index.summary.trackCount, 1);
      assert.equal(batches[0].index.query().total, 1);
      assert.equal(batches[0].indexingStarted, false);
      assert.deepEqual(batches.at(-1)!.index.summary, loaded.summary);
      assert.deepEqual(batches.at(-1)!.index.query(), loaded.query());
      assert.equal(loaded.summary.trackCount, 3);
      assert.ok(progress.length);
      assert.equal(loaded.snapshot().orders.size, 8);
      for (const sort of [
        "title",
        "artist",
        "duration",
        "bpm",
        "added",
        "stars",
        "collection",
        "tags",
      ] as SortKey[]) {
        for (const descending of [false, true]) {
          assert.deepEqual(
            loaded.query({ sort, descending }),
            direct.query({ sort, descending }),
          );
          assert.deepEqual(
            loaded.query({ sort, descending, tags: ["rock"] }),
            direct.query({ sort, descending, tags: ["rock"] }),
          );
        }
      }
      assert.deepEqual(loaded.assets, direct.assets);
      assert.deepEqual(
        loaded.getTrack(loaded.query().items[0].id),
        direct.query().items[0],
      );
    } finally {
      direct.close();
    }
    const cacheDirectory = join(directory, "library-cache");
    const firstCached = await load(
      directory,
      undefined,
      undefined,
      undefined,
      cacheDirectory,
    );
    const cachePath = libraryCachePath(cacheDirectory, directory);
    const cacheFiles = libraryCachePaths(cachePath);
    const fingerprint = await readLibraryFingerprint(directory);
    const manifest = JSON.parse(
      await readFile(cacheFiles.manifest, "utf8"),
    ) as {
      fingerprint: {
        beatmapSetCount: number;
        beatmapCount: number;
        latestDateAdded: number;
      };
      collectionFingerprint: Record<string, number>;
      realm: { mtimeMs: number; size: number };
    };
    const tracksBinary = await readFile(cacheFiles.tracks);
    const collectionsBinary = await readFile(cacheFiles.collections);
    const ordersBinary = await readFile(cacheFiles.orders);
    const cachedData = await readLibraryCache(
      cachePath,
      fingerprint.fingerprint,
    );
    assert.ok(cachedData);
    assert.equal(firstCached.summary.trackCount, 3);
    assert.deepEqual(manifest.fingerprint, fingerprint.fingerprint);
    assert.equal(manifest.fingerprint.beatmapSetCount, 3);
    assert.equal(manifest.fingerprint.beatmapCount, 3);
    assert.ok(Number.isFinite(manifest.realm.mtimeMs));
    assert.ok(Number.isFinite(manifest.realm.size));
    assert.equal(tracksBinary.subarray(0, 4).toString(), "OMTR");
    assert.equal(collectionsBinary.subarray(0, 4).toString(), "OMCL");
    assert.equal(ordersBinary.subarray(0, 4).toString(), "OMOR");
    assert.equal(cachedData.snapshot.collections.length, 1);
    assert.equal(cachedData.snapshot.collections[0].name, "Favorites");
    assert.equal(cachedData.snapshot.orders.size, 8);
    const firstTrack = cachedData.snapshot.indexed[0].track;
    const firstTrackId = firstTrack.id;
    firstTrack.title = "From disk cache";
    firstTrack.artist = "Cached artist";
    firstTrack.titleUnicode = "キャッシュタイトル";
    firstTrack.artistUnicode = "キャッシュアーティスト";
    firstTrack.backgroundHash = "b".repeat(64);
    firstTrack.videoHash = "c".repeat(64);
    firstTrack.videoOffset = 1.25;
    cachedData.snapshot.assets.set(firstTrack.backgroundHash, {
      hash: firstTrack.backgroundHash,
      filename: "background.jpg",
    });
    cachedData.snapshot.assets.set(firstTrack.videoHash, {
      hash: firstTrack.videoHash,
      filename: "video.mp4",
    });
    await writeLibraryCache(
      cachePath,
      cachedData.fingerprint,
      cachedData.collectionFingerprint,
      cachedData.realm,
      cachedData.snapshot,
    );
    const cached = await load(
      directory,
      undefined,
      undefined,
      undefined,
      cacheDirectory,
    );
    assert.ok(
      cached.query().items.some((track) => track.title === "From disk cache"),
    );
    assert.ok(
      cached.query().items.some((track) => track.artist === "Cached artist"),
    );
    assert.equal(
      cached.getTrack(firstTrackId)?.titleUnicode,
      "キャッシュタイトル",
    );
    assert.equal(
      cached.getTrack(firstTrackId)?.artistUnicode,
      "キャッシュアーティスト",
    );
    assert.equal(cached.getTrack(firstTrackId)?.videoOffset, 1.25);
    assert.equal(cached.assets.get("b".repeat(64))?.filename, "background.jpg");
    assert.equal(cached.assets.get("c".repeat(64))?.filename, "video.mp4");
    assert.equal(cached.snapshot().orders.size, 8);
    assert.equal(
      libraryFingerprintsEqual(fingerprint.fingerprint, {
        ...fingerprint.fingerprint,
        beatmapCount: fingerprint.fingerprint.beatmapCount + 1,
      }),
      false,
    );
    const changedRealm = new Realm({
      path: join(directory, "client.realm"),
      schema: Schema,
      schemaVersion: 52,
    });
    try {
      changedRealm.write(() => {
        const collection = changedRealm.objects(
          "BeatmapCollection",
        )[0] as unknown as {
          LastModified: Date;
          BeatmapMD5Hashes: { splice: (...values: unknown[]) => void };
        };
        collection.LastModified = new Date(2025, 0, 2);
        collection.BeatmapMD5Hashes.splice(0, 1, "2".repeat(32));
      });
    } finally {
      changedRealm.close();
    }
    const collectionCached = await load(
      directory,
      undefined,
      undefined,
      undefined,
      cacheDirectory,
    );
    assert.equal(
      collectionCached.getTrack(firstTrackId)?.title,
      "From disk cache",
    );
    assert.deepEqual(
      collectionCached
        .query({ collection: "Favorites" })
        .items.map((track) => track.id),
      [
        cachedData.snapshot.indexed.find((item) =>
          item.beatmapHashes.has("2".repeat(32)),
        )?.track.id,
      ],
    );

    const rebuiltRealm = new Realm({
      path: join(directory, "client.realm"),
      schema: Schema,
      schemaVersion: 52,
    });
    try {
      rebuiltRealm.write(() => {
        rebuiltRealm.objects("BeatmapSet")[0].DateAdded = new Date(
          fingerprint.fingerprint.latestDateAdded + 1,
        );
      });
    } finally {
      rebuiltRealm.close();
    }
    const rebuilt = await load(
      directory,
      undefined,
      undefined,
      undefined,
      cacheDirectory,
    );
    assert.ok(
      rebuilt.query().items.every((track) => track.title !== "From disk cache"),
    );

    // Cancellation during reading and sorting must wait for graceful worker exit.
    for (const phase of ["reading", "indexing"] as const) {
      const controller = new AbortController();
      const cancel = () =>
        controller.abort(new Error(`Cancelled during ${phase}`));
      await assert.rejects(
        load(
          directory,
          (value) => {
            if (phase === "indexing" && value.phase === "indexing") cancel();
          },
          controller.signal,
          () => {
            if (phase === "reading") cancel();
          },
        ),
        new RegExp(`Cancelled during ${phase}`),
      );
      // Reopening immediately after rejection verifies the worker released Realm.
      const reopened = await loadLibraryFromRealm(directory);
      reopened.close();
    }
    const sorting = await loadLibraryFromRealm(directory);
    try {
      let checks = 0;
      await assert.rejects(
        () =>
          sorting.prepareSortOrders({
            throwIfAborted() {
              if (++checks === 5) throw new Error("Interrupted sort traversal");
            },
          }),
        /Interrupted sort traversal/,
      );
    } finally {
      sorting.close();
    }
    await assert.rejects(load(join(directory, "missing")));
    const controller = new AbortController();
    const pending = load(directory, undefined, controller.signal);
    controller.abort(new Error("Cancelled test import"));
    await assert.rejects(pending, /Cancelled test import/);
    await assert.rejects(
      load(directory, undefined, controller.signal),
      /Cancelled test import/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    Realm.shutdown();
  }
});
