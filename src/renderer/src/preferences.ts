import type {
  SortKey,
  VideoEncodingCodec,
  VideoEncodingQuality,
  VideoMaxFps,
} from "../../shared/types";

/** Values persisted by the renderer. Keep this map in sync with the UI defaults. */
export interface Preferences {
  lastPlayedTrack: string | null;
  libraryPath: string | undefined;
  favorites: string[];
  sort: SortKey;
  sortDescending: boolean;
  showTitleUnicode: boolean;
  showArtistUnicode: boolean;
  sidebarHidden: boolean;
  libraryPosition: "left" | "right";
  transportLayout: "controls-left" | "controls-centered";
  showNowPlayingTitleArtist: boolean;
  debugMode: boolean;
  artworkTheme: boolean;
  nowPlayingPosition:
    | "top-left"
    | "top-center"
    | "top-right"
    | "right-center"
    | "bottom-right"
    | "bottom-center"
    | "bottom-left"
    | "left-center";
  libraryWidth: number;
  visualizerPanelOpen: boolean;
  sidePanelWidth: number;
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
  lastPlayedTrack: "osu-music-last-played-track",
  libraryPath: "osu-music-library-path",
  favorites: "osu-music-favorites",
  sort: "osu-music-sort",
  sortDescending: "osu-music-sort-descending",
  showTitleUnicode: "osu-music-show-title-unicode",
  showArtistUnicode: "osu-music-show-artist-unicode",
  sidebarHidden: "osu-music-sidebar-hidden",
  libraryPosition: "osu-music-library-position",
  transportLayout: "osu-music-transport-layout",
  showNowPlayingTitleArtist: "osu-music-show-now-playing-title-artist",
  debugMode: "osu-music-debug-mode",
  artworkTheme: "osu-music-artwork-theme",
  nowPlayingPosition: "osu-music-now-playing-position",
  libraryWidth: "osu-music-library-width",
  visualizerPanelOpen: "osu-music-visualizer-panel-open",
  sidePanelWidth: "osu-music-side-panel-width",
  playback: "osu-music-player:settings",
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
const sortKeys = [
  "title",
  "artist",
  "duration",
  "bpm",
  "added",
  "dateAdded",
  "dateSubmitted",
  "dateRanked",
  "lastPlayed",
  "stars",
  "collection",
  "tags",
] as const;

export const preferenceDefaults: Preferences = {
  lastPlayedTrack: null,
  libraryPath: undefined,
  favorites: [],
  sort: "title",
  sortDescending: false,
  showTitleUnicode: false,
  showArtistUnicode: false,
  sidebarHidden: false,
  libraryPosition: "right",
  transportLayout: "controls-centered",
  showNowPlayingTitleArtist: true,
  debugMode: false,
  artworkTheme: true,
  nowPlayingPosition: "top-left",
  libraryWidth: 430,
  visualizerPanelOpen: false,
  sidePanelWidth: 320,
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
    case "lastPlayedTrack":
      return (typeof value === "string" ? value : null) as Preferences[K];
    case "libraryPath":
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
    case "visualizerPanelOpen":
      return parseBoolean(value, fallback as boolean) as Preferences[K];
    case "libraryPosition":
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
    case "libraryWidth":
      return Math.min(
        720,
        Math.max(320, parseNumber(value, fallback as number)),
      ) as Preferences[K];
    case "sidePanelWidth":
      return Math.min(
        520,
        Math.max(280, parseNumber(value, fallback as number)),
      ) as Preferences[K];
    case "playback":
      return parsePlayback(value) as Preferences[K];
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
