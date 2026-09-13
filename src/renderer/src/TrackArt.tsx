import { useState } from "react";
import { Music2 } from "lucide-react";
import type { Track } from "../../shared/types";

interface TrackArtProps {
  track?: Track | null;
  playing: boolean;
  className?: string;
}

export function TrackArt({ track, playing, className = "" }: TrackArtProps) {
  const [failedArtwork, setFailedArtwork] = useState<string | undefined>();
  const artworkUrl = track?.artworkUrl;
  const hasArtwork = Boolean(artworkUrl) && failedArtwork !== artworkUrl;

  return (
    <div
      className={
        "track-art" +
        (hasArtwork ? "" : " art-fallback") +
        (className ? " " + className : "")
      }
      aria-hidden="true"
    >
      {hasArtwork ? (
        <img
          src={artworkUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedArtwork(artworkUrl)}
        />
      ) : (
        <Music2 size={22} />
      )}
      {playing && (
        <span className="playing-bars">
          <span />
          <span />
          <span />
        </span>
      )}
    </div>
  );
}
