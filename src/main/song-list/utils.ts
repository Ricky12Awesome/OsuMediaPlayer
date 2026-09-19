import { sortKeys, type Song } from "../../shared/types";

export const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const sorts = new Set(sortKeys);

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

export const songSearch = (song: Song): string =>
  normalize(
    [
      song.title,
      song.titleUnicode,
      song.artist,
      song.artistUnicode,
      song.source,
      ...song.tags,
      ...song.collections,
    ].join(" "),
  );

export const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
