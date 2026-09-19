import { join } from "node:path";
import { fork } from "node:child_process";
import { SongListIndex, type SongListSnapshot } from "./index";
import type { SongListProgress } from "../../shared/types";

type WorkerMessage =
  | { type: "progress"; progress: SongListProgress }
  | { type: "batch" | "complete"; snapshot: SongListSnapshot }
  | { type: "error"; message: string };

const workers = new Set<Promise<void>>();

/** Keep Electron alive until every Realm owner has closed its database and exited. */
export async function waitForSongListWorkers(): Promise<void> {
  await Promise.all(workers);
}

export function loadSongListInWorker(
  installPath?: string,
  onProgress?: (progress: SongListProgress) => void,
  signal?: AbortSignal,
  onSnapshot?: (index: SongListIndex) => void,
  cacheDirectory?: string,
  prioritySongId?: string,
  cacheOnly = false,
): Promise<SongListIndex> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = fork(
      join(__dirname, "song-list-worker.cjs"),
      [
        JSON.stringify({
          installPath,
          cacheDirectory,
          prioritySongId,
          cacheOnly,
        }),
      ],
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
    let completed: SongListIndex | undefined;
    let streaming: SongListIndex | undefined;
    const cancel = (error: unknown) => {
      if (failed) return;
      failed = true;
      failure = error;
      if (worker.connected) worker.send("cancel", () => {});
    };
    const abort = () =>
      cancel(signal?.reason ?? new Error("Song list import cancelled."));
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (message: WorkerMessage) => {
      if (failed) return;
      try {
        if (message.type === "progress") onProgress?.(message.progress);
        else if (message.type === "error") cancel(new Error(message.message));
        else if (message.type === "complete") {
          completed = SongListIndex.fromSnapshot(message.snapshot);
          onSnapshot?.(completed);
        } else {
          streaming ??= new SongListIndex([], new Map(), {
            ...message.snapshot.summary,
            songCount: 0,
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
            `Song list worker exited before loading completed (code ${code}).${diagnostics ? "\n" + diagnostics : ""}`,
          ),
        );
    });
  });
}
