import type { Track } from "../shared/types";

export const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const sorts = new Set([
  "title",
  "artist",
  "duration",
  "bpm",
  "added",
  "dateAdded",
  "dateSubmitted",
  "dateRanked",
  "lastPlayed",
  "stars",
  "collection",
  "tags",
] as const);

export const string = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const dateTimestamp = (value: Date | undefined): number => {
  const timestamp = value?.getTime() ?? 0;
  return Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;
};

export const normalize = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase();

export const trackSearch = (track: Track): string =>
  normalize(
    [
      track.title,
      track.titleUnicode,
      track.artist,
      track.artistUnicode,
      track.source,
      ...track.tags,
      ...track.collections,
    ].join(" "),
  );

export const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
