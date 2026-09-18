import type Realm from "realm";
import type {
  LibraryPage,
  LibraryQuery,
  LibrarySummary,
  SortKey,
  Track,
  TrackLocation,
} from "../shared/types";
import { assetUrl, type MediaAsset } from "./media";
import { realmTrackOrder } from "./library-realm";
import type {
  LibraryCancellation,
  LibraryCollection,
  LibrarySnapshot,
  IndexedTrack,
} from "./library-types";
import {
  collator,
  normalize,
  number,
  sorts,
  string,
  strings,
  trackSearch,
} from "./library-utils";

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
    // The first streamed batch may intentionally start with the restored
    // track. Never carry that temporary order into the completed library.
    this.orderCache.delete("title:ascending");
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
        case "dateAdded":
          return track.dateAddedAt ?? 0;
        case "dateSubmitted":
          return track.dateSubmittedAt ?? 0;
        case "dateRanked":
          return track.dateRankedAt ?? 0;
        case "lastPlayed":
          return track.lastPlayedAt ?? 0;
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
