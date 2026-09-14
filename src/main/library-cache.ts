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
import type {
  LibraryCancellation,
  LibraryCollection,
  LibraryCollectionFingerprint,
  LibraryFingerprint,
  LibrarySnapshot,
} from "./library";
import { assetUrl, isAssetHash, type MediaAsset } from "./media";
import type { LibrarySummary, SortKey, Track } from "../shared/types";

export const libraryCacheVersion = 2;

export interface LibraryCachePaths {
  directory: string;
  manifest: string;
  tracks: string;
  collections: string;
  orders: string;
}

interface SerializedMedia {
  hash: string;
  filename: string;
}

interface SerializedTrack {
  title: string;
  titleUnicode?: string;
  artist: string;
  artistUnicode?: string;
  source: string;
  tags: string[];
  duration: number;
  bpm: number;
  stars: number;
  difficultyCount: number;
  media: {
    audio: SerializedMedia;
    background?: SerializedMedia;
    video?: SerializedMedia;
  };
  videoOffset?: number;
  onlineId?: number;
  md5Hash?: string;
  addedAt: number;
  beatmapHashes: string[];
}

interface SerializedCollection {
  id: string;
  name: string;
  lastModified: number;
  tracks: string[];
}

interface SerializedOrder {
  sortby: string;
  tracks: string[];
}

interface LibraryCacheManifest {
  version: number;
  fingerprint: LibraryFingerprint;
  collectionFingerprint: LibraryCollectionFingerprint;
  summary: LibrarySummary;
}

export interface LibraryCacheData {
  snapshot: LibrarySnapshot;
  fingerprint: LibraryFingerprint;
  collectionFingerprint: LibraryCollectionFingerprint;
}

const sortKeys = new Set<SortKey>([
  "title",
  "artist",
  "duration",
  "bpm",
  "added",
  "stars",
  "collection",
  "tags",
]);

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
    tracks: join(directory, "tracks.json"),
    collections: join(directory, "collections.ndjson"),
    orders: join(directory, "orders.ndjson"),
  };
}

export function libraryFingerprintsEqual(
  left: LibraryFingerprint,
  right: LibraryFingerprint,
): boolean {
  return (
    left.beatmapSetCount === right.beatmapSetCount &&
    left.beatmapCount === right.beatmapCount &&
    left.latestDateAdded === right.latestDateAdded
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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isMedia(value: unknown): value is SerializedMedia {
  return (
    isRecord(value) &&
    typeof value.hash === "string" &&
    isAssetHash(value.hash) &&
    typeof value.filename === "string"
  );
}

function isBeatmapHash(value: string): boolean {
  return /^[a-f\d]{32}$/i.test(value);
}

function isTrackFields(value: unknown): value is SerializedTrack {
  if (!isRecord(value) || !isRecord(value.media)) return false;
  return (
    typeof value.title === "string" &&
    (value.titleUnicode === undefined ||
      typeof value.titleUnicode === "string") &&
    typeof value.artist === "string" &&
    (value.artistUnicode === undefined ||
      typeof value.artistUnicode === "string") &&
    typeof value.source === "string" &&
    isStringArray(value.tags) &&
    isFiniteNumber(value.duration) &&
    isFiniteNumber(value.bpm) &&
    isFiniteNumber(value.stars) &&
    isFiniteNumber(value.difficultyCount) &&
    isMedia(value.media.audio) &&
    (value.media.background === undefined || isMedia(value.media.background)) &&
    (value.media.video === undefined || isMedia(value.media.video)) &&
    (value.videoOffset === undefined || isFiniteNumber(value.videoOffset)) &&
    (value.onlineId === undefined || isFiniteNumber(value.onlineId)) &&
    (value.md5Hash === undefined || typeof value.md5Hash === "string") &&
    isFiniteNumber(value.addedAt) &&
    isStringArray(value.beatmapHashes) &&
    value.beatmapHashes.every(isBeatmapHash)
  );
}

function isSummary(value: unknown): value is LibrarySummary {
  if (!isRecord(value)) return false;
  const isFacetArray = (facets: unknown): boolean =>
    Array.isArray(facets) &&
    facets.every(
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        isFiniteNumber(item.count),
    );
  return (
    isFiniteNumber(value.trackCount) &&
    isFiniteNumber(value.beatmapCount) &&
    isFiniteNumber(value.collectionCount) &&
    isFacetArray(value.collections) &&
    isFacetArray(value.tags) &&
    typeof value.installPath === "string" &&
    isFiniteNumber(value.skippedCount)
  );
}

function isFingerprint(value: unknown): value is LibraryFingerprint {
  return (
    isRecord(value) &&
    isFiniteNumber(value.beatmapSetCount) &&
    isFiniteNumber(value.beatmapCount) &&
    isFiniteNumber(value.latestDateAdded)
  );
}

function isCollectionFingerprint(
  value: unknown,
): value is LibraryCollectionFingerprint {
  return (
    isRecord(value) &&
    Object.values(value).every((timestamp) => isFiniteNumber(timestamp))
  );
}

function parseNdjson(contents: string): unknown[] | null {
  try {
    const values: unknown[] = [];
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      values.push(JSON.parse(line));
    }
    return values;
  } catch {
    return null;
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function collectionFingerprint(
  collections: readonly LibraryCollection[],
): LibraryCollectionFingerprint {
  return Object.fromEntries(
    collections.map((collection) => [collection.id, collection.lastModified]),
  );
}

function trackSearch(track: Track): string {
  return normalize(
    [
      track.title,
      track.titleUnicode,
      track.artist,
      track.artistUnicode,
      track.source,
      ...track.tags,
      ...track.collections,
    ].join(" "),
  );
}

function serializeMedia(
  assets: ReadonlyMap<string, MediaAsset>,
  hash: string | undefined,
): SerializedMedia | undefined {
  if (!hash) return undefined;
  const asset = assets.get(hash);
  if (!asset) throw new Error(`Missing indexed media asset ${hash}.`);
  return { hash: asset.hash, filename: asset.filename };
}

function serializeTracks(
  snapshot: LibrarySnapshot,
): Record<string, SerializedTrack> {
  const tracks: Record<string, SerializedTrack> = {};
  for (const item of snapshot.indexed) {
    const track = item.track;
    const audio = serializeMedia(snapshot.assets, track.audioHash);
    if (!audio) throw new Error(`Track ${track.id} has no audio asset.`);
    tracks[track.id] = {
      title: track.title,
      titleUnicode: track.titleUnicode,
      artist: track.artist,
      artistUnicode: track.artistUnicode,
      source: track.source,
      tags: [...track.tags],
      duration: track.duration,
      bpm: track.bpm,
      stars: track.stars,
      difficultyCount: track.difficultyCount,
      media: {
        audio,
        background: serializeMedia(snapshot.assets, track.backgroundHash),
        video: serializeMedia(snapshot.assets, track.videoHash),
      },
      videoOffset: track.videoOffset,
      onlineId: track.onlineId,
      md5Hash: track.md5Hash,
      addedAt: track.addedAt,
      beatmapHashes: [...item.beatmapHashes],
    };
  }
  return tracks;
}

function serializeCollections(
  collections: readonly LibraryCollection[],
): string {
  return collections
    .map((collection) =>
      JSON.stringify({
        id: collection.id,
        name: collection.name,
        lastModified: collection.lastModified,
        tracks: collection.trackIds,
      } satisfies SerializedCollection),
    )
    .join("\n");
}

function serializeOrders(
  orders: ReadonlyMap<string, readonly string[]>,
): string {
  return [...orders]
    .filter(([key]) => key.endsWith(":ascending"))
    .map(([key, tracks]) =>
      JSON.stringify({
        sortby: key.slice(0, -":ascending".length),
        tracks: [...tracks],
      } satisfies SerializedOrder),
    )
    .join("\n");
}

function deserializeSnapshot(
  tracksValue: unknown,
  collectionsValue: unknown[],
  ordersValue: unknown[],
  summary: LibrarySummary,
): LibrarySnapshot | null {
  if (!isRecord(tracksValue)) return null;
  const collections: LibraryCollection[] = [];
  const collectionNamesByTrack = new Map<string, string[]>();
  const collectionIds = new Set<string>();
  for (const value of collectionsValue) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      !isFiniteNumber(value.lastModified) ||
      !isStringArray(value.tracks) ||
      collectionIds.has(value.id)
    ) {
      return null;
    }
    collectionIds.add(value.id);
    const collection: LibraryCollection = {
      id: value.id,
      name: value.name,
      lastModified: value.lastModified,
      trackIds: [...new Set(value.tracks)],
    };
    collections.push(collection);
    for (const id of collection.trackIds) {
      const names = collectionNamesByTrack.get(id) ?? [];
      names.push(collection.name);
      collectionNamesByTrack.set(id, names);
    }
  }

  const assets = new Map<string, MediaAsset>();
  const indexed: LibrarySnapshot["indexed"] = [];
  for (const [id, value] of Object.entries(tracksValue)) {
    if (!isTrackFields(value)) return null;
    const collectionsForTrack = [
      ...new Set(collectionNamesByTrack.get(id) ?? []),
    ];
    const audio = value.media.audio;
    const background = value.media.background;
    const video = value.media.video;
    for (const media of [audio, background, video]) {
      if (media) assets.set(media.hash, { ...media });
    }
    const track: Track = {
      id,
      title: value.title,
      titleUnicode: value.titleUnicode,
      artist: value.artist,
      artistUnicode: value.artistUnicode,
      source: value.source,
      tags: [...value.tags],
      collections: collectionsForTrack,
      duration: value.duration,
      bpm: value.bpm,
      stars: value.stars,
      difficultyCount: value.difficultyCount,
      audioUrl: assetUrl(audio.hash),
      audioHash: audio.hash,
      artworkUrl: background ? assetUrl(background.hash) : undefined,
      backgroundHash: background?.hash,
      videoUrl: video ? assetUrl(video.hash) : undefined,
      videoHash: video?.hash,
      videoOffset: value.videoOffset,
      onlineId: value.onlineId,
      md5Hash: value.md5Hash,
      addedAt: value.addedAt,
    };
    indexed.push({
      track,
      search: trackSearch(track),
      tags: new Set(track.tags.map(normalize)),
      collections: new Set(collectionsForTrack.map(normalize)),
      beatmapHashes: new Set(value.beatmapHashes),
    });
  }
  if (summary.trackCount !== indexed.length) return null;

  const orders = new Map<string, readonly string[]>();
  for (const value of ordersValue) {
    if (
      !isRecord(value) ||
      typeof value.sortby !== "string" ||
      !sortKeys.has(value.sortby as SortKey) ||
      !isStringArray(value.tracks) ||
      orders.has(`${value.sortby}:ascending`)
    ) {
      return null;
    }
    orders.set(`${value.sortby}:ascending`, [...value.tracks]);
  }
  return { assets, summary, indexed, orders, collections };
}

export async function readLibraryCache(
  directory: string,
  fingerprint: LibraryFingerprint,
  signal?: LibraryCancellation,
): Promise<LibraryCacheData | null> {
  signal?.throwIfAborted();
  const paths = libraryCachePaths(directory);
  try {
    const [
      manifestContents,
      tracksContents,
      collectionsContents,
      ordersContents,
    ] = await Promise.all([
      readFile(paths.manifest, "utf8"),
      readFile(paths.tracks, "utf8"),
      readFile(paths.collections, "utf8"),
      readFile(paths.orders, "utf8"),
    ]);
    signal?.throwIfAborted();
    const manifestValue: unknown = JSON.parse(manifestContents);
    const tracksValue: unknown = JSON.parse(tracksContents);
    const collectionsValue = parseNdjson(collectionsContents);
    const ordersValue = parseNdjson(ordersContents);
    if (
      !isRecord(manifestValue) ||
      manifestValue.version !== libraryCacheVersion ||
      !isFingerprint(manifestValue.fingerprint) ||
      !isCollectionFingerprint(manifestValue.collectionFingerprint) ||
      !isSummary(manifestValue.summary) ||
      !libraryFingerprintsEqual(manifestValue.fingerprint, fingerprint) ||
      !collectionsValue ||
      !ordersValue
    )
      return null;
    const manifest = manifestValue as unknown as LibraryCacheManifest;
    const snapshot = deserializeSnapshot(
      tracksValue,
      collectionsValue,
      ordersValue,
      manifest.summary,
    );
    if (!snapshot) return null;
    if (
      !collectionFingerprintsEqual(
        collectionFingerprint(snapshot.collections),
        manifest.collectionFingerprint,
      )
    )
      return null;
    return {
      snapshot,
      fingerprint: manifest.fingerprint,
      collectionFingerprint: manifest.collectionFingerprint,
    };
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

export async function writeLibraryCache(
  directory: string,
  fingerprint: LibraryFingerprint,
  collectionFingerprint: LibraryCollectionFingerprint,
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
      collectionFingerprint,
      summary: snapshot.summary,
    };
    const tracks = serializeTracks(snapshot);
    const collections = serializeCollections(snapshot.collections);
    const orders = serializeOrders(snapshot.orders);
    await mkdir(temporary, { recursive: true });
    signal?.throwIfAborted();
    await Promise.all([
      writeFile(paths.manifest, JSON.stringify(manifest), "utf8"),
      writeFile(paths.tracks, JSON.stringify(tracks), "utf8"),
      writeFile(
        paths.collections,
        collections ? `${collections}\n` : "",
        "utf8",
      ),
      writeFile(paths.orders, orders ? `${orders}\n` : "", "utf8"),
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
