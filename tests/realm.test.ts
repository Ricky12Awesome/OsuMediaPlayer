import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import Realm from "realm";
import { Schema } from "../src/shared/client-model";
import {
  loadLibraryFromRealm,
  sortedLibraryBeatmaps,
} from "../src/main/library";
import {
  defaultLazerInstallPath,
  resolveLazerInstallPath,
} from "../src/main/lazer-path";

after(() => Realm.shutdown());

test("default lazer paths cover all supported platforms", () => {
  assert.equal(
    defaultLazerInstallPath("linux", "/home/player"),
    "/home/player/.local/share/osu",
  );
  assert.equal(
    defaultLazerInstallPath("darwin", "/Users/player"),
    "/Users/player/Library/Application Support/osu",
  );
  assert.equal(
    defaultLazerInstallPath("win32", "C:\\Users\\player", "D:\\Roaming"),
    "D:\\Roaming\\osu",
  );
});

test("storage.ini redirects storage and rejects relative paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osu-path-"));
  try {
    assert.equal(await resolveLazerInstallPath(directory), directory);
    await writeFile(
      join(directory, "storage.ini"),
      `\uFEFF# config\r\nFullPath = ${directory}/custom songs\r\n`,
    );
    assert.equal(
      await resolveLazerInstallPath(directory),
      `${directory}/custom songs`,
    );
    await writeFile(join(directory, "storage.ini"), "FullPath = ../relative");
    await assert.rejects(resolveLazerInstallPath(directory), /absolute/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("imports linked Realm records read-only, including collections and dates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osu-realm-"));
  const path = join(directory, "client.realm");
  const audioHash = "a".repeat(64);
  const md5 = "b".repeat(32);
  const date = new Date("2025-01-02T00:00:00Z");
  try {
    const fixture = new Realm({ path, schema: Schema, schemaVersion: 52 });
    try {
      fixture.write(() => {
        const set = fixture.create("BeatmapSet", {
          ID: new Realm.BSON.UUID(),
          OnlineID: 42,
          Status: 0,
          DeletePending: false,
          Protected: false,
          DateAdded: date,
          Files: [{ Filename: "song.mp3", File: { Hash: audioHash } }],
          Beatmaps: [
            {
              ID: new Realm.BSON.UUID(),
              MD5Hash: md5,
              Status: 0,
              OnlineID: 1,
              Hidden: false,
              EndTimeObjectCount: 0,
              TotalObjectCount: 0,
              BeatDivisor: 4,
              Length: 120000,
              BPM: 180,
              StarRating: 4,
              LastLocalUpdate: date,
              Metadata: {
                PreviewTime: 0,
                Title: "Song",
                Artist: "Artist",
                AudioFile: "song.mp3",
                Tags: "dance",
                UserTags: ["favorite"],
              },
            },
          ],
        });
        const map = (set as unknown as { Beatmaps: { BeatmapSet: unknown }[] })
          .Beatmaps[0];
        map.BeatmapSet = set;
        fixture.create("BeatmapCollection", {
          ID: new Realm.BSON.UUID(),
          Name: "Favorites",
          BeatmapMD5Hashes: [md5],
          LastModified: date,
        });
        fixture.create("BeatmapSet", {
          ID: new Realm.BSON.UUID(),
          DateAdded: date,
          DeletePending: true,
          OnlineID: -1,
          Status: 0,
          Protected: false,
        });
      });
    } finally {
      fixture.close();
    }
    const checksum = async () =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    const before = await checksum();
    const index = await loadLibraryFromRealm(directory);
    assert.equal(index.summary.trackCount, 1);
    assert.equal(index.summary.beatmapCount, 1);
    const track = index.query().items[0];
    assert.equal(track.title, "Song");
    assert.equal(track.duration, 120);
    assert.equal(track.addedAt, date.getTime());
    assert.equal(track.audioHash, audioHash);
    assert.deepEqual(track.collections, ["Favorites"]);
    assert.deepEqual(track.tags, ["dance", "favorite"]);
    assert.equal(await checksum(), before);
    await assert.rejects(
      loadLibraryFromRealm(directory, undefined, AbortSignal.abort()),
    );
    const controller = new AbortController();
    await assert.rejects(
      loadLibraryFromRealm(
        directory,
        () => controller.abort(),
        controller.signal,
      ),
      { name: "AbortError" },
    );
    // Cancellation releases Realm too, allowing a subsequent import.
    assert.equal((await loadLibraryFromRealm(directory)).summary.trackCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing database is never created", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osu-missing-"));
  try {
    await assert.rejects(loadLibraryFromRealm(directory));
    await assert.rejects(readFile(join(directory, "client.realm")), {
      code: "ENOENT",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Realm sorts linked Unicode titles ascending before loading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osu-sort-"));
  const path = join(directory, "client.realm");
  try {
    const fixture = new Realm({
      path,
      schemaVersion: 52,
      schema: [
        { name: "BeatmapSet", properties: { DeletePending: "bool" } },
        {
          name: "Metadata",
          properties: { Title: "string", TitleUnicode: "string?" },
        },
        {
          name: "Beatmap",
          properties: { Metadata: "Metadata", BeatmapSet: "BeatmapSet" },
        },
      ],
    });
    try {
      fixture.write(() => {
        for (const Title of ["Zulu", "-+", "Alpha"])
          fixture.create("Beatmap", {
            Metadata: { Title, TitleUnicode: Title },
            BeatmapSet: { DeletePending: false },
          });
        fixture.create("Beatmap", {
          Metadata: { Title: "Deleted", TitleUnicode: "Deleted" },
          BeatmapSet: { DeletePending: true },
        });
        fixture.create("Beatmap", { Metadata: { Title: "Orphan" } });
      });
    } finally {
      fixture.close();
    }
    const realm = new Realm({ path, readOnly: true, schemaVersion: 52 });
    try {
      assert.deepEqual(
        Array.from(sortedLibraryBeatmaps(realm), (map) => map.Metadata?.Title),
        ["-+", "Alpha", "Zulu"],
      );
    } finally {
      realm.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
