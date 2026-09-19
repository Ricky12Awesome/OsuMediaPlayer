import type { MediaAsset } from "../media";
import type { SongListSummary, Song } from "../../shared/types";

/** A song plus the normalized values used to answer song list queries. */
export interface IndexedSong {
  song: Song;
  search: string;
  tags: Set<string>;
  collections: Set<string>;
  beatmapHashes: Set<string>;
}

export interface SongListCollection {
  id: string;
  name: string;
  lastModified: number;
  songIds: string[];
}

export interface SongListSnapshot {
  assets: Map<string, MediaAsset>;
  summary: SongListSummary;
  indexed: IndexedSong[];
  orders: Map<string, readonly string[]>;
  collections: SongListCollection[];
}

export interface SongListFingerprint {
  beatmapSetCount: number;
  beatmapCount: number;
  latestDateAdded: number;
  latestDateSubmitted: number;
  latestDateRanked: number;
  latestLastPlayed: number;
}

export type SongListCollectionFingerprint = Record<string, number>;

export type SongListCancellation = Pick<AbortSignal, "throwIfAborted">;
