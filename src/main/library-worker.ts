import Realm from "realm";
import { loadLibraryFromRealm } from "./library";

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
    const index = await loadLibraryFromRealm(
      process.argv[2] || undefined,
      (progress) => void send({ type: "progress", progress }),
      controller.signal,
      (batch) => void send({ type: "batch", snapshot: batch.snapshot() }),
    );
    try {
      await index.prepareSortOrders(controller.signal);
      controller.signal.throwIfAborted();
      await send({ type: "complete", snapshot: index.snapshot() });
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
