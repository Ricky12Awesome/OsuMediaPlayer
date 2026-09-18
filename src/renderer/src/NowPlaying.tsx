import type { PointerEvent, RefObject } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { TrackDebugInfo } from "../../shared/types";
import type { PlayerState } from "./usePlayer";
import { AudioVisualizer } from "./AudioVisualizer";
import type { VisualizerSettings } from "./visualizer-settings";
import { displayTrackArtist, displayTrackTitle } from "./track-title";
import { DebugWidget, type DebugWidgetData } from "./DebugWidget";

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
  visualizer: VisualizerSettings;
  showNowPlayingTitleArtist: boolean;
  debugMode: boolean;
  debugInfo?: TrackDebugInfo | null;
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
  visualizer,
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
  const debugData = player.track
    ? {
        onlineId: player.track.onlineId,
        md5Hash: player.track.md5Hash,
        title: player.track.title,
        titleUnicode: player.track.titleUnicode,
        artist: player.track.artist,
        artistUnicode: player.track.artistUnicode,
        tags: player.track.tags,
        ...debugInfo,
        audio: {
          hash: player.track.audioHash,
          ...(debugInfo?.audio ?? {}),
          duration:
            debugInfo?.audio?.duration ??
            player.duration ??
            player.track.duration,
        },
        background: {
          hash: player.track.backgroundHash,
          ...(debugInfo?.background ?? {}),
        },
        video: {
          hash: player.track.videoHash,
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
          (player.track?.artworkUrl ? "has-artwork " : "") +
          (player.playVideos && player.track?.videoUrl ? "has-video " : "") +
          (videoActive ? "video-is-active" : "")
        }
      >
        {player.track?.artworkUrl && (
          <img
            className="hero-background"
            src={player.track.artworkUrl}
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
        <AudioVisualizer
          analyser={player.analyser}
          playing={player.playing}
          settings={visualizer}
        />
        {debugMode && player.track && <DebugWidget data={debugData} />}
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
            <h2 title={displayTrackTitle(player.track, showTitleUnicode)}>
              {displayTrackTitle(player.track, showTitleUnicode) ||
                "A little more rhythm."}
            </h2>
            <p title={displayTrackArtist(player.track, showArtistUnicode)}>
              {displayTrackArtist(player.track, showArtistUnicode) ||
                "Your osu! library. A whole new way to listen."}
            </p>
            {player.track?.source && (
              <span className="hero-source">{player.track.source}</span>
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
