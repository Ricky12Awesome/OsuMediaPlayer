import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix, join } from "node:path";
import type {
  Beatmap,
  BeatmapSet,
  BeatmapCollection,
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
} from "../shared/types";
import {
  assetUrl,
  hashedFileCandidates,
  isAssetHash,
  type MediaAsset,
} from "./media";

type RecordData = Record<string, unknown>;
interface RawSet {
  identity: string;
  onlineId: number;
  files: Map<string, { hash: string; filename: string }>;
  beatmapDirectories: Map<string, string>;
  beatmaps: string[];
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
const record = (value: unknown): RecordData =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordData)
    : {};
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
  private readonly byId: Map<string, Track>;
  private readonly queryCache = new Map<string, Track[]>();

  constructor(
    tracks: Track[],
    assets: Map<string, MediaAsset>,
    summary: LibrarySummary,
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
      favorites ? [...favorites].sort() : null,
    ]);
    let matches = this.queryCache.get(key);
    if (!matches) {
      const terms = search.split(/\s+/).filter(Boolean);
      matches = this.indexed
        .filter(
          (item) =>
            (!collection || item.collections.has(collection)) &&
            tagFilters.every((tag) => item.tags.has(tag)) &&
            (!favorites || favorites.has(item.track.id)) &&
            terms.every((term) => item.search.includes(term)),
        )
        .map((item) => item.track);
      const compare = (a: Track, b: Track): number => {
        let result: number;
        switch (sort) {
          case "duration":
            result = a.duration - b.duration;
            break;
          case "bpm":
            result = a.bpm - b.bpm;
            break;
          case "added":
            result = a.addedAt - b.addedAt;
            break;
          case "stars":
            result = a.stars - b.stars;
            break;
          case "artist":
            result = collator.compare(a.artist, b.artist);
            break;
          case "collection":
            result = collator.compare(
              a.collections[0] ?? "\uffff",
              b.collections[0] ?? "\uffff",
            );
            break;
          case "tags":
            result = collator.compare(
              a.tags[0] ?? "\uffff",
              b.tags[0] ?? "\uffff",
            );
            break;
          default:
            result = collator.compare(a.title, b.title);
        }
        result ||=
          collator.compare(a.title, b.title) ||
          collator.compare(a.artist, b.artist) ||
          a.id.localeCompare(b.id);
        return descending ? -result : result;
      };
      matches.sort(compare);
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
  try {
    const sets: RawSet[] = [];
    const maps: RecordData[] = [];
    const collectionsByHash = new Map<string, Set<string>>();
    const collectionNames = new Set<string>();
    let records = 0;
    let lastProgress = 0;
    let nextSnapshot = 0;
    const progress = async () => {
      signal?.throwIfAborted();
      if (Date.now() - lastProgress < 120) return;
      onProgress?.({ phase: "reading", records });
      lastProgress = Date.now();
      if (onSnapshot && maps.length && Date.now() >= nextSnapshot) {
        const started = Date.now();
        onSnapshot(
          await buildIndex(
            installPath,
            maps,
            sets,
            collectionsByHash,
            collectionNames,
            false,
          ),
        );
        nextSnapshot = Date.now() + Math.max(500, (Date.now() - started) * 10);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      signal?.throwIfAborted();
    };
    for (const collection of realm.objects<BeatmapCollection>(
      "BeatmapCollection",
    )) {
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
      records++;
      await progress();
    }
    for (const set of realm.objects<BeatmapSet>("BeatmapSet")) {
      if (set.DeletePending) continue;
      const files = new Map<string, { hash: string; filename: string }>();
      const beatmapDirectories = new Map<string, string>();
      for (const usage of set.Files) {
        const filename = usage.Filename;
        const hash = usage.File?.Hash?.toLowerCase();
        if (!filename || !hash || !isAssetHash(hash)) continue;
        files.set(filenameKey(filename), { hash, filename });
        if (filename.toLowerCase().endsWith(".osu"))
          beatmapDirectories.set(hash, posix.dirname(filenameKey(filename)));
      }
      const beatmaps = Array.from(
        set.Beatmaps,
        (map) => map.MD5Hash?.toLowerCase() ?? "",
      );
      const onlineId = set.OnlineID;
      const identity =
        onlineId > 0
          ? String(onlineId)
          : `local-${createHash("sha256")
              .update(
                JSON.stringify([
                  [...beatmaps].sort(),
                  [...files.values()].map((file) => file.hash).sort(),
                ]),
              )
              .digest("hex")
              .slice(0, 20)}`;
      sets.push({ identity, onlineId, files, beatmapDirectories, beatmaps });
      for (const map of set.Beatmaps) {
        maps.push({ ...detachBeatmap(map), SetIdentity: identity });
        records++;
        await progress();
      }
      records++;
      await progress();
    }
    signal?.throwIfAborted();
    onProgress?.({ phase: "indexing", records });
    const index = await buildIndex(
      installPath,
      maps,
      sets,
      collectionsByHash,
      collectionNames,
    );
    signal?.throwIfAborted();
    return index;
  } finally {
    realm.close();
  }
}

function detachBeatmap(map: Beatmap): RecordData {
  const metadata = map.Metadata;
  return {
    MD5Hash: map.MD5Hash,
    OnlineMD5Hash: map.OnlineMD5Hash,
    Hash: map.Hash,
    BeatmapSet: map.BeatmapSet?.OnlineID,
    Length: map.Length,
    BPM: map.BPM,
    StarRating: map.StarRating,
    LastLocalUpdate: map.LastLocalUpdate?.toISOString(),
    LastOnlineUpdate: map.LastOnlineUpdate?.toISOString(),
    Metadata: metadata
      ? {
          Title: metadata.Title,
          TitleUnicode: metadata.TitleUnicode,
          Artist: metadata.Artist,
          ArtistUnicode: metadata.ArtistUnicode,
          Source: metadata.Source,
          Tags: metadata.Tags,
          UserTags: Array.from(metadata.UserTags),
          AudioFile: metadata.AudioFile,
          BackgroundFile: metadata.BackgroundFile,
        }
      : {},
  };
}

async function buildIndex(
  installPath: string,
  maps: RecordData[],
  sets: RawSet[],
  collectionsByHash: Map<string, Set<string>>,
  collectionNames: Set<string>,
  resolveVideos = true,
): Promise<LibraryIndex> {
  const setsByIdentity = new Map(sets.map((set) => [set.identity, set]));
  const setsByHash = new Map<string, RawSet>();
  const setsByOnlineId = new Map<number, RawSet>();
  for (const set of sets) {
    for (const hash of set.beatmaps) setsByHash.set(hash, set);
    if (set.onlineId > 0) setsByOnlineId.set(set.onlineId, set);
  }
  const tracks = new Map<string, Track>();
  const assets = new Map<string, MediaAsset>();
  const pendingVideos: {
    track: Track;
    set: RawSet;
    directory: string;
    beatmapHash: string;
    fallback: MediaAsset;
  }[] = [];
  let skippedCount = 0;
  for (const map of maps) {
    const hashes = [
      string(map.MD5Hash).toLowerCase(),
      string(map.OnlineMD5Hash).toLowerCase(),
    ];
    const set =
      setsByIdentity.get(string(map.SetIdentity)) ??
      hashes.map((hash) => setsByHash.get(hash)).find(Boolean) ??
      setsByOnlineId.get(number(map.BeatmapSet));
    const metadata = record(map.Metadata);
    const directory =
      set?.beatmapDirectories.get(string(map.Hash).toLowerCase()) ?? ".";
    const findAsset = (filename: unknown) =>
      set?.files.get(
        filenameKey(
          posix.join(directory, string(filename).replaceAll("\\", "/")),
        ),
      ) ?? set?.files.get(filenameKey(string(filename)));
    const audio = findAsset(metadata.AudioFile);
    if (!set || !audio) {
      skippedCount++;
      continue;
    }
    const artwork = findAsset(metadata.BackgroundFile);
    const onlineId =
      set.onlineId > 0
        ? set.onlineId
        : number(map.BeatmapSet) > 0
          ? number(map.BeatmapSet)
          : undefined;
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
    const tags = [
      ...new Set(
        [...string(metadata.Tags).split(/\s+/), ...strings(metadata.UserTags)]
          .map((value) => value.trim().toLocaleLowerCase())
          .filter(Boolean),
      ),
    ];
    const collections = [
      ...new Set(
        hashes.flatMap((hash) => [...(collectionsByHash.get(hash) ?? [])]),
      ),
    ];
    const timestamp = Date.parse(
      string(map.LastLocalUpdate) || string(map.LastOnlineUpdate),
    );
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
        title:
          string(metadata.Title) || string(metadata.TitleUnicode) || "Untitled",
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
      if (resolveVideos && videos.length) {
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
  const eventCache = new Map<string, Promise<BeatmapVideoEvent | null>>();
  let nextVideo = 0;
  const resolveVideo = async () => {
    while (nextVideo < pendingVideos.length) {
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
  return new LibraryIndex([...tracks.values()], assets, {
    trackCount: tracks.size,
    beatmapCount: maps.length,
    collectionCount: collectionNames.size,
    collections: facets(collectionCounts).sort((a, b) =>
      collator.compare(a.name, b.name),
    ),
    tags: facets(tagCounts).sort(
      (a, b) => b.count - a.count || collator.compare(a.name, b.name),
    ),
    installPath,
    skippedCount,
  });
}
