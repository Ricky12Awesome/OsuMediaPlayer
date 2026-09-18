import type { MediaAsset } from "../media";
import type { LibrarySummary, Track } from "../../shared/types";

/** A track plus the normalized values used to answer library queries. */
export interface IndexedTrack {
  track: Track;
  search: string;
  tags: Set<string>;
  collections: Set<string>;
  beatmapHashes: Set<string>;
}

export interface LibraryCollection {
  id: string;
  name: string;
  lastModified: number;
  trackIds: string[];
}

export interface LibrarySnapshot {
  assets: Map<string, MediaAsset>;
  summary: LibrarySummary;
  indexed: IndexedTrack[];
  orders: Map<string, readonly string[]>;
  collections: LibraryCollection[];
}

export interface LibraryFingerprint {
  beatmapSetCount: number;
  beatmapCount: number;
  latestDateAdded: number;
  latestDateSubmitted: number;
  latestDateRanked: number;
  latestLastPlayed: number;
}

export type LibraryCollectionFingerprint = Record<string, number>;

export type LibraryCancellation = Pick<AbortSignal, "throwIfAborted">;
