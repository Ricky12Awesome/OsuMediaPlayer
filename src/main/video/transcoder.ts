import { type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type {
  VideoEncodingSettings,
  VideoEncodingStatus,
  PreparedVideo,
} from "../../shared/types";
import type { SongListIndex } from "../song-list/index";
import { isAssetHash, resolveMediaFile } from "../media";
import {
  ffprobeFor,
  fileHasContents,
  runProcess,
  type ProcessResult,
} from "./process";
import { VideoCache, type StreamMetadata } from "./cache";
import { convertedVideoUrl, playlistName, serveHlsRequest } from "./hls";
import {
  cacheLimitBytes,
  encodingProfile,
  encoderArguments,
  hlsOutputArguments,
  normalizeVideoEncodingSettings,
  orderedVideoEncoders,
  parseAvailableVideoEncoders,
  selectedCodec,
  type CacheManifest,
  videoEncodingProfileHash,
} from "./encoding";

export { convertedVideoUrl } from "./hls";
export {
  orderedVideoEncoders,
  parseAvailableVideoEncoders,
  videoEncodingProfileHash,
} from "./encoding";
export type { VideoEncoderChoice } from "./encoding";

const directlyPlayableExtensions = new Set([".mp4", ".m4v", ".webm"]);
const streamDirectoryName = "stream";
const streamMetadataName = "stream.json";
const videoEncodingSupersededMessage = "Video encoding was superseded.";

class VideoEncodingSupersededError extends Error {
  constructor() {
    super(videoEncodingSupersededMessage);
    this.name = "VideoEncodingSupersededError";
  }
}

export const videoNeedsConversion = (filename: string): boolean =>
  !directlyPlayableExtensions.has(extname(filename).toLocaleLowerCase());

function hashFromAssetUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hash = url.pathname.slice(1);
    return url.protocol === "omp:" &&
      url.host === "asset" &&
      !url.search &&
      isAssetHash(hash)
      ? hash.toLowerCase()
      : null;
  } catch {
    return null;
  }
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
  private readonly cache: VideoCache;
  private readonly children = new Set<ChildProcess>();
  private active: EncodingSession | null = null;
  private encoderNames: Promise<Set<string>> | null = null;
  private transition: Promise<void> = Promise.resolve();
  private pendingCleanupHash: string | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cacheGeneration = 0;
  private clearPromise: Promise<void> | null = null;
  private requestVersion = 0;
  private readonly timingChecks = new Map<string, Promise<boolean>>();

  constructor(
    private readonly cacheDirectory: string,
    private readonly executable = process.env.FFMPEG_PATH || "ffmpeg",
    private readonly onStatus?: (status: VideoEncodingStatus) => void,
  ) {
    this.cache = new VideoCache(cacheDirectory);
  }

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

  /** Return the converted file or active HLS playlist served to the player. */
  async playbackFilename(
    hash: string,
    source: "Cache" | "HLS",
  ): Promise<string | null> {
    if (source === "Cache")
      return this.cache.ready.get(hash.toLowerCase())?.filename ?? null;
    const stream = await this.cache.readStreamMetadata();
    return stream?.hash === hash.toLowerCase() &&
      (await fileHasContents(this.playlist))
      ? this.playlist
      : null;
  }

  async playbackCodec(
    hash: string,
    source: "Cache" | "HLS",
  ): Promise<string | null> {
    const filename = await this.playbackFilename(hash, source);
    let encoder: string | undefined;
    if (source === "Cache") {
      encoder = (await this.cache.readCacheManifest(hash))?.encoder;
    } else {
      const stream = await this.cache.readStreamMetadata();
      encoder = stream?.encoder;
    }
    if (!filename) return null;
    const codec = (await this.probeSource(filename)).codec;
    if (codec) return codec;
    const normalized = encoder?.toLowerCase() ?? "";
    if (normalized.includes("av1")) return "av1";
    if (normalized.includes("hevc") || normalized.includes("265"))
      return "hevc";
    if (normalized.includes("264") || normalized.includes("x264"))
      return "h264";
    return null;
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
    songList: SongListIndex | null,
    songId: string,
    inputSettings?: VideoEncodingSettings,
  ): Promise<PreparedVideo | null> {
    if (this.clearPromise) await this.clearPromise;
    const requestVersion = ++this.requestVersion;
    const song = songList?.getSong(songId);
    if (!songList || !song?.videoUrl) return null;
    const hash = hashFromAssetUrl(song.videoUrl);
    if (!hash) return null;
    const asset = songList.assets.get(hash);
    if (!asset) return null;
    const settings = normalizeVideoEncodingSettings(inputSettings);
    const direct = !videoNeedsConversion(asset.filename);
    let source: Awaited<ReturnType<typeof resolveMediaFile>> = null;
    if (direct || settings.forceRemux) {
      try {
        source = await resolveMediaFile(songList, hash);
      } catch {
        // A cached conversion can still be used when the source is unavailable.
      }
    }
    const inspectTiming =
      (direct && /\.m(?:p4|4v)$/i.test(asset.filename)) || settings.forceRemux;
    const timingIssue =
      inspectTiming && source
        ? await this.needsTimestampRepair(hash, source.filename)
        : false;
    if (requestVersion !== this.requestVersion) return null;
    if (direct && !timingIssue) {
      await this.cancelEncoding();
      return { url: song.videoUrl, streaming: false };
    }
    const profileHash = videoEncodingProfileHash(settings);
    if (!source) {
      try {
        source = await resolveMediaFile(songList, hash);
      } catch {
        // A cached conversion or an already-running stream does not need the
        // original asset to be present.
      }
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
        const streamMetadata = await this.cache.readStreamMetadata();
        const streamHash = streamMetadata?.hash ?? null;
        const streamMatchesProfile =
          streamMetadata?.profileHash === profileHash;
        let cachedMatches =
          cacheLimitBytes(settings) !== 0 &&
          (await this.cache.rememberCached(hash, destination, profileHash));
        if (
          timingIssue &&
          cachedMatches &&
          (await this.cache.readCacheManifest(hash))?.timestampRepaired !== true
        ) {
          await this.cache.removeCached(hash, destination);
          cachedMatches = false;
        }
        if (cachedMatches) await this.cache.touchCached(destination);
        await this.cache.enforceCacheLimit(cacheLimitBytes(settings));
        if (cachedMatches && !this.cache.ready.has(hash)) cachedMatches = false;
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
            await this.cache.removeCached(hash, destination);
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

        const unrepairedStream =
          timingIssue && streamMetadata?.timestampRepaired !== true;
        if (streamHash === hash && streamMatchesProfile && !unrepairedStream) {
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
            streamHash !== hash || (streamMatchesProfile && !unrepairedStream),
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
          timingIssue,
        );
        return { ready: session.ready };
      });
      if (preparation.ready) await preparation.ready;
      if (requestVersion !== this.requestVersion)
        throw new VideoEncodingSupersededError();
      if (generation !== this.cacheGeneration)
        throw new Error("The video cache was cleared.");
      const converted = this.cache.ready.get(hash);
      const streamMetadata = await this.cache.readStreamMetadata();
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
      if (direct && timingIssue && requestVersion === this.requestVersion)
        return { url: song.videoUrl, streaming: false };
      throw error;
    }
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
    hasBFrames: number | null;
  }> {
    const { result } = runProcess(ffprobeFor(this.executable), [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,avg_frame_rate,r_frame_rate,duration,has_b_frames:format=duration",
      "-of",
      "json",
      filename,
    ]);
    const completed = await result;
    if (completed.code !== 0)
      return { codec: null, fps: null, duration: null, hasBFrames: null };
    try {
      const parsed = JSON.parse(completed.stdout) as {
        streams?: Array<{
          codec_name?: string;
          avg_frame_rate?: string;
          r_frame_rate?: string;
          duration?: string;
          has_b_frames?: number;
        }>;
        format?: { duration?: string };
      };
      const stream = parsed.streams?.[0];
      const fps =
        [stream?.avg_frame_rate, stream?.r_frame_rate]
          .map((value) => {
            const [numerator, denominator] = (value ?? "")
              .split("/")
              .map(Number);
            return numerator > 0 && denominator > 0
              ? numerator / denominator
              : null;
          })
          .find((value) => value !== null && Number.isFinite(value)) ?? null;
      const durationValue = Number(stream?.duration ?? parsed.format?.duration);
      return {
        codec: stream?.codec_name ?? null,
        fps,
        duration: Number.isFinite(durationValue) ? durationValue : null,
        hasBFrames:
          typeof stream?.has_b_frames === "number" ? stream.has_b_frames : null,
      };
    } catch {
      return { codec: null, fps: null, duration: null, hasBFrames: null };
    }
  }

  private needsTimestampRepair(
    hash: string,
    filename: string,
  ): Promise<boolean> {
    const existing = this.timingChecks.get(hash);
    if (existing) return existing;
    const check = this.detectTimestampIssue(filename).catch(() => false);
    this.timingChecks.set(hash, check);
    if (this.timingChecks.size > 128)
      this.timingChecks.delete(this.timingChecks.keys().next().value!);
    return check;
  }

  private async detectTimestampIssue(filename: string): Promise<boolean> {
    const source = await this.probeSource(filename);
    if (source.hasBFrames === null) return false;
    const intervals =
      source.duration && source.duration > 16
        ? `%+#64,${source.duration / 2}%+#64`
        : "%+#64";
    const { result } = runProcess(ffprobeFor(this.executable), [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-read_intervals",
      intervals,
      "-show_entries",
      "packet=pts,dts",
      "-of",
      "json",
      filename,
    ]);
    const completed = await result;
    if (completed.code !== 0) return false;
    const parsed = JSON.parse(completed.stdout) as {
      packets?: Array<{ pts?: number; dts?: number }>;
    };
    const packets = parsed.packets ?? [];
    if (
      source.hasBFrames > 0 &&
      packets.length >= 8 &&
      packets.every(
        (packet) => packet.pts === undefined || packet.pts === packet.dts,
      )
    )
      return true;
    if (
      source.hasBFrames !== 0 ||
      !source.duration ||
      packets[0]?.pts === undefined ||
      packets[0].pts >= 0
    )
      return false;

    const { result: frameResult } = runProcess(ffprobeFor(this.executable), [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-read_intervals",
      `${Math.max(0, source.duration - 8)}%+9`,
      "-show_entries",
      "frame=best_effort_timestamp",
      "-of",
      "json",
      filename,
    ]);
    const frames = await frameResult;
    if (frames.code !== 0) return false;
    const timestamps = (
      JSON.parse(frames.stdout) as {
        frames?: Array<{ best_effort_timestamp?: number }>;
      }
    ).frames?.map((frame) => frame.best_effort_timestamp);
    return Boolean(
      timestamps?.some(
        (timestamp, index) =>
          index > 0 &&
          timestamp !== undefined &&
          timestamps[index - 1] !== undefined &&
          timestamp <= timestamps[index - 1]!,
      ),
    );
  }

  private async startEncoding(
    hash: string,
    source: string,
    settings: VideoEncodingSettings,
    profileHash: string,
    generation: number,
    timingIssue: boolean,
  ): Promise<EncodingSession> {
    await mkdir(this.streamDirectory, { recursive: true });
    const metadata: StreamMetadata = {
      hash,
      profileHash,
      profile: encodingProfile(settings),
      cacheLimitBytes: cacheLimitBytes(settings),
      timestampRepaired: timingIssue,
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
      timingIssue,
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

  private async encodeToHls(
    session: EncodingSession,
    source: string,
    settings: VideoEncodingSettings,
    generation: number,
    resolveReady: () => void,
    rejectReady: (error: Error) => void,
    timingIssue: boolean,
  ): Promise<void> {
    let ready = false;
    const sourceInfo = await this.probeSource(source);
    const canKeepFrameRate =
      settings.maxFps === 0 ||
      (sourceInfo.fps !== null && sourceInfo.fps <= settings.maxFps + 0.01);
    const canRemux =
      settings.forceRemux &&
      !timingIssue &&
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
          ...hlsOutputArguments(this.streamDirectory, this.playlist),
        ],
      });
    }
    for (const encoder of encoders) {
      const options = encoderArguments(encoder, settings);
      attempts.push({
        label: encoder.name,
        args: [
          ...options.beforeInput,
          "-i",
          source,
          "-map",
          "0:v:0",
          "-vf",
          timingIssue && sourceInfo.fps
            ? `setpts=N/(${sourceInfo.fps}*TB),${options.filter}`
            : options.filter,
          "-c:v",
          encoder.name,
          ...options.output,
          "-force_key_frames",
          "expr:gte(t,n_forced*1)",
          ...hlsOutputArguments(this.streamDirectory, this.playlist),
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
          timestampRepaired: timingIssue,
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
    const metadata = await this.cache.readStreamMetadata();
    if (
      metadata?.hash !== hash ||
      !metadata.profileHash ||
      !metadata.profile ||
      !metadata.encoder ||
      metadata.cacheLimitBytes === 0
    )
      return false;
    const destination = join(this.cacheDirectory, `${hash}.mp4`);
    if (
      !(await this.cache.rememberCached(
        hash,
        destination,
        metadata.profileHash,
      ))
    ) {
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
          await this.cache.enforceCacheLimit(
            Math.max(0, metadata.cacheLimitBytes - converted.size),
          );
        await rename(temporary, destination);
        const manifest: CacheManifest = {
          hash,
          profileHash: metadata.profileHash,
          profile: metadata.profile,
          encoder: metadata.encoder,
          timestampRepaired: metadata.timestampRepaired,
        };
        await writeFile(
          this.cache.manifestFile(hash),
          JSON.stringify(manifest),
        );
        this.cache.ready.set(hash, {
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
    if ((await this.cache.readStreamHash()) !== hash) return;
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
    this.cache.ready.clear();
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

  async serve(request: Request): Promise<Response> {
    return serveHlsRequest(request, {
      streamDirectory: this.streamDirectory,
      playlist: this.playlist,
      ready: this.cache.ready,
      readStreamMetadata: () => this.cache.readStreamMetadata(),
      touchCached: (filename) => this.cache.touchCached(filename),
    });
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
