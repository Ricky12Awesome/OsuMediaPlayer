import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  VideoEncodingQuality,
  VideoEncodingSettings,
} from "../../shared/types";

export const encodingProfileVersion = 1;
export const bytesPerGiB = 1024 ** 3;
export const defaultVideoEncodingSettings: VideoEncodingSettings = {
  codec: "auto",
  quality: "medium",
  maxFps: 60,
  forceRemux: false,
  cacheLimitGb: 5,
};

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

export function normalizeVideoEncodingSettings(
  input: Partial<Record<keyof VideoEncodingSettings, unknown>> | undefined,
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
        : defaultVideoEncodingSettings.codec,
    quality:
      typeof quality === "string" && quality in qualityValues
        ? (quality as VideoEncodingQuality)
        : defaultVideoEncodingSettings.quality,
    maxFps:
      maxFps === 0 || maxFps === 24 || maxFps === 30 || maxFps === 60
        ? maxFps
        : defaultVideoEncodingSettings.maxFps,
    forceRemux:
      typeof input?.forceRemux === "boolean"
        ? input.forceRemux
        : defaultVideoEncodingSettings.forceRemux,
    cacheLimitGb:
      typeof input?.cacheLimitGb === "number" &&
      Number.isFinite(input.cacheLimitGb) &&
      (input.cacheLimitGb === -1 || input.cacheLimitGb >= 0)
        ? input.cacheLimitGb
        : defaultVideoEncodingSettings.cacheLimitGb,
  };
}

export interface EncodingProfile {
  encoderVersion: number;
  codec: VideoEncodingSettings["codec"];
  quality: VideoEncodingSettings["quality"];
  maxFps: VideoEncodingSettings["maxFps"];
  forceRemux: boolean;
}

export interface CacheManifest {
  hash: string;
  profileHash: string;
  profile: EncodingProfile;
  encoder: string;
  timestampRepaired?: boolean;
}

export function encodingProfile(
  settings: VideoEncodingSettings,
): EncodingProfile {
  return {
    encoderVersion: encodingProfileVersion,
    codec: settings.codec,
    quality: settings.quality,
    maxFps: settings.maxFps,
    forceRemux: settings.forceRemux,
  };
}

export function hashEncodingProfile(profile: EncodingProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

export function videoEncodingProfileHash(
  settings: VideoEncodingSettings,
): string {
  return hashEncodingProfile(encodingProfile(settings));
}

export function cacheLimitBytes(settings: VideoEncodingSettings): number {
  return settings.cacheLimitGb < 0
    ? -1
    : Math.floor(settings.cacheLimitGb * bytesPerGiB);
}

export function selectedCodec(
  codec: VideoEncodingSettings["codec"],
): "av1" | "hevc" | "h264" | null {
  if (codec === "h264-hardware" || codec === "h264-software") return "h264";
  return codec === "auto" ? null : codec;
}

export interface EncoderArguments {
  beforeInput: string[];
  output: string[];
  filter: string;
}

/** Build codec-specific ffmpeg flags without touching the filesystem. */
export function encoderArguments(
  encoder: VideoEncoderChoice,
  settings: VideoEncodingSettings,
): EncoderArguments {
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

export function hlsOutputArguments(
  streamDirectory: string,
  playlist: string,
): string[] {
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
    join(streamDirectory, "segment-%06d.m4s"),
    playlist,
  ];
}
