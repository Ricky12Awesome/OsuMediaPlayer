import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import Realm from "realm";
import { Schema } from "../src/shared/client-model";
import {
  SongListIndex,
  loadSongListFromRealm,
  readSongListFingerprint,
} from "../src/main/song-list/index";
import {
  songListCachePath,
  songListCachePaths,
  songListFingerprintsEqual,
  readSongListCache,
  writeSongListCache,
} from "../src/main/song-list/cache";
import type { loadSongListInWorker } from "../src/main/song-list/loader";
import type { SortKey } from "../src/shared/types";

test("worker imports Realm and transfers canonical sort orders; errors and cancellation reject", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".worker-test-"));
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
    const load: typeof loadSongListInWorker = createRequire(import.meta.url)(
      join(directory, "song-list-loader.cjs"),
    ).loadSongListInWorker;
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
          DateAdded: new Date(2025, 2, i + 1),
          DateSubmitted: new Date(2025, 3, i + 1),
          DateRanked: new Date(2025, 4, i + 1),
          Status: 0,
          DeletePending: false,
          Protected: false,
          Files: [
            { Filename: "song.mp3", File: { Hash: String(i + 1).repeat(64) } },
            {
              Filename: "video.mp4",
              File: { Hash: String(i + 4).repeat(64) },
            },
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
              LastPlayed: new Date(2025, 1, i + 1),
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
    const direct = await loadSongListFromRealm(directory);
    try {
      const progress: unknown[] = [];
      const batches: { index: SongListIndex; indexingStarted: boolean }[] = [];
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
            index: SongListIndex.fromSnapshot(
              structuredClone(index.snapshot()),
            ),
            indexingStarted,
          }),
      );
      assert.ok(batches.length >= 2);
      assert.equal(batches[0].index.summary.songCount, 1);
      assert.equal(batches[0].index.query().total, 1);
      assert.equal(batches[0].indexingStarted, false);
      assert.deepEqual(batches.at(-1)!.index.summary, loaded.summary);
      assert.deepEqual(batches.at(-1)!.index.query(), loaded.query());
      assert.equal(loaded.summary.songCount, 3);
      assert.ok(progress.length);
      assert.equal(loaded.snapshot().orders.size, 12);
      for (const sort of [
        "title",
        "artist",
        "duration",
        "bpm",
        "added",
        "dateAdded",
        "dateSubmitted",
        "dateRanked",
        "lastPlayed",
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
        loaded.getSong(loaded.query().items[0].id),
        direct.query().items[0],
      );

      const priorityBatches: SongListIndex[] = [];
      await load(
        directory,
        undefined,
        undefined,
        (index) =>
          priorityBatches.push(
            SongListIndex.fromSnapshot(structuredClone(index.snapshot())),
          ),
        undefined,
        `3-${"3".repeat(64)}`,
      );
      assert.equal(priorityBatches[0].query().items[0]?.title, "Middle");
      assert.equal(
        priorityBatches[0].query().items[0]?.videoHash,
        "6".repeat(64),
      );
    } finally {
      direct.close();
    }
    const cacheDirectory = join(directory, "song-list-cache");
    const firstCached = await load(
      directory,
      undefined,
      undefined,
      undefined,
      cacheDirectory,
    );
    const cachePath = songListCachePath(cacheDirectory, directory);
    const cacheFiles = songListCachePaths(cachePath);
    const fingerprint = await readSongListFingerprint(directory);
    const manifest = JSON.parse(
      await readFile(cacheFiles.manifest, "utf8"),
    ) as {
      fingerprint: {
        beatmapSetCount: number;
        beatmapCount: number;
        latestDateAdded: number;
      };
      realm: { mtimeMs: number; size: number };
    };
    const collectionFingerprint = JSON.parse(
      await readFile(cacheFiles.collectionManifest, "utf8"),
    ) as Record<string, number>;
    const tags = JSON.parse(await readFile(cacheFiles.tags, "utf8")) as Record<
      string,
      number
    >;
    const collections = JSON.parse(
      await readFile(cacheFiles.collections, "utf8"),
    ) as Record<string, number>;
    const songsBinary = await readFile(cacheFiles.songs);
    const collectionsBinary = await readFile(cacheFiles.collectionSongs);
    const ordersBinary = await readFile(cacheFiles.orders);
    const cachedData = await readSongListCache(
      cachePath,
      fingerprint.fingerprint,
    );
    assert.ok(cachedData);
    assert.equal(firstCached.summary.songCount, 3);
    assert.deepEqual(manifest.fingerprint, fingerprint.fingerprint);
    assert.equal(manifest.fingerprint.beatmapSetCount, 3);
    assert.equal(manifest.fingerprint.beatmapCount, 3);
    assert.ok(Number.isFinite(manifest.realm.mtimeMs));
    assert.ok(Number.isFinite(manifest.realm.size));
    assert.equal("tags" in manifest, false);
    assert.equal("collections" in manifest, false);
    assert.equal("collectionFingerprint" in manifest, false);
    assert.equal(Object.keys(collectionFingerprint).length, 1);
    assert.equal(songsBinary.subarray(0, 4).toString(), "OMTR");
    assert.equal(collectionsBinary.subarray(0, 4).toString(), "OMCL");
    assert.equal(ordersBinary.subarray(0, 4).toString(), "OMOR");
    assert.equal(cachedData.snapshot.collections.length, 1);
    assert.equal(cachedData.snapshot.collections[0].name, "Favorites");
    assert.equal(collections[cachedData.snapshot.collections[0].id], 1);
    assert.deepEqual(tags, { pop: 1, jazz: 1, rock: 1 });
    assert.equal(cachedData.snapshot.orders.size, 12);
    const firstSong = cachedData.snapshot.indexed[0].song;
    const firstSongId = firstSong.id;
    firstSong.title = "From disk cache";
    firstSong.artist = "Cached artist";
    firstSong.titleUnicode = "キャッシュタイトル";
    firstSong.artistUnicode = "キャッシュアーティスト";
    firstSong.backgroundHash = "b".repeat(64);
    firstSong.videoHash = "c".repeat(64);
    firstSong.videoOffset = 1.25;
    cachedData.snapshot.assets.set(firstSong.backgroundHash, {
      hash: firstSong.backgroundHash,
      filename: "background.jpg",
    });
    cachedData.snapshot.assets.set(firstSong.videoHash, {
      hash: firstSong.videoHash,
      filename: "video.mp4",
    });
    await writeSongListCache(
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
      cached.query().items.some((song) => song.title === "From disk cache"),
    );
    assert.ok(
      cached.query().items.some((song) => song.artist === "Cached artist"),
    );
    assert.equal(
      cached.getSong(firstSongId)?.titleUnicode,
      "キャッシュタイトル",
    );
    assert.equal(
      cached.getSong(firstSongId)?.artistUnicode,
      "キャッシュアーティスト",
    );
    assert.equal(cached.getSong(firstSongId)?.videoOffset, 1.25);
    assert.equal(cached.assets.get("b".repeat(64))?.filename, "background.jpg");
    assert.equal(cached.assets.get("c".repeat(64))?.filename, "video.mp4");
    assert.equal(cached.snapshot().orders.size, 12);
    assert.equal(
      songListFingerprintsEqual(fingerprint.fingerprint, {
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
          Name: string;
          LastModified: Date;
          BeatmapMD5Hashes: { splice: (...values: unknown[]) => void };
        };
        collection.Name = "Renamed";
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
      collectionCached.getSong(firstSongId)?.title,
      "From disk cache",
    );
    assert.deepEqual(
      collectionCached
        .query({ collection: "Renamed" })
        .items.map((song) => song.id),
      [
        cachedData.snapshot.indexed.find((item) =>
          item.beatmapHashes.has("2".repeat(32)),
        )?.song.id,
      ],
    );
    assert.equal(collectionCached.query({ collection: "Favorites" }).total, 0);

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
      rebuilt.query().items.every((song) => song.title !== "From disk cache"),
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
      const reopened = await loadSongListFromRealm(directory);
      reopened.close();
    }
    const sorting = await loadSongListFromRealm(directory);
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
