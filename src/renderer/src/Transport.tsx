import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  Heart,
  Keyboard,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { Track } from "../../shared/types";
import type { PlayerState } from "./usePlayer";
import { TrackArt } from "./TrackArt";
import { displayTrackArtist, displayTrackTitle } from "./track-title";

type TransportLayout = "controls-left" | "controls-centered";
type LibraryPosition = "left" | "right";

export interface TransportProps {
  player: PlayerState;
  transportLayout: TransportLayout;
  showTitleUnicode: boolean;
  showArtistUnicode: boolean;
  favorites: Set<string>;
  onFavorite: (track: Track) => void;
  fullscreen: boolean;
  sidebarHidden: boolean;
  libraryPosition: LibraryPosition;
  sidePanelOpen: boolean;
  onOpenShortcuts: () => void;
  onToggleSidePanel: () => void;
  onToggleSidebar: () => void;
  onFullscreen: () => void;
  onControlsActivity: () => void;
}

type SeekPreview = {
  time: number;
  position: number;
};

function formatDuration(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function Transport({
  player,
  transportLayout,
  showTitleUnicode,
  showArtistUnicode,
  favorites,
  onFavorite,
  fullscreen,
  sidebarHidden,
  libraryPosition,
  sidePanelOpen,
  onOpenShortcuts,
  onToggleSidePanel,
  onToggleSidebar,
  onFullscreen,
  onControlsActivity,
}: TransportProps) {
  const [seekPreview, setSeekPreview] = useState<SeekPreview | null>(null);
  const [seekTooltipPreview, setSeekTooltipPreview] =
    useState<SeekPreview | null>(null);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const seekPreviewClearTimer = useRef<number | null>(null);
  const scrubPointer = useRef<number | null>(null);
  const scrubTimeRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (seekPreviewClearTimer.current !== null) {
        window.clearTimeout(seekPreviewClearTimer.current);
        seekPreviewClearTimer.current = null;
      }
    },
    [],
  );

  const duration = player.duration || player.track?.duration || 0;
  const displayedTime = scrubTime ?? player.currentTime;

  const beginScrubbing = (event: PointerEvent<HTMLInputElement>) => {
    if (!player.track) return;
    scrubPointer.current = event.pointerId;
    const next = Number(event.currentTarget.value);
    scrubTimeRef.current = next;
    setScrubTime(next);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateScrubbing = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    if (scrubPointer.current === null) {
      player.seek(next);
      return;
    }
    scrubTimeRef.current = next;
    setScrubTime(next);
  };

  const finishScrubbing = (event: PointerEvent<HTMLInputElement>) => {
    if (
      scrubPointer.current === null ||
      scrubPointer.current !== event.pointerId
    )
      return;
    const next = scrubTimeRef.current ?? Number(event.currentTarget.value);
    scrubPointer.current = null;
    scrubTimeRef.current = null;
    setScrubTime(null);
    player.seek(next);
  };

  const cancelSeekPreviewClear = () => {
    if (seekPreviewClearTimer.current !== null) {
      window.clearTimeout(seekPreviewClearTimer.current);
      seekPreviewClearTimer.current = null;
    }
  };

  const updateSeekPreview = (event: PointerEvent<HTMLInputElement>) => {
    if (!duration || !player.track) return;
    cancelSeekPreviewClear();
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const position = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const preview = { time: position * duration, position: position * 100 };
    setSeekPreview(preview);
    setSeekTooltipPreview(preview);
  };

  const clearSeekPreview = () => {
    cancelSeekPreviewClear();
    setSeekPreview(null);
    seekPreviewClearTimer.current = window.setTimeout(() => {
      setSeekTooltipPreview(null);
      seekPreviewClearTimer.current = null;
    }, 150);
  };

  const resetSeekPreview = () => {
    cancelSeekPreviewClear();
    setSeekPreview(null);
    setSeekTooltipPreview(null);
  };

  const currentProgress = duration
    ? Math.max(0, Math.min(100, (displayedTime / duration) * 100))
    : 0;
  const previewPosition = seekPreview?.position ?? currentProgress;
  const tooltipPosition =
    seekPreview?.position ?? seekTooltipPreview?.position ?? currentProgress;
  const previewStart = Math.min(currentProgress, previewPosition);
  const previewEnd = Math.max(currentProgress, previewPosition);

  return (
    <footer
      className={
        "transport " +
        (transportLayout === "controls-centered"
          ? "transport-controls-centered"
          : "")
      }
      aria-label="Playback controls"
      onPointerMove={onControlsActivity}
      onFocus={onControlsActivity}
    >
      <div
        className="transport-scrubber"
        onPointerEnter={cancelSeekPreviewClear}
        onPointerLeave={clearSeekPreview}
      >
        <span
          className="seek-tooltip seek-current-tooltip"
          aria-hidden="true"
          style={
            {
              "--seek-tooltip-position": currentProgress + "%",
            } as CSSProperties
          }
        >
          {formatDuration(displayedTime)} / {formatDuration(duration)}
        </span>
        {seekTooltipPreview && (
          <span
            className="seek-tooltip seek-hover-tooltip"
            aria-hidden="true"
            style={
              {
                "--seek-tooltip-position": tooltipPosition + "%",
              } as CSSProperties
            }
          >
            {formatDuration(seekTooltipPreview.time)}
          </span>
        )}
        <input
          className="seek-slider"
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={Math.min(displayedTime, duration || 1)}
          disabled={!player.track}
          aria-label="Seek"
          aria-valuetext={
            formatDuration(displayedTime) + " of " + formatDuration(duration)
          }
          style={
            {
              "--range-progress": currentProgress + "%",
              "--range-preview-start": previewStart + "%",
              "--range-preview-end": previewEnd + "%",
            } as CSSProperties
          }
          onFocus={resetSeekPreview}
          onPointerDown={beginScrubbing}
          onPointerMove={updateSeekPreview}
          onPointerUp={finishScrubbing}
          onPointerCancel={finishScrubbing}
          onLostPointerCapture={finishScrubbing}
          onChange={updateScrubbing}
        />
      </div>

      {transportLayout !== "controls-centered" && (
        <button
          className={
            "icon-button shuffle-button " + (player.shuffle ? "active" : "")
          }
          aria-label="Shuffle"
          aria-pressed={player.shuffle}
          title={player.shuffle ? "Turn off shuffle" : "Turn on shuffle"}
          onClick={() => player.setShuffle((value) => !value)}
        >
          <Shuffle size={17} />
        </button>
      )}
      <div className="transport-buttons">
        {transportLayout === "controls-centered" && (
          <button
            className={
              "icon-button shuffle-button " + (player.shuffle ? "active" : "")
            }
            aria-label="Shuffle"
            aria-pressed={player.shuffle}
            title={player.shuffle ? "Turn off shuffle" : "Turn on shuffle"}
            onClick={() => player.setShuffle((value) => !value)}
          >
            <Shuffle size={17} />
          </button>
        )}
        <button
          className="icon-button skip-button"
          aria-label="Previous track"
          disabled={!player.track}
          onClick={() => void player.previous()}
        >
          <SkipBack size={20} fill="currentColor" />
        </button>
        <button
          className="play-button"
          aria-label={player.playing ? "Pause" : "Play"}
          disabled={!player.track}
          onClick={player.toggle}
        >
          {player.loading ? (
            <LoaderCircle className="spin" size={21} />
          ) : player.playing ? (
            <Pause size={21} fill="currentColor" />
          ) : (
            <Play size={21} fill="currentColor" />
          )}
        </button>
        <button
          className="icon-button skip-button"
          aria-label="Next track"
          disabled={!player.track}
          onClick={() => void player.next()}
        >
          <SkipForward size={20} fill="currentColor" />
        </button>
        <button
          className={
            "icon-button repeat-button " +
            (player.repeat !== "off" ? "active" : "")
          }
          aria-label={
            player.repeat === "one"
              ? "Repeat one"
              : player.repeat === "all"
                ? "Repeat all"
                : "Repeat off"
          }
          aria-pressed={player.repeat !== "off"}
          title={
            player.repeat === "one"
              ? "Repeat one"
              : player.repeat === "all"
                ? "Repeat all"
                : "Repeat off"
          }
          onClick={player.cycleRepeat}
        >
          {player.repeat === "one" ? (
            <Repeat1 size={17} />
          ) : (
            <Repeat size={17} />
          )}
        </button>
      </div>

      <div className="transport-track">
        <TrackArt
          className="transport-track-art"
          track={player.track}
          playing={false}
        />
        <div className="transport-track-text">
          <strong title={displayTrackTitle(player.track, showTitleUnicode)}>
            {displayTrackTitle(player.track, showTitleUnicode) ||
              "Your soundtrack starts here"}
          </strong>
          <span title={displayTrackArtist(player.track, showArtistUnicode)}>
            {displayTrackArtist(player.track, showArtistUnicode) ||
              "Pick a song and press play"}
          </span>
        </div>
        <button
          className={
            "icon-button transport-heart " +
            (player.track && favorites.has(player.track.id)
              ? "is-favorite"
              : "")
          }
          disabled={!player.track}
          aria-label={
            player.track && favorites.has(player.track.id)
              ? "Unfavorite song"
              : "Favorite song"
          }
          onClick={() => player.track && onFavorite(player.track)}
        >
          <Heart
            size={17}
            fill={
              player.track && favorites.has(player.track.id)
                ? "currentColor"
                : "none"
            }
          />
        </button>
      </div>

      <div className="transport-extra">
        <button
          className="icon-button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={onOpenShortcuts}
        >
          <Keyboard size={17} />
        </button>
        <button
          className={
            "icon-button settings-panel-toggle " +
            (sidePanelOpen ? "active" : "")
          }
          aria-label={sidePanelOpen ? "Hide settings" : "Show settings"}
          aria-pressed={sidePanelOpen}
          aria-expanded={sidePanelOpen}
          aria-controls="side-settings-panel"
          title={sidePanelOpen ? "Hide settings" : "Show settings"}
          onClick={onToggleSidePanel}
        >
          <Settings2 size={17} />
        </button>
        <button
          className={
            "icon-button sidebar-toggle " + (sidebarHidden ? "" : "active")
          }
          aria-label={
            sidebarHidden ? "Show library sidebar" : "Hide library sidebar"
          }
          onClick={onToggleSidebar}
        >
          {sidebarHidden ? (
            libraryPosition === "left" ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelRightOpen size={19} />
            )
          ) : libraryPosition === "left" ? (
            <PanelLeftClose size={19} />
          ) : (
            <PanelRightClose size={19} />
          )}
        </button>
        <button
          className="icon-button"
          aria-label={player.muted ? "Unmute" : "Mute"}
          onClick={player.toggleMute}
        >
          {player.muted || player.volume === 0 ? (
            <VolumeX size={19} />
          ) : player.volume < 0.5 ? (
            <Volume1 size={19} />
          ) : (
            <Volume2 size={19} />
          )}
        </button>
        <input
          className="volume-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={player.muted ? 0 : player.volume}
          aria-label="Volume"
          style={
            {
              "--range-progress":
                (player.muted ? 0 : player.volume) * 100 + "%",
            } as CSSProperties
          }
          onChange={(event) => player.setVolume(Number(event.target.value))}
        />
        <button
          className="icon-button fullscreen-toggle"
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen view (F11)"}
          onClick={onFullscreen}
        >
          {fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </button>
      </div>
    </footer>
  );
}
