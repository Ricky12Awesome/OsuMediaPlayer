import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x } from "tar";
import extractZip from "extract-zip";

export function ofuRelease(platform: string, arch: string) {
  const rid = (
    {
      "win32-x64": "win-x64",
      "linux-x64": "linux-x64",
      "darwin-x64": "osx-x64",
      "darwin-arm64": "osx-arm64",
    } as Record<string, string>
  )[`${platform}-${arch}`];
  if (!rid) throw new Error(`OFU is not available for ${platform} ${arch}.`);
  const executable = platform === "win32" ? "ofu.exe" : "ofu";
  const archive = `OsuFilesUtility-${rid}.${platform === "win32" ? "zip" : "tar.gz"}`;
  return {
    executable,
    archive,
    url: `https://github.com/Ricky12Awesome/OsuFilesUtility/releases/latest/download/${archive}`,
  };
}

async function isExecutable(path: string, platform: string) {
  try {
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function ensureOfu(
  directory: string,
  {
    platform = process.platform as string,
    arch = process.arch as string,
    bundledDirectory,
    signal,
    download = fetch,
    onDownload,
  }: {
    platform?: string;
    arch?: string;
    bundledDirectory?: string;
    signal?: AbortSignal;
    download?: typeof fetch;
    onDownload?: () => void;
  } = {},
): Promise<string> {
  const release = ofuRelease(platform, arch);
  if (bundledDirectory) {
    const bundled = join(bundledDirectory, release.executable);
    if (await isExecutable(bundled, platform)) return bundled;
  }
  const destination = join(directory, `${platform}-${arch}`);
  const executable = join(destination, release.executable);
  if (await isExecutable(executable, platform)) return executable;
  onDownload?.();
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(join(directory, ".download-"));
  try {
    const response = await download(release.url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(300_000)])
        : AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Download returned HTTP ${response.status}.`);
    const archive = join(temporary, release.archive);
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      ),
      createWriteStream(archive),
      { signal },
    );
    const contents = join(temporary, "contents");
    await mkdir(contents);
    if (platform === "win32") await extractZip(archive, { dir: contents });
    else
      await x({
        file: archive,
        cwd: contents,
        strict: true,
        filter: (_path, entry) =>
          "type" in entry &&
          (entry.type === "File" || entry.type === "Directory"),
      });
    const downloaded = join(contents, release.executable);
    if (!(await stat(downloaded)).isFile())
      throw new Error("The archive does not contain the OFU executable.");
    if (platform !== "win32") await chmod(downloaded, 0o755);
    signal?.throwIfAborted();
    // Publish only complete downloads, leaving failures safe to retry.
    if (await isExecutable(executable, platform)) return executable;
    await rm(destination, { recursive: true, force: true });
    await rename(contents, destination);
    return executable;
  } catch (error) {
    throw new Error(
      `Could not prepare OFU. Check your internet connection and retry. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
