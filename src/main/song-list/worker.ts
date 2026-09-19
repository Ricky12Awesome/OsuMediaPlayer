import Realm from "realm";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  SongListIndex,
  readSongListCollections,
  loadSongListFromRealm,
  readSongListFingerprints,
  type SongListFingerprint,
} from "./index";
import { resolveLazerInstallPath } from "../lazer-path";
import {
  collectionFingerprintsEqual,
  songListCachePath,
  songListRealmMetadataEqual,
  readSongListCacheManifest,
  readSongListCache,
  writeSongListCache,
  type SongListRealmMetadata,
} from "./cache";

// Realm's native addon owns process-wide state. Keep it outside Electron's
// main process rather than sharing that state across worker-thread environments.
const controller = new AbortController();
process.on("message", (message) => {
  if (message === "cancel")
    controller.abort(new Error("Song list import cancelled."));
});
process.on("disconnect", () => controller.abort());
// `process.send` is asynchronous. Keep every snapshot in order and wait for
// the final message to flush before Realm is closed and this process exits.
let sendQueue = Promise.resolve();
const send = (message: unknown): Promise<void> => {
  const delivery = sendQueue.then(
    () =>
      new Promise<void>((resolve) => {
        if (!process.connected) {
          resolve();
          return;
        }
        try {
          process.send!(message, () => resolve());
        } catch {
          // The parent may close its IPC channel while cancelling an import.
          resolve();
        }
      }),
  );
  // A cancelled import can close its IPC channel. Do not prevent later
  // cleanup messages from being attempted after one delivery is rejected.
  sendQueue = delivery.catch(() => undefined);
  return delivery;
};
void (async () => {
  try {
    const argument = process.argv[2];
    let options: {
      installPath?: string;
      cacheDirectory?: string;
      prioritySongId?: string;
      cacheOnly?: boolean;
    };
    try {
      options = JSON.parse(argument || "{}") as {
        installPath?: string;
        cacheDirectory?: string;
      };
    } catch {
      // Keep direct invocations using the pre-cache single-path argument
      // compatible with the worker's previous command-line contract.
      options = { installPath: argument };
    }
    let resolvedPath = options.installPath;
    let cacheDirectory: string | undefined;
    let fingerprint: SongListFingerprint | undefined;
    let collectionFingerprint: Record<string, number> | undefined;
    let realmMetadata: SongListRealmMetadata | undefined;
    if (options.cacheDirectory) {
      resolvedPath = await resolveLazerInstallPath(options.installPath);
      const realm = await stat(join(resolvedPath, "client.realm"));
      realmMetadata = { mtimeMs: realm.mtimeMs, size: realm.size };
      cacheDirectory = songListCachePath(options.cacheDirectory, resolvedPath);
      const manifest = await readSongListCacheManifest(
        cacheDirectory,
        controller.signal,
      );
      let cached =
        manifest &&
        manifest.summary.installPath === resolvedPath &&
        songListRealmMetadataEqual(manifest.realm, realmMetadata)
          ? await readSongListCache(
              cacheDirectory,
              undefined,
              controller.signal,
              manifest,
            )
          : null;
      // With no manifest there cannot be a cache hit. Avoid walking the
      // entire Realm just to calculate a fingerprint before the first import:
      // on a cold filesystem that duplicates the work of the import and
      // delays its first streamed songs. We calculate it after the snapshot
      // has been delivered, before persisting the newly-built cache.
      if (!cached && manifest) {
        const checked = await readSongListFingerprints(
          resolvedPath,
          controller.signal,
        );
        fingerprint = checked.fingerprint;
        collectionFingerprint = checked.collectionFingerprint;
        cached = await readSongListCache(
          cacheDirectory,
          fingerprint,
          controller.signal,
          manifest ?? undefined,
        );
      } else if (cached) {
        fingerprint = cached.fingerprint;
        collectionFingerprint = cached.collectionFingerprint;
      }
      if (cached && cached.snapshot.summary.installPath === resolvedPath) {
        const index = SongListIndex.fromSnapshot(cached.snapshot);
        if (
          !collectionFingerprintsEqual(
            cached.collectionFingerprint,
            collectionFingerprint ?? cached.collectionFingerprint,
          )
        ) {
          const songIdsByMd5 = new Map<string, Set<string>>();
          for (const item of cached.snapshot.indexed) {
            for (const hash of item.beatmapHashes) {
              const ids = songIdsByMd5.get(hash) ?? new Set<string>();
              ids.add(item.song.id);
              songIdsByMd5.set(hash, ids);
            }
          }
          const collections = await readSongListCollections(
            resolvedPath,
            songIdsByMd5,
            controller.signal,
          );
          index.replaceCollections(collections);
          await send({ type: "complete", snapshot: index.snapshot() });
          try {
            await writeSongListCache(
              cacheDirectory,
              fingerprint ?? cached.fingerprint,
              collectionFingerprint ?? cached.collectionFingerprint,
              realmMetadata,
              index.snapshot(),
            );
          } catch {
            // Caching is an optimization. A read-only or full cache directory
            // must never make a successfully loaded song list fail.
          }
        } else {
          await send({ type: "complete", snapshot: cached.snapshot });
        }
        return;
      }
      if (options.cacheOnly)
        throw new Error("No valid song list cache is available.");
    }
    const index = await loadSongListFromRealm(
      resolvedPath,
      (progress) => void send({ type: "progress", progress }),
      controller.signal,
      (batch) => void send({ type: "batch", snapshot: batch.snapshot() }),
      options.prioritySongId,
    );
    try {
      await index.prepareSortOrders(controller.signal);
      controller.signal.throwIfAborted();
      const snapshot = index.snapshot();
      await send({ type: "complete", snapshot });
      // The snapshot is complete at this point. Finish persisting it even if
      // the parent starts a graceful shutdown immediately afterward.
      if (cacheDirectory && realmMetadata) {
        try {
          // A cache miss without a manifest intentionally defers this scan so
          // cold startup can begin streaming immediately.
          if (!fingerprint || !collectionFingerprint) {
            const checked = await readSongListFingerprints(
              resolvedPath,
              controller.signal,
            );
            fingerprint = checked.fingerprint;
            collectionFingerprint = checked.collectionFingerprint;
          }
          const currentRealm = await stat(join(resolvedPath!, "client.realm"));
          if (songListRealmMetadataEqual(currentRealm, realmMetadata))
            await writeSongListCache(
              cacheDirectory,
              fingerprint,
              collectionFingerprint,
              realmMetadata,
              snapshot,
            );
        } catch {
          // Caching is an optimization. A read-only or full cache directory
          // must never make a successfully loaded song list fail.
        }
      }
    } finally {
      index.close();
    }
  } catch (error) {
    await send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await sendQueue;
    Realm.shutdown();
    if (process.connected) process.disconnect();
  }
})();
