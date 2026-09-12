import { contextBridge, ipcRenderer } from "electron";
import type { LibraryProgress, MediaAction, PlayerAPI } from "../shared/types";

const api: PlayerAPI = {
  loadLibrary: (installPath) => ipcRenderer.invoke("library:load", installPath),
  queryLibrary: (query) => ipcRenderer.invoke("library:query", query),
  getTrack: (id) => ipcRenderer.invoke("library:track", id),
  prepareVideo: (trackId) => ipcRenderer.invoke("video:prepare", trackId),
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
  windowControl: (action) => {
    ipcRenderer.send("window:control", action);
  },
  platform: process.platform,
};
contextBridge.exposeInMainWorld("playerAPI", api);
