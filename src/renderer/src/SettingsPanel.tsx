import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  FolderOpen,
  FolderHeart,
  LoaderCircle,
  PanelLeft,
  Palette,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { CacheKind, CacheUsage, LibrarySummary } from "../../shared/types";
import type { PlayerState } from "./usePlayer";
import { SettingsPicker } from "./SettingsPicker";
import type { VisualizerSettings } from "./visualizer-settings";

const videoCodecOptions = [
  { value: "auto", label: "Auto (best available)" },
  { value: "av1", label: "AV1" },
  { value: "hevc", label: "H.265 / HEVC" },
  { value: "h264-hardware", label: "H.264 (hardware)" },
  { value: "h264-software", label: "H.264 (software)" },
] as const;
const videoQualityOptions = [
  { value: "very-low", label: "Very low" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "very-high", label: "Very high" },
] as const;
const videoFpsOptions = [
  { value: 0, label: "No cap" },
  { value: 24, label: "24 FPS" },
  { value: 30, label: "30 FPS" },
  { value: 60, label: "60 FPS" },
] as const;

export type CacheNotice = {
  kind: "success" | "error";
  message: string;
};

export type LibraryPosition = "left" | "right";
export type TransportLayout = "controls-left" | "controls-centered";

export interface SettingsPanelProps {
  summary: LibrarySummary | null;
  importing: boolean;
  player: PlayerState;
  chooseLibrary: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  libraryPosition: LibraryPosition;
  setLibraryPosition: Dispatch<SetStateAction<LibraryPosition>>;
  transportLayout: TransportLayout;
  setTransportLayout: Dispatch<SetStateAction<TransportLayout>>;
  artworkThemeEnabled: boolean;
  setArtworkThemeEnabled: Dispatch<SetStateAction<boolean>>;
  showNowPlayingTitleArtist: boolean;
  setShowNowPlayingTitleArtist: Dispatch<SetStateAction<boolean>>;
  showTitleUnicode: boolean;
  setShowTitleUnicode: Dispatch<SetStateAction<boolean>>;
  showArtistUnicode: boolean;
  setShowArtistUnicode: Dispatch<SetStateAction<boolean>>;
  visualizer: VisualizerSettings;
  setVisualizer: (settings: VisualizerSettings) => void;
  clearingCache: CacheKind | null;
  cacheUsage: CacheUsage | null;
  cacheNotice: CacheNotice | null;
  requestCacheClear: (kind: CacheKind) => void;
  requestSettingsReset: () => void;
  cacheLimitWheelRemainder: RefObject<number>;
}

function cacheName(kind: CacheKind): string {
  return kind === "index" ? "Index cache" : "Video cache";
}

function formatCacheSize(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(unit === 0 || value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function SettingsPanel({
  summary,
  importing,
  player,
  chooseLibrary,
  refreshLibrary,
  libraryPosition,
  setLibraryPosition,
  transportLayout,
  setTransportLayout,
  artworkThemeEnabled,
  setArtworkThemeEnabled,
  showNowPlayingTitleArtist,
  setShowNowPlayingTitleArtist,
  showTitleUnicode,
  setShowTitleUnicode,
  showArtistUnicode,
  setShowArtistUnicode,
  visualizer,
  setVisualizer,
  clearingCache,
  cacheUsage,
  cacheNotice,
  requestCacheClear,
  requestSettingsReset,
  cacheLimitWheelRemainder,
}: SettingsPanelProps) {
  const settingsSwitch = (
    title: string,
    description: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <div className="settings-row">
      <span className="settings-row-label" title={description}>
        {title}
      </span>
      <button
        type="button"
        className={"settings-switch " + (active ? "active" : "")}
        aria-label={title}
        aria-pressed={active}
        title={description}
        onClick={onClick}
      >
        {active ? "On" : "Off"}
      </button>
    </div>
  );

  return (
    <>
      <div className="settings-block settings-library">
        <span className="settings-label">
          <FolderOpen size={16} /> OSU!LAZER LIBRARY
        </span>
        <div className="settings-row">
          <span className="settings-row-label">Folder</span>
          <span
            className="settings-row-value install-path"
            title={summary?.installPath || "Default osu!lazer installation"}
          >
            {summary?.installPath || "Default osu!lazer installation"}
          </span>
        </div>
        <div className="settings-actions">
          <button
            className="primary-button"
            onClick={() => void chooseLibrary()}
          >
            <FolderOpen size={15} /> Choose folder
          </button>
          <button
            className="secondary-button"
            disabled={importing}
            onClick={() => {
              void refreshLibrary();
            }}
          >
            <RefreshCw size={15} /> Refresh library
          </button>
        </div>
      </div>
      <div className="settings-block transport-layout-setting">
        <div className="settings-row">
          <span className="settings-row-label">
            <PanelLeft size={15} /> Panel
          </span>
          <div
            className="settings-choice-group"
            aria-label="Song list position"
          >
            <button
              type="button"
              className={
                "settings-choice-option " +
                (libraryPosition === "left" ? "active" : "")
              }
              aria-pressed={libraryPosition === "left"}
              title="Show the song list on the left"
              onClick={() => setLibraryPosition("left")}
            >
              Left
            </button>
            <button
              type="button"
              className={
                "settings-choice-option " +
                (libraryPosition === "right" ? "active" : "")
              }
              aria-pressed={libraryPosition === "right"}
              title="Show the song list on the right"
              onClick={() => setLibraryPosition("right")}
            >
              Right
            </button>
          </div>
        </div>
      </div>
      <div className="settings-block transport-layout-setting">
        <div className="settings-row">
          <span className="settings-row-label">
            <SlidersHorizontal size={15} /> Controls
          </span>
          <div className="settings-choice-group" aria-label="Bottom bar layout">
            <button
              type="button"
              className={
                "settings-choice-option " +
                (transportLayout === "controls-left" ? "active" : "")
              }
              aria-pressed={transportLayout === "controls-left"}
              title="Keep playback controls on the left"
              onClick={() => setTransportLayout("controls-left")}
            >
              Left
            </button>
            <button
              type="button"
              className={
                "settings-choice-option " +
                (transportLayout === "controls-centered" ? "active" : "")
              }
              aria-pressed={transportLayout === "controls-centered"}
              title="Center playback controls"
              onClick={() => setTransportLayout("controls-centered")}
            >
              Center
            </button>
          </div>
        </div>
      </div>
      <div className="settings-block artwork-theme-setting">
        <span className="settings-label">
          <Palette size={16} /> APPEARANCE
        </span>
        {settingsSwitch(
          "Show Videos",
          "Show beatmap videos when available; otherwise show the background art",
          player.playVideos,
          () => player.setPlayVideos((value) => !value),
        )}
        {settingsSwitch(
          "Dynamic Theme",
          "Theme the app background from the current song's artwork",
          artworkThemeEnabled,
          () => setArtworkThemeEnabled((value) => !value),
        )}
        {settingsSwitch(
          "Show title / artist",
          "Display track details over the artwork",
          showNowPlayingTitleArtist,
          () => setShowNowPlayingTitleArtist((value) => !value),
        )}
        {settingsSwitch(
          "Show title unicode",
          "Use a song's Unicode title when one is available",
          showTitleUnicode,
          () => setShowTitleUnicode((value) => !value),
        )}
        {settingsSwitch(
          "Show artist unicode",
          "Use a song's Unicode artist when one is available",
          showArtistUnicode,
          () => setShowArtistUnicode((value) => !value),
        )}
      </div>
      <div className="settings-block video-encoding-setting">
        <span className="settings-label">
          <SlidersHorizontal size={16} /> VIDEO ENCODING
        </span>
        <div className="settings-row">
          <span className="settings-row-label">Codec</span>
          <SettingsPicker
            label="Video codec"
            value={player.videoEncodingCodec}
            options={videoCodecOptions}
            onChange={player.setVideoEncodingCodec}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Quality</span>
          <SettingsPicker
            label="Video quality"
            value={player.videoEncodingQuality}
            options={videoQualityOptions}
            onChange={player.setVideoEncodingQuality}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">FPS Cap</span>
          <SettingsPicker
            label="Video FPS cap"
            value={player.videoMaxFps}
            options={videoFpsOptions}
            onChange={player.setVideoMaxFps}
          />
        </div>
        {settingsSwitch(
          "Force remux when possible",
          "Copy compatible video without re-encoding; automatically encode when copying is not supported",
          player.videoForceRemux,
          () => player.setVideoForceRemux((value) => !value),
        )}
        <div className="settings-row">
          <span
            className="settings-row-label"
            title="Converted-video cache size in GB. Use 0 for HLS streaming only or -1 for no limit."
          >
            Cache limit (GB)
          </span>
          <input
            className="settings-number-input"
            type="text"
            inputMode="decimal"
            value={player.videoCacheLimitGb}
            aria-label="Video cache limit in gigabytes"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value >= -1)
                player.setVideoCacheLimitGb(value);
            }}
            onWheel={(event) => {
              if (document.activeElement !== event.currentTarget) return;
              event.preventDefault();
              event.stopPropagation();
              const delta = -event.deltaY;
              let steps: number;
              if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
                steps = Math.sign(delta);
              } else {
                cacheLimitWheelRemainder.current += delta;
                steps = Math.trunc(cacheLimitWheelRemainder.current / 100);
                cacheLimitWheelRemainder.current -= steps * 100;
              }
              if (steps)
                player.setVideoCacheLimitGb((value) =>
                  Math.max(-1, value + steps),
                );
            }}
            onBlur={() => {
              cacheLimitWheelRemainder.current = 0;
            }}
          />
        </div>
        <p className="settings-hint">
          0 uses HLS only · -1 keeps converted videos without a limit
        </p>
      </div>
      <div className="settings-stats">
        <span>
          <strong>{summary?.trackCount.toLocaleString() ?? "—"}</strong> songs
        </span>
        <span>
          <strong>{summary?.beatmapCount.toLocaleString() ?? "—"}</strong>{" "}
          beatmaps
        </span>
        <span>
          <strong>{summary?.collectionCount ?? "—"}</strong> collections
        </span>
      </div>
      <div className="settings-block maintenance-setting">
        <span className="settings-label">
          <Trash2 size={16} /> CACHE &amp; SETTINGS
        </span>
        <div className="settings-actions maintenance-actions">
          <button
            type="button"
            className="secondary-button settings-reset-button"
            title="Restore playback, layout, appearance, sorting, and visualizer preferences to their original defaults"
            onClick={requestSettingsReset}
          >
            <RefreshCw size={15} /> Reset
          </button>
          {(["index", "video"] as CacheKind[]).map((kind) => {
            const active = clearingCache === kind;
            const disabled =
              clearingCache !== null || (kind === "index" && importing);
            return (
              <button
                key={kind}
                type="button"
                className="danger-button cache-button"
                aria-label={`Clear ${cacheName(kind)} cache`}
                disabled={disabled}
                onClick={() => requestCacheClear(kind)}
              >
                <strong>
                  {active && <LoaderCircle className="spin" size={13} />}
                  {active ? "Deleting…" : cacheName(kind)}
                </strong>
                <span className="cache-button-usage">
                  {formatCacheSize(cacheUsage?.[kind])}
                </span>
              </button>
            );
          })}
        </div>
        {cacheNotice && (
          <p className={"cache-notice " + cacheNotice.kind} role="status">
            {cacheNotice.message}
          </p>
        )}
      </div>
    </>
  );
}
