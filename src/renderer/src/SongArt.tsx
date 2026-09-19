import { useState } from "react";
import { Music2 } from "lucide-react";
import type { Song } from "../../shared/types";

interface SongArtProps {
  song?: Song | null;
  playing: boolean;
  className?: string;
}

export function SongArt({ song, playing, className = "" }: SongArtProps) {
  const [failedArtwork, setFailedArtwork] = useState<string | undefined>();
  const artworkUrl = song?.artworkUrl;
  const hasArtwork = Boolean(artworkUrl) && failedArtwork !== artworkUrl;

  return (
    <div
      className={
        "song-art" +
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
