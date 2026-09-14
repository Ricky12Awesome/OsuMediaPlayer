import Realm from "realm";
import {
  loadLibraryFromRealm,
  readLibraryFingerprint,
  type LibraryFingerprint,
} from "./library";
import {
  libraryCachePath,
  readLibraryCache,
  writeLibraryCache,
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
    let cacheFile: string | undefined;
    let fingerprint: LibraryFingerprint | undefined;
    if (options.cacheDirectory) {
      const checked = await readLibraryFingerprint(
        options.installPath,
        controller.signal,
      );
      resolvedPath = checked.installPath;
      fingerprint = checked.fingerprint;
      cacheFile = libraryCachePath(options.cacheDirectory, resolvedPath);
      const cached = await readLibraryCache(
        cacheFile,
        fingerprint,
        controller.signal,
      );
      if (cached && cached.summary.installPath === resolvedPath) {
        await send({ type: "complete", snapshot: cached });
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
      if (cacheFile && fingerprint) {
        try {
          await writeLibraryCache(cacheFile, fingerprint, snapshot);
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
