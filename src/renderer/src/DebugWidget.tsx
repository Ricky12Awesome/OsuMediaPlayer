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
  encodedVideo?: DebugMediaInfo | null;
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

function formatFrameRate(value: unknown): string | null {
  let frameRate: number | null = null;

  if (typeof value === "number") {
    frameRate = Number.isFinite(value) ? value : null;
  } else if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    // Accept ffprobe's fraction format as well as the normalized number sent
    // by the main process.
    const [numeratorText, denominatorText] = text.split("/");
    const numerator = Number(numeratorText);
    const denominator =
      denominatorText === undefined ? 1 : Number(denominatorText);
    if (
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator > 0
    ) {
      frameRate = numerator / denominator;
    } else {
      return text;
    }
  }

  if (frameRate === null || !Number.isFinite(frameRate) || frameRate < 0)
    return null;

  return frameRate.toFixed(2).replace(/\.?(0+)$/, "");
}

function formatVideoResolution(
  value: unknown,
  framerate: unknown,
): string | null {
  const resolution = formatResolution(value);
  const fps = formatFrameRate(framerate);
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
  const encodedVideo = data.encodedVideo;
  const rows: DebugRow[] = [
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
  if (encodedVideo) {
    rows.push(
      { label: "encoded name", value: encodedVideo.name },
      { label: "encoded path", value: encodedVideo.path },
      { label: "encoded video codec", value: encodedVideo.codec },
      {
        label: "encoded video bitrate",
        value: encodedVideo.bitrate,
        format: formatBitrate,
      },
      {
        label: "encoded resolution",
        value: encodedVideo.resolution,
        format: (value) => formatVideoResolution(value, encodedVideo.frameRate),
      },
    );
  }
  return rows;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (window.playerAPI?.copyText) {
      await window.playerAPI.copyText(value);
      return true;
    }
  } catch {
    // Fall back to the browser clipboard APIs when native copying is unavailable.
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to the legacy copy command when the Clipboard API is
    // unavailable or denied by the renderer's security context.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // Clipboard access can be unavailable in a browser preview or while the
    // Electron window is closing. The widget remains usable in either case.
  }
  textarea.remove();
  return copied;
}

export function DebugWidget({ data }: DebugWidgetProps) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const rows = rowsFor(data ?? {});

  return (
    <div
      className="debug-widget"
      data-testid="debug-widget"
      aria-label="Debug metadata"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
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
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void copyText(value).then((copiedToClipboard) => {
                  if (!copiedToClipboard) return;
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
