import { useState } from "react";

export type DebugVideoSource = "none" | "Original" | "Cache" | "HLS";

/** Metadata shown by the now-playing debug widget.
 *
 * The library only has a subset of these values available on Track today.
 * Keeping media metadata separate lets the main process add file and probe
 * details without making the normal track list payload larger.
 */
export interface DebugMediaInfo {
  name?: string | null;
  path?: string | null;
  hash?: string | null;
  fileSize?: number | string | null;
  resolution?: string | { width: number; height: number } | null;
  duration?: number | string | null;
  frameRate?: number | string | null;
  codec?: string | null;
  bitrate?: number | string | null;
  source?: DebugVideoSource | null;
}

export interface DebugWidgetData {
  onlineId?: number | string | null;
  md5Hash?: string | null;
  title?: string | null;
  titleUnicode?: string | null;
  artist?: string | null;
  artistUnicode?: string | null;
  tags?: string | string[] | null;
  audio?: DebugMediaInfo | null;
  background?: DebugMediaInfo | null;
  video?: DebugMediaInfo | null;
}

interface DebugWidgetProps {
  data: DebugWidgetData | null | undefined;
}

interface DebugRow {
  label: string;
  value: unknown;
  source?: DebugVideoSource | null;
  format?: (value: unknown) => string | null;
}

function textValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const result = value
      .filter((item) => typeof item === "string" || typeof item === "number")
      .join(" ");
    return result || null;
  }
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  return value.length ? value : null;
}

function formatFileSize(value: unknown): string | null {
  if (typeof value === "string") return value.length ? value : null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** unit;
  const decimals = unit === 0 || amount >= 100 ? 0 : 1;
  return `${amount.toFixed(decimals)} ${units[unit]}`;
}

function formatDuration(value: unknown): string | null {
  if (typeof value === "string") return value.length ? value : null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function formatBitrate(value: unknown): string | null {
  if (typeof value === "string") return value.length ? value : null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  // ffprobe reports bitrate in bits per second. Values below 1000 are useful
  // as-is for callers that already normalized them to kilobits per second.
  const kilobits = value >= 1000 ? value / 1000 : value;
  if (kilobits >= 1000) {
    const megabits = kilobits / 1000;
    return `${megabits.toFixed(megabits >= 10 ? 0 : 1)} Mbps`;
  }
  return `${kilobits.toFixed(kilobits >= 10 ? 0 : 1)} kbps`;
}

function formatResolution(value: unknown): string | null {
  const resolution =
    value && typeof value === "object" && "width" in value && "height" in value
      ? `${String(value.width)}x${String(value.height)}`
      : textValue(value);
  return resolution;
}

function formatVideoResolution(
  value: unknown,
  framerate: unknown,
): string | null {
  const resolution = formatResolution(value);
  const fps = textValue(framerate);
  if (!resolution) return null;
  return fps ? `${resolution}@${fps}` : resolution;
}

function sourceClass(source: DebugVideoSource | null | undefined): string {
  if (!source) return "";
  return ` debug-value-source-${source.toLowerCase()}`;
}

function rowsFor(data: DebugWidgetData): DebugRow[] {
  const audio = data.audio ?? {};
  const background = data.background ?? {};
  const video = data.video ?? {};
  return [
    { label: "online id", value: data.onlineId },
    { label: "md5hash", value: data.md5Hash },
    { label: "title", value: data.title },
    { label: "title unicode", value: data.titleUnicode },
    { label: "artist", value: data.artist },
    { label: "artist unicode", value: data.artistUnicode },
    { label: "tags", value: data.tags },
    { label: "audio name", value: audio.name },
    { label: "audio path", value: audio.path },
    { label: "audio hash", value: audio.hash },
    { label: "audio file size", value: audio.fileSize, format: formatFileSize },
    { label: "audio duration", value: audio.duration, format: formatDuration },
    { label: "background name", value: background.name },
    { label: "background path", value: background.path },
    { label: "background hash", value: background.hash },
    {
      label: "background resolution",
      value: background.resolution,
      format: formatResolution,
    },
    {
      label: "background file size",
      value: background.fileSize,
      format: formatFileSize,
    },
    { label: "video name", value: video.name },
    { label: "video path", value: video.path },
    { label: "video hash", value: video.hash },
    { label: "video file size", value: video.fileSize, format: formatFileSize },
    {
      label: "video resolution@framerate",
      value: video.resolution,
      format: (value) => formatVideoResolution(value, video.frameRate),
    },
    { label: "video duration", value: video.duration, format: formatDuration },
    { label: "video codec", value: video.codec },
    { label: "video bitrate", value: video.bitrate, format: formatBitrate },
    {
      label: "video source",
      value: video.source === "none" ? null : video.source,
      source: video.source,
    },
  ];
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {
    // Clipboard access can be unavailable in a browser preview or while the
    // Electron window is closing. The widget remains usable in either case.
  }
}

export function DebugWidget({ data }: DebugWidgetProps) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const rows = rowsFor(data ?? {});

  return (
    <div
      className="debug-widget"
      data-testid="debug-widget"
      aria-label="Debug metadata"
    >
      {rows.map((row) => {
        const displayValue = row.format
          ? row.format(row.value)
          : textValue(row.value);
        const missing = displayValue === null;
        const value = displayValue ?? "none";
        const copied = copiedLabel === row.label;
        return (
          <div className="debug-widget-row" key={row.label}>
            <span className="debug-widget-key">{row.label}:</span>
            <button
              type="button"
              className={
                "debug-widget-value" +
                (missing ? " is-none" : "") +
                (copied ? " is-copied" : "") +
                sourceClass(row.source)
              }
              title={copied ? "Copied" : `Copy ${row.label}`}
              aria-label={`Copy ${row.label}`}
              onClick={() => {
                void copyText(value).then(() => {
                  setCopiedLabel(row.label);
                  window.setTimeout(() => {
                    setCopiedLabel((current) =>
                      current === row.label ? null : current,
                    );
                  }, 900);
                });
              }}
            >
              {value}
            </button>
          </div>
        );
      })}
    </div>
  );
}
