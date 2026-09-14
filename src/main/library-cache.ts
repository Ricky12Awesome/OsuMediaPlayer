import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type {
  LibraryCancellation,
  LibraryFingerprint,
  LibrarySnapshot,
} from "./library";
import { isAssetHash, type MediaAsset } from "./media";
import type { LibraryFacet, LibrarySummary, Track } from "../shared/types";

export const libraryCacheVersion = 1;

interface SerializedIndexedTrack {
  track: Track;
  search: string;
  tags: string[];
  collections: string[];
}

interface SerializedLibrarySnapshot {
  assets: [string, MediaAsset][];
  summary: LibrarySummary;
  indexed: SerializedIndexedTrack[];
  orders: [string, string[]][];
}

interface LibraryCacheFile {
  version: number;
  fingerprint: LibraryFingerprint;
  snapshot: SerializedLibrarySnapshot;
}

/** Keep separate libraries from sharing a cache while retaining one stable file. */
export function libraryCachePath(
  cacheDirectory: string,
  installPath: string,
): string {
  const identity = createHash("sha256").update(installPath).digest("hex");
  return join(cacheDirectory, `library-${identity}.json`);
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

export function serializeLibrarySnapshot(
  snapshot: LibrarySnapshot,
): SerializedLibrarySnapshot {
  return {
    assets: [...snapshot.assets],
    summary: snapshot.summary,
    indexed: snapshot.indexed.map((item) => ({
      track: item.track,
      search: item.search,
      tags: [...item.tags],
      collections: [...item.collections],
    })),
    orders: [...snapshot.orders].map(([key, ids]) => [key, [...ids]]),
  };
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

function isTrack(value: unknown): value is Track {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.artist === "string" &&
    typeof value.source === "string" &&
    isStringArray(value.tags) &&
    isStringArray(value.collections) &&
    isFiniteNumber(value.duration) &&
    isFiniteNumber(value.bpm) &&
    isFiniteNumber(value.stars) &&
    isFiniteNumber(value.difficultyCount) &&
    typeof value.audioUrl === "string" &&
    isFiniteNumber(value.addedAt)
  );
}

function isFacetArray(value: unknown): value is LibraryFacet[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        isFiniteNumber(item.count),
    )
  );
}

function isSummary(value: unknown): value is LibrarySummary {
  if (!isRecord(value)) return false;
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

function deserializeSnapshot(value: unknown): LibrarySnapshot | null {
  if (!isRecord(value)) return null;
  if (!isSummary(value.summary)) return null;
  if (!Array.isArray(value.assets) || !Array.isArray(value.indexed))
    return null;
  if (!Array.isArray(value.orders)) return null;

  const assets = new Map<string, MediaAsset>();
  for (const entry of value.assets) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [hash, asset] = entry;
    if (
      typeof hash !== "string" ||
      !isRecord(asset) ||
      typeof asset.hash !== "string" ||
      !isAssetHash(asset.hash) ||
      typeof asset.filename !== "string"
    )
      return null;
    assets.set(hash, { hash: asset.hash, filename: asset.filename });
  }

  const indexed = [] as LibrarySnapshot["indexed"];
  for (const item of value.indexed) {
    if (
      !isRecord(item) ||
      !isTrack(item.track) ||
      typeof item.search !== "string" ||
      !isStringArray(item.tags) ||
      !isStringArray(item.collections)
    )
      return null;
    indexed.push({
      track: item.track,
      search: item.search,
      tags: new Set(item.tags),
      collections: new Set(item.collections),
    });
  }
  if (value.summary.trackCount !== indexed.length) return null;

  const orders = new Map<string, readonly string[]>();
  for (const entry of value.orders) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !isStringArray(entry[1])
    )
      return null;
    orders.set(entry[0], entry[1]);
  }
  return { assets, summary: value.summary, indexed, orders };
}

export async function readLibraryCache(
  filename: string,
  fingerprint: LibraryFingerprint,
  signal?: LibraryCancellation,
): Promise<LibrarySnapshot | null> {
  signal?.throwIfAborted();
  try {
    const contents = await readFile(filename, "utf8");
    signal?.throwIfAborted();
    const parsed: unknown = JSON.parse(contents);
    if (
      !isRecord(parsed) ||
      parsed.version !== libraryCacheVersion ||
      !isRecord(parsed.fingerprint) ||
      !isFiniteNumber(parsed.fingerprint.beatmapSetCount) ||
      !isFiniteNumber(parsed.fingerprint.beatmapCount) ||
      !isFiniteNumber(parsed.fingerprint.latestDateAdded) ||
      !libraryFingerprintsEqual(
        parsed.fingerprint as unknown as LibraryFingerprint,
        fingerprint,
      )
    )
      return null;
    return deserializeSnapshot(parsed.snapshot);
  } catch {
    // Missing, truncated, or manually edited caches are simply rebuilt.
    signal?.throwIfAborted();
    return null;
  }
}

export async function writeLibraryCache(
  filename: string,
  fingerprint: LibraryFingerprint,
  snapshot: LibrarySnapshot,
  signal?: LibraryCancellation,
): Promise<void> {
  signal?.throwIfAborted();
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  try {
    const payload: LibraryCacheFile = {
      version: libraryCacheVersion,
      fingerprint,
      snapshot: serializeLibrarySnapshot(snapshot),
    };
    signal?.throwIfAborted();
    await writeFile(temporary, JSON.stringify(payload), "utf8");
    signal?.throwIfAborted();
    await rename(temporary, filename);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
