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
  MediaAction,
  Track,
  TrackContextMenuAction,
  TrackContextMenuInfo,
} from "../shared/types";
import { LibraryIndex, loadLibraryFromRealm } from "./library";
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
let library: LibraryIndex | null = null;
let pendingLoad: Promise<LibraryIndex> | null = null;
let pendingPath: string | undefined;
let importController: AbortController | null = null;
let videoTranscoder: VideoTranscoder | null = null;
let zoomStatusMenuItem: Electron.MenuItem | null = null;
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const zoomStages = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
] as const;

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

function createWindow(): void {
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
  window.once("ready-to-show", () => window?.show());
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
  ipcMain.handle("library:load", async (event, requestedPath: unknown) => {
    requireTrusted(event);
    if (
      requestedPath !== undefined &&
      (typeof requestedPath !== "string" || !isAbsolute(requestedPath))
    )
      throw new Error("Choose an absolute osu!lazer directory path.");
    const installPath = requestedPath as string | undefined;
    if (pendingLoad) {
      if (pendingPath === installPath) return (await pendingLoad).summary;
      throw new Error(
        "A library import is already running. Wait for it to finish, then choose another folder.",
      );
    }
    importController = new AbortController();
    pendingPath = installPath;
    pendingLoad = loadLibraryFromRealm(
      installPath,
      (progress) => {
        if (window && !window.isDestroyed())
          window.webContents.send("library:progress", progress);
      },
      importController!.signal,
      (index) => {
        library = index;
        if (window && !window.isDestroyed())
          window.webContents.send("library:progress", {
            phase: "reading",
            records: index.summary.beatmapCount,
            summary: index.summary,
          });
      },
    );
    try {
      library = await pendingLoad;
      return library.summary;
    } finally {
      pendingLoad = null;
      pendingPath = undefined;
      importController = null;
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
  ipcMain.handle("video:prepare", async (event, trackId: unknown) => {
    requireTrusted(event);
    if (typeof trackId !== "string") throw new Error("Invalid track ID.");
    return (await videoTranscoder?.prepare(library, trackId)) ?? null;
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
app.on("before-quit", () => {
  importController?.abort();
  videoTranscoder?.dispose();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
