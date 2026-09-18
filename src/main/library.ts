/**
 * Public library API.
 *
 * The implementation is split into the detached index, Realm integration, and
 * snapshot builder modules. Keep this barrel stable for the main process,
 * worker, and renderer callers.
 */
export { LibraryIndex } from "./library-index";
export {
  loadLibraryFromRealm,
  parseBeatmapVideoEvent,
} from "./library-builder";
export {
  readLibraryCollections,
  readLibraryFingerprint,
  readLibraryFingerprints,
  sortedLibraryBeatmaps,
} from "./library-realm";
export type { BeatmapVideoEvent } from "./library-builder";
export type {
  IndexedTrack,
  LibraryCancellation,
  LibraryCollection,
  LibraryCollectionFingerprint,
  LibraryFingerprint,
  LibrarySnapshot,
} from "./library-types";
