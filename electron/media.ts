import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { Readable } from "node:stream";

export interface MediaAsset {
  hash: string;
  filename: string;
}
export interface AssetLibrary {
  summary: { installPath: string };
  assets: ReadonlyMap<string, MediaAsset>;
}
export interface ByteRange {
  start: number;
  end: number;
}
export interface ResolvedMediaFile {
  filename: string;
  size: number;
  asset: MediaAsset;
}
export const isAssetHash = (hash: string): boolean =>
  /^[a-f\d]{64}$/i.test(hash);
export const assetUrl = (hash: string): string =>
  `osu-media://asset/${hash.toLowerCase()}`;

export function hashedFilePath(installPath: string, hash: string): string {
  if (!isAssetHash(hash)) throw new Error("Invalid asset hash");
  const lower = hash.toLowerCase();
  return join(
    installPath,
    "files",
    lower.slice(0, 1),
    lower.slice(0, 2),
    lower,
  );
}

export function hashedFileCandidates(
  installPath: string,
  hash: string,
): string[] {
  return [hashedFilePath(installPath, hash)];
}

export function mimeForFilename(filename: string): string {
  const types: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".flv": "video/x-flv",
    ".wmv": "video/x-ms-wmv",
    ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg",
    ".mkv": "video/x-matroska",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
  };
  return types[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/** null means an invalid/unsatisfiable range; absent headers are handled by the caller. */
export function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0 || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { start: Math.max(0, size - suffix), end: size - 1 }
      : null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end: Math.min(size - 1, end) };
}

/** Resolves an allowlisted asset hash without trusting any path from a URL. */
export async function resolveMediaFile(
  library: AssetLibrary | null,
  hash: string,
): Promise<ResolvedMediaFile | null> {
  if (!library || !isAssetHash(hash)) return null;
  const asset = library.assets.get(hash.toLowerCase());
  if (!asset) return null;
  const root = await realpath(join(library.summary.installPath, "files"));
  for (const candidate of hashedFileCandidates(
    library.summary.installPath,
    hash,
  )) {
    try {
      const resolved = await realpath(candidate);
      const withinRoot = relative(root, resolved);
      if (
        !withinRoot ||
        withinRoot === ".." ||
        withinRoot.startsWith(
          `..${process.platform === "win32" ? "\\" : "/"}`,
        ) ||
        isAbsolute(withinRoot)
      )
        return null;
      const info = await stat(resolved);
      if (info.isFile()) return { filename: resolved, size: info.size, asset };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
  }
  return null;
}

/** Streams a previously validated file with browser-compatible range handling. */
export function streamMediaFile(
  request: Request,
  filename: string,
  size: number,
  contentType: string,
): Response {
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  });
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;
  if (rangeHeader && !range) {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const length = range ? range.end - range.start + 1 : size;
  headers.set("Content-Length", String(length));
  if (range)
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  if (request.method === "HEAD" || length === 0)
    return new Response(null, { status: range ? 206 : 200, headers });
  const stream = createReadStream(filename, range ?? {});
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range ? 206 : 200,
    headers,
  });
}

/** Only indexed media hashes can be served. No names from a URL become filesystem paths. */
export async function serveMedia(
  request: Request,
  library: AssetLibrary | null,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response(null, { status: 400 });
  }
  const hash = url.pathname.slice(1);
  if (
    url.protocol !== "osu-media:" ||
    url.host !== "asset" ||
    url.username ||
    url.password ||
    url.search ||
    !isAssetHash(hash)
  )
    return new Response(null, { status: 400 });
  try {
    const resolved = await resolveMediaFile(library, hash);
    if (!resolved) return new Response(null, { status: 404 });
    return streamMediaFile(
      request,
      resolved.filename,
      resolved.size,
      mimeForFilename(resolved.asset.filename),
    );
  } catch {
    return new Response(null, { status: 404 });
  }
}
