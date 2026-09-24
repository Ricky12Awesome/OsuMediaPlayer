import {
  app,
  BrowserWindow,
  ClipboardItem,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
} from "electron";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type {
  SongListSummary,
  MediaAction,
  Song,
  SongDebugInfo,
  SongDebugMediaInfo,
  SongContextMenuAction,
  SongContextMenuInfo,
  VideoSource,
} from "../shared/types";
import { SongListIndex } from "./song-list/index";
import { directorySize } from "./cache";
import { clearSongListCache } from "./song-list/cache";
import {
  loadSongListInWorker,
  waitForSongListWorkers,
} from "./song-list/loader";
import {
  mimeForFilename,
  resolveMediaFile,
  serveMedia,
  type ResolvedMediaFile,
} from "./media";
import { VideoTranscoder } from "./video/transcoder";
import { ffprobeFor, runProcess } from "./video/process";
import { resolveRendererUrl } from "./renderer-url";
import {
  parseSongListQuery,
  parseVideoEncodingSettings,
} from "./ipc-validation";
import { startOffscreenViewer } from "./test-viewer";

const isWaylandSession =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));
const offscreenTest =
  !app.isPackaged && process.env.OSU_MEDIA_PLAYER_OFFSCREEN_TEST === "1";
const testViewer =
  offscreenTest && process.env.OSU_MEDIA_PLAYER_TEST_VIEWER === "1";
const testInstallPath = offscreenTest
  ? process.env.OSU_MEDIA_PLAYER_TEST_INSTALL_PATH
  : undefined;

if (offscreenTest) {
  const userDataPath = process.env.OSU_MEDIA_PLAYER_TEST_USER_DATA;
  if (
    !testInstallPath ||
    !isAbsolute(testInstallPath) ||
    !userDataPath ||
    !isAbsolute(userDataPath)
  )
    throw new Error(
      "Offscreen tests need absolute fixture and user data paths.",
    );
  app.setPath("userData", userDataPath);
}

// Chromium's timer-based Wayland frame source can report a small negative
// latency for frames that are presented just before the predicted timestamp.
// Use the compositor's frame callbacks instead so Viz receives consistent
// timing data without falling back to XWayland or disabling GPU rendering.
if (isWaylandSession)
  app.commandLine.appendSwitch(
    "enable-features",
    "WaylandExternalBeginFrameSource",
  );

protocol.registerSchemesAsPrivileged([
  {
    scheme: "omp",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let window: BrowserWindow | null = null;
let rendererReady = false;
let windowReadyToShow = false;
let songList: SongListIndex | null = null;
let pendingLoad: Promise<SongListIndex> | null = null;
let pendingIndexCacheClear: Promise<void> | null = null;
let pendingPath: string | undefined;
let importController: AbortController | null = null;
let videoTranscoder: VideoTranscoder | null = null;
let zoomStatusMenuItem: Electron.MenuItem | null = null;
let offscreenViewer: Awaited<ReturnType<typeof startOffscreenViewer>> | null =
  null;
const rendererUrl = resolveRendererUrl(
  process.env.ELECTRON_RENDERER_URL,
  app.isPackaged,
);
const zoomStages = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
] as const;

function replaceSongList(next: SongListIndex): void {
  if (songList && songList !== next && !songList.sharesRealm(next))
    songList.close();
  songList = next;
}

function currentZoomPercent(): number {
  if (!window || window.isDestroyed()) return 100;
  return Math.round(window.webContents.getZoomFactor() * 100);
}

function notifyZoomChange(): void {
  if (!window || window.isDestroyed()) return;
  const percent = currentZoomPercent();
  if (zoomStatusMenuItem) zoomStatusMenuItem.label = `Zoom: ${percent}%`;
  window.webContents.send("window:zoom", percent);
}

function changeZoom(delta: number): void {
  if (!window || window.isDestroyed()) return;
  const current = window.webContents.getZoomFactor() * 100;
  let next: (typeof zoomStages)[number] = zoomStages[0];
  if (delta > 0) {
    next = zoomStages[zoomStages.length - 1];
    for (const stage of zoomStages) {
      if (stage > current + 0.01) {
        next = stage;
        break;
      }
    }
  } else {
    for (let index = zoomStages.length - 1; index >= 0; index -= 1) {
      const stage = zoomStages[index];
      if (stage < current - 0.01) {
        next = stage;
        break;
      }
    }
  }
  window.webContents.setZoomFactor(next / 100);
  notifyZoomChange();
}

function resetZoom(): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.setZoomFactor(1);
  notifyZoomChange();
}

function isTrusted(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): boolean {
  return Boolean(
    window &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame,
  );
}

function requireTrusted(event: Electron.IpcMainInvokeEvent): void {
  if (!isTrusted(event))
    throw new Error("This request did not come from the player window.");
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error &&
      (error.name === "AbortError" ||
        /\babort(?:ed|ing)?\b/i.test(error.message)))
  );
}

function cancelledSongListSummary(installPath?: string): SongListSummary {
  return {
    songCount: 0,
    beatmapCount: 0,
    collectionCount: 0,
    collections: [],
    tags: [],
    installPath: installPath ?? "",
    skippedCount: 0,
  };
}

function createWindow(): void {
  rendererReady = false;
  windowReadyToShow = false;
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 360,
    minHeight: 580,
    backgroundColor: "#17131f",
    frame: false,
    title: "OsuMediaPlayer",
    show: false,
    webPreferences: {
      offscreen: offscreenTest,
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  if (offscreenTest) window.setContentSize(1440, 920);
  if (!offscreenTest)
    window.once("ready-to-show", () => {
      windowReadyToShow = true;
      if (rendererReady) window?.show();
    });
  window.on("enter-full-screen", () =>
    window?.webContents.send("window:fullscreen", true),
  );
  window.on("leave-full-screen", () =>
    window?.webContents.send("window:fullscreen", false),
  );
  window.on("closed", () => {
    window = null;
  });
  window.webContents.on("zoom-changed", notifyZoomChange);
  window.webContents.on("did-finish-load", notifyZoomChange);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  if (rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(join(__dirname, "../dist/index.html"));
}

type SongAssetKind = "audio" | "background" | "video";

const songContextMenuActions = new Set<SongContextMenuAction>([
  "copy-title",
  "copy-title-unicode",
  "copy-artist",
  "copy-artist-unicode",
  "copy-audio",
  "copy-audio-path",
  "copy-background",
  "copy-background-path",
  "copy-video",
  "copy-video-path",
  "copy-online-id",
  "copy-md5",
  "open-listing",
  "open-audio",
  "open-background",
  "open-video",
]);

function isSongContextMenuAction(
  value: unknown,
): value is SongContextMenuAction {
  return (
    typeof value === "string" &&
    songContextMenuActions.has(value as SongContextMenuAction)
  );
}

function assetHashForSong(song: Song, kind: SongAssetKind): string | undefined {
  if (kind === "audio") return song.audioHash;
  if (kind === "background") return song.backgroundHash;
  return song.videoHash;
}

async function resolveSongAsset(
  index: SongListIndex,
  song: Song,
  kind: SongAssetKind,
): Promise<ResolvedMediaFile | null> {
  const hash = assetHashForSong(song, kind);
  if (!hash) return null;
  try {
    return await resolveMediaFile(index, hash);
  } catch {
    return null;
  }
}

async function copyAssetData(asset: ResolvedMediaFile): Promise<void> {
  const data = await readFile(asset.filename);
  const mimeType = mimeForFilename(asset.asset.filename);
  await clipboard.write([
    new ClipboardItem({
      [mimeType]: new Blob([data as unknown as BlobPart], { type: mimeType }),
    }),
  ]);
}

function openAsset(asset: ResolvedMediaFile | null): void {
  if (!asset || offscreenTest) return;
  void shell.openPath(asset.filename).catch(() => {
    /* The default application may be unavailable while closing. */
  });
}

async function getSongContextMenuInfo(
  index: SongListIndex,
  song: Song,
): Promise<SongContextMenuInfo> {
  const [audio, background, video] = await Promise.all([
    resolveSongAsset(index, song, "audio"),
    resolveSongAsset(index, song, "background"),
    resolveSongAsset(index, song, "video"),
  ]);
  return {
    audio: Boolean(audio),
    background: Boolean(background),
    video: Boolean(video),
    listing: song.onlineId !== undefined,
  };
}

type DebugMediaKind = "audio" | "background" | "video";

function debugAssetName(filename: string): string {
  const normalized = filename.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || filename;
}

/** Probe optional media properties without making playback depend on ffprobe. */
async function probeDebugMedia(
  filename: string,
  kind: DebugMediaKind,
): Promise<
  Pick<
    SongDebugMediaInfo,
    "duration" | "resolution" | "frameRate" | "codec" | "bitrate"
  >
> {
  const stream = kind === "audio" ? "a:0" : "v:0";
  const { result } = runProcess(
    ffprobeFor(process.env.FFMPEG_PATH || "ffmpeg"),
    [
      "-v",
      "error",
      "-select_streams",
      stream,
      "-show_entries",
      "stream=width,height,codec_name,avg_frame_rate,bit_rate,duration:format=duration,bit_rate",
      "-of",
      "json",
      filename,
    ],
  );
  const completed = await result;
  if (completed.code !== 0)
    return {
      duration: null,
      resolution: null,
      frameRate: null,
      codec: null,
      bitrate: null,
    };
  try {
    const parsed = JSON.parse(completed.stdout) as {
      streams?: Array<{
        width?: number;
        height?: number;
        codec_name?: string;
        avg_frame_rate?: string;
        r_frame_rate?: string;
        bit_rate?: string;
        duration?: string;
      }>;
      format?: { duration?: string; bit_rate?: string };
    };
    const streamInfo = parsed.streams?.[0];
    const parseFrameRate = (value: string | undefined): number | null => {
      const [numerator, denominator] = (value ?? "").split("/").map(Number);
      if (denominator > 0 && Number.isFinite(numerator / denominator))
        return numerator / denominator;
      return null;
    };
    const frameRate =
      parseFrameRate(streamInfo?.avg_frame_rate) ??
      parseFrameRate(streamInfo?.r_frame_rate);
    const durationValue = Number(
      streamInfo?.duration ?? parsed.format?.duration,
    );
    const bitrateValue = Number(
      streamInfo?.bit_rate ?? parsed.format?.bit_rate,
    );
    return {
      duration:
        Number.isFinite(durationValue) && durationValue >= 0
          ? durationValue
          : null,
      resolution:
        Number.isFinite(streamInfo?.width) &&
        Number.isFinite(streamInfo?.height) &&
        streamInfo?.width &&
        streamInfo?.height
          ? { width: streamInfo.width, height: streamInfo.height }
          : null,
      frameRate,
      codec: streamInfo?.codec_name ?? null,
      bitrate:
        Number.isFinite(bitrateValue) && bitrateValue > 0 ? bitrateValue : null,
    };
  } catch {
    return {
      duration: null,
      resolution: null,
      frameRate: null,
      codec: null,
      bitrate: null,
    };
  }
}

async function getSongDebugInfo(
  index: SongListIndex,
  song: Song,
  videoSource: VideoSource = "none",
): Promise<SongDebugInfo> {
  const resolve = async (
    kind: DebugMediaKind,
    hash: string | undefined,
  ): Promise<SongDebugMediaInfo | null> => {
    if (!hash) return null;
    const resolved = await resolveSongAsset(index, song, kind);
    if (!resolved) return null;
    const probe = await probeDebugMedia(resolved.filename, kind);
    return {
      name: debugAssetName(resolved.asset.filename),
      path: resolved.filename,
      hash: resolved.asset.hash,
      fileSize: resolved.size,
      ...probe,
    };
  };
  const [audio, background, originalVideo] = await Promise.all([
    resolve("audio", song.audioHash),
    resolve("background", song.backgroundHash),
    resolve("video", song.videoHash),
  ]);
  let encodedVideo: SongDebugMediaInfo | null = null;
  if (
    song.videoHash &&
    (videoSource === "Cache" || videoSource === "HLS") &&
    videoTranscoder
  ) {
    const encodedPath = await videoTranscoder.playbackFilename(
      song.videoHash,
      videoSource,
    );
    if (encodedPath) {
      try {
        const [file, probe] = await Promise.all([
          stat(encodedPath),
          probeDebugMedia(encodedPath, "video"),
        ]);
        const codec =
          probe.codec ??
          (await videoTranscoder.playbackCodec(song.videoHash, videoSource)) ??
          originalVideo?.codec ??
          null;
        encodedVideo = {
          name: debugAssetName(encodedPath),
          path: encodedPath,
          hash: song.videoHash,
          fileSize: file.size,
          ...probe,
          codec,
        };
      } catch {
        // The stream can disappear while playback changes source.
      }
    }
  }
  return { audio, background, video: originalVideo, encodedVideo };
}

function copyTextForAction(
  song: Song,
  action: SongContextMenuAction,
): string | undefined {
  switch (action) {
    case "copy-title":
      return song.title;
    case "copy-title-unicode":
      return song.titleUnicode;
    case "copy-artist":
      return song.artist;
    case "copy-artist-unicode":
      return song.artistUnicode;
    case "copy-online-id":
      return song.onlineId === undefined ? undefined : String(song.onlineId);
    case "copy-md5":
      return song.md5Hash;
    default:
      return undefined;
  }
}

function assetKindForAction(
  action: SongContextMenuAction,
): SongAssetKind | undefined {
  if (action.includes("audio")) return "audio";
  if (action.includes("background")) return "background";
  if (action.includes("video")) return "video";
  return undefined;
}

function setupIPC(): void {
  ipcMain.on("window:ready", (event) => {
    if (!isTrusted(event)) return;
    rendererReady = true;
    if (!offscreenTest && windowReadyToShow) window?.show();
  });
  ipcMain.handle(
    "song-list:load-cached",
    async (event, requestedPath: unknown) => {
      requireTrusted(event);
      if (quitting || pendingLoad) return null;
      if (
        requestedPath !== undefined &&
        (typeof requestedPath !== "string" || !isAbsolute(requestedPath))
      )
        return null;
      const installPath =
        testInstallPath ?? (requestedPath as string | undefined);
      try {
        const loaded = await loadSongListInWorker(
          installPath,
          undefined,
          undefined,
          (index) => {
            songList = index;
          },
          join(app.getPath("userData"), "song-list-cache"),
          undefined,
          true,
        );
        replaceSongList(loaded);
        return loaded.summary;
      } catch {
        // A miss is expected here. The renderer will begin the normal streamed
        // import after it has painted its loading UI.
        return null;
      }
    },
  );
  ipcMain.handle(
    "song-list:load",
    async (event, requestedPath: unknown, prioritySongId: unknown) => {
      requireTrusted(event);
      if (quitting) throw new Error("The player is closing.");
      if (pendingIndexCacheClear) await pendingIndexCacheClear;
      if (
        requestedPath !== undefined &&
        (typeof requestedPath !== "string" || !isAbsolute(requestedPath))
      )
        throw new Error("Choose an absolute osu!lazer directory path.");
      const installPath =
        testInstallPath ?? (requestedPath as string | undefined);
      if (
        prioritySongId !== undefined &&
        (typeof prioritySongId !== "string" || prioritySongId.length > 256)
      )
        throw new Error("Invalid saved song ID.");
      if (pendingLoad) {
        if (pendingPath === installPath) {
          try {
            return (await pendingLoad).summary;
          } catch (error) {
            // A duplicate request shares the original import promise. Handle its
            // expected shutdown cancellation the same way as the original call.
            if (quitting && isAbortError(error))
              return songList?.summary ?? cancelledSongListSummary(installPath);
            throw error;
          }
        }
        throw new Error(
          "A song list import is already running. Wait for it to finish, then choose another folder.",
        );
      }
      importController = new AbortController();
      pendingPath = installPath;
      const previousSongList = songList;
      pendingLoad = loadSongListInWorker(
        installPath,
        (progress) => {
          if (window && !window.isDestroyed())
            window.webContents.send("song-list:progress", progress);
        },
        importController!.signal,
        (index) => {
          // Keep the previous song list available for rollback if streaming fails.
          // If loading is cancelled, the callback can then restore it.
          songList = index;
          if (window && !window.isDestroyed())
            window.webContents.send("song-list:progress", {
              phase: "reading",
              records: index.summary.beatmapCount,
              summary: index.summary,
            });
        },
        join(app.getPath("userData"), "song-list-cache"),
        prioritySongId as string | undefined,
      );
      try {
        const loaded = await pendingLoad;
        if (
          previousSongList &&
          previousSongList !== loaded &&
          !previousSongList.sharesRealm(loaded)
        )
          previousSongList.close();
        replaceSongList(loaded);
        return loaded.summary;
      } catch (error) {
        // Restore the previous song list if the new import fails or is cancelled.
        if (previousSongList) songList = previousSongList;
        else songList = null;
        // Closing the app intentionally aborts the pending IPC request. Returning
        // a harmless summary prevents Electron from reporting that expected
        // cancellation as an unhandled handler error.
        if (quitting && isAbortError(error))
          return (
            previousSongList?.summary ?? cancelledSongListSummary(installPath)
          );
        throw error;
      } finally {
        pendingLoad = null;
        pendingPath = undefined;
        importController = null;
      }
    },
  );
  ipcMain.handle("cache:usage", async (event) => {
    requireTrusted(event);
    const [index, video] = await Promise.all([
      directorySize(join(app.getPath("userData"), "song-list-cache")),
      directorySize(join(app.getPath("userData"), "video-cache")),
    ]);
    return { index, video };
  });
  ipcMain.handle("cache:clear", async (event, kind: unknown) => {
    requireTrusted(event);
    if (quitting) throw new Error("The player is closing.");
    if (kind !== "index" && kind !== "video")
      throw new Error("Choose a valid cache to clear.");
    if (kind === "video") {
      await videoTranscoder?.clearCache();
      return;
    }
    if (pendingLoad)
      throw new Error(
        "Wait for the current song list import to finish before clearing the cache.",
      );
    if (pendingIndexCacheClear) return pendingIndexCacheClear;

    const clear = clearSongListCache(
      join(app.getPath("userData"), "song-list-cache"),
    );
    pendingIndexCacheClear = clear;
    try {
      await clear;
    } finally {
      if (pendingIndexCacheClear === clear) pendingIndexCacheClear = null;
    }
  });
  ipcMain.handle("song-list:query", (event, input: unknown) => {
    requireTrusted(event);
    if (!songList) throw new Error("The song list has not been loaded yet.");
    return songList.query(parseSongListQuery(input));
  });
  ipcMain.handle("song-list:song", (event, id: unknown) => {
    requireTrusted(event);
    return typeof id === "string" ? (songList?.getSong(id) ?? null) : null;
  });
  ipcMain.handle(
    "song-list:song-debug-info",
    async (event, id: unknown, source: unknown) => {
      requireTrusted(event);
      if (typeof id !== "string" || !songList) return null;
      const song = songList.getSong(id);
      const videoSource: VideoSource =
        source === "Original" || source === "Cache" || source === "HLS"
          ? source
          : "none";
      return song ? getSongDebugInfo(songList, song, videoSource) : null;
    },
  );
  ipcMain.handle("clipboard:write-text", async (event, value: unknown) => {
    requireTrusted(event);
    if (typeof value !== "string") throw new Error("Invalid clipboard text.");
    clipboard.writeText(value);
  });
  ipcMain.handle(
    "song-list:song-location",
    (event, id: unknown, input: unknown) => {
      requireTrusted(event);
      if (typeof id !== "string" || !songList) return null;
      return songList.getSongLocation(id, parseSongListQuery(input, true));
    },
  );
  ipcMain.handle(
    "video:prepare",
    async (event, songId: unknown, settings: unknown) => {
      requireTrusted(event);
      if (typeof songId !== "string") throw new Error("Invalid song ID.");
      return (
        (await videoTranscoder?.prepare(
          songList,
          songId,
          parseVideoEncodingSettings(settings),
        )) ?? null
      );
    },
  );
  ipcMain.handle("video:cancel", async (event) => {
    requireTrusted(event);
    await videoTranscoder?.cancelEncoding();
  });
  ipcMain.handle("video:stream-complete", async (event, hash: unknown) => {
    requireTrusted(event);
    if (typeof hash !== "string") return;
    await videoTranscoder?.completeStream(hash);
  });
  ipcMain.handle("video:encoding-status", (event) => {
    requireTrusted(event);
    return videoTranscoder?.encodingStatus ?? null;
  });
  ipcMain.handle("window:fullscreen-state", (event) => {
    requireTrusted(event);
    return window?.isFullScreen() ?? false;
  });
  ipcMain.handle("window:zoom-level", (event) => {
    requireTrusted(event);
    return currentZoomPercent();
  });
  ipcMain.handle("song-list:choose", async (event) => {
    requireTrusted(event);
    if (offscreenTest) return testInstallPath ?? null;
    const result = await dialog.showOpenDialog(window!, {
      title: "Choose your osu!lazer directory",
      message: "Choose the directory containing client.realm and files.",
      properties: ["openDirectory"],
      defaultPath: songList?.summary.installPath,
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("song:context-info", async (event, id: unknown) => {
    requireTrusted(event);
    if (typeof id !== "string" || !songList) return null;
    const song = songList.getSong(id);
    return song ? getSongContextMenuInfo(songList, song) : null;
  });
  ipcMain.handle(
    "song:context-action",
    async (event, id: unknown, action: unknown) => {
      requireTrusted(event);
      if (
        typeof id !== "string" ||
        !songList ||
        !isSongContextMenuAction(action)
      )
        return;
      const song = songList.getSong(id);
      if (!song) return;

      if (action === "open-listing") {
        if (song.onlineId === undefined) return;
        if (offscreenTest) return;
        await shell.openExternal(
          `https://osu.ppy.sh/beatmapsets/${song.onlineId}`,
        );
        return;
      }

      const kind = assetKindForAction(action);
      if (!kind) {
        const value = copyTextForAction(song, action);
        if (value !== undefined) await clipboard.writeText(value);
        return;
      }

      const asset = await resolveSongAsset(songList, song, kind);
      if (!asset) return;
      if (action.endsWith("-path")) {
        await clipboard.writeText(asset.filename);
      } else if (action.startsWith("copy-")) {
        await copyAssetData(asset);
      } else {
        openAsset(asset);
      }
    },
  );
  ipcMain.on("window:control", (event, action: unknown) => {
    if (!isTrusted(event) || !window) return;
    if (action === "minimize") window.minimize();
    if (action === "maximize") {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }
    if (action === "fullscreen") window.setFullScreen(!window.isFullScreen());
    if (action === "close") window.close();
  });
}

function sendMediaAction(action: MediaAction): void {
  window?.webContents.send("media:action", action);
}

void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  videoTranscoder = new VideoTranscoder(
    join(app.getPath("userData"), "video-cache"),
    undefined,
    (status) => {
      if (window && !window.isDestroyed())
        window.webContents.send("video:encoding", status);
    },
  );
  protocol.handle("omp", (request) => {
    try {
      if (new URL(request.url).host === "video-cache")
        return videoTranscoder!.serve(request);
    } catch {
      /* The normal media handler will return a bad-request response. */
    }
    return serveMedia(request, songList);
  });
  setupIPC();
  createWindow();
  if (testViewer && window)
    void startOffscreenViewer(window)
      .then((viewer) => {
        offscreenViewer = viewer;
      })
      .catch((error) => {
        console.error(error);
        app.quit();
      });
  const menu = Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "Playback",
      submenu: [
        { label: "Play / Pause", click: () => sendMediaAction("toggle") },
        { label: "Next song", click: () => sendMediaAction("next") },
        { label: "Previous song", click: () => sendMediaAction("previous") },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          id: "zoom-status",
          label: "Zoom: 100%",
          enabled: false,
        },
        {
          label: "Zoom In",
          accelerator: "CommandOrControl+=",
          click: () => changeZoom(1),
        },
        {
          label: "Zoom Out",
          accelerator: "CommandOrControl+-",
          click: () => changeZoom(-1),
        },
        {
          label: "Reset Zoom",
          accelerator: "CommandOrControl+0",
          click: resetZoom,
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ]);
  zoomStatusMenuItem = menu.getMenuItemById("zoom-status");
  Menu.setApplicationMenu(menu);
  notifyZoomChange();
  app.on("activate", () => {
    if (!offscreenTest && BrowserWindow.getAllWindows().length === 0)
      createWindow();
  });
});
let quitReady = false;
let quitting = false;
app.on("before-quit", (event) => {
  if (quitReady) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  importController?.abort();
  videoTranscoder?.dispose();
  void Promise.all([waitForSongListWorkers(), offscreenViewer?.close()]).then(
    () => {
      songList?.close();
      songList = null;
      quitReady = true;
      app.quit();
    },
  );
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
