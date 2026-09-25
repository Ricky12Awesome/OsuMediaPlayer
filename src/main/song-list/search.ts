import type { BeatmapSearchData, Song } from "../../shared/types";
import { normalize } from "./utils";

type Operator = "=" | ":" | "!=" | "<" | ">" | "<=" | ">=";
type Predicate<T> = (value: T) => boolean;

export interface ParsedSearch {
  terms: string[];
  songFilters: Predicate<Song>[];
  beatmapFilters: Predicate<BeatmapSearchData>[];
  timeSensitive: boolean;
}

function compare(left: number, right: number, operator: Operator): boolean {
  switch (operator) {
    case "=":
    case ":":
      return left === right;
    case "!=":
      return left !== right;
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
  }
}

function textFilter(
  value: string,
  operator: Operator,
): Predicate<string> | null {
  if (operator !== "=" && operator !== ":" && operator !== "!=") return null;
  const expected = normalize(value);
  if (!expected) return null;
  return (actual) =>
    normalize(actual).includes(expected) !== (operator === "!=");
}

function dateRange(value: string): [number, number] | null {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2] ?? 1);
  const day = Number(match[3] ?? 1);
  const start = Date.UTC(year, month - 1, day);
  if (
    year < 100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    new Date(start).getUTCDate() !== day ||
    new Date(start).getUTCMonth() !== month - 1
  )
    return null;
  const end = match[3]
    ? Date.UTC(year, month - 1, day + 1)
    : match[2]
      ? Date.UTC(year, month, 1)
      : Date.UTC(year + 1, 0, 1);
  return [start, end];
}

function dateFilter(
  value: string,
  operator: Operator,
): Predicate<number> | null {
  const range = dateRange(value);
  if (!range) return null;
  const [start, end] = range;
  return (actual) => {
    if (!actual) return false;
    switch (operator) {
      case "=":
      case ":":
        return actual >= start && actual < end;
      case "!=":
        return actual < start || actual >= end;
      case "<":
        return actual < start;
      case "<=":
        return actual < end;
      case ">":
        return actual >= end;
      case ">=":
        return actual >= start;
    }
  };
}

function elapsedMilliseconds(value: string, now: number): number | null {
  const match =
    /^(?:(\d+)y)?(?:(\d+)M)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(
      value,
    );
  if (!match || !match.slice(1).some(Boolean)) return null;
  const [, years, months, days, hours, minutes, seconds] = match;
  const past = new Date(now);
  const dayOfMonth = past.getUTCDate();
  past.setUTCDate(1);
  past.setUTCFullYear(past.getUTCFullYear() - Number(years ?? 0));
  past.setUTCMonth(past.getUTCMonth() - Number(months ?? 0));
  const daysInMonth = new Date(
    Date.UTC(past.getUTCFullYear(), past.getUTCMonth() + 1, 0),
  ).getUTCDate();
  past.setUTCDate(Math.min(dayOfMonth, daysInMonth) - Number(days ?? 0));
  past.setUTCHours(past.getUTCHours() - Number(hours ?? 0));
  past.setUTCMinutes(past.getUTCMinutes() - Number(minutes ?? 0));
  past.setUTCSeconds(past.getUTCSeconds() - Number(seconds ?? 0));
  const elapsed = now - past.getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

const statuses = new Map<string, readonly number[]>([
  ["ranked", [1]],
  ["r", [1]],
  ["approved", [2]],
  ["a", [2]],
  ["pending", [0]],
  ["p", [0]],
  ["notsubmitted", [-4]],
  ["n", [-4]],
  ["unknown", [-3]],
  ["u", [-3]],
  ["loved", [4]],
  ["l", [4]],
]);

/** Parse search operators without consuming unrecognized or incomplete text. */
export function parseSearch(search: string, now = Date.now()): ParsedSearch {
  const result: ParsedSearch = {
    terms: [],
    songFilters: [],
    beatmapFilters: [],
    timeSensitive: false,
  };
  const tokens = search.match(/(?:[^\s"]|"[^"]*")+/g) ?? [];
  for (const token of tokens) {
    const match = /^([a-z]+)(<=|>=|!=|=|:|<|>)(.*)$/i.exec(token);
    if (!match) {
      result.terms.push(normalize(token.replace(/^"|"$/g, "")));
      continue;
    }
    const [, rawName, rawOperator, rawValue] = match;
    const name = rawName.toLowerCase();
    const operator = rawOperator as Operator;
    const value = rawValue.replace(/^"|"$/g, "");
    let accepted = false;
    if (name === "unplayed" && !value) {
      result.beatmapFilters.push((map) => map.lastPlayedAt === 0);
      accepted = true;
    } else if (name === "artist" || name === "title" || name === "source") {
      const filter = textFilter(value, operator);
      if (filter) {
        result.songFilters.push((song) =>
          name === "artist"
            ? operator === "!="
              ? filter(song.artist) && filter(song.artistUnicode ?? "")
              : filter(song.artist) || filter(song.artistUnicode ?? "")
            : name === "title"
              ? operator === "!="
                ? filter(song.title) && filter(song.titleUnicode ?? "")
                : filter(song.title) || filter(song.titleUnicode ?? "")
              : filter(song.source),
        );
        accepted = true;
      }
    } else if (name === "bpm" || name === "length") {
      const expected = Number(value);
      if (value && Number.isFinite(expected) && expected >= 0) {
        result.beatmapFilters.push((map) =>
          compare(name === "bpm" ? map.bpm : map.duration, expected, operator),
        );
        accepted = true;
      }
    } else if (name === "lastplayed") {
      const elapsed = elapsedMilliseconds(value, now);
      if (elapsed !== null) {
        result.beatmapFilters.push((map) =>
          compare(
            map.lastPlayedAt ? now - map.lastPlayedAt : Infinity,
            elapsed,
            operator,
          ),
        );
        result.timeSensitive = true;
        accepted = true;
      }
    } else if (name === "played") {
      const expected = ["yes", "true", "1"].includes(value.toLowerCase())
        ? true
        : ["no", "false", "0"].includes(value.toLowerCase())
          ? false
          : null;
      if (expected !== null) {
        result.beatmapFilters.push((map) => {
          const played = map.lastPlayedAt > 0;
          return played === (operator === "!=" ? !expected : expected);
        });
        accepted = true;
      }
    } else if (
      name === "created" ||
      name === "submitted" ||
      name === "ranked"
    ) {
      const filter = dateFilter(value, operator);
      if (filter) {
        result.songFilters.push((song) =>
          filter(
            name === "ranked"
              ? (song.dateRankedAt ?? 0)
              : (song.dateSubmittedAt ?? 0),
          ),
        );
        accepted = true;
      }
    } else if (name === "status") {
      const parts = value.toLowerCase().split(",");
      const selected = parts.flatMap((part) => statuses.get(part) ?? []);
      if (selected.length && parts.every((part) => statuses.has(part))) {
        if (operator === "=" || operator === ":" || operator === "!=") {
          result.beatmapFilters.push(
            (map) => selected.includes(map.status) !== (operator === "!="),
          );
          accepted = true;
        } else if (parts.length === 1) {
          result.beatmapFilters.push((map) =>
            compare(map.status, selected[0], operator),
          );
          accepted = true;
        }
      }
    } else if (name === "tag") {
      if (textFilter(value, operator)) {
        const expected = normalize(value);
        result.beatmapFilters.push(
          (map) =>
            map.userTags.some((tag) => normalize(tag) === expected) !==
            (operator === "!="),
        );
        accepted = true;
      }
    }
    if (!accepted) result.terms.push(normalize(token));
  }
  return result;
}

export function matchesSearch(
  song: Song,
  searchText: string,
  criteria: ParsedSearch,
): boolean {
  if (!criteria.terms.every((term) => searchText.includes(term))) return false;
  if (!criteria.songFilters.every((filter) => filter(song))) return false;
  if (!criteria.beatmapFilters.length) return true;
  const beatmaps = song.beatmapSearch?.length
    ? song.beatmapSearch
    : [
        {
          duration: song.duration,
          bpm: song.bpm,
          lastPlayedAt: song.lastPlayedAt ?? 0,
          status: -3,
          userTags: [],
        },
      ];
  return beatmaps.some((map) =>
    criteria.beatmapFilters.every((filter) => filter(map)),
  );
}
