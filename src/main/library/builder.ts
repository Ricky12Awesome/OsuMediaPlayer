import type Realm from "realm";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type {
  Beatmap,
  BeatmapCollection,
  BeatmapSet,
} from "../../shared/client-model";
import type {
  LibraryFacet,
  LibraryProgress,
  LibrarySummary,
  Track,
} from "../../shared/types";
import {
  assetUrl,
  hashedFileCandidates,
  isAssetHash,
  type MediaAsset,
} from "../media";
import { resolveLazerInstallPath } from "../lazer-path";
import { LibraryIndex } from "./index";
import { sortedLibraryBeatmaps } from "./realm";
import type {
  LibraryCancellation,
  LibraryCollection,
  LibrarySnapshot,
} from "./types";
import { collator, dateTimestamp, normalize, number, string } from "./utils";

interface RawSet {
  identity: string;
  onlineId: number;
  dateAddedAt: number;
  dateSubmittedAt: number;
  dateRankedAt: number;
  files: Map<string, { hash: string; filename: string }>;
  beatmapDirectories: Map<string, string>;
}
interface PendingCollection {
  id: string;
  name: string;
  lastModified: number;
  hashes: string[];
}

const beatmapTitle = (map: Beatmap): string =>
  string(map.Metadata?.Title) ||
  string(map.Metadata?.TitleUnicode) ||
  "Untitled";
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

interface PriorityTrackId {
  onlineId: number;
  audioHash: string;
}

function parsePriorityTrackId(
  value: string | undefined,
): PriorityTrackId | null {
  const match = /^(\d+)-([a-f\d]{64})$/i.exec(value ?? "");
  if (!match) return null;
  const onlineId = Number(match[1]);
  return Number.isSafeInteger(onlineId) && onlineId > 0
    ? { onlineId, audioHash: match[2].toLowerCase() }
    : null;
}

/** Find the saved song without materializing the rest of the library first. */
function priorityBeatmap(
  realm: Realm,
  priorityTrackId: string | undefined,
  signal?: LibraryCancellation,
): Beatmap | undefined {
  const priority = parsePriorityTrackId(priorityTrackId);
  if (!priority) return undefined;
  const candidates = realm
    .objects<Beatmap>("Beatmap")
    .filtered(
      "BeatmapSet != nil AND BeatmapSet.DeletePending == false AND BeatmapSet.OnlineID == $0",
      priority.onlineId,
    );
  for (const map of candidates) {
    signal?.throwIfAborted();
    const source = map.BeatmapSet;
    const audioFilename = map.Metadata?.AudioFile;
    if (!source || !audioFilename) continue;
    const beatmapHash = string(map.Hash).toLowerCase();
    let directory = ".";
    for (const usage of source.Files) {
      const filename = usage.Filename;
      const hash = usage.File?.Hash?.toLowerCase();
      if (filename?.toLowerCase().endsWith(".osu") && hash === beatmapHash) {
        directory = posix.dirname(filenameKey(filename));
        break;
      }
    }
    const expectedPaths = new Set([
      filenameKey(posix.join(directory, audioFilename.replaceAll("\\", "/"))),
      filenameKey(audioFilename),
    ]);
    if (
      [...source.Files].some(
        (usage) =>
          usage.File?.Hash?.toLowerCase() === priority.audioHash &&
          usage.Filename &&
          expectedPaths.has(filenameKey(usage.Filename)),
      )
    )
      return map;
  }
  return undefined;
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

/** Read a consistent library snapshot without modifying osu!'s database. */
export async function loadLibraryFromRealm(
  requestedPath?: string,
  onProgress?: (progress: LibraryProgress) => void,
  signal?: LibraryCancellation,
  onBatch?: (index: LibraryIndex) => void,
  priorityTrackId?: string,
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
    const priorityMap = priorityBeatmap(realm, priorityTrackId, signal);
    const priorityMapId = priorityMap?.ID.toHexString();
    // Filter in Realm and traverse its links directly, without a detached copy of every difficulty.
    function* beatmaps(): Generator<{ map: Beatmap; set: RawSet }> {
      const sets = new Map<string, RawSet>();
      function* prioritizedMaps(): Generator<Beatmap> {
        if (priorityMap) yield priorityMap;
        for (const map of sortedMaps) {
          if (map.ID.toHexString() !== priorityMapId) yield map;
        }
      }
      for (const map of prioritizedMaps()) {
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
        const set = {
          identity,
          onlineId,
          dateAddedAt: dateTimestamp(source.DateAdded),
          dateSubmittedAt: dateTimestamp(source.DateSubmitted),
          dateRankedAt: dateTimestamp(source.DateRanked),
          files,
          beatmapDirectories,
        };
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
      priorityTrackId,
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
  priorityTrackId?: string,
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
    const playedTimestamp = map.LastPlayed?.getTime() ?? 0;
    const lastPlayedAt = Number.isFinite(playedTimestamp)
      ? Math.max(0, playedTimestamp)
      : 0;
    const { dateAddedAt, dateSubmittedAt, dateRankedAt } = set;
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
      current.dateAddedAt = Math.max(current.dateAddedAt ?? 0, dateAddedAt);
      current.dateSubmittedAt = Math.max(
        current.dateSubmittedAt ?? 0,
        dateSubmittedAt,
      );
      current.dateRankedAt = Math.max(current.dateRankedAt ?? 0, dateRankedAt);
      current.lastPlayedAt = Math.max(current.lastPlayedAt ?? 0, lastPlayedAt);
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
        dateAddedAt,
        dateSubmittedAt,
        dateRankedAt,
        lastPlayedAt,
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
        const beatmapHash = string(map.Hash).toLowerCase();
        if (id === priorityTrackId) {
          // The saved track is streamed before the rest of the library. Read
          // its event file now so its video is ready with that first batch.
          const event = await readBeatmapVideoEvent(installPath, beatmapHash);
          const referenced = event
            ? (set.files.get(
                filenameKey(posix.join(directory, event.filename)),
              ) ?? set.files.get(filenameKey(event.filename)))
            : undefined;
          const video =
            referenced && isVideoFilename(referenced.filename)
              ? referenced
              : fallback;
          track.videoUrl = assetUrl(video.hash);
          track.videoHash = video.hash;
          track.videoOffset = referenced && event ? event.offset : 0;
          assets.set(video.hash, {
            hash: video.hash,
            filename: video.filename,
          });
        } else {
          pendingVideos.push({
            track,
            set,
            directory,
            beatmapHash,
            fallback,
          });
        }
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
