import Realm from "realm";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  LibraryIndex,
  readLibraryCollections,
  loadLibraryFromRealm,
  readLibraryFingerprints,
  type LibraryFingerprint,
} from "./library";
import { resolveLazerInstallPath } from "./lazer-path";
import {
  collectionFingerprintsEqual,
  libraryCachePath,
  libraryRealmMetadataEqual,
  readLibraryCacheManifest,
  readLibraryCache,
  writeLibraryCache,
  type LibraryRealmMetadata,
} from "./library-cache";

// Realm's native addon owns process-wide state. Keep it outside Electron's
// main process rather than sharing that state across worker-thread environments.
const controller = new AbortController();
process.on("message", (message) => {
  if (message === "cancel")
    controller.abort(new Error("Library import cancelled."));
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
    let options: { installPath?: string; cacheDirectory?: string };
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
    let fingerprint: LibraryFingerprint | undefined;
    let collectionFingerprint: Record<string, number> | undefined;
    let realmMetadata: LibraryRealmMetadata | undefined;
    if (options.cacheDirectory) {
      resolvedPath = await resolveLazerInstallPath(options.installPath);
      const realm = await stat(join(resolvedPath, "client.realm"));
      realmMetadata = { mtimeMs: realm.mtimeMs, size: realm.size };
      cacheDirectory = libraryCachePath(options.cacheDirectory, resolvedPath);
      const manifest = await readLibraryCacheManifest(
        cacheDirectory,
        controller.signal,
      );
      let cached =
        manifest &&
        manifest.summary.installPath === resolvedPath &&
        libraryRealmMetadataEqual(manifest.realm, realmMetadata)
          ? await readLibraryCache(
              cacheDirectory,
              undefined,
              controller.signal,
              manifest,
            )
          : null;
      if (!cached) {
        const checked = await readLibraryFingerprints(
          resolvedPath,
          controller.signal,
        );
        fingerprint = checked.fingerprint;
        collectionFingerprint = checked.collectionFingerprint;
        cached = await readLibraryCache(
          cacheDirectory,
          fingerprint,
          controller.signal,
          manifest ?? undefined,
        );
      } else {
        fingerprint = cached.fingerprint;
        collectionFingerprint = cached.collectionFingerprint;
      }
      if (cached && cached.snapshot.summary.installPath === resolvedPath) {
        const index = LibraryIndex.fromSnapshot(cached.snapshot);
        if (
          !collectionFingerprintsEqual(
            cached.collectionFingerprint,
            collectionFingerprint,
          )
        ) {
          const trackIdsByMd5 = new Map<string, Set<string>>();
          for (const item of cached.snapshot.indexed) {
            for (const hash of item.beatmapHashes) {
              const ids = trackIdsByMd5.get(hash) ?? new Set<string>();
              ids.add(item.track.id);
              trackIdsByMd5.set(hash, ids);
            }
          }
          const collections = await readLibraryCollections(
            resolvedPath,
            trackIdsByMd5,
            controller.signal,
          );
          index.replaceCollections(collections);
          await send({ type: "complete", snapshot: index.snapshot() });
          try {
            await writeLibraryCache(
              cacheDirectory,
              fingerprint,
              collectionFingerprint,
              realmMetadata,
              index.snapshot(),
            );
          } catch {
            // Caching is an optimization. A read-only or full cache directory
            // must never make a successfully loaded library fail.
          }
        } else {
          await send({ type: "complete", snapshot: cached.snapshot });
        }
        return;
      }
    }
    const index = await loadLibraryFromRealm(
      resolvedPath,
      (progress) => void send({ type: "progress", progress }),
      controller.signal,
      (batch) => void send({ type: "batch", snapshot: batch.snapshot() }),
    );
    try {
      await index.prepareSortOrders(controller.signal);
      controller.signal.throwIfAborted();
      const snapshot = index.snapshot();
      await send({ type: "complete", snapshot });
      // The snapshot is complete at this point. Finish persisting it even if
      // the parent starts a graceful shutdown immediately afterward.
      if (
        cacheDirectory &&
        fingerprint &&
        collectionFingerprint &&
        realmMetadata
      ) {
        try {
          const currentRealm = await stat(join(resolvedPath!, "client.realm"));
          if (libraryRealmMetadataEqual(currentRealm, realmMetadata))
            await writeLibraryCache(
              cacheDirectory,
              fingerprint,
              collectionFingerprint,
              realmMetadata,
              snapshot,
            );
        } catch {
          // Caching is an optimization. A read-only or full cache directory
          // must never make a successfully loaded library fail.
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
