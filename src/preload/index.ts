import { contextBridge, ipcRenderer } from "electron";
import type {
  LibraryQuery,
  LibraryProgress,
  MediaAction,
  PlayerAPI,
  TrackContextMenuAction,
  VideoEncodingStatus,
} from "../shared/types";

const api: PlayerAPI = {
  loadLibrary: (installPath, priorityTrackId) =>
    ipcRenderer.invoke("library:load", installPath, priorityTrackId),
  loadCachedLibrary: (installPath) =>
    ipcRenderer.invoke("library:load-cached", installPath),
  queryLibrary: (query) => ipcRenderer.invoke("library:query", query),
  getTrack: (id) => ipcRenderer.invoke("library:track", id),
  getTrackLocation: (id, query?: LibraryQuery) =>
    ipcRenderer.invoke("library:track-location", id, query),
  prepareVideo: (trackId, settings) =>
    ipcRenderer.invoke("video:prepare", trackId, settings),
  cancelVideoEncoding: () => ipcRenderer.invoke("video:cancel"),
  completeVideoStream: (hash) =>
    ipcRenderer.invoke("video:stream-complete", hash),
  getCacheUsage: () => ipcRenderer.invoke("cache:usage"),
  clearCache: (kind) => ipcRenderer.invoke("cache:clear", kind),
  chooseLibrary: () => ipcRenderer.invoke("library:choose"),
  onLibraryProgress: (listener) => {
    const callback = (
      _event: Electron.IpcRendererEvent,
      progress: LibraryProgress,
    ) => listener(progress);
    ipcRenderer.on("library:progress", callback);
    return () => {
      ipcRenderer.removeListener("library:progress", callback);
    };
  },
  onMediaAction: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, action: MediaAction) =>
      listener(action);
    ipcRenderer.on("media:action", callback);
    return () => {
      ipcRenderer.removeListener("media:action", callback);
    };
  },
  onVideoEncodingChange: (listener) => {
    let subscribed = true;
    let receivedChange = false;
    const callback = (
      _event: Electron.IpcRendererEvent,
      status: VideoEncodingStatus,
    ) => {
      receivedChange = true;
      listener(status);
    };
    ipcRenderer.on("video:encoding", callback);
    void ipcRenderer
      .invoke("video:encoding-status")
      .then((status: VideoEncodingStatus | null) => {
        if (subscribed && !receivedChange && status) listener(status);
      })
      .catch(() => {
        /* The window may be closing during subscription. */
      });
    return () => {
      subscribed = false;
      ipcRenderer.removeListener("video:encoding", callback);
    };
  },
  onFullscreenChange: (listener) => {
    let subscribed = true;
    let receivedChange = false;
    const callback = (_event: Electron.IpcRendererEvent, active: boolean) => {
      receivedChange = true;
      listener(active);
    };
    ipcRenderer.on("window:fullscreen", callback);
    // Synchronize new subscriptions, including renderer reloads while fullscreen.
    void ipcRenderer
      .invoke("window:fullscreen-state")
      .then((active: boolean) => {
        if (subscribed && !receivedChange) listener(active);
      })
      .catch(() => {
        /* The window may be closing during subscription. */
      });
    return () => {
      subscribed = false;
      ipcRenderer.removeListener("window:fullscreen", callback);
    };
  },
  onZoomChange: (listener) => {
    let subscribed = true;
    let receivedChange = false;
    const callback = (_event: Electron.IpcRendererEvent, percent: number) => {
      if (!Number.isFinite(percent)) return;
      receivedChange = true;
      listener(percent);
    };
    ipcRenderer.on("window:zoom", callback);
    // Synchronize the current value for renderer reloads and startup.
    void ipcRenderer
      .invoke("window:zoom-level")
      .then((percent: number) => {
        if (subscribed && !receivedChange && Number.isFinite(percent))
          listener(percent);
      })
      .catch(() => {
        /* The window may be closing during subscription. */
      });
    return () => {
      subscribed = false;
      ipcRenderer.removeListener("window:zoom", callback);
    };
  },
  getTrackContextMenuInfo: (trackId) =>
    ipcRenderer.invoke("track:context-info", trackId),
  performTrackContextMenuAction: (trackId, action: TrackContextMenuAction) =>
    ipcRenderer.invoke("track:context-action", trackId, action),
  windowControl: (action) => {
    ipcRenderer.send("window:control", action);
  },
  windowReady: () => ipcRenderer.send("window:ready"),
  platform: process.platform,
};
contextBridge.exposeInMainWorld("playerAPI", api);
