import type { SongListSummary } from "../../shared/types";
import type {
  SongListCollectionFingerprint,
  SongListFingerprint,
  SongListSnapshot,
} from "./types";

export const songListCacheVersion = 8;

export interface SongListCachePaths {
  directory: string;
  manifest: string;
  collectionManifest: string;
  tags: string;
  collections: string;
  songs: string;
  collectionSongs: string;
  orders: string;
}

export interface SongListRealmMetadata {
  mtimeMs: number;
  size: number;
}

export type SongListCacheSummary = Omit<
  SongListSummary,
  "collections" | "tags"
>;

export interface SongListCacheManifest {
  version: number;
  fingerprint: SongListFingerprint;
  summary: SongListCacheSummary;
  realm: SongListRealmMetadata;
}

export interface SongListCacheData {
  snapshot: SongListSnapshot;
  fingerprint: SongListFingerprint;
  collectionFingerprint: SongListCollectionFingerprint;
  realm: SongListRealmMetadata;
}
