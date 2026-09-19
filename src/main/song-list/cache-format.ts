import { assetUrl, isAssetHash, type MediaAsset } from "../media";
import {
  sortKeys,
  type SongListSummary,
  type SortKey,
  type Song,
} from "../../shared/types";
import type {
  SongListCollection,
  SongListCollectionFingerprint,
  SongListSnapshot,
} from "./types";
import type { SongListCacheSummary } from "./cache-types";
import { collator, normalize, songSearch } from "./utils";

const sortKeyList: readonly SortKey[] = sortKeys;
const sortKeyCodes = new Map(sortKeyList.map((key, index) => [key, index]));
const sortKeysByCode = new Map(sortKeyList.map((key, index) => [index, key]));
const facetCollator = collator;
const songReferenceBytes = 40;
const md5Bytes = 16;
const sha256Bytes = 32;
const binaryVersion = 3;
const songsMagic = Buffer.from("OMTR");
const collectionsMagic = Buffer.from("OMCL");
const ordersMagic = Buffer.from("OMOR");
const songFlagTitleUnicode = 1 << 0;
const songFlagArtistUnicode = 1 << 1;
const songFlagMd5Hash = 1 << 2;
const songFlagBackground = 1 << 3;
const songFlagVideo = 1 << 4;
const songFlagVideoOffset = 1 << 5;
const songKnownFlags =
  songFlagTitleUnicode |
  songFlagArtistUnicode |
  songFlagMd5Hash |
  songFlagBackground |
  songFlagVideo |
  songFlagVideoOffset;

interface DecodedSong {
  song: Song;
  beatmapHashes: Set<string>;
  assets: MediaAsset[];
}

interface DecodedSongs {
  songs: DecodedSong[];
  assets: Map<string, MediaAsset>;
  ids: Set<string>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

export function serializeSongs(snapshot: SongListSnapshot): Buffer | null {
  const chunks: Buffer[] = [binaryHeader(songsMagic, snapshot.indexed.length)];
  const seen = new Set<string>();
  try {
    for (const item of snapshot.indexed) {
      const song = item.song;
      const identity = parseSongId(song.id);
      const audio = assetForHash(snapshot.assets, song.audioHash);
      const dateAddedAt = song.dateAddedAt ?? 0;
      const dateSubmittedAt = song.dateSubmittedAt ?? 0;
      const dateRankedAt = song.dateRankedAt ?? 0;
      const lastPlayedAt = song.lastPlayedAt ?? 0;
      if (
        !identity ||
        !audio ||
        audio.hash !== identity.hash.toLowerCase() ||
        seen.has(song.id) ||
        !Number.isFinite(song.duration) ||
        !Number.isFinite(song.bpm) ||
        !Number.isFinite(song.stars) ||
        !Number.isSafeInteger(song.difficultyCount) ||
        song.difficultyCount < 0 ||
        song.difficultyCount > 0xffffffff ||
        !Number.isSafeInteger(song.addedAt) ||
        song.addedAt < 0 ||
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
      seen.add(song.id);
      const background = assetForHash(snapshot.assets, song.backgroundHash);
      if (song.backgroundHash && !background) return null;
      const video = assetForHash(snapshot.assets, song.videoHash);
      if (song.videoHash && !video) return null;
      const md5Hash = song.md5Hash ? hashBuffer(song.md5Hash, md5Bytes) : null;
      if (song.md5Hash && !md5Hash) return null;
      const beatmapHashes = [...item.beatmapHashes].map((hash) =>
        hashBuffer(hash, md5Bytes),
      );
      if (beatmapHashes.some((hash) => !hash)) return null;
      if (song.videoOffset !== undefined && !Number.isFinite(song.videoOffset))
        return null;
      let flags = 0;
      if (song.titleUnicode !== undefined) flags |= songFlagTitleUnicode;
      if (song.artistUnicode !== undefined) flags |= songFlagArtistUnicode;
      if (md5Hash) flags |= songFlagMd5Hash;
      if (background) flags |= songFlagBackground;
      if (video) flags |= songFlagVideo;
      if (song.videoOffset !== undefined) flags |= songFlagVideoOffset;

      const record = new BinaryWriter();
      record.writeBigInt64(identity.onlineId);
      record.writeBytes(hashBuffer(identity.hash, sha256Bytes)!);
      record.writeUint16(flags);
      record.writeString(song.title);
      if (song.titleUnicode !== undefined)
        record.writeString(song.titleUnicode);
      record.writeString(song.artist);
      if (song.artistUnicode !== undefined)
        record.writeString(song.artistUnicode);
      record.writeString(song.source);
      record.writeFloat64(song.duration);
      record.writeFloat64(song.bpm);
      record.writeFloat64(song.stars);
      record.writeUint32(song.difficultyCount);
      record.writeBigUint64(BigInt(song.addedAt));
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
      if (song.videoOffset !== undefined) record.writeFloat64(song.videoOffset);
      record.writeUint32(song.tags.length);
      for (const tag of song.tags) record.writeString(tag);
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

function parseSongId(
  songId: string,
): { onlineId: bigint; hash: string } | null {
  const hash = songId.slice(-64);
  const identity = songId.slice(0, -65);
  if (!isAssetHash(hash) || !/^-?\d+$/.test(identity)) return null;
  try {
    const onlineId = BigInt(identity);
    if (onlineId < -(1n << 63n) || onlineId > (1n << 63n) - 1n) return null;
    return { onlineId, hash };
  } catch {
    return null;
  }
}

function encodeSongReference(songId: string): Buffer | null {
  const parsed = parseSongId(songId);
  if (!parsed) return null;
  const reference = Buffer.alloc(songReferenceBytes);
  dataView(reference).setBigInt64(0, parsed.onlineId, true);
  Buffer.from(parsed.hash, "hex").copy(reference, 8);
  return reference;
}

function decodeSongReference(data: Buffer, offset: number): string | null {
  if (offset < 0 || offset + songReferenceBytes > data.length) return null;
  const view = dataView(data);
  const onlineId = view.getBigInt64(offset, true).toString();
  const hash = data
    .subarray(offset + 8, offset + songReferenceBytes)
    .toString("hex");
  return `${onlineId}-${hash}`;
}

function deserializeSongRecord(data: Buffer): DecodedSong | null {
  const reader = new BinaryReader(data);
  const onlineId = reader.readBigInt64();
  const audioHash = reader.readBytes(sha256Bytes)?.toString("hex");
  const flags = reader.readUint16();
  if (
    onlineId === null ||
    !audioHash ||
    flags === null ||
    flags & ~songKnownFlags
  )
    return null;
  const title = reader.readString();
  const titleUnicode =
    flags & songFlagTitleUnicode ? reader.readString() : undefined;
  const artist = reader.readString();
  const artistUnicode =
    flags & songFlagArtistUnicode ? reader.readString() : undefined;
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
    flags & songFlagMd5Hash
      ? reader.readBytes(md5Bytes)?.toString("hex")
      : undefined;
  const audioFilename = reader.readString();
  if (
    title === null ||
    (flags & songFlagTitleUnicode && titleUnicode === null) ||
    artist === null ||
    (flags & songFlagArtistUnicode && artistUnicode === null) ||
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
    (flags & songFlagMd5Hash && !md5Hash) ||
    audioFilename === null
  )
    return null;

  let background: MediaAsset | undefined;
  if (flags & songFlagBackground) {
    const filename = reader.readString();
    const hash = reader.readBytes(sha256Bytes)?.toString("hex");
    if (filename === null || !hash) return null;
    background = { hash, filename };
  }
  let video: MediaAsset | undefined;
  if (flags & songFlagVideo) {
    const filename = reader.readString();
    const hash = reader.readBytes(sha256Bytes)?.toString("hex");
    if (filename === null || !hash) return null;
    video = { hash, filename };
  }
  let videoOffset: number | undefined;
  if (flags & songFlagVideoOffset) {
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
  const song: Song = {
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
    song,
    beatmapHashes: new Set(beatmapHashes),
    assets: [
      audio,
      ...(background ? [background] : []),
      ...(video ? [video] : []),
    ],
  };
}

export function deserializeSongs(data: Buffer): DecodedSongs | null {
  const header = parseBinaryHeader(data, songsMagic);
  if (!header) return null;
  const reader = new BinaryReader(data.subarray(header.offset));
  const songs: DecodedSong[] = [];
  const assets = new Map<string, MediaAsset>();
  const ids = new Set<string>();
  for (let index = 0; index < header.count; index++) {
    const length = reader.readUint32();
    if (length === null) return null;
    const record = reader.readBytes(length);
    const decoded = record ? deserializeSongRecord(record) : null;
    if (!decoded || ids.has(decoded.song.id)) return null;
    ids.add(decoded.song.id);
    songs.push(decoded);
    for (const asset of decoded.assets) assets.set(asset.hash, asset);
  }
  return reader.remaining === 0 ? { songs, assets, ids } : null;
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

export function serializeCollections(
  collections: readonly SongListCollection[],
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
    if (collection.songIds.length > 0xffffffff) return null;
    const header = Buffer.alloc(2 + 4);
    header.writeUInt16LE(name.length, 0);
    header.writeUInt32LE(collection.songIds.length, 2);
    chunks.push(id, header, name);
    for (const songId of collection.songIds) {
      const reference = encodeSongReference(songId);
      if (!reference) return null;
      chunks.push(reference);
    }
  }
  return Buffer.concat(chunks);
}

export function serializeOrders(
  orders: ReadonlyMap<string, readonly string[]>,
): Buffer | null {
  const canonical = [...orders].filter(([key]) => key.endsWith(":ascending"));
  const chunks: Buffer[] = [binaryHeader(ordersMagic, canonical.length)];
  for (const [key, songs] of canonical) {
    const sortby = key.slice(0, -":ascending".length) as SortKey;
    const code = sortKeyCodes.get(sortby);
    if (code === undefined || songs.length > 0xffffffff) return null;
    const header = Buffer.alloc(1 + 4);
    header.writeUInt8(code, 0);
    header.writeUInt32LE(songs.length, 1);
    chunks.push(header);
    for (const songId of songs) {
      const reference = encodeSongReference(songId);
      if (!reference) return null;
      chunks.push(reference);
    }
  }
  return Buffer.concat(chunks);
}

export function serializeTagCounts(snapshot: SongListSnapshot): string | null {
  const tags: Record<string, number> = Object.create(null);

  try {
    for (const item of snapshot.indexed) {
      for (const tag of item.song.tags) tags[tag] = (tags[tag] ?? 0) + 1;
    }
    return JSON.stringify(tags);
  } catch {
    return null;
  }
}

export function serializeCollectionCounts(
  snapshot: SongListSnapshot,
): string | null {
  const collections: Record<string, number> = Object.create(null);
  const songIds = new Set(snapshot.indexed.map(({ song }) => song.id));

  try {
    for (const collection of snapshot.collections) {
      if (collections[collection.id] !== undefined) return null;
      let count = 0;
      for (const songId of new Set(collection.songIds)) {
        if (!songIds.has(songId)) return null;
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

export function deserializeCollections(
  data: Buffer,
  collectionFingerprint: SongListCollectionFingerprint,
  songIds: ReadonlySet<string>,
): SongListCollection[] | null {
  const header = parseBinaryHeader(data, collectionsMagic);
  if (!header) return null;
  const result: SongListCollection[] = [];
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
    const songCount = view.getUint32(offset + 2, true);
    offset += 6;
    const nameBytes = nameLength;
    if (nameBytes % 2 !== 0) return null;
    if (offset + nameBytes > data.length) return null;
    const name = data.subarray(offset, offset + nameBytes).toString("utf16le");
    offset += nameBytes;
    const lastModified = collectionFingerprint[id];
    if (!isFiniteNumber(lastModified)) return null;
    const songs: string[] = [];
    for (let songIndex = 0; songIndex < songCount; songIndex++) {
      const songId = decodeSongReference(data, offset);
      if (!songId || !songIds.has(songId)) return null;
      songs.push(songId);
      offset += songReferenceBytes;
    }
    result.push({ id, name, lastModified, songIds: songs });
  }
  return offset === data.length ? result : null;
}

export function deserializeOrders(
  data: Buffer,
  songIds: ReadonlySet<string>,
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
    const songCount = view.getUint32(offset + 1, true);
    offset += 5;
    if (!sortby || result.has(`${sortby}:ascending`)) return null;
    const songs: string[] = [];
    for (let songIndex = 0; songIndex < songCount; songIndex++) {
      const songId = decodeSongReference(data, offset);
      if (!songId || !songIds.has(songId)) return null;
      songs.push(songId);
      offset += songReferenceBytes;
    }
    result.set(`${sortby}:ascending`, songs);
  }
  return offset === data.length ? result : null;
}

export function deserializeSnapshot(
  songsValue: DecodedSongs | null,
  collectionsValue: SongListCollection[] | null,
  ordersValue: Map<string, readonly string[]> | null,
  summary: SongListCacheSummary,
  tagCounts: Record<string, number> | null,
  collectionCountsById: Record<string, number> | null,
): SongListSnapshot | null {
  if (
    !songsValue ||
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
  const fullSummary: SongListSummary = {
    ...summary,
    collections: collectionFacets,
    tags: tagFacets,
  };
  const collectionNamesBySong = new Map<string, string[]>();
  for (const collection of collections) {
    for (const id of collection.songIds) {
      const names = collectionNamesBySong.get(id) ?? [];
      names.push(collection.name);
      collectionNamesBySong.set(id, names);
    }
  }

  const indexed: SongListSnapshot["indexed"] = [];
  for (const decoded of songsValue.songs) {
    const song = decoded.song;
    const collectionsForSong = [
      ...new Set(collectionNamesBySong.get(song.id) ?? []),
    ];
    song.collections = collectionsForSong;
    indexed.push({
      song,
      search: songSearch(song),
      tags: new Set(song.tags.map(normalize)),
      collections: new Set(collectionsForSong.map(normalize)),
      beatmapHashes: decoded.beatmapHashes,
    });
  }
  if (fullSummary.songCount !== indexed.length) return null;
  return {
    assets: songsValue.assets,
    summary: fullSummary,
    indexed,
    orders: ordersValue,
    collections,
  };
}
