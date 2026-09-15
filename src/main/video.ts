import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { LibraryIndex } from "./library";
import { isAssetHash, resolveMediaFile, streamMediaFile } from "./media";

const directlyPlayableExtensions = new Set([".mp4", ".m4v", ".webm"]);

export const videoNeedsConversion = (filename: string): boolean =>
  !directlyPlayableExtensions.has(extname(filename).toLocaleLowerCase());

export const convertedVideoUrl = (hash: string): string =>
  `osu-media://video-cache/${hash.toLowerCase()}`;

function hashFromAssetUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hash = url.pathname.slice(1);
    return url.protocol === "osu-media:" &&
      url.host === "asset" &&
      !url.search &&
      isAssetHash(hash)
      ? hash.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export class VideoTranscoder {
  private readonly ready = new Map<
    string,
    { filename: string; size: number }
  >();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly children = new Set<ChildProcess>();
  private cacheGeneration = 0;
  private clearPromise: Promise<void> | null = null;

  constructor(
    private readonly cacheDirectory: string,
    private readonly executable = process.env.FFMPEG_PATH || "ffmpeg",
  ) {}

  async prepare(
    library: LibraryIndex | null,
    trackId: string,
  ): Promise<string | null> {
    if (this.clearPromise) await this.clearPromise;
    const track = library?.getTrack(trackId);
    if (!library || !track?.videoUrl) return null;
    const hash = hashFromAssetUrl(track.videoUrl);
    if (!hash) return null;
    const asset = library.assets.get(hash);
    if (!asset) return null;
    if (!videoNeedsConversion(asset.filename)) return track.videoUrl;

    const existing = this.pending.get(hash);
    if (existing) return await existing;
    const conversion = this.convert(library, hash, this.cacheGeneration);
    this.pending.set(hash, conversion);
    try {
      return await conversion;
    } finally {
      this.pending.delete(hash);
    }
  }

  private async convert(
    library: LibraryIndex,
    hash: string,
    generation: number,
  ): Promise<string> {
    if (generation !== this.cacheGeneration)
      throw new Error("The video cache was cleared.");
    await mkdir(this.cacheDirectory, { recursive: true });
    const destination = join(this.cacheDirectory, `${hash}.mp4`);
    try {
      const cached = await stat(destination);
      if (cached.isFile() && cached.size > 0) {
        if (generation !== this.cacheGeneration)
          throw new Error("The video cache was cleared.");
        this.ready.set(hash, { filename: destination, size: cached.size });
        return convertedVideoUrl(hash);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }

    const source = await resolveMediaFile(library, hash);
    if (!source) throw new Error("The beatmap video file could not be found.");
    if (generation !== this.cacheGeneration)
      throw new Error("The video cache was cleared.");
    const temporary = join(
      this.cacheDirectory,
      `${hash}.${process.pid}.${randomUUID()}.partial.mp4`,
    );
    const child = spawn(
      this.executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        source.filename,
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-movflags",
        "+faststart",
        temporary,
      ],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    this.children.add(child);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 16_384)
        stderr += chunk.toString().slice(0, 16_384 - stderr.length);
    });
    const result = await new Promise<{
      code: number | null;
      error?: Error;
    }>((resolve) => {
      child.once("error", (error) => resolve({ code: null, error }));
      child.once("close", (code) => resolve({ code }));
    });
    this.children.delete(child);
    try {
      if (generation !== this.cacheGeneration)
        throw new Error("The video cache was cleared.");
      if (result.error) {
        const unavailable =
          (result.error as NodeJS.ErrnoException).code === "ENOENT";
        throw new Error(
          unavailable
            ? "FFmpeg is required to play AVI, FLV, and WMV videos. Install ffmpeg or set FFMPEG_PATH."
            : `Could not start FFmpeg: ${result.error.message}`,
        );
      }
      if (result.code !== 0)
        throw new Error(
          stderr.trim() || `FFmpeg exited with code ${result.code}.`,
        );
      const converted = await stat(temporary);
      if (!converted.isFile() || converted.size === 0)
        throw new Error("FFmpeg did not produce a playable video.");
      if (generation !== this.cacheGeneration)
        throw new Error("The video cache was cleared.");
      await rename(temporary, destination);
      this.ready.set(hash, { filename: destination, size: converted.size });
      return convertedVideoUrl(hash);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async clearCache(): Promise<void> {
    if (this.clearPromise) return this.clearPromise;

    this.cacheGeneration += 1;
    this.ready.clear();
    for (const child of this.children) child.kill();
    const pending = [...this.pending.values()];
    const clear = (async () => {
      await Promise.allSettled(pending);
      await rm(this.cacheDirectory, { recursive: true, force: true });
    })();
    this.clearPromise = clear;
    try {
      await clear;
    } finally {
      if (this.clearPromise === clear) this.clearPromise = null;
    }
  }

  async serve(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    try {
      const url = new URL(request.url);
      const hash = url.pathname.slice(1);
      if (
        url.protocol !== "osu-media:" ||
        url.host !== "video-cache" ||
        url.username ||
        url.password ||
        url.search ||
        !isAssetHash(hash)
      )
        return new Response(null, { status: 400 });
      const converted = this.ready.get(hash.toLowerCase());
      if (!converted) return new Response(null, { status: 404 });
      return streamMediaFile(
        request,
        converted.filename,
        converted.size,
        "video/mp4",
      );
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  dispose(): void {
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}
