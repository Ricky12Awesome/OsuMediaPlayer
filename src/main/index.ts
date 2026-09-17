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
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type {
  LibraryQuery,
  LibrarySummary,
  MediaAction,
  Track,
  TrackContextMenuAction,
  TrackContextMenuInfo,
  VideoEncodingSettings,
} from "../shared/types";
import { LibraryIndex } from "./library";
import { directorySize } from "./cache";
import { clearLibraryCache } from "./library-cache";
import { loadLibraryInWorker, waitForLibraryWorkers } from "./library-loader";
import {
  mimeForFilename,
  resolveMediaFile,
  serveMedia,
  type ResolvedMediaFile,
} from "./media";
import { VideoTranscoder } from "./video";

const isWaylandSession =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));

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
    scheme: "osu-media",
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
let library: LibraryIndex | null = null;
let pendingLoad: Promise<LibraryIndex> | null = null;
let pendingIndexCacheClear: Promise<void> | null = null;
let pendingPath: string | undefined;
let importController: AbortController | null = null;
let videoTranscoder: VideoTranscoder | null = null;
let zoomStatusMenuItem: Electron.MenuItem | null = null;
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const zoomStages = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
] as const;

function replaceLibrary(next: LibraryIndex): void {
  if (library && library !== next && !library.sharesRealm(next))
    library.close();
  library = next;
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

function cancelledLibrarySummary(installPath?: string): LibrarySummary {
  return {
    trackCount: 0,
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
    title: "osu! music",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
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

type TrackAssetKind = "audio" | "background" | "video";

const trackContextMenuActions = new Set<TrackContextMenuAction>([
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

function isTrackContextMenuAction(
  value: unknown,
): value is TrackContextMenuAction {
  return (
    typeof value === "string" &&
    trackContextMenuActions.has(value as TrackContextMenuAction)
  );
}

function assetHashForTrack(
  track: Track,
  kind: TrackAssetKind,
): string | undefined {
  if (kind === "audio") return track.audioHash;
  if (kind === "background") return track.backgroundHash;
  return track.videoHash;
}

async function resolveTrackAsset(
  index: LibraryIndex,
  track: Track,
  kind: TrackAssetKind,
): Promise<ResolvedMediaFile | null> {
  const hash = assetHashForTrack(track, kind);
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
  if (!asset) return;
  void shell.openPath(asset.filename).catch(() => {
    /* The default application may be unavailable while closing. */
  });
}

async function getTrackContextMenuInfo(
  index: LibraryIndex,
  track: Track,
): Promise<TrackContextMenuInfo> {
  const [audio, background, video] = await Promise.all([
    resolveTrackAsset(index, track, "audio"),
    resolveTrackAsset(index, track, "background"),
    resolveTrackAsset(index, track, "video"),
  ]);
  return {
    audio: Boolean(audio),
    background: Boolean(background),
    video: Boolean(video),
    listing: track.onlineId !== undefined,
  };
}

function copyTextForAction(
  track: Track,
  action: TrackContextMenuAction,
): string | undefined {
  switch (action) {
    case "copy-title":
      return track.title;
    case "copy-title-unicode":
      return track.titleUnicode;
    case "copy-artist":
      return track.artist;
    case "copy-artist-unicode":
      return track.artistUnicode;
    case "copy-online-id":
      return track.onlineId === undefined ? undefined : String(track.onlineId);
    case "copy-md5":
      return track.md5Hash;
    default:
      return undefined;
  }
}

function assetKindForAction(
  action: TrackContextMenuAction,
): TrackAssetKind | undefined {
  if (action.includes("audio")) return "audio";
  if (action.includes("background")) return "background";
  if (action.includes("video")) return "video";
  return undefined;
}

function setupIPC(): void {
  ipcMain.on("window:ready", (event) => {
    if (!isTrusted(event)) return;
    rendererReady = true;
    if (windowReadyToShow) window?.show();
  });
  ipcMain.handle(
    "library:load-cached",
    async (event, requestedPath: unknown) => {
      requireTrusted(event);
      if (quitting || pendingLoad) return null;
      if (
        requestedPath !== undefined &&
        (typeof requestedPath !== "string" || !isAbsolute(requestedPath))
      )
        return null;
      const installPath = requestedPath as string | undefined;
      try {
        const loaded = await loadLibraryInWorker(
          installPath,
          undefined,
          undefined,
          (index) => {
            library = index;
          },
          join(app.getPath("userData"), "library-cache"),
          undefined,
          true,
        );
        replaceLibrary(loaded);
        return loaded.summary;
      } catch {
        // A miss is expected here. The renderer will begin the normal streamed
        // import after it has painted its loading UI.
        return null;
      }
    },
  );
  ipcMain.handle(
    "library:load",
    async (event, requestedPath: unknown, priorityTrackId: unknown) => {
      requireTrusted(event);
      if (quitting) throw new Error("The player is closing.");
      if (pendingIndexCacheClear) await pendingIndexCacheClear;
      if (
        requestedPath !== undefined &&
        (typeof requestedPath !== "string" || !isAbsolute(requestedPath))
      )
        throw new Error("Choose an absolute osu!lazer directory path.");
      const installPath = requestedPath as string | undefined;
      if (
        priorityTrackId !== undefined &&
        (typeof priorityTrackId !== "string" || priorityTrackId.length > 256)
      )
        throw new Error("Invalid saved track ID.");
      if (pendingLoad) {
        if (pendingPath === installPath) {
          try {
            return (await pendingLoad).summary;
          } catch (error) {
            // A duplicate request shares the original import promise. Handle its
            // expected shutdown cancellation the same way as the original call.
            if (quitting && isAbortError(error))
              return library?.summary ?? cancelledLibrarySummary(installPath);
            throw error;
          }
        }
        throw new Error(
          "A library import is already running. Wait for it to finish, then choose another folder.",
        );
      }
      importController = new AbortController();
      pendingPath = installPath;
      const previousLibrary = library;
      pendingLoad = loadLibraryInWorker(
        installPath,
        (progress) => {
          if (window && !window.isDestroyed())
            window.webContents.send("library:progress", progress);
        },
        importController!.signal,
        (index) => {
          // Keep the previous library available for rollback if streaming fails.
          // If loading is cancelled, the callback can then restore it.
          library = index;
          if (window && !window.isDestroyed())
            window.webContents.send("library:progress", {
              phase: "reading",
              records: index.summary.beatmapCount,
              summary: index.summary,
            });
        },
        join(app.getPath("userData"), "library-cache"),
        priorityTrackId as string | undefined,
      );
      try {
        const loaded = await pendingLoad;
        if (
          previousLibrary &&
          previousLibrary !== loaded &&
          !previousLibrary.sharesRealm(loaded)
        )
          previousLibrary.close();
        replaceLibrary(loaded);
        return loaded.summary;
      } catch (error) {
        // Restore the previous library if the new import fails or is cancelled.
        if (previousLibrary) library = previousLibrary;
        else library = null;
        // Closing the app intentionally aborts the pending IPC request. Returning
        // a harmless summary prevents Electron from reporting that expected
        // cancellation as an unhandled handler error.
        if (quitting && isAbortError(error))
          return (
            previousLibrary?.summary ?? cancelledLibrarySummary(installPath)
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
      directorySize(join(app.getPath("userData"), "library-cache")),
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
        "Wait for the current library import to finish before clearing the cache.",
      );
    if (pendingIndexCacheClear) return pendingIndexCacheClear;

    const clear = clearLibraryCache(
      join(app.getPath("userData"), "library-cache"),
    );
    pendingIndexCacheClear = clear;
    try {
      await clear;
    } finally {
      if (pendingIndexCacheClear === clear) pendingIndexCacheClear = null;
    }
  });
  ipcMain.handle("library:query", (event, input: unknown) => {
    requireTrusted(event);
    if (!library) throw new Error("The library has not been loaded yet.");
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid library query.");
    return library.query(input as LibraryQuery);
  });
  ipcMain.handle("library:track", (event, id: unknown) => {
    requireTrusted(event);
    return typeof id === "string" ? (library?.getTrack(id) ?? null) : null;
  });
  ipcMain.handle(
    "library:track-location",
    (event, id: unknown, input: unknown) => {
      requireTrusted(event);
      if (typeof id !== "string" || !library) return null;
      if (
        input !== undefined &&
        (!input || typeof input !== "object" || Array.isArray(input))
      )
        throw new Error("Invalid library query.");
      return library.getTrackLocation(id, input as LibraryQuery | undefined);
    },
  );
  ipcMain.handle(
    "video:prepare",
    async (event, trackId: unknown, settings: unknown) => {
      requireTrusted(event);
      if (typeof trackId !== "string") throw new Error("Invalid track ID.");
      if (
        settings !== undefined &&
        (!settings || typeof settings !== "object" || Array.isArray(settings))
      )
        throw new Error("Invalid video encoding settings.");
      return (
        (await videoTranscoder?.prepare(
          library,
          trackId,
          settings as VideoEncodingSettings | undefined,
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
  ipcMain.handle("library:choose", async (event) => {
    requireTrusted(event);
    const result = await dialog.showOpenDialog(window!, {
      title: "Choose your osu!lazer directory",
      message: "Choose the directory containing client.realm and files.",
      properties: ["openDirectory"],
      defaultPath: library?.summary.installPath,
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("track:context-info", async (event, id: unknown) => {
    requireTrusted(event);
    if (typeof id !== "string" || !library) return null;
    const track = library.getTrack(id);
    return track ? getTrackContextMenuInfo(library, track) : null;
  });
  ipcMain.handle(
    "track:context-action",
    async (event, id: unknown, action: unknown) => {
      requireTrusted(event);
      if (
        typeof id !== "string" ||
        !library ||
        !isTrackContextMenuAction(action)
      )
        return;
      const track = library.getTrack(id);
      if (!track) return;

      if (action === "open-listing") {
        if (track.onlineId === undefined) return;
        await shell.openExternal(
          `https://osu.ppy.sh/beatmapsets/${track.onlineId}`,
        );
        return;
      }

      const kind = assetKindForAction(action);
      if (!kind) {
        const value = copyTextForAction(track, action);
        if (value !== undefined) await clipboard.writeText(value);
        return;
      }

      const asset = await resolveTrackAsset(library, track, kind);
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
  protocol.handle("osu-media", (request) => {
    try {
      if (new URL(request.url).host === "video-cache")
        return videoTranscoder!.serve(request);
    } catch {
      /* The normal media handler will return a bad-request response. */
    }
    return serveMedia(request, library);
  });
  setupIPC();
  createWindow();
  const menu = Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "Playback",
      submenu: [
        { label: "Play / Pause", click: () => sendMediaAction("toggle") },
        { label: "Next track", click: () => sendMediaAction("next") },
        { label: "Previous track", click: () => sendMediaAction("previous") },
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
  void waitForLibraryWorkers().then(() => {
    library?.close();
    library = null;
    quitReady = true;
    app.quit();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
