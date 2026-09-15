import { join } from "node:path";
import { fork } from "node:child_process";
import { LibraryIndex, type LibrarySnapshot } from "./library";
import type { LibraryProgress } from "../shared/types";

type WorkerMessage =
  | { type: "progress"; progress: LibraryProgress }
  | { type: "batch" | "complete"; snapshot: LibrarySnapshot }
  | { type: "error"; message: string };

const workers = new Set<Promise<void>>();

/** Keep Electron alive until every Realm owner has closed its database and exited. */
export async function waitForLibraryWorkers(): Promise<void> {
  await Promise.all(workers);
}

export function loadLibraryInWorker(
  installPath?: string,
  onProgress?: (progress: LibraryProgress) => void,
  signal?: AbortSignal,
  onSnapshot?: (index: LibraryIndex) => void,
  cacheDirectory?: string,
  priorityTrackId?: string,
): Promise<LibraryIndex> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = fork(
      join(__dirname, "library-worker.cjs"),
      [JSON.stringify({ installPath, cacheDirectory, priorityTrackId })],
      {
        // Electron's executable runs the loader as Node, including packaged builds.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        serialization: "advanced",
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        execArgv: [],
      },
    );
    let diagnostics = "";
    worker.stderr?.on("data", (data: Buffer) => {
      diagnostics = (diagnostics + data.toString()).slice(-4000);
    });
    let didExit!: () => void;
    const exited = new Promise<void>((done) => {
      didExit = done;
    });
    workers.add(exited);
    let failed = false;
    let failure: unknown;
    let completed: LibraryIndex | undefined;
    let streaming: LibraryIndex | undefined;
    const cancel = (error: unknown) => {
      if (failed) return;
      failed = true;
      failure = error;
      if (worker.connected) worker.send("cancel", () => {});
    };
    const abort = () =>
      cancel(signal?.reason ?? new Error("Library import cancelled."));
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (message: WorkerMessage) => {
      if (failed) return;
      try {
        if (message.type === "progress") onProgress?.(message.progress);
        else if (message.type === "error") cancel(new Error(message.message));
        else if (message.type === "complete") {
          completed = LibraryIndex.fromSnapshot(message.snapshot);
          onSnapshot?.(completed);
        } else {
          streaming ??= new LibraryIndex([], new Map(), {
            ...message.snapshot.summary,
            trackCount: 0,
            collections: [],
            tags: [],
          });
          streaming.applyBatch(message.snapshot);
          onSnapshot?.(streaming);
        }
      } catch (error) {
        cancel(error);
      }
    });
    worker.on("error", cancel);
    worker.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      workers.delete(exited);
      didExit();
      if (failed) reject(failure);
      else if (completed && code === 0) resolve(completed);
      else
        reject(
          new Error(
            `Library worker exited before loading completed (code ${code}).${diagnostics ? "\n" + diagnostics : ""}`,
          ),
        );
    });
  });
}
