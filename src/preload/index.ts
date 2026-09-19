import { contextBridge, ipcRenderer } from "electron";
import type {
  SongListQuery,
  SongListProgress,
  MediaAction,
  PlayerAPI,
  SongContextMenuAction,
  VideoEncodingStatus,
} from "../shared/types";

const api: PlayerAPI = {
  loadSongList: (installPath, prioritySongId) =>
    ipcRenderer.invoke("song-list:load", installPath, prioritySongId),
  loadCachedSongList: (installPath) =>
    ipcRenderer.invoke("song-list:load-cached", installPath),
  querySongList: (query) => ipcRenderer.invoke("song-list:query", query),
  getSong: (id) => ipcRenderer.invoke("song-list:song", id),
  getSongDebugInfo: (id, source) =>
    ipcRenderer.invoke("song-list:song-debug-info", id, source),
  copyText: (value) => ipcRenderer.invoke("clipboard:write-text", value),
  getSongLocation: (id, query?: SongListQuery) =>
    ipcRenderer.invoke("song-list:song-location", id, query),
  prepareVideo: (songId, settings) =>
    ipcRenderer.invoke("video:prepare", songId, settings),
  cancelVideoEncoding: () => ipcRenderer.invoke("video:cancel"),
  completeVideoStream: (hash) =>
    ipcRenderer.invoke("video:stream-complete", hash),
  getCacheUsage: () => ipcRenderer.invoke("cache:usage"),
  clearCache: (kind) => ipcRenderer.invoke("cache:clear", kind),
  chooseSongList: () => ipcRenderer.invoke("song-list:choose"),
  onSongListProgress: (listener) => {
    const callback = (
      _event: Electron.IpcRendererEvent,
      progress: SongListProgress,
    ) => listener(progress);
    ipcRenderer.on("song-list:progress", callback);
    return () => {
      ipcRenderer.removeListener("song-list:progress", callback);
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
  getSongContextMenuInfo: (songId) =>
    ipcRenderer.invoke("song:context-info", songId),
  performSongContextMenuAction: (songId, action: SongContextMenuAction) =>
    ipcRenderer.invoke("song:context-action", songId, action),
  windowControl: (action) => {
    ipcRenderer.send("window:control", action);
  },
  windowReady: () => ipcRenderer.send("window:ready"),
  platform: process.platform,
};
contextBridge.exposeInMainWorld("playerAPI", api);
