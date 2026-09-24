import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import Realm from "realm";
import { addTestTracks, parseArgs } from "../scripts/add-test-tracks";
import { hashedFilePath } from "../src/main/media";
import { loadSongListFromRealm } from "../src/main/song-list/index";
import { Schema } from "../src/shared/client-model";

after(() => Realm.shutdown());

async function addSong(
  directory: string,
  title: string,
  onlineId: number,
  withAsset = true,
  selectors: {
    setHash?: string;
    mapMd5?: string;
    onlineMd5?: string;
    mapOnlineId?: number;
  } = {},
): Promise<string> {
  const bytes = Buffer.from(`${title} audio`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (withAsset) {
    const path = hashedFilePath(directory, hash);
    await mkdir(join(directory, "files", hash[0], hash.slice(0, 2)), {
      recursive: true,
    });
    await writeFile(path, bytes);
  }
  const realm = new Realm({
    path: join(directory, "client.realm"),
    schema: Schema,
    schemaVersion: 52,
  });
  try {
    realm.write(() => {
      const set = realm.create("BeatmapSet", {
        ID: new Realm.BSON.UUID(),
        OnlineID: onlineId,
        Hash: selectors.setHash,
        DateAdded: new Date("2025-01-01T00:00:00Z"),
        Status: 0,
        DeletePending: false,
        Protected: false,
        Files: [{ Filename: "audio.mp3", File: { Hash: hash } }],
        Beatmaps: [
          {
            ID: new Realm.BSON.UUID(),
            Status: 0,
            OnlineID: selectors.mapOnlineId ?? onlineId,
            MD5Hash: selectors.mapMd5,
            OnlineMD5Hash: selectors.onlineMd5,
            Hidden: false,
            EndTimeObjectCount: 0,
            TotalObjectCount: 0,
            BeatDivisor: 4,
            Length: 1000,
            BPM: 120,
            StarRating: 2,
            Metadata: {
              Title: title,
              Artist: "Test Artist",
              PreviewTime: 0,
              AudioFile: "audio.mp3",
            },
          },
        ],
      }) as unknown as { Beatmaps: { BeatmapSet: unknown }[] };
      set.Beatmaps[0].BeatmapSet = set;
    });
  } finally {
    realm.close();
  }
  return hash;
}

test("parses multiple online IDs and hashes from bracketed CLI lists", () => {
  const hash = "a".repeat(32);
  assert.deepEqual(
    parseArgs([
      "--ids",
      "[345678, 3456789]",
      "--ids",
      "234789",
      "--hashes",
      `["${hash.toUpperCase()}"]`,
    ]).options,
    { onlineIds: [345678, 3456789, 234789], hashes: [hash] },
  );
  assert.throws(() => parseArgs(["--ids", "[123, nope]"]), /Invalid online ID/);
  assert.throws(() => parseArgs(["--hashes", "1234"]), /Invalid beatmap hash/);
});

test("imports multiple sets selected by set and beatmap IDs or hashes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osu-import-selectors-"));
  const source = join(directory, "source");
  const target = join(directory, "target");
  await mkdir(source);
  await mkdir(target);
  try {
    await addSong(source, "Set ID", 123, true, { mapOnlineId: 1001 });
    await addSong(source, "Map ID", 124, true, { mapOnlineId: 1002 });
    await addSong(source, "Map MD5", 125, true, {
      mapMd5: "a".repeat(32),
    });
    await addSong(source, "Set Hash", 126, true, {
      setHash: "b".repeat(64),
    });
    await addSong(source, "Unselected", 127);
    await addSong(target, "Fixture Track", 900001);

    assert.equal(
      await addTestTracks(source, target, {
        onlineIds: [123, 1002],
        hashes: ["A".repeat(32), "b".repeat(64)],
      }),
      4,
    );
    const index = await loadSongListFromRealm(target);
    try {
      assert.deepEqual(
        new Set(index.query({ limit: 10 }).items.map((song) => song.title)),
        new Set(["Fixture Track", "Set ID", "Map ID", "Map MD5", "Set Hash"]),
      );
    } finally {
      index.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reuses a file referenced by multiple names in one set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osu-import-shared-file-"));
  const source = join(directory, "source");
  const target = join(directory, "target");
  await mkdir(source);
  await mkdir(target);
  try {
    const hash = await addSong(source, "Shared File", 123);
    await addSong(target, "Fixture Track", 900001);
    const realm = new Realm({
      path: join(source, "client.realm"),
      schema: Schema,
      schemaVersion: 52,
    });
    try {
      realm.write(() => {
        const set = realm.objects("BeatmapSet")[0] as unknown as {
          Files: Array<{ Filename: string; File: { Hash: string } }>;
        };
        set.Files.push({ Filename: "copy.mp3", File: set.Files[0].File });
      });
    } finally {
      realm.close();
    }

    assert.equal(await addTestTracks(source, target, { onlineIds: [123] }), 1);
    const imported = new Realm({
      path: join(target, "client.realm"),
      schema: Schema,
      schemaVersion: 52,
    });
    try {
      const set = imported
        .objects("BeatmapSet")
        .find(
          (entry) =>
            (entry as unknown as { OnlineID: number }).OnlineID === 123,
        ) as unknown as {
        Files: Array<{ Filename: string; File: { Hash: string } }>;
      };
      assert.deepEqual(
        set.Files.map((file) => [file.Filename, file.File.Hash]),
        [
          ["audio.mp3", hash],
          ["copy.mp3", hash],
        ],
      );
    } finally {
      imported.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("adds selected installed sets without changing the source or adding duplicates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osu-import-test-"));
  const source = join(directory, "source");
  const target = join(directory, "target");
  await mkdir(source);
  await mkdir(target);
  try {
    const hash = await addSong(source, "Alpha Track", 123);
    await addSong(source, "Beta Track", 124);
    await addSong(target, "Fixture Track", 900001);

    await assert.rejects(
      addTestTracks(source, source),
      /cannot be the test environment/,
    );
    assert.equal(await addTestTracks(source, target, { query: "alpha" }), 1);
    assert.deepEqual(
      await readFile(hashedFilePath(target, hash)),
      Buffer.from("Alpha Track audio"),
    );
    assert.equal(await addTestTracks(source, target, { query: "alpha" }), 0);
    const index = await loadSongListFromRealm(target);
    try {
      assert.deepEqual(
        new Set(index.query({ limit: 10 }).items.map((song) => song.title)),
        new Set(["Fixture Track", "Alpha Track"]),
      );
    } finally {
      index.close();
    }
    const sourceIndex = await loadSongListFromRealm(source);
    try {
      assert.equal(sourceIndex.summary.songCount, 2);
    } finally {
      sourceIndex.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing source assets leave the test Realm unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osu-import-missing-"));
  const source = join(directory, "source");
  const target = join(directory, "target");
  await mkdir(source);
  await mkdir(target);
  try {
    await addSong(source, "Missing Audio", 125, false);
    await addSong(target, "Fixture Track", 900001);
    await assert.rejects(addTestTracks(source, target), /ENOENT/);
    const index = await loadSongListFromRealm(target);
    try {
      assert.equal(index.summary.songCount, 1);
    } finally {
      index.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
