import type { Song } from "../../shared/types";

/** Return the title that should be shown for a song in the player UI. */
export function displaySongTitle(
  song: Pick<Song, "title" | "titleUnicode"> | null | undefined,
  showUnicode: boolean,
): string {
  if (!song) return "";
  return showUnicode && song.titleUnicode ? song.titleUnicode : song.title;
}

/** Return the artist that should be shown for a song in the player UI. */
export function displaySongArtist(
  song: Pick<Song, "artist" | "artistUnicode"> | null | undefined,
  showUnicode: boolean,
): string {
  if (!song) return "";
  return showUnicode && song.artistUnicode ? song.artistUnicode : song.artist;
}
