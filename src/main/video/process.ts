import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** The bounded output collected from one ffmpeg/ffprobe invocation. */
export interface ProcessResult {
  code: number | null;
  error?: Error;
  stderr: string;
  stdout: string;
}

/**
 * Start a media process and collect enough output for diagnostics.
 *
 * Keeping process bookkeeping here makes cancellation ownership explicit: the
 * caller owns the returned child and can add it to its active-child set.
 */
export function runProcess(
  executable: string,
  args: string[],
  children?: Set<ChildProcess>,
  onStdout?: (chunk: string) => void,
): { child: ChildProcess; result: Promise<ProcessResult> } {
  const child = spawn(executable, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children?.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    onStdout?.(text);
    if (stdout.length < 1_000_000)
      stdout += text.slice(0, 1_000_000 - stdout.length);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (stderr.length < 32_768) stderr += text.slice(0, 32_768 - stderr.length);
  });
  const result = new Promise<ProcessResult>((resolve) => {
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code) => {
      children?.delete(child);
      resolve({ code, error: spawnError, stderr, stdout });
    });
  });
  return { child, result };
}

export function ffprobeFor(ffmpeg: string): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const filename = basename(ffmpeg);
  if (!/^ffmpeg(?:\.exe)?$/i.test(filename)) return "ffprobe";
  const probe = filename.toLowerCase().endsWith(".exe")
    ? "ffprobe.exe"
    : "ffprobe";
  return dirname(ffmpeg) === "." ? probe : join(dirname(ffmpeg), probe);
}

export async function fileHasContents(filename: string): Promise<boolean> {
  try {
    const info = await stat(filename);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
