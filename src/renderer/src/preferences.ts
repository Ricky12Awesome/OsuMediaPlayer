import {
  sortKeys,
  type SortKey,
  type VideoEncodingCodec,
  type VideoEncodingQuality,
  type VideoMaxFps,
} from "../../shared/types";
import {
  defaultVisualizerSettings,
  parseVisualizerSettings,
  type VisualizerSettings,
} from "./visualizer-settings";

/** Values persisted by the renderer. Keep this map in sync with the UI defaults. */
export interface Preferences {
  lastPlayedSong: string | null;
  songListPath: string | undefined;
  favorites: string[];
  sort: SortKey;
  sortDescending: boolean;
  showTitleUnicode: boolean;
  showArtistUnicode: boolean;
  sidebarHidden: boolean;
  songListPosition: "left" | "right";
  transportLayout: "controls-left" | "controls-centered";
  showNowPlayingTitleArtist: boolean;
  debugMode: boolean;
  artworkTheme: boolean;
  backgroundDim: number;
  backgroundBlur: number;
  backgroundBlurStyle: "classic" | "frosted";
  nowPlayingPosition:
    | "top-left"
    | "top-center"
    | "top-right"
    | "right-center"
    | "bottom-right"
    | "bottom-center"
    | "bottom-left"
    | "left-center";
  songListWidth: number;
  sidePanelOpen: boolean;
  sidePanelWidth: number;
  visualizer: VisualizerSettings;
  playback: {
    volume: number;
    muted: boolean;
    shuffle: boolean;
    repeat: "off" | "all" | "one";
    playVideos: boolean;
    videoEncodingCodec: VideoEncodingCodec;
    videoEncodingQuality: VideoEncodingQuality;
    videoMaxFps: VideoMaxFps;
    videoForceRemux: boolean;
    videoCacheLimitGb: number;
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PreferenceKey = keyof Preferences;

const keys: Record<PreferenceKey, string> = {
  lastPlayedSong: "last-played-song",
  songListPath: "song-list-path",
  favorites: "favorites",
  sort: "sort",
  sortDescending: "sort-descending",
  showTitleUnicode: "show-title-unicode",
  showArtistUnicode: "show-artist-unicode",
  sidebarHidden: "sidebar-hidden",
  songListPosition: "song-list-position",
  transportLayout: "transport-layout",
  showNowPlayingTitleArtist: "show-now-playing-title-artist",
  debugMode: "debug-mode",
  artworkTheme: "artwork-theme",
  backgroundDim: "background-dim",
  backgroundBlur: "background-blur",
  backgroundBlurStyle: "background-blur-style",
  nowPlayingPosition: "now-playing-position",
  songListWidth: "song-list-width",
  sidePanelOpen: "side-panel-open",
  sidePanelWidth: "side-panel-width",
  visualizer: "visualizer-settings",
  playback: "playback-settings",
};

const positions = [
  "top-left",
  "top-center",
  "top-right",
  "right-center",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "left-center",
] as const;
export const preferenceDefaults: Preferences = {
  lastPlayedSong: null,
  songListPath: undefined,
  favorites: [],
  sort: "title",
  sortDescending: false,
  showTitleUnicode: false,
  showArtistUnicode: false,
  sidebarHidden: false,
  songListPosition: "right",
  transportLayout: "controls-centered",
  showNowPlayingTitleArtist: true,
  debugMode: false,
  artworkTheme: true,
  backgroundDim: 0,
  backgroundBlur: 0,
  backgroundBlurStyle: "classic",
  nowPlayingPosition: "top-left",
  songListWidth: 466,
  sidePanelOpen: false,
  sidePanelWidth: 416,
  visualizer: defaultVisualizerSettings,
  playback: {
    volume: 0.75,
    muted: false,
    shuffle: false,
    repeat: "off",
    playVideos: true,
    videoEncodingCodec: "auto",
    videoEncodingQuality: "medium",
    videoMaxFps: 60,
    videoForceRemux: false,
    videoCacheLimitGb: 5,
  },
};

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function parseString(
  value: unknown,
  fallback: string | undefined,
): string | undefined {
  return typeof value === "string" ? value : fallback;
}
function parseNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function parseValue<K extends PreferenceKey>(
  key: K,
  value: unknown,
): Preferences[K] {
  const fallback = preferenceDefaults[key];
  switch (key) {
    case "lastPlayedSong":
      return (typeof value === "string" ? value : null) as Preferences[K];
    case "songListPath":
      return parseString(
        value,
        fallback as string | undefined,
      ) as Preferences[K];
    case "favorites":
      return (
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : fallback
      ) as Preferences[K];
    case "sort":
      return (
        sortKeys.includes(value as SortKey) ? value : fallback
      ) as Preferences[K];
    case "sortDescending":
    case "showTitleUnicode":
    case "showArtistUnicode":
    case "sidebarHidden":
    case "showNowPlayingTitleArtist":
    case "debugMode":
    case "artworkTheme":
    case "sidePanelOpen":
      return parseBoolean(value, fallback as boolean) as Preferences[K];
    case "songListPosition":
      return (
        value === "left" || value === "right" ? value : fallback
      ) as Preferences[K];
    case "transportLayout":
      return (
        value === "controls-left" || value === "controls-centered"
          ? value
          : fallback
      ) as Preferences[K];
    case "nowPlayingPosition":
      return (
        positions.includes(value as (typeof positions)[number])
          ? value
          : fallback
      ) as Preferences[K];
    case "songListWidth":
      return Math.min(
        720,
        Math.max(466, parseNumber(value, fallback as number)),
      ) as Preferences[K];
    case "backgroundDim":
      return Math.min(
        100,
        Math.max(0, parseNumber(value, fallback as number)),
      ) as Preferences[K];
    case "backgroundBlur":
      return Math.min(
        24,
        Math.max(0, parseNumber(value, fallback as number)),
      ) as Preferences[K];
    case "backgroundBlurStyle":
      return (
        value === "classic" || value === "frosted" ? value : fallback
      ) as Preferences[K];
    case "sidePanelWidth":
      return Math.min(
        520,
        Math.max(416, parseNumber(value, fallback as number)),
      ) as Preferences[K];
    case "playback":
      return parsePlayback(value) as Preferences[K];
    case "visualizer":
      return parseVisualizerSettings(value) as Preferences[K];
  }
}

function parsePlayback(value: unknown): Preferences["playback"] {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const defaults = preferenceDefaults.playback;
  const codec = record.videoEncodingCodec;
  const quality = record.videoEncodingQuality;
  const fps = record.videoMaxFps;
  const repeat = record.repeat;
  return {
    volume: Math.max(
      0,
      Math.min(1, parseNumber(record.volume, defaults.volume)),
    ),
    muted: parseBoolean(record.muted, defaults.muted),
    shuffle: parseBoolean(record.shuffle, defaults.shuffle),
    repeat:
      repeat === "off" || repeat === "all" || repeat === "one"
        ? repeat
        : defaults.repeat,
    playVideos: parseBoolean(record.playVideos, defaults.playVideos),
    videoEncodingCodec:
      codec === "auto" ||
      codec === "av1" ||
      codec === "hevc" ||
      codec === "h264-hardware" ||
      codec === "h264-software"
        ? codec
        : defaults.videoEncodingCodec,
    videoEncodingQuality:
      quality === "very-low" ||
      quality === "low" ||
      quality === "medium" ||
      quality === "high" ||
      quality === "very-high"
        ? quality
        : defaults.videoEncodingQuality,
    videoMaxFps:
      fps === 0 || fps === 24 || fps === 30 || fps === 60
        ? fps
        : defaults.videoMaxFps,
    videoForceRemux: parseBoolean(
      record.videoForceRemux,
      defaults.videoForceRemux,
    ),
    videoCacheLimitGb: Math.max(
      -1,
      parseNumber(record.videoCacheLimitGb, defaults.videoCacheLimitGb),
    ),
  };
}

export function readPreference<K extends PreferenceKey>(
  key: K,
  fallback = preferenceDefaults[key],
): Preferences[K] {
  const store = storage();
  if (!store) return fallback as Preferences[K];
  try {
    const raw = store.getItem(keys[key]);
    if (raw === null) return fallback as Preferences[K];
    return parseValue(key, JSON.parse(raw));
  } catch {
    return fallback as Preferences[K];
  }
}

export function writePreference<K extends PreferenceKey>(
  key: K,
  value: Preferences[K],
): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(keys[key], JSON.stringify(value));
  } catch {
    // Preferences are optional and storage may be unavailable or full.
  }
}

export function removePreference(key: PreferenceKey): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(keys[key]);
  } catch {
    // Preferences are optional.
  }
}

/** A typed facade useful for panels and tests that need an injectable store. */
export function createPreferencesStore(
  store: StorageLike = storage() ?? memoryStorage(),
): {
  get<K extends PreferenceKey>(key: K): Preferences[K];
  set<K extends PreferenceKey>(key: K, value: Preferences[K]): void;
  remove(key: PreferenceKey): void;
} {
  return {
    get: <K extends PreferenceKey>(key: K) => {
      try {
        const raw = store.getItem(keys[key]);
        return raw === null
          ? (preferenceDefaults[key] as Preferences[K])
          : parseValue(key, JSON.parse(raw));
      } catch {
        return preferenceDefaults[key] as Preferences[K];
      }
    },
    set: <K extends PreferenceKey>(key: K, value: Preferences[K]) => {
      try {
        store.setItem(keys[key], JSON.stringify(value));
      } catch {
        /* optional */
      }
    },
    remove: (key: PreferenceKey) => {
      try {
        store.removeItem(keys[key]);
      } catch {
        /* optional */
      }
    },
  };
}

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
