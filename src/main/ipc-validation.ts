import type {
  SongListQuery,
  SortKey,
  VideoEncodingSettings,
} from "../shared/types";
import { sortKeys } from "../shared/types";
import { normalizeVideoEncodingSettings } from "./video/encoding";

const validSortKeys = new Set<SortKey>(sortKeys);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validate and detach a song list query received across the IPC boundary. */
export function parseSongListQuery(
  value: unknown,
  optional = false,
): SongListQuery | undefined {
  if (value === undefined && optional) return undefined;
  if (!isRecord(value)) throw new Error("Invalid song list query.");

  const query: SongListQuery = {};
  if (typeof value.search === "string")
    query.search = value.search.slice(0, 1000);
  if (typeof value.collection === "string") query.collection = value.collection;
  if (typeof value.tag === "string") query.tag = value.tag;
  if (Array.isArray(value.tags))
    query.tags = value.tags.filter(
      (tag): tag is string => typeof tag === "string",
    );
  if (value.tagMatch === "any" || value.tagMatch === "all")
    query.tagMatch = value.tagMatch;
  if (
    typeof value.sort === "string" &&
    validSortKeys.has(value.sort as SortKey)
  )
    query.sort = value.sort as SortKey;
  if (typeof value.descending === "boolean")
    query.descending = value.descending;
  if (Array.isArray(value.favoriteIds))
    query.favoriteIds = value.favoriteIds.filter(
      (id): id is string => typeof id === "string",
    );
  if (typeof value.offset === "number" && Number.isFinite(value.offset))
    query.offset = value.offset;
  if (typeof value.limit === "number" && Number.isFinite(value.limit))
    query.limit = value.limit;
  return query;
}

/** Validate persisted renderer settings before passing them to video code. */
export function parseVideoEncodingSettings(
  value: unknown,
): VideoEncodingSettings | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid video encoding settings.");
  return normalizeVideoEncodingSettings(value);
}
