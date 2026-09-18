import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type {
  VideoEncodingQuality,
  VideoEncodingSettings,
  VideoEncodingStatus,
  PreparedVideo,
} from "../shared/types";
import type { LibraryIndex } from "./library";
import { isAssetHash, resolveMediaFile, streamMediaFile } from "./media";

const directlyPlayableExtensions = new Set([".mp4", ".m4v", ".webm"]);
const streamDirectoryName = "stream";
const streamMetadataName = "stream.json";
const playlistName = "playlist.m3u8";
const encodingProfileVersion = 1;
const bytesPerGiB = 1024 ** 3;
const defaultSettings: VideoEncodingSettings = {
  codec: "auto",
  quality: "medium",
  maxFps: 60,
  forceRemux: false,
  cacheLimitGb: 5,
};
const videoEncodingSupersededMessage = "Video encoding was superseded.";

class VideoEncodingSupersededError extends Error {
  constructor() {
    super(videoEncodingSupersededMessage);
    this.name = "VideoEncodingSupersededError";
  }
}

const qualityValues: Record<
  VideoEncodingQuality,
  { crf: number; hardwareQp: number; videotoolbox: number }
> = {
  "very-low": { crf: 35, hardwareQp: 40, videotoolbox: 25 },
  low: { crf: 29, hardwareQp: 34, videotoolbox: 40 },
  medium: { crf: 23, hardwareQp: 28, videotoolbox: 55 },
  high: { crf: 19, hardwareQp: 22, videotoolbox: 70 },
  "very-high": { crf: 16, hardwareQp: 17, videotoolbox: 85 },
};

type EncoderFamily =
  "nvenc" | "qsv" | "amf" | "videotoolbox" | "vaapi" | "software";

export interface VideoEncoderChoice {
  name: string;
  codec: "av1" | "hevc" | "h264";
  hardware: boolean;
  family: EncoderFamily;
}

const encoderPriority: VideoEncoderChoice[] = [
  { name: "av1_nvenc", codec: "av1", hardware: true, family: "nvenc" },
  { name: "av1_qsv", codec: "av1", hardware: true, family: "qsv" },
  { name: "av1_amf", codec: "av1", hardware: true, family: "amf" },
  {
    name: "av1_videotoolbox",
    codec: "av1",
    hardware: true,
    family: "videotoolbox",
  },
  { name: "av1_vaapi", codec: "av1", hardware: true, family: "vaapi" },
  { name: "hevc_nvenc", codec: "hevc", hardware: true, family: "nvenc" },
  { name: "hevc_qsv", codec: "hevc", hardware: true, family: "qsv" },
  { name: "hevc_amf", codec: "hevc", hardware: true, family: "amf" },
  {
    name: "hevc_videotoolbox",
    codec: "hevc",
    hardware: true,
    family: "videotoolbox",
  },
  { name: "hevc_vaapi", codec: "hevc", hardware: true, family: "vaapi" },
  { name: "h264_nvenc", codec: "h264", hardware: true, family: "nvenc" },
  { name: "h264_qsv", codec: "h264", hardware: true, family: "qsv" },
  { name: "h264_amf", codec: "h264", hardware: true, family: "amf" },
  {
    name: "h264_videotoolbox",
    codec: "h264",
    hardware: true,
    family: "videotoolbox",
  },
  { name: "h264_vaapi", codec: "h264", hardware: true, family: "vaapi" },
  { name: "libx264", codec: "h264", hardware: false, family: "software" },
];

export function parseAvailableVideoEncoders(output: string): Set<string> {
  const available = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*V[.A-Z]{5}\s+(\S+)/i);
    if (match?.[1]) available.add(match[1]);
  }
  return available;
}

export function orderedVideoEncoders(
  available: ReadonlySet<string>,
): VideoEncoderChoice[] {
  return encoderPriority.filter((encoder) => available.has(encoder.name));
}

export const videoNeedsConversion = (filename: string): boolean =>
  !directlyPlayableExtensions.has(extname(filename).toLocaleLowerCase());

export const convertedVideoUrl = (
  hash: string,
  profileHash?: string,
): string => {
  const base = `osu-media://video-cache/${hash.toLowerCase()}`;
  return profileHash
    ? `${base}?profile=${encodeURIComponent(profileHash.toLowerCase())}`
    : base;
};

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

function normalizeSettings(
  input: VideoEncodingSettings | undefined,
): VideoEncodingSettings {
  const quality = input?.quality;
  const codec = input?.codec;
  const maxFps = input?.maxFps;
  return {
    codec:
      codec === "auto" ||
      codec === "av1" ||
      codec === "hevc" ||
      codec === "h264-hardware" ||
      codec === "h264-software"
        ? codec
        : defaultSettings.codec,
    quality:
      quality && quality in qualityValues ? quality : defaultSettings.quality,
    maxFps:
      maxFps === 0 || maxFps === 24 || maxFps === 30 || maxFps === 60
        ? maxFps
        : defaultSettings.maxFps,
    forceRemux:
      typeof input?.forceRemux === "boolean"
        ? input.forceRemux
        : defaultSettings.forceRemux,
    cacheLimitGb:
      typeof input?.cacheLimitGb === "number" &&
      Number.isFinite(input.cacheLimitGb) &&
      (input.cacheLimitGb === -1 || input.cacheLimitGb >= 0)
        ? input.cacheLimitGb
        : defaultSettings.cacheLimitGb,
  };
}

interface EncodingProfile {
  encoderVersion: number;
  codec: VideoEncodingSettings["codec"];
  quality: VideoEncodingSettings["quality"];
  maxFps: VideoEncodingSettings["maxFps"];
  forceRemux: boolean;
}

interface CacheManifest {
  hash: string;
  profileHash: string;
  profile: EncodingProfile;
  encoder: string;
}

function encodingProfile(settings: VideoEncodingSettings): EncodingProfile {
  return {
    encoderVersion: encodingProfileVersion,
    codec: settings.codec,
    quality: settings.quality,
    maxFps: settings.maxFps,
    forceRemux: settings.forceRemux,
  };
}

export function videoEncodingProfileHash(
  settings: VideoEncodingSettings,
): string {
  return hashEncodingProfile(encodingProfile(settings));
}

function hashEncodingProfile(profile: EncodingProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

function cacheLimitBytes(settings: VideoEncodingSettings): number {
  return settings.cacheLimitGb < 0
    ? -1
    : Math.floor(settings.cacheLimitGb * bytesPerGiB);
}

function selectedCodec(
  codec: VideoEncodingSettings["codec"],
): "av1" | "hevc" | "h264" | null {
  if (codec === "h264-hardware" || codec === "h264-software") return "h264";
  return codec === "auto" ? null : codec;
}

function ffprobeFor(ffmpeg: string): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const filename = basename(ffmpeg);
  if (!/^ffmpeg(?:\.exe)?$/i.test(filename)) return "ffprobe";
  const probe = filename.toLowerCase().endsWith(".exe")
    ? "ffprobe.exe"
    : "ffprobe";
  return dirname(ffmpeg) === "." ? probe : join(dirname(ffmpeg), probe);
}

type ProcessResult = {
  code: number | null;
  error?: Error;
  stderr: string;
  stdout: string;
};

function runProcess(
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
    onStdout?.(chunk.toString());
    if (stdout.length < 1_000_000)
      stdout += chunk.toString().slice(0, 1_000_000 - stdout.length);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 32_768)
      stderr += chunk.toString().slice(0, 32_768 - stderr.length);
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

async function fileHasContents(filename: string): Promise<boolean> {
  try {
    const info = await stat(filename);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

interface StreamMetadata {
  hash: string;
  profileHash?: string;
  profile?: EncodingProfile;
  cacheLimitBytes?: number;
  encoder?: string;
}

interface EncodingSession {
  hash: string;
  child: ChildProcess | null;
  cancelled: boolean;
  encoding: boolean;
  encoder: string | null;
  progress: number | null;
  profileHash: string;
  settings: VideoEncodingSettings;
  ready: Promise<void>;
  done: Promise<void>;
}

export class VideoTranscoder {
  private readonly ready = new Map<
    string,
    { filename: string; size: number; profileHash: string }
  >();
  private readonly children = new Set<ChildProcess>();
  private active: EncodingSession | null = null;
  private encoderNames: Promise<Set<string>> | null = null;
  private transition: Promise<void> = Promise.resolve();
  private pendingCleanupHash: string | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cacheGeneration = 0;
  private clearPromise: Promise<void> | null = null;
  private requestVersion = 0;

  constructor(
    private readonly cacheDirectory: string,
    private readonly executable = process.env.FFMPEG_PATH || "ffmpeg",
    private readonly onStatus?: (status: VideoEncodingStatus) => void,
  ) {}

  get encodingStatus(): VideoEncodingStatus | null {
    return this.active?.encoding
      ? {
          hash: this.active.hash,
          encoding: true,
          ...(this.active.encoder
            ? {
                encoder: this.active.encoder,
                progress: this.active.progress ?? undefined,
              }
            : {}),
        }
      : null;
  }

  private get streamDirectory(): string {
    return join(this.cacheDirectory, streamDirectoryName);
  }

  private get playlist(): string {
    return join(this.streamDirectory, playlistName);
  }

  private get metadataFile(): string {
    return join(this.cacheDirectory, streamMetadataName);
  }

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.transition;
    let release!: () => void;
    this.transition = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async prepare(
    library: LibraryIndex | null,
    trackId: string,
    inputSettings?: VideoEncodingSettings,
  ): Promise<PreparedVideo | null> {
    if (this.clearPromise) await this.clearPromise;
    const requestVersion = ++this.requestVersion;
    const track = library?.getTrack(trackId);
    if (!library || !track?.videoUrl) return null;
    const hash = hashFromAssetUrl(track.videoUrl);
    if (!hash) return null;
    const asset = library.assets.get(hash);
    if (!asset) return null;
    if (!videoNeedsConversion(asset.filename)) {
      await this.cancelEncoding();
      return { url: track.videoUrl, streaming: false };
    }
    const settings = normalizeSettings(inputSettings);
    const profileHash = videoEncodingProfileHash(settings);
    let source: Awaited<ReturnType<typeof resolveMediaFile>> = null;
    try {
      source = await resolveMediaFile(library, hash);
    } catch {
      // A cached conversion or an already-running stream does not need the
      // original asset to be present.
    }

    const generation = this.cacheGeneration;
    try {
      const preparation = await this.locked(async () => {
        if (requestVersion !== this.requestVersion)
          throw new VideoEncodingSupersededError();
        if (generation !== this.cacheGeneration)
          throw new Error("The video cache was cleared.");
        await mkdir(this.cacheDirectory, { recursive: true });
        const destination = join(this.cacheDirectory, `${hash}.mp4`);
        const streamMetadata = await this.readStreamMetadata();
        const streamHash = streamMetadata?.hash ?? null;
        const streamMatchesProfile =
          streamMetadata?.profileHash === profileHash;
        let cachedMatches =
          cacheLimitBytes(settings) !== 0 &&
          (await this.rememberCached(hash, destination, profileHash));
        if (cachedMatches) await this.touchCached(destination);
        await this.enforceCacheLimit(cacheLimitBytes(settings));
        if (cachedMatches && !this.ready.has(hash)) cachedMatches = false;
        if (cachedMatches) {
          const cachedInfo = await this.probeSource(destination);
          const sourceInfo = source
            ? await this.probeSource(source.filename)
            : { duration: null };
          const durationMismatch =
            cachedInfo.duration !== null &&
            sourceInfo.duration !== null &&
            cachedInfo.duration + 2 < sourceInfo.duration;
          if (durationMismatch) {
            await this.removeCached(hash, destination);
            cachedMatches = false;
          }
        }
        if (cachedMatches) {
          if (
            streamHash === hash &&
            !(this.active?.hash === hash && this.active.encoding)
          )
            await this.removeStreamFiles(hash);
          if (requestVersion !== this.requestVersion)
            throw new VideoEncodingSupersededError();
          return { ready: null as Promise<void> | null };
        }

        if (streamHash === hash && streamMatchesProfile) {
          if (requestVersion !== this.requestVersion)
            throw new VideoEncodingSupersededError();
          if (this.active?.hash === hash) return { ready: this.active.ready };
          if (await fileHasContents(this.playlist)) {
            if (requestVersion !== this.requestVersion)
              throw new VideoEncodingSupersededError();
            return { ready: null as Promise<void> | null };
          }
        }
        if (streamHash)
          await this.rotateStream(
            streamHash,
            generation,
            streamHash !== hash || streamMatchesProfile,
          );

        if (requestVersion !== this.requestVersion)
          throw new VideoEncodingSupersededError();
        if (!source)
          throw new Error("The beatmap video file could not be found.");
        if (generation !== this.cacheGeneration)
          throw new Error("The video cache was cleared.");
        const session = await this.startEncoding(
          hash,
          source.filename,
          settings,
          profileHash,
          generation,
        );
        return { ready: session.ready };
      });
      if (preparation.ready) await preparation.ready;
      if (requestVersion !== this.requestVersion)
        throw new VideoEncodingSupersededError();
      if (generation !== this.cacheGeneration)
        throw new Error("The video cache was cleared.");
      const converted = this.ready.get(hash);
      const streamMetadata = await this.readStreamMetadata();
      const streaming =
        converted?.profileHash !== profileHash &&
        streamMetadata?.hash === hash &&
        streamMetadata.profileHash === profileHash;
      if (requestVersion !== this.requestVersion)
        throw new VideoEncodingSupersededError();
      return {
        url: convertedVideoUrl(hash, profileHash),
        streaming,
      };
    } catch (error) {
      if (error instanceof VideoEncodingSupersededError) return null;
      throw error;
    }
  }

  private async rememberCached(
    hash: string,
    filename: string,
    profileHash: string,
  ): Promise<boolean> {
    try {
      const [cached, manifest] = await Promise.all([
        stat(filename),
        this.readCacheManifest(hash),
      ]);
      if (
        !cached.isFile() ||
        cached.size === 0 ||
        manifest?.hash !== hash ||
        manifest.profileHash !== profileHash ||
        hashEncodingProfile(manifest.profile) !== manifest.profileHash
      ) {
        await this.removeCached(hash, filename);
        return false;
      }
      this.ready.set(hash, { filename, size: cached.size, profileHash });
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      await rm(this.manifestFile(hash), { force: true });
      return false;
    }
  }

  private manifestFile(hash: string): string {
    return join(this.cacheDirectory, `${hash}.manifest.json`);
  }

  private async readCacheManifest(hash: string): Promise<CacheManifest | null> {
    try {
      const parsed = JSON.parse(
        await readFile(this.manifestFile(hash), "utf8"),
      ) as Partial<CacheManifest>;
      return typeof parsed.hash === "string" &&
        typeof parsed.profileHash === "string" &&
        typeof parsed.encoder === "string" &&
        parsed.profile &&
        typeof parsed.profile === "object"
        ? (parsed as CacheManifest)
        : null;
    } catch {
      return null;
    }
  }

  private async removeCached(hash: string, filename?: string): Promise<void> {
    this.ready.delete(hash);
    await Promise.all([
      rm(filename ?? join(this.cacheDirectory, `${hash}.mp4`), { force: true }),
      rm(this.manifestFile(hash), { force: true }),
    ]);
  }

  private async touchCached(filename: string): Promise<void> {
    const now = new Date();
    await utimes(filename, now, now).catch(() => {});
  }

  private async enforceCacheLimit(limit: number): Promise<void> {
    if (limit < 0) return;
    let entries;
    try {
      entries = await readdir(this.cacheDirectory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }
    const cached = await Promise.all(
      entries
        .filter(
          (entry) => entry.isFile() && /^[0-9a-f]{64}\.mp4$/i.test(entry.name),
        )
        .map(async (entry) => {
          const hash = entry.name.slice(0, 64).toLowerCase();
          const filename = join(this.cacheDirectory, entry.name);
          const info = await stat(filename);
          return { hash, filename, size: info.size, usedAt: info.mtimeMs };
        }),
    );
    let total = cached.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of cached.sort((a, b) => a.usedAt - b.usedAt)) {
      if (total <= limit) break;
      await this.removeCached(entry.hash, entry.filename);
      total -= entry.size;
    }
  }

  private async readStreamMetadata(): Promise<StreamMetadata | null> {
    try {
      const parsed = JSON.parse(
        await readFile(this.metadataFile, "utf8"),
      ) as Partial<StreamMetadata>;
      if (typeof parsed.hash !== "string" || !isAssetHash(parsed.hash))
        return null;
      return { ...parsed, hash: parsed.hash.toLowerCase() } as StreamMetadata;
    } catch {
      return null;
    }
  }

  private async readStreamHash(): Promise<string | null> {
    return (await this.readStreamMetadata())?.hash ?? null;
  }

  private async availableEncoders(): Promise<Set<string>> {
    if (!this.encoderNames) {
      this.encoderNames = (async () => {
        const { result } = runProcess(this.executable, [
          "-hide_banner",
          "-encoders",
        ]);
        const completed = await result;
        if (completed.error) {
          const unavailable =
            (completed.error as NodeJS.ErrnoException).code === "ENOENT";
          throw new Error(
            unavailable
              ? "FFmpeg is required to play this video. Install ffmpeg or set FFMPEG_PATH."
              : `Could not start FFmpeg: ${completed.error.message}`,
          );
        }
        return parseAvailableVideoEncoders(completed.stdout + completed.stderr);
      })();
    }
    return this.encoderNames;
  }

  private async probeSource(filename: string): Promise<{
    codec: string | null;
    fps: number | null;
    duration: number | null;
  }> {
    const { result } = runProcess(ffprobeFor(this.executable), [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,avg_frame_rate,duration:format=duration",
      "-of",
      "json",
      filename,
    ]);
    const completed = await result;
    if (completed.code !== 0) return { codec: null, fps: null, duration: null };
    try {
      const parsed = JSON.parse(completed.stdout) as {
        streams?: Array<{
          codec_name?: string;
          avg_frame_rate?: string;
          duration?: string;
        }>;
        format?: { duration?: string };
      };
      const stream = parsed.streams?.[0];
      const [numerator, denominator] = (stream?.avg_frame_rate ?? "")
        .split("/")
        .map(Number);
      const fps =
        denominator > 0 && Number.isFinite(numerator / denominator)
          ? numerator / denominator
          : null;
      const durationValue = Number(stream?.duration ?? parsed.format?.duration);
      return {
        codec: stream?.codec_name ?? null,
        fps,
        duration: Number.isFinite(durationValue) ? durationValue : null,
      };
    } catch {
      return { codec: null, fps: null, duration: null };
    }
  }

  private async startEncoding(
    hash: string,
    source: string,
    settings: VideoEncodingSettings,
    profileHash: string,
    generation: number,
  ): Promise<EncodingSession> {
    await mkdir(this.streamDirectory, { recursive: true });
    const metadata: StreamMetadata = {
      hash,
      profileHash,
      profile: encodingProfile(settings),
      cacheLimitBytes: cacheLimitBytes(settings),
    };
    await writeFile(this.metadataFile, JSON.stringify(metadata));

    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const session: EncodingSession = {
      hash,
      child: null,
      cancelled: false,
      encoding: true,
      encoder: null,
      progress: 0,
      profileHash,
      settings,
      ready,
      done: Promise.resolve(),
    };
    this.active = session;
    this.emitEncodingStatus(session);
    let finalized = false;
    session.done = this.encodeToHls(
      session,
      source,
      settings,
      generation,
      resolveReady,
      rejectReady,
    )
      .then(async () => {
        if (session.cancelled || generation !== this.cacheGeneration) return;
        if (cacheLimitBytes(settings) !== 0)
          finalized = await this.finalizeStream(hash, generation, true);
      })
      .catch((error: unknown) => {
        rejectReady(
          error instanceof Error ? error : new Error("Video encoding failed."),
        );
      })
      .finally(async () => {
        session.encoding = false;
        session.child = null;
        if (
          this.active === session &&
          !(await fileHasContents(this.playlist))
        ) {
          this.active = null;
          await rm(this.streamDirectory, {
            recursive: true,
            force: true,
          });
          await rm(this.metadataFile, { force: true });
        }
        this.onStatus?.({
          hash,
          encoding: false,
          encoder: session.encoder ?? undefined,
          progress: session.progress ?? undefined,
          finalized,
        });
      });
    return session;
  }

  private emitEncodingStatus(session: EncodingSession): void {
    this.onStatus?.({
      hash: session.hash,
      encoding: true,
      encoder: session.encoder ?? undefined,
      progress: session.progress ?? undefined,
    });
  }

  private encoderArguments(
    encoder: VideoEncoderChoice,
    settings: VideoEncodingSettings,
  ): { beforeInput: string[]; output: string[]; filter: string } {
    const quality = qualityValues[settings.quality];
    const frameFilters = [
      ...(settings.maxFps ? [`fps=min(source_fps\\,${settings.maxFps})`] : []),
      "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    ];
    const beforeInput: string[] = [];
    let output: string[];
    if (encoder.family === "nvenc")
      output = [
        "-preset",
        "p4",
        "-cq:v",
        String(quality.hardwareQp),
        "-b:v",
        "0",
      ];
    else if (encoder.family === "qsv")
      output = [
        "-preset",
        "veryfast",
        "-global_quality:v",
        String(quality.hardwareQp),
      ];
    else if (encoder.family === "amf")
      output = [
        "-quality",
        "balanced",
        "-rc",
        "cqp",
        "-qp_i",
        String(quality.hardwareQp),
        "-qp_p",
        String(quality.hardwareQp),
      ];
    else if (encoder.family === "videotoolbox")
      output = ["-q:v", String(quality.videotoolbox)];
    else if (encoder.family === "vaapi") {
      beforeInput.push("-vaapi_device", "/dev/dri/renderD128");
      frameFilters.push("format=nv12", "hwupload");
      output = ["-qp", String(quality.hardwareQp)];
    } else
      output = [
        "-preset",
        "veryfast",
        "-crf",
        String(quality.crf),
        "-pix_fmt",
        "yuv420p",
      ];
    const keyframeInterval = settings.maxFps === 24 ? 24 : 30;
    output.push(
      "-g",
      String(keyframeInterval),
      "-keyint_min",
      String(keyframeInterval),
    );
    if (encoder.family === "nvenc") output.push("-forced-idr", "1");
    if (encoder.codec === "hevc") output.push("-tag:v", "hvc1");
    return { beforeInput, output, filter: frameFilters.join(",") };
  }

  private hlsOutputArguments(): string[] {
    return [
      "-an",
      "-f",
      "hls",
      "-hls_time",
      "1",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "event",
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      "init.mp4",
      "-hls_segment_filename",
      join(this.streamDirectory, "segment-%06d.m4s"),
      this.playlist,
    ];
  }

  private async encodeToHls(
    session: EncodingSession,
    source: string,
    settings: VideoEncodingSettings,
    generation: number,
    resolveReady: () => void,
    rejectReady: (error: Error) => void,
  ): Promise<void> {
    let ready = false;
    const sourceInfo = await this.probeSource(source);
    const canKeepFrameRate =
      settings.maxFps === 0 ||
      (sourceInfo.fps !== null && sourceInfo.fps <= settings.maxFps + 0.01);
    const canRemux =
      settings.forceRemux &&
      canKeepFrameRate &&
      sourceInfo.codec !== null &&
      new Set(["av1", "hevc", "h264"]).has(sourceInfo.codec) &&
      (!selectedCodec(settings.codec) ||
        selectedCodec(settings.codec) === sourceInfo.codec);
    const encoders = orderedVideoEncoders(
      await this.availableEncoders(),
    ).filter((encoder) => {
      if (settings.codec === "auto") return true;
      if (settings.codec === "h264-hardware")
        return encoder.codec === "h264" && encoder.hardware;
      if (settings.codec === "h264-software")
        return encoder.codec === "h264" && !encoder.hardware;
      return encoder.codec === settings.codec;
    });
    const attempts: Array<{ label: string; args: string[] }> = [];
    if (canRemux) {
      attempts.push({
        label: "stream copy",
        args: [
          "-i",
          source,
          "-map",
          "0:v:0",
          "-c:v",
          "copy",
          ...this.hlsOutputArguments(),
        ],
      });
    }
    for (const encoder of encoders) {
      const options = this.encoderArguments(encoder, settings);
      attempts.push({
        label: encoder.name,
        args: [
          ...options.beforeInput,
          "-i",
          source,
          "-map",
          "0:v:0",
          "-vf",
          options.filter,
          "-c:v",
          encoder.name,
          ...options.output,
          "-force_key_frames",
          "expr:gte(t,n_forced*1)",
          ...this.hlsOutputArguments(),
        ],
      });
    }
    if (!attempts.length)
      throw new Error("FFmpeg does not provide a supported video encoder.");

    const failures: string[] = [];
    for (const attempt of attempts) {
      if (session.cancelled || generation !== this.cacheGeneration) {
        rejectReady(new VideoEncodingSupersededError());
        return;
      }
      await this.removeHlsFiles();
      session.encoder = attempt.label;
      session.progress = 0;
      await writeFile(
        this.metadataFile,
        JSON.stringify({
          hash: session.hash,
          profileHash: session.profileHash,
          profile: encodingProfile(session.settings),
          cacheLimitBytes: cacheLimitBytes(session.settings),
          encoder: attempt.label,
        } satisfies StreamMetadata),
      );
      this.emitEncodingStatus(session);
      let progressOutput = "";
      let lastPercent = 0;
      const updateProgress = (chunk: string) => {
        if (!sourceInfo.duration || sourceInfo.duration <= 0) return;
        progressOutput += chunk;
        const lines = progressOutput.split(/\r?\n/);
        progressOutput = lines.pop() ?? "";
        for (const line of lines) {
          const match = line.match(/^out_time_(?:us|ms)=(\d+)$/);
          if (!match) continue;
          const elapsed = Number(match[1]) / 1_000_000;
          const progress = Math.max(
            0,
            Math.min(1, elapsed / sourceInfo.duration),
          );
          const percent = Math.floor(progress * 100);
          if (percent <= lastPercent) continue;
          lastPercent = percent;
          session.progress = progress;
          this.emitEncodingStatus(session);
        }
      };
      const { child, result } = runProcess(
        this.executable,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-progress",
          "pipe:1",
          "-nostats",
          "-y",
          ...attempt.args,
        ],
        this.children,
        updateProgress,
      );
      session.child = child;
      if (session.cancelled) child.kill("SIGTERM");
      let completed: ProcessResult;
      for (;;) {
        const state = await Promise.race([
          result.then((value) => ({ done: true as const, value })),
          new Promise<{ done: false }>((resolve) =>
            setTimeout(() => resolve({ done: false }), 75),
          ),
        ]);
        if (state.done) {
          completed = state.value;
          break;
        }
        if (!ready && (await fileHasContents(this.playlist))) {
          ready = true;
          resolveReady();
        }
      }
      session.child = null;
      if (session.cancelled || generation !== this.cacheGeneration) {
        rejectReady(new VideoEncodingSupersededError());
        return;
      }
      if (completed.code === 0) {
        if (!ready && (await fileHasContents(this.playlist))) {
          ready = true;
          resolveReady();
        }
        if (!ready) throw new Error("FFmpeg did not produce an HLS playlist.");
        session.progress = 1;
        this.emitEncodingStatus(session);
        return;
      }
      const unavailable =
        completed.error &&
        (completed.error as NodeJS.ErrnoException).code === "ENOENT";
      if (unavailable)
        throw new Error(
          "FFmpeg is required to play this video. Install ffmpeg or set FFMPEG_PATH.",
        );
      failures.push(
        `${attempt.label}: ${
          completed.stderr.trim() || `FFmpeg exited with code ${completed.code}`
        }`,
      );
      // Continue with the next encoder. A partial playlist must never be
      // finalized into a seemingly valid but truncated cached video.
    }
    const detail = failures.at(-1);
    const error = new Error(detail || "FFmpeg could not encode this video.");
    rejectReady(error);
    throw error;
  }

  private async removeHlsFiles(): Promise<void> {
    await rm(this.streamDirectory, { recursive: true, force: true });
    await mkdir(this.streamDirectory, { recursive: true });
  }

  private async rotateStream(
    hash: string,
    generation: number,
    preserveInCache: boolean,
  ): Promise<void> {
    const session = this.active?.hash === hash ? this.active : null;
    if (session?.encoding) {
      session.cancelled = true;
      session.child?.kill("SIGTERM");
      await session.done;
    }
    if (generation !== this.cacheGeneration)
      throw new Error("The video cache was cleared.");
    const finalized =
      preserveInCache && (await this.finalizeStream(hash, generation, false));
    if (!finalized) await this.removeStreamFiles(hash);
  }

  private async finalizeStream(
    hash: string,
    generation: number,
    waitForRenderer: boolean,
  ): Promise<boolean> {
    if (
      generation !== this.cacheGeneration ||
      !(await fileHasContents(this.playlist))
    )
      return false;
    const metadata = await this.readStreamMetadata();
    if (
      metadata?.hash !== hash ||
      !metadata.profileHash ||
      !metadata.profile ||
      !metadata.encoder ||
      metadata.cacheLimitBytes === 0
    )
      return false;
    const destination = join(this.cacheDirectory, `${hash}.mp4`);
    if (!(await this.rememberCached(hash, destination, metadata.profileHash))) {
      const temporary = join(
        this.cacheDirectory,
        `${hash}.${process.pid}.${randomUUID()}.partial.mp4`,
      );
      try {
        const { result } = runProcess(
          this.executable,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            this.playlist,
            "-map",
            "0:v:0",
            "-an",
            "-c:v",
            "copy",
            "-movflags",
            "+faststart",
            temporary,
          ],
          this.children,
        );
        const completed = await result;
        if (completed.code !== 0)
          throw new Error(
            completed.stderr.trim() ||
              "Could not finalize the previous video stream.",
          );
        const converted = await stat(temporary);
        if (!converted.isFile() || converted.size === 0)
          throw new Error("FFmpeg did not finalize the previous video stream.");
        if (
          typeof metadata.cacheLimitBytes === "number" &&
          metadata.cacheLimitBytes >= 0 &&
          converted.size > metadata.cacheLimitBytes
        )
          return false;
        if (
          typeof metadata.cacheLimitBytes === "number" &&
          metadata.cacheLimitBytes >= 0
        )
          await this.enforceCacheLimit(
            Math.max(0, metadata.cacheLimitBytes - converted.size),
          );
        await rename(temporary, destination);
        const manifest: CacheManifest = {
          hash,
          profileHash: metadata.profileHash,
          profile: metadata.profile,
          encoder: metadata.encoder,
        };
        await writeFile(this.manifestFile(hash), JSON.stringify(manifest));
        this.ready.set(hash, {
          filename: destination,
          size: converted.size,
          profileHash: metadata.profileHash,
        });
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    }
    if (this.active?.hash === hash) this.active = null;
    if (waitForRenderer) this.deferStreamCleanup(hash);
    else await this.removeStreamFiles(hash);
    return true;
  }

  private deferStreamCleanup(hash: string): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.pendingCleanupHash = hash;
    this.cleanupTimer = setTimeout(() => {
      void this.locked(() => this.removeStreamFiles(hash));
    }, 15_000);
    this.cleanupTimer.unref();
  }

  private async removeStreamFiles(hash: string): Promise<void> {
    if (this.pendingCleanupHash === hash) {
      this.pendingCleanupHash = null;
      if (this.cleanupTimer) {
        clearTimeout(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    }
    if ((await this.readStreamHash()) !== hash) return;
    await rm(this.streamDirectory, { recursive: true, force: true });
    await rm(this.metadataFile, { force: true });
  }

  async completeStream(hash: string): Promise<void> {
    if (!isAssetHash(hash)) return;
    await this.locked(() => this.removeStreamFiles(hash.toLowerCase()));
  }

  async cancelEncoding(): Promise<void> {
    this.requestVersion += 1;
    await this.locked(async () => {
      const session = this.active;
      if (!session?.encoding) return;
      session.cancelled = true;
      session.child?.kill("SIGTERM");
      await session.done;
      if (this.active !== session) return;
      this.active = null;
      await this.removeStreamFiles(session.hash);
    });
  }

  async clearCache(): Promise<void> {
    if (this.clearPromise) return this.clearPromise;
    this.requestVersion += 1;
    this.cacheGeneration += 1;
    this.ready.clear();
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
    this.pendingCleanupHash = null;
    const clear = this.locked(async () => {
      if (this.active?.encoding) {
        this.active.cancelled = true;
        this.active.child?.kill("SIGTERM");
        await this.active.done;
      }
      this.active = null;
      for (const child of this.children) child.kill();
      await rm(this.cacheDirectory, { recursive: true, force: true });
    });
    this.clearPromise = clear;
    try {
      await clear;
    } finally {
      if (this.clearPromise === clear) this.clearPromise = null;
    }
  }

  private streamFileFromUrl(url: URL): string | null {
    if (
      [...url.searchParams.keys()].some(
        (key) => key !== "file" && key !== "profile",
      )
    )
      return null;
    const file = url.searchParams.get("file");
    if (!file) return playlistName;
    return file === "init.mp4" || /^segment-\d{6}\.m4s$/.test(file ?? "")
      ? file
      : null;
  }

  private async servePlaylist(
    request: Request,
    hash: string,
    profileHash: string | null,
  ): Promise<Response> {
    let playlist = await readFile(this.playlist, "utf8");
    const mediaUrl = (file: string) => {
      const url = new URL(convertedVideoUrl(hash, profileHash ?? undefined));
      url.searchParams.set("file", file);
      return url.toString();
    };
    playlist = playlist
      .replace(
        /URI="([^"]+)"/g,
        (_match, file: string) => `URI="${mediaUrl(file)}"`,
      )
      .split(/\r?\n/)
      .map((line) => (line && !line.startsWith("#") ? mediaUrl(line) : line))
      .join("\n");
    const body = Buffer.from(playlist);
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Content-Length": String(body.length),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  async serve(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    try {
      const url = new URL(request.url);
      const hash = url.pathname.slice(1).toLowerCase();
      if (
        url.protocol !== "osu-media:" ||
        url.host !== "video-cache" ||
        url.username ||
        url.password ||
        !isAssetHash(hash)
      )
        return new Response(null, { status: 400 });
      const requestedProfile = url.searchParams.get("profile");
      if (requestedProfile !== null && !isAssetHash(requestedProfile))
        return new Response(null, { status: 400 });
      const converted = this.ready.get(hash);
      const file = url.searchParams.get("file");
      if (
        converted &&
        !file &&
        requestedProfile === converted.profileHash &&
        [...url.searchParams.keys()].every((key) => key === "profile")
      ) {
        await this.touchCached(converted.filename);
        return streamMediaFile(
          request,
          converted.filename,
          converted.size,
          "video/mp4",
        );
      }

      const streamMetadata = await this.readStreamMetadata();
      const streamMatches =
        streamMetadata?.hash === hash &&
        (streamMetadata.profileHash
          ? requestedProfile === streamMetadata.profileHash
          : requestedProfile === null);
      if (!streamMatches) return new Response(null, { status: 404 });
      const streamFile = this.streamFileFromUrl(url);
      if (!streamFile) return new Response(null, { status: 400 });
      if (streamFile === playlistName)
        return await this.servePlaylist(request, hash, requestedProfile);
      const filename = join(this.streamDirectory, streamFile);
      const info = await stat(filename);
      if (!info.isFile()) return new Response(null, { status: 404 });
      const response = streamMediaFile(
        request,
        filename,
        info.size,
        "video/mp4",
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  dispose(): void {
    this.requestVersion += 1;
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
    if (this.active) this.active.cancelled = true;
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}
