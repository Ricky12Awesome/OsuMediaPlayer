import type Realm from "realm";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix, join } from "node:path";
import type { Beatmap, BeatmapCollection } from "../shared/client-model";
import { resolveLazerInstallPath } from "./lazer-path";
import type {
  LibraryFacet,
  LibraryPage,
  LibraryProgress,
  LibraryQuery,
  LibrarySummary,
  SortKey,
  Track,
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
interface IndexedTrack {
  track: Track;
  search: string;
  tags: Set<string>;
  collections: Set<string>;
}
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
  readonly assets: ReadonlyMap<string, MediaAsset>;
  readonly summary: LibrarySummary;
  private readonly indexed: IndexedTrack[];
  private readonly indexedById: Map<string, IndexedTrack>;
  private readonly byId: Map<string, Track>;
  private readonly realm?: Realm;
  private readonly trackIdByBeatmap: ReadonlyMap<string, string>;
  private readonly trackIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>;
  private readonly orderCache = new Map<string, readonly string[]>();
  private readonly queryCache = new Map<string, Track[]>();
  private realmClosed = false;

  constructor(
    tracks: Track[],
    assets: Map<string, MediaAsset>,
    summary: LibrarySummary,
    realm?: Realm,
    trackIdByBeatmap: ReadonlyMap<string, string> = new Map(),
    trackIdsByMd5: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
    initialTitleOrder?: readonly string[],
  ) {
    this.assets = assets;
    this.summary = summary;
    this.byId = new Map(tracks.map((track) => [track.id, track]));
    this.indexed = tracks.map((track) => ({
      track,
      search: normalize(
        [
          track.title,
          track.titleUnicode,
          track.artist,
          track.artistUnicode,
          track.source,
          ...track.tags,
          ...track.collections,
        ].join(" "),
      ),
      tags: new Set(track.tags.map(normalize)),
      collections: new Set(track.collections.map(normalize)),
    }));
    this.indexedById = new Map(
      this.indexed.map((item) => [item.track.id, item]),
    );
    this.realm = realm;
    this.trackIdByBeatmap = trackIdByBeatmap;
    this.trackIdsByMd5 = trackIdsByMd5;
    // Realm already supplied this order while the library was materialized.
    if (initialTitleOrder)
      this.orderCache.set("title:ascending", initialTitleOrder);
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

  private orderFor(sort: SortKey, descending: boolean): readonly string[] {
    const key = `${sort}:${descending ? "descending" : "ascending"}`;
    const cached = this.orderCache.get(key);
    if (cached) return cached;
    const fallback = this.indexed.map((item) => item.track.id);
    const order = this.realm
      ? realmTrackOrder(
          this.realm,
          sort,
          this.trackIdByBeatmap,
          this.trackIdsByMd5,
          fallback,
          descending,
        )
      : fallback;
    this.orderCache.set(key, order);
    return order;
  }

  getTrack(id: string): Track | null {
    return this.byId.get(id) ?? null;
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
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const map of maps) {
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
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const collection of realm
    .objects<BeatmapCollection>("BeatmapCollection")
    .sorted("Name", descending)) {
    for (const hash of collection.BeatmapMD5Hashes) {
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
  descending: boolean,
): string[] {
  const titleFallback = (): string[] =>
    orderFromBeatmaps(
      sortedLibraryBeatmaps(realm, descending),
      trackIdByBeatmap,
      fallback,
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
          descending,
        ),
        trackIdByBeatmap,
        titleFallback(),
      );
    case "duration":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["Length", false]], descending),
        trackIdByBeatmap,
        titleFallback(),
      );
    case "bpm":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["BPM", false]], descending),
        trackIdByBeatmap,
        titleFallback(),
      );
    case "added":
      return orderFromBeatmaps(
        sortedBeatmaps(
          realm,
          [
            ["LastLocalUpdate", false],
            ["LastOnlineUpdate", false],
          ],
          descending,
        ),
        trackIdByBeatmap,
        titleFallback(),
      );
    case "stars":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["StarRating", false]], descending),
        trackIdByBeatmap,
        titleFallback(),
      );
    case "tags":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["Metadata.Tags", false]], descending),
        trackIdByBeatmap,
        titleFallback(),
      );
    case "collection":
      return collectionOrder(realm, trackIdsByMd5, titleFallback(), descending);
  }
}

/** Read a consistent library snapshot without modifying osu!'s database. */
export async function loadLibraryFromRealm(
  requestedPath?: string,
  onProgress?: (progress: LibraryProgress) => void,
  signal?: AbortSignal,
  onSnapshot?: (index: LibraryIndex) => void,
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
    for (const collection of realm.objects<BeatmapCollection>(
      "BeatmapCollection",
    )) {
      signal?.throwIfAborted();
      const name = collection.Name?.trim();
      if (name) {
        collectionNames.add(name);
        for (const hash of collection.BeatmapMD5Hashes) {
          if (!hash) continue;
          const key = hash.toLowerCase();
          const names = collectionsByHash.get(key) ?? new Set<string>();
          names.add(name);
          collectionsByHash.set(key, names);
        }
      }
    }
    const sortedMaps = sortedLibraryBeatmaps(realm);
    // Filter in Realm and traverse its links directly, without a detached copy of every difficulty.
    function* beatmaps(): Generator<{ map: Beatmap; set: RawSet }> {
      const sets = new Map<string, RawSet>();
      for (const map of sortedMaps) {
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
          const filename = usage.Filename;
          const hash = usage.File?.Hash?.toLowerCase();
          if (!filename || !hash || !isAssetHash(hash)) continue;
          files.set(filenameKey(filename), { hash, filename });
          if (filename.toLowerCase().endsWith(".osu"))
            beatmapDirectories.set(hash, posix.dirname(filenameKey(filename)));
        }
        const onlineId = source.OnlineID;
        const linkedMaps = source.Beatmaps;
        // Keep existing local track IDs so saved favorites remain valid.
        const identity =
          onlineId > 0
            ? String(onlineId)
            : `local-${createHash("sha256")
                .update(
                  JSON.stringify([
                    Array.from(
                      linkedMaps,
                      (map) => map.MD5Hash?.toLowerCase() ?? "",
                    ).sort(),
                    [...files.values()].map((file) => file.hash).sort(),
                  ]),
                )
                .digest("hex")
                .slice(0, 20)}`;
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
      onProgress,
      signal,
      onSnapshot,
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
  onProgress?: (progress: LibraryProgress) => void,
  signal?: AbortSignal,
  onSnapshot?: (index: LibraryIndex) => void,
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
  let publishedPreview = false;
  for (const { map, set } of maps) {
    beatmapCount++;
    if (beatmapCount % 64 === 0 && performance.now() - lastYield >= 16) {
      signal?.throwIfAborted();
      onProgress?.({ phase: "reading", records: beatmapCount });
      // One bounded preview; never rebuild the growing library on every progress update.
      if (onSnapshot && !publishedPreview && tracks.size) {
        onSnapshot(
          finishIndex(
            new Map(
              [...tracks].map(([id, track]) => [
                id,
                {
                  ...track,
                  tags: [...track.tags],
                  collections: [...track.collections],
                },
              ]),
            ),
            new Map(assets),
            installPath,
            beatmapCount,
            skippedCount,
            collectionNames,
            realm,
            trackIdByBeatmap,
            trackIdsByMd5,
            [...tracks.keys()],
          ),
        );
        publishedPreview = true;
      }
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
  }
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
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(8, pendingVideos.length) }, () =>
      resolveVideo(),
    ),
  );
  signal?.throwIfAborted();
  return finishIndex(
    tracks,
    assets,
    installPath,
    beatmapCount,
    skippedCount,
    collectionNames,
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
  );
}
