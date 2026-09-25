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
  ListMusic,
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
  X,
} from "lucide-react";
import type { Song } from "../../shared/types";
import type { PlayerState } from "./usePlayer";
import { SongArt } from "./SongArt";
import { displaySongArtist, displaySongTitle } from "./song-title";

type TransportLayout = "controls-left" | "controls-centered";
type SongListPosition = "left" | "right";

export interface TransportProps {
  player: PlayerState;
  transportLayout: TransportLayout;
  showTitleUnicode: boolean;
  showArtistUnicode: boolean;
  favorites: Set<string>;
  onFavorite: (song: Song) => void;
  fullscreen: boolean;
  sidebarHidden: boolean;
  songListPosition: SongListPosition;
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
  songListPosition,
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
  const [queueOpen, setQueueOpen] = useState(false);
  const seekPreviewClearTimer = useRef<number | null>(null);
  const queueButtonRef = useRef<HTMLButtonElement>(null);
  const queuePopoverRef = useRef<HTMLElement>(null);
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

  useEffect(() => {
    if (!queueOpen) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (
        !queueButtonRef.current?.contains(target) &&
        !queuePopoverRef.current?.contains(target)
      )
        setQueueOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setQueueOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [queueOpen]);

  const duration = player.duration || player.song?.duration || 0;
  const displayedTime = scrubTime ?? player.currentTime;

  const beginScrubbing = (event: PointerEvent<HTMLInputElement>) => {
    if (!player.song) return;
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
    if (!duration || !player.song) return;
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
          disabled={!player.song}
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
          aria-label="Previous song"
          disabled={!player.song}
          onClick={() => void player.previous()}
        >
          <SkipBack size={20} fill="currentColor" />
        </button>
        <button
          className="play-button"
          aria-label={player.playing ? "Pause" : "Play"}
          disabled={!player.song}
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
          aria-label="Next song"
          disabled={!player.song}
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

      <div className="transport-song">
        <SongArt
          className="transport-song-art"
          song={player.song}
          playing={false}
        />
        <div className="transport-song-text">
          <strong title={displaySongTitle(player.song, showTitleUnicode)}>
            {displaySongTitle(player.song, showTitleUnicode) ||
              "Your song starts here"}
          </strong>
          <span title={displaySongArtist(player.song, showArtistUnicode)}>
            {displaySongArtist(player.song, showArtistUnicode) ||
              "Pick a song and press play"}
          </span>
        </div>
        <button
          className={
            "icon-button transport-heart " +
            (player.song && favorites.has(player.song.id) ? "is-favorite" : "")
          }
          disabled={!player.song}
          aria-label={
            player.song && favorites.has(player.song.id)
              ? "Unfavorite song"
              : "Favorite song"
          }
          onClick={() => player.song && onFavorite(player.song)}
        >
          <Heart
            size={17}
            fill={
              player.song && favorites.has(player.song.id)
                ? "currentColor"
                : "none"
            }
          />
        </button>
      </div>

      <div className="transport-extra">
        <button
          ref={queueButtonRef}
          className="icon-button transport-queue-toggle"
          aria-label="Up next"
          aria-expanded={queueOpen}
          aria-controls={queueOpen ? "transport-queue" : undefined}
          title={`Up next (${player.queuedSongs.length})`}
          onClick={() => setQueueOpen((open) => !open)}
        >
          <ListMusic size={17} />
          {player.queuedSongs.length > 0 && (
            <span className="transport-queue-count" aria-hidden="true">
              {player.queuedSongs.length}
            </span>
          )}
        </button>
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
            sidebarHidden ? "Show song list sidebar" : "Hide song list sidebar"
          }
          onClick={onToggleSidebar}
        >
          {sidebarHidden ? (
            songListPosition === "left" ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelRightOpen size={19} />
            )
          ) : songListPosition === "left" ? (
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
      {queueOpen && (
        <section
          ref={queuePopoverRef}
          id="transport-queue"
          className="control-popover transport-queue-popover"
          aria-label="Up next"
        >
          <div className="transport-queue-heading">
            <h2>Up next</h2>
            <button
              type="button"
              className="control-option transport-queue-clear"
              disabled={player.queuedSongs.length === 0}
              onClick={player.clearQueue}
            >
              Clear queue
            </button>
          </div>
          {player.queuedSongs.length === 0 ? (
            <p className="transport-queue-empty">
              Right-click a song and choose Add to queue.
            </p>
          ) : (
            <ol className="transport-queue-list">
              {player.queuedSongs.map((song, index) => (
                <li key={`${song.id}-${index}`}>
                  <div className="transport-queue-song">
                    <strong>{displaySongTitle(song, showTitleUnicode)}</strong>
                    <span>{displaySongArtist(song, showArtistUnicode)}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${displaySongTitle(song, showTitleUnicode)} from queue`}
                    onClick={() => player.removeFromQueue(index)}
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </footer>
  );
}
