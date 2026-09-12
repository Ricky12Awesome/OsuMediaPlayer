import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
} from "electron";
import { isAbsolute, join } from "node:path";
import type { LibraryQuery, MediaAction } from "../shared/types";
import { LibraryIndex, loadLibraryFromOfu } from "./library";
import { ensureOfu } from "./ofu";
import { serveMedia } from "./media";
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
const rendererUrl = process.env.ELECTRON_RENDERER_URL;

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
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  if (rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(join(__dirname, "../dist/index.html"));
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
    pendingLoad = ensureOfu(join(app.getPath("userData"), "ofu"), {
      bundledDirectory: app.isPackaged
        ? join(process.resourcesPath, "ofu")
        : undefined,
      signal: importController.signal,
      onDownload: () =>
        window?.webContents.send("library:progress", {
          phase: "downloading",
          records: 0,
        }),
    }).then((executable) =>
      loadLibraryFromOfu(
        executable,
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
      ),
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
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
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
      { role: "viewMenu" },
    ]),
  );
  createWindow();
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
