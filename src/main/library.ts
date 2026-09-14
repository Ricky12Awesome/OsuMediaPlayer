import type Realm from "realm";
import { readFile } from "node:fs/promises";
import { posix, join } from "node:path";
import type {
  Beatmap,
  BeatmapCollection,
  BeatmapSet,
} from "../shared/client-model";
import { resolveLazerInstallPath } from "./lazer-path";
import type {
  LibraryFacet,
  LibraryPage,
  LibraryProgress,
  LibraryQuery,
  LibrarySummary,
  SortKey,
  Track,
  TrackLocation,
} from "../shared/types";
import {
  assetUrl,
  hashedFileCandidates,
  isAssetHash,
  type MediaAsset,
} from "./media";

interface RawSet {
  identity: string;
  onlineId: number;
  files: Map<string, { hash: string; filename: string }>;
  beatmapDirectories: Map<string, string>;
}
interface PendingCollection {
  id: string;
  name: string;
  lastModified: number;
  hashes: string[];
}
interface IndexedTrack {
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
}

export type LibraryCollectionFingerprint = Record<string, number>;

export type LibraryCancellation = Pick<AbortSignal, "throwIfAborted">;

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const sorts = new Set<SortKey>([
  "title",
  "artist",
  "duration",
  "bpm",
  "added",
  "stars",
  "collection",
  "tags",
]);
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const beatmapTitle = (map: Beatmap): string =>
  string(map.Metadata?.Title) ||
  string(map.Metadata?.TitleUnicode) ||
  "Untitled";
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const normalize = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase();
const trackSearch = (track: Track): string =>
  normalize(
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
const filenameKey = (value: string): string =>
  normalize(posix.normalize(value.replaceAll("\\", "/")));
const videoExtensions = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".ogv",
  ".mov",
  ".avi",
  ".flv",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".mkv",
]);
const isVideoFilename = (filename: string): boolean =>
  videoExtensions.has(posix.extname(filename).toLocaleLowerCase());

export interface BeatmapVideoEvent {
  filename: string;
  offset: number;
}

/** Reads the first background-video event from an osu! beatmap. */
export function parseBeatmapVideoEvent(
  contents: string,
): BeatmapVideoEvent | null {
  let inEvents = false;
  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = /^\[([^\]]+)]$/.exec(line);
    if (section) {
      inEvents = section[1].toLocaleLowerCase() === "events";
      continue;
    }
    if (!inEvents || !line || line.startsWith("//")) continue;
    const event =
      /^(?:Video|1)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(?:"((?:[^"]|"")*)"|([^,]+))/i.exec(
        line,
      );
    if (!event) continue;
    const milliseconds = Number(event[1]);
    const filename = (event[2] ?? event[3] ?? "").replaceAll('""', '"').trim();
    if (filename && Number.isFinite(milliseconds))
      return { filename, offset: milliseconds / 1000 };
  }
  return null;
}

async function readBeatmapVideoEvent(
  installPath: string,
  hash: string,
): Promise<BeatmapVideoEvent | null> {
  if (!isAssetHash(hash)) return null;
  for (const filename of hashedFileCandidates(installPath, hash)) {
    try {
      return parseBeatmapVideoEvent(await readFile(filename, "utf8"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
    }
  }
  return null;
}

export class LibraryIndex {
  readonly assets: Map<string, MediaAsset>;
  readonly summary: LibrarySummary;
  private readonly indexed: IndexedTrack[];
  private readonly indexedById: Map<string, IndexedTrack>;
  private readonly byId: Map<string, Track>;
  private readonly realm?: Realm;
  private readonly trackIdByBeatmap: ReadonlyMap<string, string>;
  private readonly trackIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>;
  private readonly orderCache = new Map<string, readonly string[]>();
  private readonly queryCache = new Map<string, Track[]>();
  private collections: LibraryCollection[];
  private realmClosed = false;

  constructor(
    tracks: Track[],
    assets: Map<string, MediaAsset>,
    summary: LibrarySummary,
    realm?: Realm,
    trackIdByBeatmap: ReadonlyMap<string, string> = new Map(),
    trackIdsByMd5: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
    initialTitleOrder?: readonly string[],
    beatmapHashesByTrack: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
    initialCollections: readonly LibraryCollection[] = [],
  ) {
    this.assets = assets;
    this.summary = summary;
    this.byId = new Map(tracks.map((track) => [track.id, track]));
    this.indexed = tracks.map((track) => ({
      track,
      search: trackSearch(track),
      tags: new Set(track.tags.map(normalize)),
      collections: new Set(track.collections.map(normalize)),
      beatmapHashes: new Set(
        beatmapHashesByTrack.get(track.id) ??
          (track.md5Hash ? [track.md5Hash] : []),
      ),
    }));
    this.indexedById = new Map(
      this.indexed.map((item) => [item.track.id, item]),
    );
    this.realm = realm;
    this.trackIdByBeatmap = trackIdByBeatmap;
    this.trackIdsByMd5 = trackIdsByMd5;
    this.collections = initialCollections.map((collection) => ({
      ...collection,
      trackIds: [...collection.trackIds],
    }));
    // Realm already supplied this order while the library was materialized.
    if (initialTitleOrder)
      this.orderCache.set("title:ascending", initialTitleOrder);
  }

  /** Materialize one canonical ascending order per sort key. */
  async prepareSortOrders(signal?: LibraryCancellation): Promise<void> {
    for (const sort of sorts) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      signal?.throwIfAborted();
      this.orderFor(sort, false, signal);
    }
  }

  /** Only detached data crosses the worker boundary; Realm stays in its owning process. */
  snapshot(): LibrarySnapshot {
    return {
      assets: new Map(this.assets),
      summary: this.summary,
      indexed: this.indexed,
      orders: new Map(
        [...this.orderCache].filter(([key]) => key.endsWith(":ascending")),
      ),
      collections: this.collections.map((collection) => ({
        ...collection,
        trackIds: [...collection.trackIds],
      })),
    };
  }

  static fromSnapshot(snapshot: LibrarySnapshot): LibraryIndex {
    const index = new LibraryIndex(
      [],
      snapshot.assets,
      snapshot.summary,
      undefined,
      new Map(),
      new Map(),
      undefined,
      new Map(),
      snapshot.collections,
    );
    // Search normalization and facet indexing have already run in the worker.
    Object.assign(index, {
      indexed: snapshot.indexed,
      indexedById: new Map(
        snapshot.indexed.map((item) => [item.track.id, item]),
      ),
      byId: new Map(
        snapshot.indexed.map((item) => [item.track.id, item.track]),
      ),
      orderCache: snapshot.orders,
    });
    return index;
  }

  /** Release the read-only Realm held by this index. */
  close(): void {
    if (!this.realm || this.realmClosed) return;
    this.realm.close();
    this.realmClosed = true;
  }

  sharesRealm(other: LibraryIndex): boolean {
    return this.realm !== undefined && this.realm === other.realm;
  }

  private orderFor(
    sort: SortKey,
    descending: boolean,
    signal?: LibraryCancellation,
  ): readonly string[] {
    signal?.throwIfAborted();
    const key = `${sort}:${descending ? "descending" : "ascending"}`;
    const cached = this.orderCache.get(key);
    if (cached) return cached;
    const ascending = this.orderForAscending(sort, signal);
    if (!descending) return ascending;
    const reversed = [...ascending].reverse();
    this.orderCache.set(key, reversed);
    return reversed;
  }

  private orderForAscending(
    sort: SortKey,
    signal?: LibraryCancellation,
  ): readonly string[] {
    const key = `${sort}:ascending`;
    const cached = this.orderCache.get(key);
    if (cached) return cached;
    const fallback = this.indexed.map((item) => item.track.id);
    const order =
      sort === "collection" && this.collections.length
        ? this.collectionOrderFromSnapshot()
        : this.realm
          ? realmTrackOrder(
              this.realm,
              sort,
              this.trackIdByBeatmap,
              this.trackIdsByMd5,
              fallback,
              signal,
              this.orderCache.get("title:ascending"),
            )
          : this.detachedOrder(sort);
    this.orderCache.set(key, order);
    return order;
  }

  /** Merge only new/changed songs while the worker is still reading. */
  applyBatch(batch: LibrarySnapshot): void {
    const collectionCounts = new Map(
      this.summary.collections.map(({ name, count }) => [name, count]),
    );
    const tagCounts = new Map(
      this.summary.tags.map(({ name, count }) => [name, count]),
    );
    for (const { name } of batch.summary.collections) {
      if (!collectionCounts.has(name)) collectionCounts.set(name, 0);
    }
    const countFacets = (track: Track, delta: number) => {
      for (const name of track.collections)
        collectionCounts.set(name, (collectionCounts.get(name) ?? 0) + delta);
      for (const name of track.tags)
        tagCounts.set(name, (tagCounts.get(name) ?? 0) + delta);
    };
    for (const item of batch.indexed) {
      const previous = this.indexedById.get(item.track.id);
      if (previous) {
        countFacets(previous.track, -1);
        Object.assign(previous, item);
      } else {
        this.indexed.push(item);
        this.indexedById.set(item.track.id, item);
      }
      this.byId.set(item.track.id, item.track);
      countFacets(item.track, 1);
    }
    for (const [hash, asset] of batch.assets) this.assets.set(hash, asset);
    Object.assign(this.summary, batch.summary, {
      collections: [...collectionCounts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => collator.compare(a.name, b.name)),
      tags: [...tagCounts]
        .filter(([, count]) => count > 0)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || collator.compare(a.name, b.name)),
    });
    this.orderCache.clear();
    this.queryCache.clear();
    // Batches arrive in Realm's title order, so this view needs no sorting.
    this.orderCache.set(
      "title:ascending",
      this.indexed.map(({ track }) => track.id),
    );
  }

  /** Replace only collection-derived data while retaining the indexed tracks. */
  replaceCollections(collections: readonly LibraryCollection[]): void {
    this.collections = collections.map((collection) => ({
      ...collection,
      trackIds: [...collection.trackIds],
    }));
    const namesByTrack = new Map<string, string[]>();
    for (const collection of this.collections) {
      for (const id of collection.trackIds) {
        if (!this.byId.has(id)) continue;
        const names = namesByTrack.get(id) ?? [];
        if (!names.includes(collection.name)) names.push(collection.name);
        namesByTrack.set(id, names);
      }
    }
    for (const item of this.indexed) {
      const names = (namesByTrack.get(item.track.id) ?? []).sort(
        collator.compare,
      );
      item.track.collections = names;
      item.collections = new Set(names.map(normalize));
      item.search = trackSearch(item.track);
    }
    const collectionCounts = new Map<string, number>();
    for (const collection of this.collections)
      collectionCounts.set(collection.name, 0);
    for (const item of this.indexed) {
      for (const name of item.track.collections)
        collectionCounts.set(name, (collectionCounts.get(name) ?? 0) + 1);
    }
    this.summary.collectionCount = new Set(
      this.collections.map((collection) => collection.name),
    ).size;
    this.summary.collections = [...collectionCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => collator.compare(a.name, b.name));
    this.orderCache.delete("collection:ascending");
    this.orderCache.delete("collection:descending");
    this.orderCache.set(
      "collection:ascending",
      this.collectionOrderFromSnapshot(),
    );
    this.queryCache.clear();
  }

  private collectionOrderFromSnapshot(): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const collections = [...this.collections].sort(
      (a, b) =>
        collator.compare(a.name, b.name) || collator.compare(a.id, b.id),
    );
    for (const collection of collections) {
      for (const id of collection.trackIds) {
        if (this.byId.has(id) && !seen.has(id)) {
          seen.add(id);
          order.push(id);
        }
      }
    }
    for (const item of this.indexed) {
      if (!seen.has(item.track.id)) {
        seen.add(item.track.id);
        order.push(item.track.id);
      }
    }
    return order;
  }

  private detachedOrder(sort: SortKey): string[] {
    const value = (track: Track): string | number => {
      switch (sort) {
        case "title":
          return track.titleUnicode || track.title;
        case "artist":
          return track.artist;
        case "added":
          return track.addedAt;
        case "collection":
          return track.collections[0] ?? "";
        case "tags":
          return track.tags.join(" ");
        default:
          return track[sort];
      }
    };
    return [...this.byId.values()]
      .sort((a, b) => {
        const left = value(a),
          right = value(b);
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : collator.compare(String(left), String(right));
        return comparison || collator.compare(a.title, b.title);
      })
      .map((track) => track.id);
  }

  getTrack(id: string): Track | null {
    return this.byId.get(id) ?? null;
  }

  getTrackLocation(id: string, input: LibraryQuery = {}): TrackLocation | null {
    if (!this.byId.has(id)) return null;
    const limit = 250;
    let offset = 0;
    while (true) {
      const page = this.query({ ...input, offset, limit });
      const itemIndex = page.items.findIndex((track) => track.id === id);
      if (itemIndex >= 0) {
        return {
          track: page.items[itemIndex],
          index: page.offset + itemIndex,
        };
      }

      const nextOffset = page.offset + page.items.length;
      if (page.items.length === 0 || nextOffset >= page.total) return null;
      offset = nextOffset;
    }
  }

  query(input: LibraryQuery = {}): LibraryPage {
    const search = normalize(string(input.search).slice(0, 1000)).trim();
    const collection = normalize(string(input.collection));
    const tagFilters = [...strings(input.tags), string(input.tag)]
      .map(normalize)
      .filter(Boolean);
    const sort = sorts.has(input.sort as SortKey) ? input.sort! : "title";
    const descending = input.descending === true;
    const favorites = Array.isArray(input.favoriteIds)
      ? new Set(input.favoriteIds.filter((id) => typeof id === "string"))
      : null;
    const key = JSON.stringify([
      search,
      collection,
      tagFilters,
      sort,
      descending,
      favorites ? [...favorites] : null,
    ]);
    let matches = this.queryCache.get(key);
    if (!matches) {
      const terms = search.split(/\s+/).filter(Boolean);
      const ordered = this.orderFor(sort, descending);
      matches = [];
      for (const id of ordered) {
        const item = this.indexedById.get(id);
        if (
          item &&
          (!collection || item.collections.has(collection)) &&
          tagFilters.every((tag) => item.tags.has(tag)) &&
          (!favorites || favorites.has(item.track.id)) &&
          terms.every((term) => item.search.includes(term))
        ) {
          matches.push(item.track);
        }
      }
      if (this.queryCache.size >= 12)
        this.queryCache.delete(this.queryCache.keys().next().value!);
      this.queryCache.set(key, matches);
    }
    const offset = Math.min(
      matches.length,
      Math.max(0, Math.floor(number(input.offset))),
    );
    const limit = Math.min(
      250,
      Math.max(
        1,
        Math.floor(input.limit === undefined ? 80 : number(input.limit)),
      ),
    );
    return {
      items: matches.slice(offset, offset + limit),
      total: matches.length,
      offset,
    };
  }
}

/** Sort persisted title fields in Realm before materializing songs. */
export function sortedLibraryBeatmaps(realm: Realm, descending = false) {
  const maps = realm
    .objects<Beatmap>("Beatmap")
    .filtered("BeatmapSet != nil AND BeatmapSet.DeletePending == false");
  // Realm's tuple direction is `reverse`, so false means ascending.
  return maps.sorted([
    ["Metadata.TitleUnicode", descending],
    ["Metadata.Title", descending],
  ]);
}

/** Read the small Realm metadata fingerprints used to validate disk caches. */
export async function readLibraryFingerprints(
  requestedPath?: string,
  signal?: LibraryCancellation,
): Promise<{
  installPath: string;
  fingerprint: LibraryFingerprint;
  collectionFingerprint: LibraryCollectionFingerprint;
}> {
  signal?.throwIfAborted();
  const installPath = await resolveLazerInstallPath(requestedPath);
  signal?.throwIfAborted();
  const { default: Realm } = await import("realm");
  signal?.throwIfAborted();
  const realm = new Realm({
    path: join(installPath, "client.realm"),
    readOnly: true,
    schemaVersion: 52,
    disableFormatUpgrade: true,
  });
  try {
    signal?.throwIfAborted();
    const sets = realm.objects<BeatmapSet>("BeatmapSet");
    const latest = sets.sorted("DateAdded", true)[0];
    const latestDateAdded = latest?.DateAdded?.getTime() ?? 0;
    const collectionFingerprint: LibraryCollectionFingerprint = {};
    for (const collection of realm.objects<BeatmapCollection>(
      "BeatmapCollection",
    )) {
      const name = collection.Name?.trim();
      if (!name) continue;
      const lastModified = collection.LastModified?.getTime() ?? 0;
      collectionFingerprint[collection.ID.toHexString()] = Number.isFinite(
        lastModified,
      )
        ? lastModified
        : 0;
    }
    return {
      installPath,
      fingerprint: {
        beatmapSetCount: sets.length,
        beatmapCount: realm.objects<Beatmap>("Beatmap").length,
        latestDateAdded: Number.isFinite(latestDateAdded) ? latestDateAdded : 0,
      },
      collectionFingerprint,
    };
  } finally {
    realm.close();
  }
}

export async function readLibraryFingerprint(
  requestedPath?: string,
  signal?: LibraryCancellation,
): Promise<{ installPath: string; fingerprint: LibraryFingerprint }> {
  const result = await readLibraryFingerprints(requestedPath, signal);
  return { installPath: result.installPath, fingerprint: result.fingerprint };
}

/** Rebuild only collection membership from Realm using cached beatmap-to-track mappings. */
export async function readLibraryCollections(
  requestedPath: string,
  trackIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>,
  signal?: LibraryCancellation,
): Promise<LibraryCollection[]> {
  signal?.throwIfAborted();
  const installPath = await resolveLazerInstallPath(requestedPath);
  signal?.throwIfAborted();
  const { default: Realm } = await import("realm");
  signal?.throwIfAborted();
  const realm = new Realm({
    path: join(installPath, "client.realm"),
    readOnly: true,
    schemaVersion: 52,
    disableFormatUpgrade: true,
  });
  try {
    const result: LibraryCollection[] = [];
    for (const collection of realm.objects<BeatmapCollection>(
      "BeatmapCollection",
    )) {
      signal?.throwIfAborted();
      const name = collection.Name?.trim();
      if (!name) continue;
      const trackIds = new Set<string>();
      for (const hash of collection.BeatmapMD5Hashes) {
        for (const id of trackIdsByMd5.get(hash?.toLowerCase() ?? "") ?? [])
          trackIds.add(id);
      }
      const lastModified = collection.LastModified?.getTime() ?? 0;
      result.push({
        id: collection.ID.toHexString(),
        name,
        lastModified: Number.isFinite(lastModified) ? lastModified : 0,
        trackIds: [...trackIds],
      });
    }
    return result;
  } finally {
    realm.close();
  }
}

type RealmSortDescriptor = [string, boolean];

function sortedBeatmaps(
  realm: Realm,
  descriptors: RealmSortDescriptor[],
  descending: boolean,
) {
  const maps = realm
    .objects<Beatmap>("Beatmap")
    .filtered("BeatmapSet != nil AND BeatmapSet.DeletePending == false");
  return maps.sorted(
    descriptors.map(
      ([property]) => [property, descending] as RealmSortDescriptor,
    ),
  );
}

function orderFromBeatmaps(
  maps: Iterable<Beatmap>,
  trackIdByBeatmap: ReadonlyMap<string, string>,
  fallback: readonly string[],
  signal?: LibraryCancellation,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const map of maps) {
    signal?.throwIfAborted();
    const id = trackIdByBeatmap.get(map.ID.toHexString());
    if (id && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of fallback) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  return order;
}

function collectionOrder(
  realm: Realm,
  trackIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>,
  fallback: readonly string[],
  descending: boolean,
  signal?: LibraryCancellation,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const collection of realm
    .objects<BeatmapCollection>("BeatmapCollection")
    .sorted("Name", descending)) {
    signal?.throwIfAborted();
    for (const hash of collection.BeatmapMD5Hashes) {
      signal?.throwIfAborted();
      for (const id of trackIdsByMd5.get(hash?.toLowerCase() ?? "") ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          order.push(id);
        }
      }
    }
  }
  for (const id of fallback) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  return order;
}

function realmTrackOrder(
  realm: Realm,
  sort: SortKey,
  trackIdByBeatmap: ReadonlyMap<string, string>,
  trackIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>,
  fallback: readonly string[],
  signal?: LibraryCancellation,
  cachedTitle?: readonly string[],
): readonly string[] {
  const titleFallback = (): readonly string[] =>
    cachedTitle ??
    orderFromBeatmaps(
      sortedLibraryBeatmaps(realm),
      trackIdByBeatmap,
      fallback,
      signal,
    );
  switch (sort) {
    case "title":
      return titleFallback();
    case "artist":
      return orderFromBeatmaps(
        sortedBeatmaps(
          realm,
          [
            ["Metadata.Artist", false],
            ["Metadata.ArtistUnicode", false],
          ],
          false,
        ),
        trackIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "duration":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["Length", false]], false),
        trackIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "bpm":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["BPM", false]], false),
        trackIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "added":
      return orderFromBeatmaps(
        sortedBeatmaps(
          realm,
          [
            ["LastLocalUpdate", false],
            ["LastOnlineUpdate", false],
          ],
          false,
        ),
        trackIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "stars":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["StarRating", false]], false),
        trackIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "tags":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["Metadata.Tags", false]], false),
        trackIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "collection":
      return collectionOrder(
        realm,
        trackIdsByMd5,
        titleFallback(),
        false,
        signal,
      );
  }
}

/** Read a consistent library snapshot without modifying osu!'s database. */
export async function loadLibraryFromRealm(
  requestedPath?: string,
  onProgress?: (progress: LibraryProgress) => void,
  signal?: LibraryCancellation,
  onBatch?: (index: LibraryIndex) => void,
): Promise<LibraryIndex> {
  signal?.throwIfAborted();
  const installPath = await resolveLazerInstallPath(requestedPath);
  signal?.throwIfAborted();
  const { default: Realm } = await import("realm");
  signal?.throwIfAborted();
  const realm = new Realm({
    path: join(installPath, "client.realm"),
    readOnly: true,
    schemaVersion: 52,
    disableFormatUpgrade: true,
  });
  let handedOff = false;
  try {
    const collectionsByHash = new Map<string, Set<string>>();
    const collectionNames = new Set<string>();
    const pendingCollections: PendingCollection[] = [];
    for (const collection of realm.objects<BeatmapCollection>(
      "BeatmapCollection",
    )) {
      signal?.throwIfAborted();
      const name = collection.Name?.trim();
      if (name) {
        const lastModified = collection.LastModified?.getTime() ?? 0;
        pendingCollections.push({
          id: collection.ID.toHexString(),
          name,
          lastModified: Number.isFinite(lastModified) ? lastModified : 0,
          hashes: [],
        });
        collectionNames.add(name);
        for (const hash of collection.BeatmapMD5Hashes) {
          if (!hash) continue;
          const key = hash.toLowerCase();
          const names = collectionsByHash.get(key) ?? new Set<string>();
          names.add(name);
          collectionsByHash.set(key, names);
          pendingCollections.at(-1)!.hashes.push(key);
        }
      }
    }
    const sortedMaps = sortedLibraryBeatmaps(realm);
    // Filter in Realm and traverse its links directly, without a detached copy of every difficulty.
    function* beatmaps(): Generator<{ map: Beatmap; set: RawSet }> {
      const sets = new Map<string, RawSet>();
      for (const map of sortedMaps) {
        signal?.throwIfAborted();
        const source = map.BeatmapSet!;
        const key = source.ID.toHexString();
        const cached = sets.get(key);
        if (cached) {
          yield { map, set: cached };
          continue;
        }
        const files = new Map<string, { hash: string; filename: string }>();
        const beatmapDirectories = new Map<string, string>();
        for (const usage of source.Files) {
          signal?.throwIfAborted();
          const filename = usage.Filename;
          const hash = usage.File?.Hash?.toLowerCase();
          if (!filename || !hash || !isAssetHash(hash)) continue;
          files.set(filenameKey(filename), { hash, filename });
          if (filename.toLowerCase().endsWith(".osu"))
            beatmapDirectories.set(hash, posix.dirname(filenameKey(filename)));
        }
        const onlineId = source.OnlineID;
        if (typeof onlineId !== "number" || !Number.isInteger(onlineId))
          continue;
        const identity = String(onlineId);
        const set = { identity, onlineId, files, beatmapDirectories };
        sets.set(key, set);
        yield { map, set };
      }
    }
    const index = await buildIndex(
      installPath,
      beatmaps(),
      collectionsByHash,
      collectionNames,
      pendingCollections,
      onProgress,
      signal,
      onBatch,
      realm,
    );
    handedOff = true;
    return index;
  } finally {
    if (!handedOff) realm.close();
  }
}

async function buildIndex(
  installPath: string,
  maps: Iterable<{ map: Beatmap; set: RawSet }>,
  collectionsByHash: Map<string, Set<string>>,
  collectionNames: Set<string>,
  pendingCollections: readonly PendingCollection[],
  onProgress?: (progress: LibraryProgress) => void,
  signal?: LibraryCancellation,
  onBatch?: (index: LibraryIndex) => void,
  realm?: Realm,
): Promise<LibraryIndex> {
  const tracks = new Map<string, Track>();
  const assets = new Map<string, MediaAsset>();
  const pendingVideos: {
    track: Track;
    set: RawSet;
    directory: string;
    beatmapHash: string;
    fallback: MediaAsset;
  }[] = [];
  const trackIdByBeatmap = new Map<string, string>();
  const trackIdsByMd5 = new Map<string, Set<string>>();
  let skippedCount = 0;
  let beatmapCount = 0;
  let lastYield = performance.now();
  let lastPublish = 0;
  const changedTracks = new Map<string, Track>();
  const publishBatch = () => {
    if (!onBatch || !changedTracks.size) return;
    signal?.throwIfAborted();
    const changedAssets = new Map<string, MediaAsset>();
    for (const track of changedTracks.values()) {
      for (const hash of [
        track.audioHash,
        track.backgroundHash,
        track.videoHash,
      ]) {
        if (hash && assets.has(hash))
          changedAssets.set(hash, assets.get(hash)!);
      }
    }
    const batch = finishIndex(
      changedTracks,
      changedAssets,
      installPath,
      beatmapCount,
      skippedCount,
      collectionNames,
      [],
    );
    batch.summary.trackCount = tracks.size;
    onBatch(batch);
    changedTracks.clear();
    lastPublish = performance.now();
  };
  for (const { map, set } of maps) {
    signal?.throwIfAborted();
    beatmapCount++;
    if (beatmapCount % 64 === 0 && performance.now() - lastYield >= 16) {
      onProgress?.({ phase: "reading", records: beatmapCount });
      if (performance.now() - lastPublish >= 150) publishBatch();
      await new Promise<void>((resolve) => setImmediate(resolve));
      signal?.throwIfAborted();
      lastYield = performance.now();
    }
    const hashes = [
      string(map.MD5Hash).toLowerCase(),
      string(map.OnlineMD5Hash).toLowerCase(),
    ];
    const metadata = map.Metadata;
    const directory =
      set?.beatmapDirectories.get(string(map.Hash).toLowerCase()) ?? ".";
    const findAsset = (filename: unknown) =>
      set?.files.get(
        filenameKey(
          posix.join(directory, string(filename).replaceAll("\\", "/")),
        ),
      ) ?? set?.files.get(filenameKey(string(filename)));
    const audio = findAsset(metadata?.AudioFile);
    if (!metadata || !audio) {
      skippedCount++;
      continue;
    }
    const artwork = findAsset(metadata.BackgroundFile);
    const onlineId = set.onlineId > 0 ? set.onlineId : undefined;
    const md5Hash =
      string(map.MD5Hash).toLowerCase() ||
      string(map.OnlineMD5Hash).toLowerCase() ||
      undefined;
    assets.set(audio.hash, { hash: audio.hash, filename: audio.filename });
    if (artwork)
      assets.set(artwork.hash, {
        hash: artwork.hash,
        filename: artwork.filename,
      });
    const id = `${set.identity}-${audio.hash}`;
    trackIdByBeatmap.set(map.ID.toHexString(), id);
    for (const hash of hashes) {
      if (!hash) continue;
      const ids = trackIdsByMd5.get(hash) ?? new Set<string>();
      ids.add(id);
      trackIdsByMd5.set(hash, ids);
    }
    const tags = [
      ...new Set(
        [
          ...string(metadata.Tags).split(/\s+/),
          ...Array.from(metadata.UserTags, (value) => value ?? ""),
        ]
          .map((value) => value.trim().toLocaleLowerCase())
          .filter(Boolean),
      ),
    ];
    const collections = [
      ...new Set(
        hashes.flatMap((hash) => [...(collectionsByHash.get(hash) ?? [])]),
      ),
    ];
    const timestamp =
      (map.LastLocalUpdate ?? map.LastOnlineUpdate)?.getTime() ?? 0;
    const addedAt = Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;
    const current = tracks.get(id);
    if (current) {
      current.difficultyCount++;
      current.tags = [...new Set([...current.tags, ...tags])];
      current.collections = [
        ...new Set([...current.collections, ...collections]),
      ];
      current.duration = Math.max(current.duration, number(map.Length) / 1000);
      current.stars = Math.max(current.stars, number(map.StarRating));
      current.addedAt = Math.max(current.addedAt, addedAt);
      current.artworkUrl ||= artwork ? assetUrl(artwork.hash) : undefined;
      current.backgroundHash ||= artwork?.hash;
      current.onlineId ??= onlineId;
      current.md5Hash ??= md5Hash;
    } else {
      const track: Track = {
        id,
        title: beatmapTitle(map),
        titleUnicode: string(metadata.TitleUnicode) || undefined,
        artist:
          string(metadata.Artist) ||
          string(metadata.ArtistUnicode) ||
          "Unknown artist",
        artistUnicode: string(metadata.ArtistUnicode) || undefined,
        source: string(metadata.Source),
        tags,
        collections,
        duration: Math.max(0, number(map.Length) / 1000),
        bpm: Math.max(0, number(map.BPM)),
        stars: Math.max(0, number(map.StarRating)),
        difficultyCount: 1,
        audioUrl: assetUrl(audio.hash),
        audioHash: audio.hash,
        artworkUrl: artwork ? assetUrl(artwork.hash) : undefined,
        backgroundHash: artwork?.hash,
        onlineId,
        md5Hash,
        addedAt,
      };
      tracks.set(id, track);
      const videos = [...set.files.entries()].filter(([, file]) =>
        isVideoFilename(file.filename),
      );
      if (videos.length) {
        const localPrefix = directory === "." ? "" : `${directory}/`;
        const fallback =
          videos.find(([path]) => posix.dirname(path) === directory)?.[1] ??
          videos.find(([path]) => path.startsWith(localPrefix))?.[1] ??
          videos[0][1];
        pendingVideos.push({
          track,
          set,
          directory,
          beatmapHash: string(map.Hash).toLowerCase(),
          fallback,
        });
      }
    }
    if (onBatch) changedTracks.set(id, tracks.get(id)!);
    if (!lastPublish) publishBatch();
  }
  publishBatch();
  signal?.throwIfAborted();
  onProgress?.({ phase: "indexing", records: beatmapCount });
  const eventCache = new Map<string, Promise<BeatmapVideoEvent | null>>();
  let nextVideo = 0;
  const resolveVideo = async () => {
    while (nextVideo < pendingVideos.length) {
      signal?.throwIfAborted();
      const pending = pendingVideos[nextVideo++];
      const cacheKey = pending.beatmapHash;
      let eventPromise = eventCache.get(cacheKey);
      if (!eventPromise) {
        eventPromise = readBeatmapVideoEvent(installPath, cacheKey);
        eventCache.set(cacheKey, eventPromise);
      }
      const event = await eventPromise;
      const referenced = event
        ? (pending.set.files.get(
            filenameKey(posix.join(pending.directory, event.filename)),
          ) ?? pending.set.files.get(filenameKey(event.filename)))
        : undefined;
      const video =
        referenced && isVideoFilename(referenced.filename)
          ? referenced
          : pending.fallback;
      pending.track.videoUrl = assetUrl(video.hash);
      pending.track.videoHash = video.hash;
      pending.track.videoOffset = referenced && event ? event.offset : 0;
      assets.set(video.hash, { hash: video.hash, filename: video.filename });
      if (onBatch) changedTracks.set(pending.track.id, pending.track);
      if (performance.now() - lastPublish >= 150) publishBatch();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(8, pendingVideos.length) }, () =>
      resolveVideo(),
    ),
  );
  signal?.throwIfAborted();
  publishBatch();
  return finishIndex(
    tracks,
    assets,
    installPath,
    beatmapCount,
    skippedCount,
    collectionNames,
    pendingCollections,
    realm,
    trackIdByBeatmap,
    trackIdsByMd5,
    [...tracks.keys()],
  );
}

function finishIndex(
  tracks: Map<string, Track>,
  assets: Map<string, MediaAsset>,
  installPath: string,
  beatmapCount: number,
  skippedCount: number,
  collectionNames: Set<string>,
  pendingCollections: readonly PendingCollection[],
  realm?: Realm,
  trackIdByBeatmap: ReadonlyMap<string, string> = new Map(),
  trackIdsByMd5: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  initialTitleOrder?: readonly string[],
): LibraryIndex {
  const collectionCounts = new Map(
    [...collectionNames].map((name) => [name, 0]),
  );
  const tagCounts = new Map<string, number>();
  for (const track of tracks.values()) {
    track.tags.sort(collator.compare);
    track.collections.sort(collator.compare);
    for (const name of track.collections)
      collectionCounts.set(name, (collectionCounts.get(name) ?? 0) + 1);
    for (const name of track.tags)
      tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1);
  }
  const facets = (values: Map<string, number>): LibraryFacet[] =>
    [...values].map(([name, count]) => ({ name, count }));
  const beatmapHashesByTrack = new Map<string, Set<string>>();
  for (const [hash, ids] of trackIdsByMd5) {
    for (const id of ids) {
      const hashes = beatmapHashesByTrack.get(id) ?? new Set<string>();
      hashes.add(hash);
      beatmapHashesByTrack.set(id, hashes);
    }
  }
  const collections: LibraryCollection[] = pendingCollections.map(
    (collection) => {
      const trackIds = new Set<string>();
      for (const hash of collection.hashes) {
        for (const id of trackIdsByMd5.get(hash) ?? []) trackIds.add(id);
      }
      return {
        id: collection.id,
        name: collection.name,
        lastModified: collection.lastModified,
        trackIds: [...trackIds],
      };
    },
  );
  return new LibraryIndex(
    [...tracks.values()],
    assets,
    {
      trackCount: tracks.size,
      beatmapCount,
      collectionCount: collectionNames.size,
      collections: facets(collectionCounts).sort((a, b) =>
        collator.compare(a.name, b.name),
      ),
      tags: facets(tagCounts).sort(
        (a, b) => b.count - a.count || collator.compare(a.name, b.name),
      ),
      installPath,
      skippedCount,
    },
    realm,
    trackIdByBeatmap,
    trackIdsByMd5,
    initialTitleOrder,
    beatmapHashesByTrack,
    collections,
  );
}
