import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import Realm from "realm";
import { createServer } from "vite";
import {
  parseSongListQuery,
  parseVideoEncodingSettings,
} from "../src/main/ipc-validation.ts";
import { serveMedia } from "../src/main/media.ts";
import { loadSongListFromRealm } from "../src/main/song-list/index.ts";
import { VideoTranscoder } from "../src/main/video/transcoder.ts";

const execFileAsync = promisify(execFile);
const installPath = resolve("tests/environment");
const origin = "http://127.0.0.1:5174";

await execFileAsync(
  process.execPath,
  ["--import", "tsx", "scripts/create-test-environment.ts"],
  {
    stdio: "inherit",
  },
);

const index = await loadSongListFromRealm(installPath);
const statusClients = new Set();
const transcoder = new VideoTranscoder(
  join(installPath, "video-cache"),
  undefined,
  (status) => {
    const message = `data: ${JSON.stringify(status)}\n\n`;
    for (const client of statusClients) client.write(message);
  },
);
const bridge = await readFile(resolve("tests/fixtures/browser-bridge.js"));

function browserSong(song) {
  if (!song) return null;
  return {
    ...song,
    audioUrl: `/__fixture_asset/${song.audioHash}`,
    artworkUrl: song.backgroundHash
      ? `/__fixture_asset/${song.backgroundHash}`
      : undefined,
    videoUrl: song.videoHash ? `/__fixture_asset/${song.videoHash}` : undefined,
  };
}

function browserVideoUrl(url) {
  const source = new URL(url);
  if (source.protocol === "omp:" && source.host === "asset")
    return `/__fixture_asset${source.pathname}`;
  if (source.protocol === "omp:" && source.host === "video-cache")
    return `/__fixture_video${source.pathname}${source.search}`;
  throw new Error("Unexpected video URL.");
}

async function sendResponse(reply, response, rewritePlaylist = false) {
  const headers = Object.fromEntries(response.headers);
  if (rewritePlaylist && headers["content-type"]?.includes("mpegurl")) {
    const playlist = (await response.text()).replaceAll(
      "omp://video-cache/",
      `${origin}/__fixture_video/`,
    );
    headers["content-length"] = String(Buffer.byteLength(playlist));
    reply.writeHead(response.status, headers);
    reply.end(playlist);
    return;
  }
  reply.writeHead(response.status, headers);
  if (response.body) await pipeline(Readable.fromWeb(response.body), reply);
  else reply.end();
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Fixture request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fixtureAction(action, args) {
  switch (action) {
    case "loadSongList":
      return index.summary;
    case "querySongList": {
      const page = index.query(parseSongListQuery(args[0] ?? {}));
      return { ...page, items: page.items.map(browserSong) };
    }
    case "getSong":
      return browserSong(
        typeof args[0] === "string" ? index.getSong(args[0]) : null,
      );
    case "getSongLocation": {
      if (typeof args[0] !== "string") return null;
      const location = index.getSongLocation(
        args[0],
        parseSongListQuery(args[1] ?? {}),
      );
      return location
        ? { ...location, song: browserSong(location.song) }
        : null;
    }
    case "prepareVideo": {
      if (typeof args[0] !== "string") return null;
      const prepared = await transcoder.prepare(
        index,
        args[0],
        parseVideoEncodingSettings(args[1]),
      );
      return prepared
        ? { ...prepared, url: browserVideoUrl(prepared.url) }
        : null;
    }
    case "cancelVideoEncoding":
      await transcoder.cancelEncoding();
      return null;
    case "completeVideoStream":
      if (typeof args[0] === "string") await transcoder.completeStream(args[0]);
      return null;
    case "clearCache":
      if (args[0] === "video") await transcoder.clearCache();
      return null;
    default:
      throw new Error("Unknown fixture action.");
  }
}

const fixturePlugin = {
  name: "browser-test-environment",
  transformIndexHtml(html) {
    return {
      html: html.replace(
        "ws://127.0.0.1:5173;",
        "ws://127.0.0.1:5173 ws://127.0.0.1:5174;",
      ),
      tags: [
        {
          tag: "script",
          attrs: { src: "/__fixture_bridge.js" },
          injectTo: "head-prepend",
        },
      ],
    };
  },
  configureServer(server) {
    server.middlewares.use(async (request, reply, next) => {
      const url = new URL(request.url, origin);
      if (url.pathname === "/__fixture_bridge.js") {
        reply.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Content-Length": bridge.length,
          "Cache-Control": "no-store",
        });
        reply.end(bridge);
        return;
      }
      if (url.pathname === "/__fixture_api") {
        if (request.method !== "POST") {
          reply.writeHead(405).end();
          return;
        }
        try {
          const { action, args = [] } = await readJson(request);
          const value = await fixtureAction(action, args);
          reply.writeHead(200, { "Content-Type": "application/json" });
          reply.end(JSON.stringify({ value }));
        } catch (error) {
          reply.writeHead(400, { "Content-Type": "application/json" });
          reply.end(JSON.stringify({ error: String(error) }));
        }
        return;
      }
      if (url.pathname === "/__fixture_events") {
        reply.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        reply.write("\n");
        statusClients.add(reply);
        const status = transcoder.encodingStatus;
        if (status) reply.write(`data: ${JSON.stringify(status)}\n\n`);
        request.once("close", () => statusClients.delete(reply));
        return;
      }
      const isAsset = url.pathname.startsWith("/__fixture_asset/");
      const isVideo = url.pathname.startsWith("/__fixture_video/");
      if (!isAsset && !isVideo) return next();
      try {
        const hash = url.pathname.slice(
          isAsset ? "/__fixture_asset/".length : "/__fixture_video/".length,
        );
        const mediaRequest = new Request(
          `omp://${isAsset ? "asset" : "video-cache"}/${hash}${url.search}`,
          {
            method: request.method,
            headers: request.headers.range
              ? { Range: request.headers.range }
              : undefined,
          },
        );
        const response = isAsset
          ? await serveMedia(mediaRequest, index)
          : await transcoder.serve(mediaRequest);
        await sendResponse(reply, response, isVideo);
      } catch (error) {
        if (!reply.headersSent) reply.writeHead(500);
        reply.end(String(error));
      }
    });
  },
};

let server;
try {
  server = await createServer({
    plugins: [fixturePlugin],
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
  });
  await server.listen();
  console.log(`Test environment: ${origin}/`);
} catch (error) {
  for (const client of statusClients) client.end();
  await server?.close();
  transcoder.dispose();
  index.close();
  Realm.shutdown();
  throw error;
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const client of statusClients) client.end();
  await server.close();
  transcoder.dispose();
  index.close();
  Realm.shutdown();
  process.exit(0);
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
