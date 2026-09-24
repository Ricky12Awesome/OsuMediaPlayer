import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Realm from "realm";
import {
  defaultLazerInstallPath,
  resolveLazerInstallPath,
} from "../src/main/lazer-path";
import { hashedFilePath, isAssetHash } from "../src/main/media";
import type { Beatmap, BeatmapSet } from "../src/shared/client-model";
import { Schema } from "../src/shared/client-model";

type Options = {
  query?: string;
  limit?: number;
  onlineIds?: number[];
  hashes?: string[];
};

function copyBeatmap(map: Beatmap) {
  const metadata = map.Metadata;
  return {
    ID: map.ID,
    DifficultyName: map.DifficultyName,
    Status: map.Status,
    OnlineID: map.OnlineID,
    Length: map.Length,
    BPM: map.BPM,
    Hash: map.Hash,
    StarRating: map.StarRating,
    MD5Hash: map.MD5Hash,
    OnlineMD5Hash: map.OnlineMD5Hash,
    LastLocalUpdate: map.LastLocalUpdate,
    LastOnlineUpdate: map.LastOnlineUpdate,
    Hidden: map.Hidden,
    EndTimeObjectCount: map.EndTimeObjectCount,
    TotalObjectCount: map.TotalObjectCount,
    LastPlayed: map.LastPlayed,
    BeatDivisor: map.BeatDivisor,
    EditorTimestamp: map.EditorTimestamp,
    Difficulty: map.Difficulty
      ? {
          DrainRate: map.Difficulty.DrainRate,
          CircleSize: map.Difficulty.CircleSize,
          OverallDifficulty: map.Difficulty.OverallDifficulty,
          ApproachRate: map.Difficulty.ApproachRate,
          SliderMultiplier: map.Difficulty.SliderMultiplier,
          SliderTickRate: map.Difficulty.SliderTickRate,
        }
      : undefined,
    UserSettings: map.UserSettings
      ? { Offset: map.UserSettings.Offset }
      : undefined,
    Metadata: metadata
      ? {
          Title: metadata.Title,
          TitleUnicode: metadata.TitleUnicode,
          Artist: metadata.Artist,
          ArtistUnicode: metadata.ArtistUnicode,
          Author: metadata.Author
            ? {
                OnlineID: metadata.Author.OnlineID,
                Username: metadata.Author.Username,
                CountryCode: metadata.Author.CountryCode,
              }
            : undefined,
          Source: metadata.Source,
          Tags: metadata.Tags,
          PreviewTime: metadata.PreviewTime,
          AudioFile: metadata.AudioFile,
          BackgroundFile: metadata.BackgroundFile,
          UserTags: [...metadata.UserTags],
        }
      : undefined,
  };
}

function matchesQuery(set: BeatmapSet, query: string): boolean {
  return set.Beatmaps.some((map) =>
    [
      map.Metadata?.Title,
      map.Metadata?.TitleUnicode,
      map.Metadata?.Artist,
      map.Metadata?.ArtistUnicode,
    ].some((value) => value?.toLocaleLowerCase().includes(query)),
  );
}

function matchesExactSelector(
  set: BeatmapSet,
  onlineIds: ReadonlySet<number>,
  hashes: ReadonlySet<string>,
): boolean {
  return (
    onlineIds.has(set.OnlineID) ||
    hashes.has(set.Hash?.toLowerCase() ?? "") ||
    set.Beatmaps.some(
      (map) =>
        onlineIds.has(map.OnlineID) ||
        [map.MD5Hash, map.OnlineMD5Hash, map.Hash].some((hash) =>
          hashes.has(hash?.toLowerCase() ?? ""),
        ),
    )
  );
}

export async function addTestTracks(
  requestedSource: string,
  requestedEnvironment = resolve("tests/environment"),
  options: Options = {},
): Promise<number> {
  if (
    options.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100)
  )
    throw new Error("--limit must be an integer from 1 to 100.");
  const onlineIds = new Set(options.onlineIds ?? []);
  const hashes = new Set(
    (options.hashes ?? []).map((hash) => hash.toLowerCase()),
  );
  const exactSelection = onlineIds.size > 0 || hashes.size > 0;
  const limit = options.limit ?? (exactSelection ? Infinity : 5);
  const sourcePath = await realpath(
    await resolveLazerInstallPath(resolve(requestedSource)),
  );
  const environmentPath = await realpath(requestedEnvironment);
  if (sourcePath === environmentPath)
    throw new Error("The installed directory cannot be the test environment.");
  await stat(join(sourcePath, "client.realm"));
  await stat(join(environmentPath, "client.realm"));

  const source = new Realm({
    path: join(sourcePath, "client.realm"),
    readOnly: true,
    schemaVersion: 52,
    disableFormatUpgrade: true,
  });
  try {
    const target = new Realm({
      path: join(environmentPath, "client.realm"),
      schema: Schema,
      schemaVersion: 52,
    });
    try {
      const query = options.query?.trim().toLocaleLowerCase();
      const selected: BeatmapSet[] = [];
      for (const set of source
        .objects<BeatmapSet>("BeatmapSet")
        .sorted("DateAdded", true)) {
        if (set.DeletePending || !set.Beatmaps.length) continue;
        if (target.objectForPrimaryKey("BeatmapSet", set.ID)) continue;
        if (exactSelection && !matchesExactSelector(set, onlineIds, hashes))
          continue;
        if (query && !matchesQuery(set, query)) continue;
        selected.push(set);
        if (selected.length === limit) break;
      }
      if (!selected.length) return 0;

      const assets = new Set<string>();
      for (const set of selected) {
        for (const usage of set.Files) {
          const hash = usage.File?.Hash?.toLowerCase();
          if (hash && isAssetHash(hash)) assets.add(hash);
        }
      }
      for (const hash of assets) {
        const destination = hashedFilePath(environmentPath, hash);
        try {
          await stat(destination);
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await mkdir(join(environmentPath, "files", hash[0], hash.slice(0, 2)), {
          recursive: true,
        });
        await copyFile(hashedFilePath(sourcePath, hash), destination);
      }

      target.write(() => {
        for (const set of selected) {
          const files = [...set.Files].flatMap((usage) => {
            const hash = usage.File?.Hash?.toLowerCase();
            if (!usage.Filename || !hash || !isAssetHash(hash)) return [];
            return [
              {
                Filename: usage.Filename,
                File:
                  target.objectForPrimaryKey("File", hash) ??
                  target.create("File", { Hash: hash }),
              },
            ];
          });
          const imported = target.create("BeatmapSet", {
            ID: set.ID,
            OnlineID: set.OnlineID,
            DateAdded: set.DateAdded,
            DateSubmitted: set.DateSubmitted,
            DateRanked: set.DateRanked,
            Status: set.Status,
            DeletePending: false,
            Hash: set.Hash,
            Protected: set.Protected,
            Files: files,
            Beatmaps: [...set.Beatmaps].map(copyBeatmap),
          }) as unknown as { Beatmaps: { BeatmapSet: unknown }[] };
          for (const map of imported.Beatmaps) map.BeatmapSet = imported;
        }
      });
      return selected.length;
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
}

function parseList(value: string, flag: string): string[] {
  const input = value.trim();
  if (input.startsWith("[") !== input.endsWith("]"))
    throw new Error(`Invalid list for ${flag}.`);
  const contents = input.startsWith("[") ? input.slice(1, -1) : input;
  const items = contents
    .split(",")
    .map((item) => item.trim().replace(/^(["'])(.*)\1$/, "$2"));
  if (items.some((item) => !item)) throw new Error(`Invalid list for ${flag}.`);
  return items;
}

export function parseArgs(args: string[]): {
  source: string;
  options: Options;
} {
  let source = defaultLazerInstallPath();
  const options: Options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!["--source", "--query", "--limit", "--ids", "--hashes"].includes(flag))
      throw new Error(`Unknown argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}.`);
    if (flag === "--source") source = value;
    if (flag === "--query") options.query = value;
    if (flag === "--limit") options.limit = Number(value);
    if (flag === "--ids") {
      const ids = parseList(value, flag).map((id) => {
        if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
          throw new Error(`Invalid online ID: ${id}`);
        return Number(id);
      });
      options.onlineIds = [...(options.onlineIds ?? []), ...ids];
    }
    if (flag === "--hashes") {
      const hashes = parseList(value, flag).map((hash) => {
        if (!/^(?:[a-f\d]{32}|[a-f\d]{64})$/i.test(hash))
          throw new Error(`Invalid beatmap hash: ${hash}`);
        return hash.toLowerCase();
      });
      options.hashes = [...(options.hashes ?? []), ...hashes];
    }
  }
  return { source, options };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const { source, options } = parseArgs(process.argv.slice(2));
    const count = await addTestTracks(source, undefined, options);
    console.log(`Added ${count} beatmap set(s) to tests/environment.`);
  } finally {
    Realm.shutdown();
  }
}
