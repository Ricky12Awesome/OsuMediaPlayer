import type { PointerEvent, RefObject } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { SongDebugInfo } from "../../shared/types";
import type { PlayerState } from "./usePlayer";
import { displaySongArtist, displaySongTitle } from "./song-title";
import { DebugWidget, type DebugWidgetData } from "./DebugWidget";
import { AudioVisualizer } from "./AudioVisualizer";
import type {
  VisualizerSettings,
  VisualizerStatus,
} from "./visualizer-settings";

export const captionPositions = [
  "top-left",
  "top-center",
  "top-right",
  "right-center",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "left-center",
] as const;

export type CaptionPosition = (typeof captionPositions)[number];

export interface NowPlayingProps {
  player: PlayerState;
  visualizerSettings: VisualizerSettings;
  onVisualizerStatus: (status: VisualizerStatus, detail?: string) => void;
  visualizerThemeKey?: unknown;
  showNowPlayingTitleArtist: boolean;
  debugMode: boolean;
  debugInfo?: SongDebugInfo | null;
  showTitleUnicode: boolean;
  showArtistUnicode: boolean;
  captionPosition: CaptionPosition;
  captionDragging: boolean;
  videoActive: boolean;
  captionRef: RefObject<HTMLDivElement | null>;
  beginCaptionDrag: (event: PointerEvent<HTMLDivElement>) => void;
}

export function NowPlaying({
  player,
  visualizerSettings,
  onVisualizerStatus,
  visualizerThemeKey,
  showNowPlayingTitleArtist,
  debugMode,
  debugInfo,
  showTitleUnicode,
  showArtistUnicode,
  captionPosition,
  captionDragging,
  videoActive,
  captionRef,
  beginCaptionDrag,
}: NowPlayingProps) {
  const debugData = player.song
    ? {
        onlineId: player.song.onlineId,
        md5Hash: player.song.md5Hash,
        title: player.song.title,
        titleUnicode: player.song.titleUnicode,
        artist: player.song.artist,
        artistUnicode: player.song.artistUnicode,
        tags: player.song.tags,
        ...debugInfo,
        audio: {
          hash: player.song.audioHash,
          ...(debugInfo?.audio ?? {}),
          duration:
            debugInfo?.audio?.duration ??
            player.duration ??
            player.song.duration,
        },
        background: {
          hash: player.song.backgroundHash,
          ...(debugInfo?.background ?? {}),
        },
        video: {
          hash: player.song.videoHash,
          ...(debugInfo?.video ?? {}),
          source: player.videoSource,
        },
      }
    : debugInfo;

  return (
    <section className="now-playing-panel" aria-label="Now playing">
      <div
        ref={captionRef}
        className={
          "artwork-stage " +
          (player.song?.artworkUrl ? "has-artwork " : "") +
          (player.playVideos && player.song?.videoUrl ? "has-video " : "") +
          (videoActive ? "video-is-active" : "")
        }
      >
        {player.song?.artworkUrl && (
          <img
            className="hero-background"
            src={player.song.artworkUrl}
            alt=""
            draggable={false}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
        {player.playVideos && player.videoUrl && (
          <video
            ref={player.videoRef}
            className={"hero-video " + (videoActive ? "is-active" : "")}
            muted
            playsInline
            disablePictureInPicture
            preload="metadata"
            aria-hidden="true"
          />
        )}
        <div className="artwork-grain" />
        <AudioVisualizer
          audioRef={player.audioRef}
          getAudioAnalyser={player.getAudioAnalyser}
          settings={visualizerSettings}
          onStatus={onVisualizerStatus}
          themeKey={visualizerThemeKey}
        />
        {player.videoEncoding && (
          <div className="video-encoding-indicator" role="status">
            <LoaderCircle className="spin" size={14} />
            <span>
              Encoding video
              {player.videoEncodingProgress !== null
                ? ` · ${Math.round(player.videoEncodingProgress * 100)}%`
                : "…"}
              {player.videoEncoder ? ` · ${player.videoEncoder}` : ""}
            </span>
          </div>
        )}
        {debugMode && player.song && <DebugWidget data={debugData} />}
        {showNowPlayingTitleArtist && (
          <div
            className={
              "hero-caption hero-caption-" +
              captionPosition +
              (captionDragging ? " is-dragging" : "")
            }
            aria-label="Now playing information. Drag to move it to an edge."
            onPointerDown={beginCaptionDrag}
          >
            <h2 title={displaySongTitle(player.song, showTitleUnicode)}>
              {displaySongTitle(player.song, showTitleUnicode) ||
                "A little more rhythm."}
            </h2>
            <p title={displaySongArtist(player.song, showArtistUnicode)}>
              {displaySongArtist(player.song, showArtistUnicode) ||
                "Your osu! song list. A whole new way to listen."}
            </p>
            {player.song?.source && (
              <span className="hero-source">{player.song.source}</span>
            )}
          </div>
        )}
      </div>
      <div className="player-note">
        <span className="tiny-osu">osu!</span>
        <span>Less clicking circles. More listening.</span>
        <Sparkles size={14} />
      </div>
    </section>
  );
}
