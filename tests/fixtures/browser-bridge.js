const fixtureApiUrl = "/__fixture_api";

async function fixtureCall(action, ...args) {
  const response = await fetch(fixtureApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, args }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Fixture request failed.");
  return result.value;
}

const noListener = () => () => {};

window.playerAPI = {
  loadSongList: () => fixtureCall("loadSongList"),
  loadCachedSongList: () => fixtureCall("loadSongList"),
  querySongList: (query = {}) => fixtureCall("querySongList", query),
  getSong: (id) => fixtureCall("getSong", id),
  getSongLocation: (id, query = {}) =>
    fixtureCall("getSongLocation", id, query),
  getSongDebugInfo: async () => null,
  copyText: (value) => navigator.clipboard.writeText(value),
  prepareVideo: (id, settings) => fixtureCall("prepareVideo", id, settings),
  cancelVideoEncoding: () => fixtureCall("cancelVideoEncoding"),
  completeVideoStream: (hash) => fixtureCall("completeVideoStream", hash),
  getCacheUsage: async () => ({ index: 0, video: 0 }),
  clearCache: (kind) => fixtureCall("clearCache", kind),
  chooseSongList: async () => null,
  onSongListProgress: noListener,
  onMediaAction: noListener,
  onVideoEncodingChange: (listener) => {
    const events = new EventSource("/__fixture_events");
    events.onmessage = (event) => listener(JSON.parse(event.data));
    return () => events.close();
  },
  onFullscreenChange: (listener) => {
    const changed = () => listener(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    changed();
    return () => document.removeEventListener("fullscreenchange", changed);
  },
  onZoomChange: (listener) => {
    listener(100);
    return () => {};
  },
  getSongContextMenuInfo: async () => null,
  performSongContextMenuAction: async () => {},
  windowControl: (action) => {
    if (action === "fullscreen") {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    }
  },
  platform: "browser",
};
