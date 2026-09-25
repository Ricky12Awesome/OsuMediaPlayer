import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { isAssetHash } from "../media";
import {
  hashEncodingProfile,
  type CacheManifest,
  type EncodingProfile,
} from "./encoding";

export interface StreamMetadata {
  hash: string;
  profileHash?: string;
  profile?: EncodingProfile;
  cacheLimitBytes?: number;
  encoder?: string;
  timestampRepaired?: boolean;
  // FFmpeg can write ENDLIST after SIGTERM; only a successful exit sets this.
  completed?: boolean;
}

export interface CachedVideo {
  filename: string;
  size: number;
  profileHash: string;
}

/** Filesystem state for converted videos and the one shared HLS stream. */
export class VideoCache {
  readonly ready = new Map<string, CachedVideo>();

  constructor(readonly directory: string) {}

  manifestFile(hash: string): string {
    return join(this.directory, `${hash}.manifest.json`);
  }

  async readTimingChecks(): Promise<Map<string, boolean>> {
    try {
      const parsed = JSON.parse(
        await readFile(join(this.directory, "timing-checks.json"), "utf8"),
      ) as { version?: number; results?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.results))
        return new Map();
      const results = new Map<string, boolean>();
      for (const entry of parsed.results.slice(-1024)) {
        if (
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === "string" &&
          isAssetHash(entry[0]) &&
          typeof entry[1] === "boolean"
        )
          results.set(entry[0].toLowerCase(), entry[1]);
      }
      return results;
    } catch {
      return new Map();
    }
  }

  async writeTimingChecks(
    results: ReadonlyMap<string, boolean>,
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `timing-checks.${randomUUID()}.tmp`);
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, results: [...results] }),
      );
      await rename(temporary, join(this.directory, "timing-checks.json"));
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async readCacheManifest(hash: string): Promise<CacheManifest | null> {
    try {
      const parsed = JSON.parse(
        await readFile(this.manifestFile(hash), "utf8"),
      ) as Partial<CacheManifest>;
      return typeof parsed.hash === "string" &&
        typeof parsed.profileHash === "string" &&
        typeof parsed.encoder === "string" &&
        parsed.profile &&
        typeof parsed.profile === "object"
        ? (parsed as CacheManifest)
        : null;
    } catch {
      return null;
    }
  }

  async rememberCached(
    hash: string,
    filename: string,
    profileHash: string,
  ): Promise<boolean> {
    try {
      const [cached, manifest] = await Promise.all([
        stat(filename),
        this.readCacheManifest(hash),
      ]);
      if (
        !cached.isFile() ||
        cached.size === 0 ||
        manifest?.hash !== hash ||
        manifest.profileHash !== profileHash ||
        hashEncodingProfile(manifest.profile) !== manifest.profileHash
      ) {
        await this.removeCached(hash, filename);
        return false;
      }
      this.ready.set(hash, { filename, size: cached.size, profileHash });
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      await rm(this.manifestFile(hash), { force: true });
      return false;
    }
  }

  async removeCached(hash: string, filename?: string): Promise<void> {
    this.ready.delete(hash);
    await Promise.all([
      rm(filename ?? join(this.directory, `${hash}.mp4`), { force: true }),
      rm(this.manifestFile(hash), { force: true }),
    ]);
  }

  async touchCached(filename: string): Promise<void> {
    const now = new Date();
    await utimes(filename, now, now).catch(() => {});
  }

  async enforceCacheLimit(limit: number): Promise<void> {
    if (limit < 0) return;
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }
    const cached = await Promise.all(
      entries
        .filter(
          (entry) => entry.isFile() && /^[0-9a-f]{64}\.mp4$/i.test(entry.name),
        )
        .map(async (entry) => {
          const hash = entry.name.slice(0, 64).toLowerCase();
          const filename = join(this.directory, entry.name);
          const info = await stat(filename);
          return { hash, filename, size: info.size, usedAt: info.mtimeMs };
        }),
    );
    let total = cached.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of cached.sort((a, b) => a.usedAt - b.usedAt)) {
      if (total <= limit) break;
      await this.removeCached(entry.hash, entry.filename);
      total -= entry.size;
    }
  }

  async readStreamMetadata(
    filename = join(this.directory, "stream.json"),
  ): Promise<StreamMetadata | null> {
    try {
      const parsed = JSON.parse(
        await readFile(filename, "utf8"),
      ) as Partial<StreamMetadata>;
      if (typeof parsed.hash !== "string" || !isAssetHash(parsed.hash))
        return null;
      return { ...parsed, hash: parsed.hash.toLowerCase() } as StreamMetadata;
    } catch {
      return null;
    }
  }

  async writeStreamMetadata(metadata: StreamMetadata): Promise<void> {
    const temporary = join(this.directory, `stream.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(metadata));
      await rename(temporary, join(this.directory, "stream.json"));
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async readStreamHash(filename?: string): Promise<string | null> {
    return (await this.readStreamMetadata(filename))?.hash ?? null;
  }
}
