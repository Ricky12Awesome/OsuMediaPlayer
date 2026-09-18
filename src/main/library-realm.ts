import type Realm from "realm";
import type {
  Beatmap,
  BeatmapCollection,
  BeatmapSet,
} from "../shared/client-model";
import type { LibraryProgress, SortKey } from "../shared/types";
import { join } from "node:path";
import { resolveLazerInstallPath } from "./lazer-path";
import type {
  LibraryCancellation,
  LibraryCollection,
  LibraryCollectionFingerprint,
  LibraryFingerprint,
} from "./library-types";
import { collator, dateTimestamp } from "./library-utils";

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

export function realmTrackOrder(
  realm: Realm,
  sort: Exclude<
    SortKey,
    "dateAdded" | "dateSubmitted" | "dateRanked" | "lastPlayed"
  >,
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
