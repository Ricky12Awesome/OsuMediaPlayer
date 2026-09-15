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

const sortKeyList: SortKey[] = [
  "title",
  "artist",
  "duration",
  "bpm",
  "added",
  "dateAdded",
  "dateSubmitted",
  "dateRanked",
  "lastPlayed",
  "stars",
  "collection",
  "tags",
];
const sortKeyCodes = new Map(sortKeyList.map((key, index) => [key, index]));
const sortKeysByCode = new Map(sortKeyList.map((key, index) => [index, key]));
const facetCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const trackReferenceBytes = 40;
const md5Bytes = 16;
const sha256Bytes = 32;
const binaryVersion = 3;
const tracksMagic = Buffer.from("OMTR");
const collectionsMagic = Buffer.from("OMCL");
const ordersMagic = Buffer.from("OMOR");
const trackFlagTitleUnicode = 1 << 0;
const trackFlagArtistUnicode = 1 << 1;
const trackFlagMd5Hash = 1 << 2;
const trackFlagBackground = 1 << 3;
const trackFlagVideo = 1 << 4;
const trackFlagVideoOffset = 1 << 5;
const trackKnownFlags =
  trackFlagTitleUnicode |
  trackFlagArtistUnicode |
  trackFlagMd5Hash |
  trackFlagBackground |
  trackFlagVideo |
  trackFlagVideoOffset;

interface DecodedTrack {
  track: Track;
  beatmapHashes: Set<string>;
  assets: MediaAsset[];
}

interface DecodedTracks {
  tracks: DecodedTrack[];
  assets: Map<string, MediaAsset>;
  ids: Set<string>;
}

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

function dataView(data: Buffer): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

class BinaryWriter {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  writeBytes(value: Buffer): void {
    this.chunks.push(value);
    this.size += value.length;
  }

  writeUint16(value: number): void {
    const data = Buffer.alloc(2);
    data.writeUInt16LE(value, 0);
    this.writeBytes(data);
  }

  writeUint32(value: number): void {
    const data = Buffer.alloc(4);
    data.writeUInt32LE(value, 0);
    this.writeBytes(data);
  }

  writeBigInt64(value: bigint): void {
    const data = Buffer.alloc(8);
    dataView(data).setBigInt64(0, value, true);
    this.writeBytes(data);
  }

  writeBigUint64(value: bigint): void {
    const data = Buffer.alloc(8);
    dataView(data).setBigUint64(0, value, true);
    this.writeBytes(data);
  }

  writeFloat64(value: number): void {
    const data = Buffer.alloc(8);
    dataView(data).setFloat64(0, value, true);
    this.writeBytes(data);
  }

  writeString(value: string): void {
    const data = Buffer.from(value, "utf16le");
    if (data.length > 0xffff || data.length % 2 !== 0)
      throw new Error("Cache string exceeds the UTF-16 binary length limit.");
    this.writeUint16(data.length);
    this.writeBytes(data);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.size);
  }
}

class BinaryReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly data: Buffer) {
    this.view = dataView(data);
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  readBytes(length: number): Buffer | null {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining)
      return null;
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readUint16(): number | null {
    if (this.remaining < 2) return null;
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32(): number | null {
    if (this.remaining < 4) return null;
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readBigInt64(): bigint | null {
    if (this.remaining < 8) return null;
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readBigUint64(): bigint | null {
    if (this.remaining < 8) return null;
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readFloat64(): number | null {
    if (this.remaining < 8) return null;
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readString(): string | null {
    const byteLength = this.readUint16();
    if (byteLength === null || byteLength % 2 !== 0) return null;
    const value = this.readBytes(byteLength);
    return value?.toString("utf16le") ?? null;
  }
}

function hashBuffer(value: string, bytes: number): Buffer | null {
  const expectedLength = bytes * 2;
  if (value.length !== expectedLength || !/^[a-f\d]+$/i.test(value))
    return null;
  return Buffer.from(value, "hex");
}

function assetForHash(
  assets: ReadonlyMap<string, MediaAsset>,
  hash: string | undefined,
): MediaAsset | null {
  if (!hash || !isAssetHash(hash)) return null;
  const asset = assets.get(hash) ?? assets.get(hash.toLowerCase());
  return asset && isAssetHash(asset.hash)
    ? { hash: asset.hash.toLowerCase(), filename: asset.filename }
    : null;
}

function serializeTracks(snapshot: LibrarySnapshot): Buffer | null {
  const chunks: Buffer[] = [binaryHeader(tracksMagic, snapshot.indexed.length)];
  const seen = new Set<string>();
  try {
    for (const item of snapshot.indexed) {
      const track = item.track;
      const identity = parseTrackId(track.id);
      const audio = assetForHash(snapshot.assets, track.audioHash);
      const dateAddedAt = track.dateAddedAt ?? 0;
      const dateSubmittedAt = track.dateSubmittedAt ?? 0;
      const dateRankedAt = track.dateRankedAt ?? 0;
      const lastPlayedAt = track.lastPlayedAt ?? 0;
      if (
        !identity ||
        !audio ||
        audio.hash !== identity.hash.toLowerCase() ||
        seen.has(track.id) ||
        !Number.isFinite(track.duration) ||
        !Number.isFinite(track.bpm) ||
        !Number.isFinite(track.stars) ||
        !Number.isSafeInteger(track.difficultyCount) ||
        track.difficultyCount < 0 ||
        track.difficultyCount > 0xffffffff ||
        !Number.isSafeInteger(track.addedAt) ||
        track.addedAt < 0 ||
        !Number.isSafeInteger(dateAddedAt) ||
        dateAddedAt < 0 ||
        !Number.isSafeInteger(dateSubmittedAt) ||
        dateSubmittedAt < 0 ||
        !Number.isSafeInteger(dateRankedAt) ||
        dateRankedAt < 0 ||
        !Number.isSafeInteger(lastPlayedAt) ||
        lastPlayedAt < 0
      )
        return null;
      seen.add(track.id);
      const background = assetForHash(snapshot.assets, track.backgroundHash);
      if (track.backgroundHash && !background) return null;
      const video = assetForHash(snapshot.assets, track.videoHash);
      if (track.videoHash && !video) return null;
      const md5Hash = track.md5Hash
        ? hashBuffer(track.md5Hash, md5Bytes)
        : null;
      if (track.md5Hash && !md5Hash) return null;
      const beatmapHashes = [...item.beatmapHashes].map((hash) =>
        hashBuffer(hash, md5Bytes),
      );
      if (beatmapHashes.some((hash) => !hash)) return null;
      if (
        track.videoOffset !== undefined &&
        !Number.isFinite(track.videoOffset)
      )
        return null;
      let flags = 0;
      if (track.titleUnicode !== undefined) flags |= trackFlagTitleUnicode;
      if (track.artistUnicode !== undefined) flags |= trackFlagArtistUnicode;
      if (md5Hash) flags |= trackFlagMd5Hash;
      if (background) flags |= trackFlagBackground;
      if (video) flags |= trackFlagVideo;
      if (track.videoOffset !== undefined) flags |= trackFlagVideoOffset;

      const record = new BinaryWriter();
      record.writeBigInt64(identity.onlineId);
      record.writeBytes(hashBuffer(identity.hash, sha256Bytes)!);
      record.writeUint16(flags);
      record.writeString(track.title);
      if (track.titleUnicode !== undefined)
        record.writeString(track.titleUnicode);
      record.writeString(track.artist);
      if (track.artistUnicode !== undefined)
        record.writeString(track.artistUnicode);
      record.writeString(track.source);
      record.writeFloat64(track.duration);
      record.writeFloat64(track.bpm);
      record.writeFloat64(track.stars);
      record.writeUint32(track.difficultyCount);
      record.writeBigUint64(BigInt(track.addedAt));
      record.writeBigUint64(BigInt(dateAddedAt));
      record.writeBigUint64(BigInt(dateSubmittedAt));
      record.writeBigUint64(BigInt(dateRankedAt));
      record.writeBigUint64(BigInt(lastPlayedAt));
      if (md5Hash) record.writeBytes(md5Hash);
      record.writeString(audio.filename);
      if (background) {
        record.writeString(background.filename);
        record.writeBytes(hashBuffer(background.hash, sha256Bytes)!);
      }
      if (video) {
        record.writeString(video.filename);
        record.writeBytes(hashBuffer(video.hash, sha256Bytes)!);
      }
      if (track.videoOffset !== undefined)
        record.writeFloat64(track.videoOffset);
      record.writeUint32(track.tags.length);
      for (const tag of track.tags) record.writeString(tag);
      record.writeUint32(beatmapHashes.length);
      for (const hash of beatmapHashes) record.writeBytes(hash!);
      const bytes = record.toBuffer();
      if (bytes.length > 0xffffffff) return null;
      const length = Buffer.alloc(4);
      length.writeUInt32LE(bytes.length, 0);
      chunks.push(length, bytes);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

function binaryHeader(magic: Buffer, recordCount: number): Buffer {
  const header = Buffer.alloc(10);
  magic.copy(header, 0);
  header.writeUInt16LE(binaryVersion, 4);
  header.writeUInt32LE(recordCount, 6);
  return header;
}

function parseTrackId(
  trackId: string,
): { onlineId: bigint; hash: string } | null {
  const hash = trackId.slice(-64);
  const identity = trackId.slice(0, -65);
  if (!isAssetHash(hash) || !/^-?\d+$/.test(identity)) return null;
  try {
    const onlineId = BigInt(identity);
    if (onlineId < -(1n << 63n) || onlineId > (1n << 63n) - 1n) return null;
    return { onlineId, hash };
  } catch {
    return null;
  }
}

function encodeTrackReference(trackId: string): Buffer | null {
  const parsed = parseTrackId(trackId);
  if (!parsed) return null;
  const reference = Buffer.alloc(trackReferenceBytes);
  dataView(reference).setBigInt64(0, parsed.onlineId, true);
  Buffer.from(parsed.hash, "hex").copy(reference, 8);
  return reference;
}

function decodeTrackReference(data: Buffer, offset: number): string | null {
  if (offset < 0 || offset + trackReferenceBytes > data.length) return null;
  const view = dataView(data);
  const onlineId = view.getBigInt64(offset, true).toString();
  const hash = data
    .subarray(offset + 8, offset + trackReferenceBytes)
    .toString("hex");
  return `${onlineId}-${hash}`;
}

function deserializeTrackRecord(data: Buffer): DecodedTrack | null {
  const reader = new BinaryReader(data);
  const onlineId = reader.readBigInt64();
  const audioHash = reader.readBytes(sha256Bytes)?.toString("hex");
  const flags = reader.readUint16();
  if (
    onlineId === null ||
    !audioHash ||
    flags === null ||
    flags & ~trackKnownFlags
  )
    return null;
  const title = reader.readString();
  const titleUnicode =
    flags & trackFlagTitleUnicode ? reader.readString() : undefined;
  const artist = reader.readString();
  const artistUnicode =
    flags & trackFlagArtistUnicode ? reader.readString() : undefined;
  const source = reader.readString();
  const duration = reader.readFloat64();
  const bpm = reader.readFloat64();
  const stars = reader.readFloat64();
  const difficultyCount = reader.readUint32();
  const addedAt = reader.readBigUint64();
  const dateAddedAt = reader.readBigUint64();
  const dateSubmittedAt = reader.readBigUint64();
  const dateRankedAt = reader.readBigUint64();
  const lastPlayedAt = reader.readBigUint64();
  const md5Hash =
    flags & trackFlagMd5Hash
      ? reader.readBytes(md5Bytes)?.toString("hex")
      : undefined;
  const audioFilename = reader.readString();
  if (
    title === null ||
    (flags & trackFlagTitleUnicode && titleUnicode === null) ||
    artist === null ||
    (flags & trackFlagArtistUnicode && artistUnicode === null) ||
    source === null ||
    duration === null ||
    !Number.isFinite(duration) ||
    bpm === null ||
    !Number.isFinite(bpm) ||
    stars === null ||
    !Number.isFinite(stars) ||
    difficultyCount === null ||
    addedAt === null ||
    addedAt > BigInt(Number.MAX_SAFE_INTEGER) ||
    dateAddedAt === null ||
    dateAddedAt > BigInt(Number.MAX_SAFE_INTEGER) ||
    dateSubmittedAt === null ||
    dateSubmittedAt > BigInt(Number.MAX_SAFE_INTEGER) ||
    dateRankedAt === null ||
    dateRankedAt > BigInt(Number.MAX_SAFE_INTEGER) ||
    lastPlayedAt === null ||
    lastPlayedAt > BigInt(Number.MAX_SAFE_INTEGER) ||
    (flags & trackFlagMd5Hash && !md5Hash) ||
    audioFilename === null
  )
    return null;

  let background: MediaAsset | undefined;
  if (flags & trackFlagBackground) {
    const filename = reader.readString();
    const hash = reader.readBytes(sha256Bytes)?.toString("hex");
    if (filename === null || !hash) return null;
    background = { hash, filename };
  }
  let video: MediaAsset | undefined;
  if (flags & trackFlagVideo) {
    const filename = reader.readString();
    const hash = reader.readBytes(sha256Bytes)?.toString("hex");
    if (filename === null || !hash) return null;
    video = { hash, filename };
  }
  let videoOffset: number | undefined;
  if (flags & trackFlagVideoOffset) {
    videoOffset = reader.readFloat64() ?? undefined;
    if (videoOffset === undefined || !Number.isFinite(videoOffset)) return null;
  }
  const tagCount = reader.readUint32();
  if (tagCount === null) return null;
  const tags: string[] = [];
  for (let index = 0; index < tagCount; index++) {
    const tag = reader.readString();
    if (tag === null) return null;
    tags.push(tag);
  }
  const beatmapHashCount = reader.readUint32();
  if (beatmapHashCount === null) return null;
  const beatmapHashes: string[] = [];
  for (let index = 0; index < beatmapHashCount; index++) {
    const hash = reader.readBytes(md5Bytes)?.toString("hex");
    if (!hash) return null;
    beatmapHashes.push(hash);
  }
  if (reader.remaining !== 0) return null;

  const audio: MediaAsset = { hash: audioHash, filename: audioFilename };
  const track: Track = {
    id: `${onlineId.toString()}-${audioHash}`,
    title,
    titleUnicode: titleUnicode ?? undefined,
    artist,
    artistUnicode: artistUnicode ?? undefined,
    source,
    tags,
    collections: [],
    duration,
    bpm,
    stars,
    difficultyCount,
    audioUrl: assetUrl(audio.hash),
    audioHash: audio.hash,
    artworkUrl: background ? assetUrl(background.hash) : undefined,
    backgroundHash: background?.hash,
    videoUrl: video ? assetUrl(video.hash) : undefined,
    videoHash: video?.hash,
    videoOffset,
    onlineId: onlineId > 0n ? Number(onlineId) : undefined,
    md5Hash: md5Hash ?? undefined,
    addedAt: Number(addedAt),
    dateAddedAt: Number(dateAddedAt),
    dateSubmittedAt: Number(dateSubmittedAt),
    dateRankedAt: Number(dateRankedAt),
    lastPlayedAt: Number(lastPlayedAt),
  };
  return {
    track,
    beatmapHashes: new Set(beatmapHashes),
    assets: [
      audio,
      ...(background ? [background] : []),
      ...(video ? [video] : []),
    ],
  };
}

function deserializeTracks(data: Buffer): DecodedTracks | null {
  const header = parseBinaryHeader(data, tracksMagic);
  if (!header) return null;
  const reader = new BinaryReader(data.subarray(header.offset));
  const tracks: DecodedTrack[] = [];
  const assets = new Map<string, MediaAsset>();
  const ids = new Set<string>();
  for (let index = 0; index < header.count; index++) {
    const length = reader.readUint32();
    if (length === null) return null;
    const record = reader.readBytes(length);
    const decoded = record ? deserializeTrackRecord(record) : null;
    if (!decoded || ids.has(decoded.track.id)) return null;
    ids.add(decoded.track.id);
    tracks.push(decoded);
    for (const asset of decoded.assets) assets.set(asset.hash, asset);
  }
  return reader.remaining === 0 ? { tracks, assets, ids } : null;
}

function encodeCollectionId(id: string): Buffer | null {
  const hex = id.replaceAll("-", "");
  return /^[a-f\d]{32}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}

function formatCollectionId(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decodeCollectionId(data: Buffer, offset: number): string | null {
  if (offset < 0 || offset + 16 > data.length) return null;
  return formatCollectionId(data.subarray(offset, offset + 16).toString("hex"));
}

function serializeCollections(
  collections: readonly LibraryCollection[],
): Buffer | null {
  const chunks: Buffer[] = [binaryHeader(collectionsMagic, collections.length)];
  const seen = new Set<string>();
  for (const collection of collections) {
    const id = encodeCollectionId(collection.id);
    const name = Buffer.from(collection.name, "utf16le");
    if (
      !id ||
      seen.has(collection.id) ||
      name.length % 2 !== 0 ||
      name.length > 0xffff
    )
      return null;
    seen.add(collection.id);
    if (collection.trackIds.length > 0xffffffff) return null;
    const header = Buffer.alloc(2 + 4);
    header.writeUInt16LE(name.length, 0);
    header.writeUInt32LE(collection.trackIds.length, 2);
    chunks.push(id, header, name);
    for (const trackId of collection.trackIds) {
      const reference = encodeTrackReference(trackId);
      if (!reference) return null;
      chunks.push(reference);
    }
  }
  return Buffer.concat(chunks);
}

function serializeOrders(
  orders: ReadonlyMap<string, readonly string[]>,
): Buffer | null {
  const canonical = [...orders].filter(([key]) => key.endsWith(":ascending"));
  const chunks: Buffer[] = [binaryHeader(ordersMagic, canonical.length)];
  for (const [key, tracks] of canonical) {
    const sortby = key.slice(0, -":ascending".length) as SortKey;
    const code = sortKeyCodes.get(sortby);
    if (code === undefined || tracks.length > 0xffffffff) return null;
    const header = Buffer.alloc(1 + 4);
    header.writeUInt8(code, 0);
    header.writeUInt32LE(tracks.length, 1);
    chunks.push(header);
    for (const trackId of tracks) {
      const reference = encodeTrackReference(trackId);
      if (!reference) return null;
      chunks.push(reference);
    }
  }
  return Buffer.concat(chunks);
}

function serializeTagCounts(snapshot: LibrarySnapshot): string | null {
  const tags: Record<string, number> = Object.create(null);

  try {
    for (const item of snapshot.indexed) {
      for (const tag of item.track.tags) tags[tag] = (tags[tag] ?? 0) + 1;
    }
    return JSON.stringify(tags);
  } catch {
    return null;
  }
}

function serializeCollectionCounts(snapshot: LibrarySnapshot): string | null {
  const collections: Record<string, number> = Object.create(null);
  const trackIds = new Set(snapshot.indexed.map(({ track }) => track.id));

  try {
    for (const collection of snapshot.collections) {
      if (collections[collection.id] !== undefined) return null;
      let count = 0;
      for (const trackId of new Set(collection.trackIds)) {
        if (!trackIds.has(trackId)) return null;
        count++;
      }
      collections[collection.id] = count;
    }
    return JSON.stringify(collections);
  } catch {
    return null;
  }
}

function parseBinaryHeader(
  data: Buffer,
  magic: Buffer,
): { offset: number; count: number } | null {
  if (data.length < 10 || !data.subarray(0, 4).equals(magic)) return null;
  const view = dataView(data);
  if (view.getUint16(4, true) !== binaryVersion) return null;
  return { offset: 10, count: view.getUint32(6, true) };
}

function deserializeCollections(
  data: Buffer,
  collectionFingerprint: LibraryCollectionFingerprint,
  trackIds: ReadonlySet<string>,
): LibraryCollection[] | null {
  const header = parseBinaryHeader(data, collectionsMagic);
  if (!header) return null;
  const result: LibraryCollection[] = [];
  let offset = header.offset;
  const seen = new Set<string>();
  const view = dataView(data);
  for (let index = 0; index < header.count; index++) {
    const id = decodeCollectionId(data, offset);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    offset += 16;
    if (offset + 6 > data.length) return null;
    const nameLength = view.getUint16(offset, true);
    const trackCount = view.getUint32(offset + 2, true);
    offset += 6;
    const nameBytes = nameLength;
    if (nameBytes % 2 !== 0) return null;
    if (offset + nameBytes > data.length) return null;
    const name = data.subarray(offset, offset + nameBytes).toString("utf16le");
    offset += nameBytes;
    const lastModified = collectionFingerprint[id];
    if (!isFiniteNumber(lastModified)) return null;
    const tracks: string[] = [];
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
      const trackId = decodeTrackReference(data, offset);
      if (!trackId || !trackIds.has(trackId)) return null;
      tracks.push(trackId);
      offset += trackReferenceBytes;
    }
    result.push({ id, name, lastModified, trackIds: tracks });
  }
  return offset === data.length ? result : null;
}

function deserializeOrders(
  data: Buffer,
  trackIds: ReadonlySet<string>,
): Map<string, readonly string[]> | null {
  const header = parseBinaryHeader(data, ordersMagic);
  if (!header) return null;
  const result = new Map<string, readonly string[]>();
  let offset = header.offset;
  const view = dataView(data);
  for (let index = 0; index < header.count; index++) {
    if (offset + 5 > data.length) return null;
    const code = view.getUint8(offset);
    const sortby = sortKeysByCode.get(code);
    const trackCount = view.getUint32(offset + 1, true);
    offset += 5;
    if (!sortby || result.has(`${sortby}:ascending`)) return null;
    const tracks: string[] = [];
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
      const trackId = decodeTrackReference(data, offset);
      if (!trackId || !trackIds.has(trackId)) return null;
      tracks.push(trackId);
      offset += trackReferenceBytes;
    }
    result.set(`${sortby}:ascending`, tracks);
  }
  return offset === data.length ? result : null;
}

function deserializeSnapshot(
  tracksValue: DecodedTracks | null,
  collectionsValue: LibraryCollection[] | null,
  ordersValue: Map<string, readonly string[]> | null,
  summary: LibraryCacheSummary,
  tagCounts: Record<string, number> | null,
  collectionCountsById: Record<string, number> | null,
): LibrarySnapshot | null {
  if (
    !tracksValue ||
    !collectionsValue ||
    !ordersValue ||
    !tagCounts ||
    !collectionCountsById
  )
    return null;
  const collections = collectionsValue;
  const collectionIds = new Set(collections.map((collection) => collection.id));
  const facetCollectionIds = Object.keys(collectionCountsById);
  if (
    facetCollectionIds.length !== collectionIds.size ||
    facetCollectionIds.some((id) => !collectionIds.has(id))
  )
    return null;

  const collectionCounts = new Map<string, number>();
  for (const collection of collections) {
    const count = collectionCountsById[collection.id];
    if (!Number.isSafeInteger(count) || count < 0) return null;
    collectionCounts.set(
      collection.name,
      (collectionCounts.get(collection.name) ?? 0) + count,
    );
  }
  const collectionFacets = [...collectionCounts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => facetCollator.compare(a.name, b.name));
  const tagFacets = Object.entries(tagCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || facetCollator.compare(a.name, b.name));
  if (summary.collectionCount !== collectionFacets.length) return null;
  const fullSummary: LibrarySummary = {
    ...summary,
    collections: collectionFacets,
    tags: tagFacets,
  };
  const collectionNamesByTrack = new Map<string, string[]>();
  for (const collection of collections) {
    for (const id of collection.trackIds) {
      const names = collectionNamesByTrack.get(id) ?? [];
      names.push(collection.name);
      collectionNamesByTrack.set(id, names);
    }
  }

  const indexed: LibrarySnapshot["indexed"] = [];
  for (const decoded of tracksValue.tracks) {
    const track = decoded.track;
    const collectionsForTrack = [
      ...new Set(collectionNamesByTrack.get(track.id) ?? []),
    ];
    track.collections = collectionsForTrack;
    indexed.push({
      track,
      search: trackSearch(track),
      tags: new Set(track.tags.map(normalize)),
      collections: new Set(collectionsForTrack.map(normalize)),
      beatmapHashes: decoded.beatmapHashes,
    });
  }
  if (fullSummary.trackCount !== indexed.length) return null;
  return {
    assets: tracksValue.assets,
    summary: fullSummary,
    indexed,
    orders: ordersValue,
    collections,
  };
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
