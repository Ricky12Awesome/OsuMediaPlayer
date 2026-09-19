import type Realm from "realm";
import type {
  Beatmap,
  BeatmapCollection,
  BeatmapSet,
} from "../../shared/client-model";
import type { SongListProgress, SortKey } from "../../shared/types";
import { join } from "node:path";
import { resolveLazerInstallPath } from "../lazer-path";
import type {
  SongListCancellation,
  SongListCollection,
  SongListCollectionFingerprint,
  SongListFingerprint,
} from "./types";
import { collator, dateTimestamp } from "./utils";

/** Sort persisted title fields in Realm before materializing songs. */
export function sortedSongListBeatmaps(realm: Realm, descending = false) {
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
export async function readSongListFingerprints(
  requestedPath?: string,
  signal?: SongListCancellation,
): Promise<{
  installPath: string;
  fingerprint: SongListFingerprint;
  collectionFingerprint: SongListCollectionFingerprint;
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
    let latestDateSubmitted = 0;
    let latestDateRanked = 0;
    for (const set of sets) {
      signal?.throwIfAborted();
      latestDateSubmitted = Math.max(
        latestDateSubmitted,
        dateTimestamp(set.DateSubmitted),
      );
      latestDateRanked = Math.max(
        latestDateRanked,
        dateTimestamp(set.DateRanked),
      );
    }
    let latestLastPlayed = 0;
    for (const map of realm
      .objects<Beatmap>("Beatmap")
      .filtered("BeatmapSet != nil AND BeatmapSet.DeletePending == false")) {
      signal?.throwIfAborted();
      const timestamp = map.LastPlayed?.getTime() ?? 0;
      if (Number.isFinite(timestamp))
        latestLastPlayed = Math.max(latestLastPlayed, timestamp);
    }
    const collectionFingerprint: SongListCollectionFingerprint = {};
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
        latestDateSubmitted,
        latestDateRanked,
        latestLastPlayed: Number.isFinite(latestLastPlayed)
          ? Math.max(0, latestLastPlayed)
          : 0,
      },
      collectionFingerprint,
    };
  } finally {
    realm.close();
  }
}

export async function readSongListFingerprint(
  requestedPath?: string,
  signal?: SongListCancellation,
): Promise<{ installPath: string; fingerprint: SongListFingerprint }> {
  const result = await readSongListFingerprints(requestedPath, signal);
  return { installPath: result.installPath, fingerprint: result.fingerprint };
}

/** Rebuild only collection membership from Realm using cached beatmap-to-song mappings. */
export async function readSongListCollections(
  requestedPath: string,
  songIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>,
  signal?: SongListCancellation,
): Promise<SongListCollection[]> {
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
    const result: SongListCollection[] = [];
    for (const collection of realm.objects<BeatmapCollection>(
      "BeatmapCollection",
    )) {
      signal?.throwIfAborted();
      const name = collection.Name?.trim();
      if (!name) continue;
      const songIds = new Set<string>();
      for (const hash of collection.BeatmapMD5Hashes) {
        for (const id of songIdsByMd5.get(hash?.toLowerCase() ?? "") ?? [])
          songIds.add(id);
      }
      const lastModified = collection.LastModified?.getTime() ?? 0;
      result.push({
        id: collection.ID.toHexString(),
        name,
        lastModified: Number.isFinite(lastModified) ? lastModified : 0,
        songIds: [...songIds],
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
  songIdByBeatmap: ReadonlyMap<string, string>,
  fallback: readonly string[],
  signal?: SongListCancellation,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const map of maps) {
    signal?.throwIfAborted();
    const id = songIdByBeatmap.get(map.ID.toHexString());
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
  songIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>,
  fallback: readonly string[],
  descending: boolean,
  signal?: SongListCancellation,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const collection of realm
    .objects<BeatmapCollection>("BeatmapCollection")
    .sorted("Name", descending)) {
    signal?.throwIfAborted();
    for (const hash of collection.BeatmapMD5Hashes) {
      signal?.throwIfAborted();
      for (const id of songIdsByMd5.get(hash?.toLowerCase() ?? "") ?? []) {
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

export function realmSongOrder(
  realm: Realm,
  sort: Exclude<
    SortKey,
    "dateAdded" | "dateSubmitted" | "dateRanked" | "lastPlayed"
  >,
  songIdByBeatmap: ReadonlyMap<string, string>,
  songIdsByMd5: ReadonlyMap<string, ReadonlySet<string>>,
  fallback: readonly string[],
  signal?: SongListCancellation,
  cachedTitle?: readonly string[],
): readonly string[] {
  const titleFallback = (): readonly string[] =>
    cachedTitle ??
    orderFromBeatmaps(
      sortedSongListBeatmaps(realm),
      songIdByBeatmap,
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
        songIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "duration":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["Length", false]], false),
        songIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "bpm":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["BPM", false]], false),
        songIdByBeatmap,
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
        songIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "stars":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["StarRating", false]], false),
        songIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "tags":
      return orderFromBeatmaps(
        sortedBeatmaps(realm, [["Metadata.Tags", false]], false),
        songIdByBeatmap,
        titleFallback(),
        signal,
      );
    case "collection":
      return collectionOrder(
        realm,
        songIdsByMd5,
        titleFallback(),
        false,
        signal,
      );
  }
}
