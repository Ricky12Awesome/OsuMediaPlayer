import type { LibrarySummary } from "../shared/types";
import type {
  LibraryCollectionFingerprint,
  LibraryFingerprint,
  LibrarySnapshot,
} from "./library-types";

export const libraryCacheVersion = 8;

export interface LibraryCachePaths {
  directory: string;
  manifest: string;
  collectionManifest: string;
  tags: string;
  collections: string;
  tracks: string;
  collectionTracks: string;
  orders: string;
}

export interface LibraryRealmMetadata {
  mtimeMs: number;
  size: number;
}

export type LibraryCacheSummary = Omit<LibrarySummary, "collections" | "tags">;

export interface LibraryCacheManifest {
  version: number;
  fingerprint: LibraryFingerprint;
  summary: LibraryCacheSummary;
  realm: LibraryRealmMetadata;
}

export interface LibraryCacheData {
  snapshot: LibrarySnapshot;
  fingerprint: LibraryFingerprint;
  collectionFingerprint: LibraryCollectionFingerprint;
  realm: LibraryRealmMetadata;
}
