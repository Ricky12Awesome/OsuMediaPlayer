import type { Track } from "../../shared/types";

/** Return the title that should be shown for a track in the player UI. */
export function displayTrackTitle(
  track: Pick<Track, "title" | "titleUnicode"> | null | undefined,
  showUnicode: boolean,
): string {
  if (!track) return "";
  return showUnicode && track.titleUnicode ? track.titleUnicode : track.title;
}

/** Return the artist that should be shown for a track in the player UI. */
export function displayTrackArtist(
  track: Pick<Track, "artist" | "artistUnicode"> | null | undefined,
  showUnicode: boolean,
): string {
  if (!track) return "";
  return showUnicode && track.artistUnicode
    ? track.artistUnicode
    : track.artist;
}
