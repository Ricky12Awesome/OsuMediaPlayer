import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isAssetHash, streamMediaFile } from "../media";
import type { CachedVideo, StreamMetadata } from "./cache";

export const playlistName = "playlist.m3u8";

export function convertedVideoUrl(hash: string, profileHash?: string): string {
  const base = `osu-media://video-cache/${hash.toLowerCase()}`;
  return profileHash
    ? `${base}?profile=${encodeURIComponent(profileHash.toLowerCase())}`
    : base;
}

export interface HlsServerOptions {
  streamDirectory: string;
  playlist?: string;
  ready: ReadonlyMap<string, CachedVideo>;
  readStreamMetadata: () => Promise<StreamMetadata | null>;
  touchCached: (filename: string) => Promise<void>;
}

function streamFileFromUrl(url: URL): string | null {
  if (
    [...url.searchParams.keys()].some(
      (key) => key !== "file" && key !== "profile",
    )
  )
    return null;
  const file = url.searchParams.get("file");
  if (!file) return playlistName;
  return file === "init.mp4" || /^segment-\d{6}\.m4s$/.test(file ?? "")
    ? file
    : null;
}

async function servePlaylist(
  request: Request,
  hash: string,
  profileHash: string | null,
  playlistFilename: string,
): Promise<Response> {
  let playlist = await readFile(playlistFilename, "utf8");
  const mediaUrl = (file: string) => {
    const url = new URL(convertedVideoUrl(hash, profileHash ?? undefined));
    url.searchParams.set("file", file);
    return url.toString();
  };
  playlist = playlist
    .replace(
      /URI="([^"]+)"/g,
      (_match, file: string) => `URI="${mediaUrl(file)}"`,
    )
    .split(/\r?\n/)
    .map((line) => (line && !line.startsWith("#") ? mediaUrl(line) : line))
    .join("\n");
  const body = Buffer.from(playlist);
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Serve a converted MP4 or the currently active shared HLS stream. */
export async function serveHlsRequest(
  request: Request,
  options: HlsServerOptions,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  try {
    const url = new URL(request.url);
    const hash = url.pathname.slice(1).toLowerCase();
    if (
      url.protocol !== "osu-media:" ||
      url.host !== "video-cache" ||
      url.username ||
      url.password ||
      !isAssetHash(hash)
    )
      return new Response(null, { status: 400 });
    const requestedProfile = url.searchParams.get("profile");
    if (requestedProfile !== null && !isAssetHash(requestedProfile))
      return new Response(null, { status: 400 });
    const converted = options.ready.get(hash);
    const file = url.searchParams.get("file");
    if (
      converted &&
      !file &&
      requestedProfile === converted.profileHash &&
      [...url.searchParams.keys()].every((key) => key === "profile")
    ) {
      await options.touchCached(converted.filename);
      return streamMediaFile(
        request,
        converted.filename,
        converted.size,
        "video/mp4",
      );
    }

    const streamMetadata = await options.readStreamMetadata();
    const streamMatches =
      streamMetadata?.hash === hash &&
      (streamMetadata.profileHash
        ? requestedProfile === streamMetadata.profileHash
        : requestedProfile === null);
    if (!streamMatches) return new Response(null, { status: 404 });
    const streamFile = streamFileFromUrl(url);
    if (!streamFile) return new Response(null, { status: 400 });
    if (streamFile === playlistName)
      return await servePlaylist(
        request,
        hash,
        requestedProfile,
        options.playlist ?? join(options.streamDirectory, playlistName),
      );
    const filename = join(options.streamDirectory, streamFile);
    const info = await stat(filename);
    if (!info.isFile()) return new Response(null, { status: 404 });
    const response = streamMediaFile(request, filename, info.size, "video/mp4");
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return new Response(null, { status: 404 });
  }
}
