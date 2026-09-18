import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { LibrarySummary } from "../../shared/types";
import type {
  LibraryCollection,
  LibraryCollectionFingerprint,
  LibraryFingerprint,
  LibrarySnapshot,
  LibraryCancellation,
} from "./types";
import {
  libraryCacheVersion,
  type LibraryCacheData,
  type LibraryCacheManifest,
  type LibraryCachePaths,
  type LibraryCacheSummary,
  type LibraryRealmMetadata,
} from "./cache-types";
import {
  deserializeCollections,
  deserializeOrders,
  deserializeSnapshot,
  deserializeTracks,
  serializeCollectionCounts,
  serializeCollections,
  serializeOrders,
  serializeTagCounts,
  serializeTracks,
} from "./cache-format";

export { libraryCacheVersion } from "./cache-types";
export type {
  LibraryCacheData,
  LibraryCacheManifest,
  LibraryCachePaths,
  LibraryCacheSummary,
  LibraryRealmMetadata,
} from "./cache-types";

export function libraryCachePath(
  cacheDirectory: string,
  installPath: string,
): string {
  const identity = createHash("sha256").update(installPath).digest("hex");
  return join(cacheDirectory, `library-${identity}`);
}

export function libraryCachePaths(directory: string): LibraryCachePaths {
  return {
    directory,
    manifest: join(directory, "manifest.json"),
    collectionManifest: join(directory, "manifest.collections.json"),
    tags: join(directory, "tags.json"),
    collections: join(directory, "collections.json"),
    tracks: join(directory, "tracks.bin"),
    collectionTracks: join(directory, "collections.bin"),
    orders: join(directory, "orders.bin"),
  };
}

export async function clearLibraryCache(cacheDirectory: string): Promise<void> {
  await rm(cacheDirectory, { recursive: true, force: true });
}

export function libraryFingerprintsEqual(
  left: LibraryFingerprint,
  right: LibraryFingerprint,
): boolean {
  return (
    left.beatmapSetCount === right.beatmapSetCount &&
    left.beatmapCount === right.beatmapCount &&
    left.latestDateAdded === right.latestDateAdded &&
    left.latestDateSubmitted === right.latestDateSubmitted &&
    left.latestDateRanked === right.latestDateRanked &&
    left.latestLastPlayed === right.latestLastPlayed
  );
}

export function collectionFingerprintsEqual(
  left: LibraryCollectionFingerprint,
  right: LibraryCollectionFingerprint,
): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((id) => left[id] === right[id])
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCacheSummary(value: unknown): value is LibraryCacheSummary {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.trackCount) &&
    isFiniteNumber(value.beatmapCount) &&
    isFiniteNumber(value.collectionCount) &&
    typeof value.installPath === "string" &&
    isFiniteNumber(value.skippedCount)
  );
}

function isCountMap(value: unknown): value is Record<string, number> {
  const isCount = (count: unknown): count is number =>
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.values(value).every(isCount)
  );
}

function parseCountMap(value: unknown): Record<string, number> | null {
  return isCountMap(value) ? value : null;
}

function isFingerprint(value: unknown): value is LibraryFingerprint {
  return (
    isRecord(value) &&
    isFiniteNumber(value.beatmapSetCount) &&
    isFiniteNumber(value.beatmapCount) &&
    isFiniteNumber(value.latestDateAdded) &&
    isFiniteNumber(value.latestDateSubmitted) &&
    isFiniteNumber(value.latestDateRanked) &&
    isFiniteNumber(value.latestLastPlayed)
  );
}

function isCollectionFingerprint(
  value: unknown,
): value is LibraryCollectionFingerprint {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.values(value).every(isFiniteNumber)
  );
}

function isRealmMetadata(value: unknown): value is LibraryRealmMetadata {
  return (
    isRecord(value) &&
    isFiniteNumber(value.mtimeMs) &&
    isFiniteNumber(value.size)
  );
}

function parseManifest(value: unknown): LibraryCacheManifest | null {
  if (
    !isRecord(value) ||
    value.version !== libraryCacheVersion ||
    !isFingerprint(value.fingerprint) ||
    !isCacheSummary(value.summary) ||
    !isRealmMetadata(value.realm)
  )
    return null;
  return value as unknown as LibraryCacheManifest;
}

function collectionFingerprint(
  collections: readonly LibraryCollection[],
): LibraryCollectionFingerprint {
  return Object.fromEntries(
    collections.map((collection) => [collection.id, collection.lastModified]),
  );
}

export async function readLibraryCache(
  directory: string,
  fingerprint?: LibraryFingerprint,
  signal?: LibraryCancellation,
  knownManifest?: LibraryCacheManifest,
): Promise<LibraryCacheData | null> {
  signal?.throwIfAborted();
  const paths = libraryCachePaths(directory);
  try {
    const [
      manifestContents,
      collectionFingerprintContents,
      tagCountsContents,
      collectionCountsContents,
      tracksContents,
      collectionTracksContents,
      ordersContents,
    ] = await Promise.all([
      knownManifest ? Promise.resolve("") : readFile(paths.manifest, "utf8"),
      readFile(paths.collectionManifest, "utf8"),
      readFile(paths.tags, "utf8"),
      readFile(paths.collections, "utf8"),
      readFile(paths.tracks),
      readFile(paths.collectionTracks),
      readFile(paths.orders),
    ]);
    signal?.throwIfAborted();
    const manifest =
      knownManifest ?? parseManifest(JSON.parse(manifestContents));
    if (
      !manifest ||
      (fingerprint &&
        !libraryFingerprintsEqual(manifest.fingerprint, fingerprint))
    )
      return null;
    const cachedCollectionFingerprint = parseCountMap(
      JSON.parse(collectionFingerprintContents),
    );
    if (!cachedCollectionFingerprint) return null;
    const tagCounts = parseCountMap(JSON.parse(tagCountsContents));
    const collectionCounts = parseCountMap(
      JSON.parse(collectionCountsContents),
    );
    const tracksValue = deserializeTracks(tracksContents);
    const trackIds = tracksValue?.ids ?? new Set<string>();
    const collectionsValue = deserializeCollections(
      collectionTracksContents,
      cachedCollectionFingerprint,
      trackIds,
    );
    const ordersValue = deserializeOrders(ordersContents, trackIds);
    const snapshot = deserializeSnapshot(
      tracksValue,
      collectionsValue,
      ordersValue,
      manifest.summary,
      tagCounts,
      collectionCounts,
    );
    if (!snapshot) return null;
    if (
      !collectionFingerprintsEqual(
        collectionFingerprint(snapshot.collections),
        cachedCollectionFingerprint,
      )
    )
      return null;
    return {
      snapshot,
      fingerprint: manifest.fingerprint,
      collectionFingerprint: cachedCollectionFingerprint,
      realm: manifest.realm,
    };
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

export async function readLibraryCacheManifest(
  directory: string,
  signal?: LibraryCancellation,
): Promise<LibraryCacheManifest | null> {
  signal?.throwIfAborted();
  try {
    const contents = await readFile(
      libraryCachePaths(directory).manifest,
      "utf8",
    );
    signal?.throwIfAborted();
    return parseManifest(JSON.parse(contents));
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

export function libraryRealmMetadataEqual(
  left: LibraryRealmMetadata,
  right: LibraryRealmMetadata,
): boolean {
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

export async function writeLibraryCache(
  directory: string,
  fingerprint: LibraryFingerprint,
  collectionFingerprint: LibraryCollectionFingerprint,
  realm: LibraryRealmMetadata,
  snapshot: LibrarySnapshot,
  signal?: LibraryCancellation,
): Promise<void> {
  signal?.throwIfAborted();
  await mkdir(dirname(directory), { recursive: true });
  const temporary = `${directory}.${process.pid}.${Date.now()}.tmp`;
  const paths = libraryCachePaths(temporary);
  try {
    const manifest: LibraryCacheManifest = {
      version: libraryCacheVersion,
      fingerprint,
      summary: {
        trackCount: snapshot.summary.trackCount,
        beatmapCount: snapshot.summary.beatmapCount,
        collectionCount: snapshot.summary.collectionCount,
        installPath: snapshot.summary.installPath,
        skippedCount: snapshot.summary.skippedCount,
      },
      realm,
    };
    const tracks = serializeTracks(snapshot);
    const collectionTracks = serializeCollections(snapshot.collections);
    const orders = serializeOrders(snapshot.orders);
    const tags = serializeTagCounts(snapshot);
    const collections = serializeCollectionCounts(snapshot);
    if (
      !tracks ||
      !collectionTracks ||
      !orders ||
      tags === null ||
      collections === null
    )
      throw new Error("Could not encode the library cache binary files.");
    await mkdir(temporary, { recursive: true });
    signal?.throwIfAborted();
    await Promise.all([
      writeFile(paths.manifest, JSON.stringify(manifest), "utf8"),
      writeFile(
        paths.collectionManifest,
        JSON.stringify(collectionFingerprint),
        "utf8",
      ),
      writeFile(paths.tags, tags, "utf8"),
      writeFile(paths.collections, collections, "utf8"),
      writeFile(paths.tracks, tracks),
      writeFile(paths.collectionTracks, collectionTracks),
      writeFile(paths.orders, orders),
    ]);
    signal?.throwIfAborted();
    await rm(directory, { recursive: true, force: true });
    await rename(temporary, directory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    await rm(temporary, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}
