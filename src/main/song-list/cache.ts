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
import type { SongListSummary } from "../../shared/types";
import type {
  SongListCollection,
  SongListCollectionFingerprint,
  SongListFingerprint,
  SongListSnapshot,
  SongListCancellation,
} from "./types";
import {
  songListCacheVersion,
  type SongListCacheData,
  type SongListCacheManifest,
  type SongListCachePaths,
  type SongListCacheSummary,
  type SongListRealmMetadata,
} from "./cache-types";
import {
  deserializeCollections,
  deserializeOrders,
  deserializeSnapshot,
  deserializeSongs,
  serializeCollectionCounts,
  serializeCollections,
  serializeOrders,
  serializeTagCounts,
  serializeSongs,
} from "./cache-format";

export { songListCacheVersion } from "./cache-types";
export type {
  SongListCacheData,
  SongListCacheManifest,
  SongListCachePaths,
  SongListCacheSummary,
  SongListRealmMetadata,
} from "./cache-types";

export function songListCachePath(
  cacheDirectory: string,
  installPath: string,
): string {
  const identity = createHash("sha256").update(installPath).digest("hex");
  return join(cacheDirectory, `song-list-${identity}`);
}

export function songListCachePaths(directory: string): SongListCachePaths {
  return {
    directory,
    manifest: join(directory, "manifest.json"),
    collectionManifest: join(directory, "manifest.collections.json"),
    tags: join(directory, "tags.json"),
    collections: join(directory, "collections.json"),
    songs: join(directory, "songs.bin"),
    collectionSongs: join(directory, "collections.bin"),
    orders: join(directory, "orders.bin"),
  };
}

export async function clearSongListCache(
  cacheDirectory: string,
): Promise<void> {
  await rm(cacheDirectory, { recursive: true, force: true });
}

export function songListFingerprintsEqual(
  left: SongListFingerprint,
  right: SongListFingerprint,
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
  left: SongListCollectionFingerprint,
  right: SongListCollectionFingerprint,
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

function isCacheSummary(value: unknown): value is SongListCacheSummary {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.songCount) &&
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

function isFingerprint(value: unknown): value is SongListFingerprint {
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
): value is SongListCollectionFingerprint {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.values(value).every(isFiniteNumber)
  );
}

function isRealmMetadata(value: unknown): value is SongListRealmMetadata {
  return (
    isRecord(value) &&
    isFiniteNumber(value.mtimeMs) &&
    isFiniteNumber(value.size)
  );
}

function parseManifest(value: unknown): SongListCacheManifest | null {
  if (
    !isRecord(value) ||
    value.version !== songListCacheVersion ||
    !isFingerprint(value.fingerprint) ||
    !isCacheSummary(value.summary) ||
    !isRealmMetadata(value.realm)
  )
    return null;
  return value as unknown as SongListCacheManifest;
}

function collectionFingerprint(
  collections: readonly SongListCollection[],
): SongListCollectionFingerprint {
  return Object.fromEntries(
    collections.map((collection) => [collection.id, collection.lastModified]),
  );
}

export async function readSongListCache(
  directory: string,
  fingerprint?: SongListFingerprint,
  signal?: SongListCancellation,
  knownManifest?: SongListCacheManifest,
): Promise<SongListCacheData | null> {
  signal?.throwIfAborted();
  const paths = songListCachePaths(directory);
  try {
    const [
      manifestContents,
      collectionFingerprintContents,
      tagCountsContents,
      collectionCountsContents,
      songsContents,
      collectionSongsContents,
      ordersContents,
    ] = await Promise.all([
      knownManifest ? Promise.resolve("") : readFile(paths.manifest, "utf8"),
      readFile(paths.collectionManifest, "utf8"),
      readFile(paths.tags, "utf8"),
      readFile(paths.collections, "utf8"),
      readFile(paths.songs),
      readFile(paths.collectionSongs),
      readFile(paths.orders),
    ]);
    signal?.throwIfAborted();
    const manifest =
      knownManifest ?? parseManifest(JSON.parse(manifestContents));
    if (
      !manifest ||
      (fingerprint &&
        !songListFingerprintsEqual(manifest.fingerprint, fingerprint))
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
    const songsValue = deserializeSongs(songsContents);
    const songIds = songsValue?.ids ?? new Set<string>();
    const collectionsValue = deserializeCollections(
      collectionSongsContents,
      cachedCollectionFingerprint,
      songIds,
    );
    const ordersValue = deserializeOrders(ordersContents, songIds);
    const snapshot = deserializeSnapshot(
      songsValue,
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

export async function readSongListCacheManifest(
  directory: string,
  signal?: SongListCancellation,
): Promise<SongListCacheManifest | null> {
  signal?.throwIfAborted();
  try {
    const contents = await readFile(
      songListCachePaths(directory).manifest,
      "utf8",
    );
    signal?.throwIfAborted();
    return parseManifest(JSON.parse(contents));
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

export function songListRealmMetadataEqual(
  left: SongListRealmMetadata,
  right: SongListRealmMetadata,
): boolean {
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

export async function writeSongListCache(
  directory: string,
  fingerprint: SongListFingerprint,
  collectionFingerprint: SongListCollectionFingerprint,
  realm: SongListRealmMetadata,
  snapshot: SongListSnapshot,
  signal?: SongListCancellation,
): Promise<void> {
  signal?.throwIfAborted();
  await mkdir(dirname(directory), { recursive: true });
  const temporary = `${directory}.${process.pid}.${Date.now()}.tmp`;
  const paths = songListCachePaths(temporary);
  try {
    const manifest: SongListCacheManifest = {
      version: songListCacheVersion,
      fingerprint,
      summary: {
        songCount: snapshot.summary.songCount,
        beatmapCount: snapshot.summary.beatmapCount,
        collectionCount: snapshot.summary.collectionCount,
        installPath: snapshot.summary.installPath,
        skippedCount: snapshot.summary.skippedCount,
      },
      realm,
    };
    const songs = serializeSongs(snapshot);
    const collectionSongs = serializeCollections(snapshot.collections);
    const orders = serializeOrders(snapshot.orders);
    const tags = serializeTagCounts(snapshot);
    const collections = serializeCollectionCounts(snapshot);
    if (
      !songs ||
      !collectionSongs ||
      !orders ||
      tags === null ||
      collections === null
    )
      throw new Error("Could not encode the song list cache binary files.");
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
      writeFile(paths.songs, songs),
      writeFile(paths.collectionSongs, collectionSongs),
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
