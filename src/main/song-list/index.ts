import type Realm from "realm";
import type {
  SongListPage,
  SongListQuery,
  SongListSummary,
  SortKey,
  Song,
  SongLocation,
} from "../../shared/types";
import { assetUrl, type MediaAsset } from "../media";
import { realmSongOrder } from "./realm";
import { matchesSearch, parseSearch } from "./search";
import type {
  SongListCancellation,
  SongListCollection,
  SongListSnapshot,
  IndexedSong,
} from "./types";
import {
  collator,
  normalize,
  number,
  sorts,
  string,
  strings,
  songSearch,
} from "./utils";

export { loadSongListFromRealm, parseBeatmapVideoEvent } from "./builder";
export {
  readSongListCollections,
  readSongListFingerprint,
  readSongListFingerprints,
  sortedSongListBeatmaps,
} from "./realm";
export type { BeatmapVideoEvent } from "./builder";
export type {
  IndexedSong,
  SongListCancellation,
  SongListCollection,
  SongListCollectionFingerprint,
  SongListFingerprint,
  SongListSnapshot,
} from "./types";

export class SongListIndex {
  readonly assets: Map<string, MediaAsset>;
  readonly summary: SongListSummary;
  private readonly indexed: IndexedSong[];
  private readonly indexedById: Map<string, IndexedSong>;
  private readonly byId: Map<string, Song>;
  private readonly realm?: Realm;
  private readonly songIdByBeatmap: ReadonlyMap<string, string>;
  private readonly songIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>;
  private readonly orderCache = new Map<string, readonly string[]>();
  private readonly queryCache = new Map<string, Song[]>();
  private collections: SongListCollection[];
  private realmClosed = false;

  constructor(
    songs: Song[],
    assets: Map<string, MediaAsset>,
    summary: SongListSummary,
    realm?: Realm,
    songIdByBeatmap: ReadonlyMap<string, string> = new Map(),
    songIdsByMd5: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
    initialTitleOrder?: readonly string[],
    beatmapHashesBySong: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
    initialCollections: readonly SongListCollection[] = [],
  ) {
    this.assets = assets;
    this.summary = summary;
    this.byId = new Map(songs.map((song) => [song.id, song]));
    this.indexed = songs.map((song) => ({
      song,
      search: songSearch(song),
      tags: new Set(song.tags.map(normalize)),
      collections: new Set(song.collections.map(normalize)),
      beatmapHashes: new Set(
        beatmapHashesBySong.get(song.id) ??
          (song.md5Hash ? [song.md5Hash] : []),
      ),
    }));
    this.indexedById = new Map(
      this.indexed.map((item) => [item.song.id, item]),
    );
    this.realm = realm;
    this.songIdByBeatmap = songIdByBeatmap;
    this.songIdsByMd5 = songIdsByMd5;
    this.collections = initialCollections.map((collection) => ({
      ...collection,
      songIds: [...collection.songIds],
    }));
    // Realm already supplied this order while the song list was materialized.
    if (initialTitleOrder)
      this.orderCache.set("title:ascending", initialTitleOrder);
  }

  /** Materialize one canonical ascending order per sort key. */
  async prepareSortOrders(signal?: SongListCancellation): Promise<void> {
    // The first streamed batch may intentionally start with the restored
    // song. Never carry that temporary order into the completed song list.
    this.orderCache.delete("title:ascending");
    for (const sort of sorts) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      signal?.throwIfAborted();
      this.orderFor(sort, false, signal);
    }
  }

  /** Only detached data crosses the worker boundary; Realm stays in its owning process. */
  snapshot(): SongListSnapshot {
    return {
      assets: new Map(this.assets),
      summary: this.summary,
      indexed: this.indexed,
      orders: new Map(
        [...this.orderCache].filter(([key]) => key.endsWith(":ascending")),
      ),
      collections: this.collections.map((collection) => ({
        ...collection,
        songIds: [...collection.songIds],
      })),
    };
  }

  static fromSnapshot(snapshot: SongListSnapshot): SongListIndex {
    const index = new SongListIndex(
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
        snapshot.indexed.map((item) => [item.song.id, item]),
      ),
      byId: new Map(snapshot.indexed.map((item) => [item.song.id, item.song])),
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

  sharesRealm(other: SongListIndex): boolean {
    return this.realm !== undefined && this.realm === other.realm;
  }

  private orderFor(
    sort: SortKey,
    descending: boolean,
    signal?: SongListCancellation,
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
    signal?: SongListCancellation,
  ): readonly string[] {
    const key = `${sort}:ascending`;
    const cached = this.orderCache.get(key);
    if (cached) return cached;
    if (
      sort === "dateAdded" ||
      sort === "dateSubmitted" ||
      sort === "dateRanked" ||
      sort === "lastPlayed"
    ) {
      const order = this.detachedOrder(sort);
      this.orderCache.set(key, order);
      return order;
    }
    const fallback = this.indexed.map((item) => item.song.id);
    const order =
      sort === "collection" && this.collections.length
        ? this.collectionOrderFromSnapshot()
        : this.realm
          ? realmSongOrder(
              this.realm,
              sort,
              this.songIdByBeatmap,
              this.songIdsByMd5,
              fallback,
              signal,
              this.orderCache.get("title:ascending"),
            )
          : this.detachedOrder(sort);
    this.orderCache.set(key, order);
    return order;
  }

  /** Merge only new/changed songs while the worker is still reading. */
  applyBatch(batch: SongListSnapshot): void {
    const collectionCounts = new Map(
      this.summary.collections.map(({ name, count }) => [name, count]),
    );
    const tagCounts = new Map(
      this.summary.tags.map(({ name, count }) => [name, count]),
    );
    for (const { name } of batch.summary.collections) {
      if (!collectionCounts.has(name)) collectionCounts.set(name, 0);
    }
    const countFacets = (song: Song, delta: number) => {
      for (const name of song.collections)
        collectionCounts.set(name, (collectionCounts.get(name) ?? 0) + delta);
      for (const name of song.tags)
        tagCounts.set(name, (tagCounts.get(name) ?? 0) + delta);
    };
    for (const item of batch.indexed) {
      const previous = this.indexedById.get(item.song.id);
      if (previous) {
        countFacets(previous.song, -1);
        Object.assign(previous, item);
      } else {
        this.indexed.push(item);
        this.indexedById.set(item.song.id, item);
      }
      this.byId.set(item.song.id, item.song);
      countFacets(item.song, 1);
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
      this.indexed.map(({ song }) => song.id),
    );
  }

  /** Replace only collection-derived data while retaining the indexed songs. */
  replaceCollections(collections: readonly SongListCollection[]): void {
    this.collections = collections.map((collection) => ({
      ...collection,
      songIds: [...collection.songIds],
    }));
    const namesBySong = new Map<string, string[]>();
    for (const collection of this.collections) {
      for (const id of collection.songIds) {
        if (!this.byId.has(id)) continue;
        const names = namesBySong.get(id) ?? [];
        if (!names.includes(collection.name)) names.push(collection.name);
        namesBySong.set(id, names);
      }
    }
    for (const item of this.indexed) {
      const names = (namesBySong.get(item.song.id) ?? []).sort(
        collator.compare,
      );
      item.song.collections = names;
      item.collections = new Set(names.map(normalize));
      item.search = songSearch(item.song);
    }
    const collectionCounts = new Map<string, number>();
    for (const collection of this.collections)
      collectionCounts.set(collection.name, 0);
    for (const item of this.indexed) {
      for (const name of item.song.collections)
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
      for (const id of collection.songIds) {
        if (this.byId.has(id) && !seen.has(id)) {
          seen.add(id);
          order.push(id);
        }
      }
    }
    for (const item of this.indexed) {
      if (!seen.has(item.song.id)) {
        seen.add(item.song.id);
        order.push(item.song.id);
      }
    }
    return order;
  }

  private detachedOrder(sort: SortKey): string[] {
    const value = (song: Song): string | number => {
      switch (sort) {
        case "title":
          return song.titleUnicode || song.title;
        case "artist":
          return song.artist;
        case "added":
          return song.addedAt;
        case "dateAdded":
          return song.dateAddedAt ?? 0;
        case "dateSubmitted":
          return song.dateSubmittedAt ?? 0;
        case "dateRanked":
          return song.dateRankedAt ?? 0;
        case "lastPlayed":
          return song.lastPlayedAt ?? 0;
        case "collection":
          return song.collections[0] ?? "";
        case "tags":
          return song.tags.join(" ");
        default:
          return song[sort];
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
      .map((song) => song.id);
  }

  getSong(id: string): Song | null {
    return this.byId.get(id) ?? null;
  }

  getSongLocation(id: string, input: SongListQuery = {}): SongLocation | null {
    if (!this.byId.has(id)) return null;
    const limit = 250;
    let offset = 0;
    while (true) {
      const page = this.query({ ...input, offset, limit });
      const itemIndex = page.items.findIndex((song) => song.id === id);
      if (itemIndex >= 0) {
        return {
          song: page.items[itemIndex],
          index: page.offset + itemIndex,
        };
      }

      const nextOffset = page.offset + page.items.length;
      if (page.items.length === 0 || nextOffset >= page.total) return null;
      offset = nextOffset;
    }
  }

  query(input: SongListQuery = {}): SongListPage {
    const search = string(input.search).slice(0, 1000).trim();
    const criteria = parseSearch(search);
    const collection = normalize(string(input.collection));
    const tagFilters = [...strings(input.tags), string(input.tag)]
      .map(normalize)
      .filter(Boolean);
    const tagMatch = input.tagMatch === "any" ? "any" : "all";
    const sort = sorts.has(input.sort as SortKey) ? input.sort! : "title";
    const descending = input.descending === true;
    const favorites = Array.isArray(input.favoriteIds)
      ? new Set(input.favoriteIds.filter((id) => typeof id === "string"))
      : null;
    const key = JSON.stringify([
      search,
      criteria.timeSensitive ? Math.floor(Date.now() / 1000) : null,
      collection,
      tagFilters,
      tagMatch,
      sort,
      descending,
      favorites ? [...favorites] : null,
    ]);
    let matches = this.queryCache.get(key);
    if (!matches) {
      const ordered = this.orderFor(sort, descending);
      matches = [];
      for (const id of ordered) {
        const item = this.indexedById.get(id);
        if (
          item &&
          (!collection || item.collections.has(collection)) &&
          (tagFilters.length === 0 ||
            (tagMatch === "any"
              ? tagFilters.some((tag) => item.tags.has(tag))
              : tagFilters.every((tag) => item.tags.has(tag)))) &&
          (!favorites || favorites.has(item.song.id)) &&
          matchesSearch(item.song, item.search, criteria)
        ) {
          matches.push(item.song);
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
