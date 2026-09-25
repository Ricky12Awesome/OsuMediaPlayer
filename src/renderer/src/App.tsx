import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type {
  CacheKind,
  CacheUsage,
  SongListQuery,
  SongListSummary,
  PlayerAPI,
  SortKey,
  TagMatchMode,
  Song,
  SongDebugInfo,
  SongContextMenuAction,
} from "../../shared/types";
import { sortKeys } from "../../shared/types";
import { extractArtworkTheme, type ArtworkTheme } from "./artwork-theme";
import {
  cacheLastArtworkTheme,
  clearCachedLastArtworkTheme,
} from "./artwork-theme-cache";
import { type VirtualSongListKeyboardControls } from "./VirtualSongList";
import { usePlayer } from "./usePlayer";
import { SongListPanel, type SongListTab } from "./SongListPanel";
import { NowPlaying, type CaptionPosition } from "./NowPlaying";
import {
  SettingsPanel,
  type SongListPosition,
  type TransportLayout,
} from "./SettingsPanel";
import { Transport } from "./Transport";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { AppOverlays, type SongContextMenuState } from "./AppOverlays";
import { PlayerToolsPanel } from "./PlayerToolsPanel";
import { PanelResizers } from "./PanelResizers";
import { VisualizerSettingsPanel } from "./VisualizerSettingsPanel";
import { mergeFavorites } from "./preference-transfer";
import {
  defaultVisualizerSettings,
  type VisualizerStatus,
} from "./visualizer-settings";
import {
  readPreference,
  removePreference,
  writePreference,
  preferenceDefaults,
  type Preferences,
} from "./preferences";

const defaultPosition = "top-left";
const defaultSongListPosition = "right";
const defaultSidePanelWidth = 416;
const minSidePanelWidth = 416;
const maxSidePanelWidth = 520;
const minSongListWidth = 466;
const cssRem = (pixels: number): string => `${pixels / 16}rem`;
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
const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "added", label: "Last updated" },
  { value: "dateAdded", label: "Date added" },
  { value: "dateSubmitted", label: "Date submitted" },
  { value: "dateRanked", label: "Date ranked" },
  { value: "lastPlayed", label: "Last played" },
  { value: "duration", label: "Length" },
  { value: "bpm", label: "BPM" },
  { value: "stars", label: "Difficulty" },
  { value: "collection", label: "Collection" },
  { value: "tags", label: "Tags" },
];

const showTitleUnicodeKey = "show-title-unicode";
const showArtistUnicodeKey = "show-artist-unicode";
const combinedShowUnicodeKey = "show-unicode";
const legacyShowUnicodeTitleKey = "show-unicode-title";

const defaultApi: PlayerAPI = {
  loadSongList: async () => {
    throw new Error(
      "Open OsuMediaPlayer in the desktop app to connect to your osu!lazer songs. Run npm run dev in the project folder.",
    );
  },
  querySongList: async () => ({ items: [], total: 0, offset: 0 }),
  getSong: async () => null,
  getSongDebugInfo: async () => null,
  prepareVideo: async () => null,
  cancelVideoEncoding: async () => {},
  completeVideoStream: async () => {},
  getCacheUsage: async () => {
    throw new Error("Cache management is only available in the desktop app.");
  },
  clearCache: async () => {
    throw new Error("Cache management is only available in the desktop app.");
  },
  chooseSongList: async () => null,
  onSongListProgress: () => () => {},
  onMediaAction: () => () => {},
  onVideoEncodingChange: () => () => {},
  onFullscreenChange: () => () => {},
  onZoomChange: () => () => {},
  getSongContextMenuInfo: async () => null,
  performSongContextMenuAction: async () => {},
  windowControl: () => {},
  platform: "browser",
};

const api = window.playerAPI ?? defaultApi;

function readLegacyBoolean(key: string): boolean | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    return JSON.parse(raw) === true;
  } catch {
    return undefined;
  }
}

function readStoredBoolean(key: string): boolean | undefined {
  return readLegacyBoolean(key);
}

function readShowTitleUnicodeSetting(): boolean {
  return (
    readStoredBoolean(showTitleUnicodeKey) ??
    readStoredBoolean(combinedShowUnicodeKey) ??
    readStoredBoolean(legacyShowUnicodeTitleKey) ??
    false
  );
}

function readShowArtistUnicodeSetting(): boolean {
  return (
    readStoredBoolean(showArtistUnicodeKey) ??
    readStoredBoolean(combinedShowUnicodeKey) ??
    false
  );
}

function isSortKey(value: unknown): value is SortKey {
  return sortKeys.includes(value as SortKey);
}

function isCaptionPosition(value: unknown): value is CaptionPosition {
  return (
    typeof value === "string" && positions.includes(value as CaptionPosition)
  );
}

function isSongListPosition(value: unknown): value is SongListPosition {
  return value === "left" || value === "right";
}

function cacheName(kind: CacheKind): string {
  return kind === "index" ? "Index cache" : "Video cache";
}

export function App({
  initialSongList = null,
  initialSong = null,
  initialArtworkTheme = null,
}: {
  initialSongList?: SongListSummary | null;
  initialSong?: Song | null;
  initialArtworkTheme?: { url: string; theme: ArtworkTheme } | null;
}) {
  const [showTitleUnicode, setShowTitleUnicode] = useState(
    readShowTitleUnicodeSetting,
  );
  const [showArtistUnicode, setShowArtistUnicode] = useState(
    readShowArtistUnicodeSetting,
  );
  const player = usePlayer(
    api,
    initialSong,
    showTitleUnicode,
    showArtistUnicode,
  );
  const [summary, setSummary] = useState<SongListSummary | null>(
    initialSongList,
  );
  const [importing, setImporting] = useState(!initialSongList);
  const [loadError, setLoadError] = useState("");
  const [clearingCache, setClearingCache] = useState<CacheKind | null>(null);
  const [cacheConfirmation, setCacheConfirmation] = useState<CacheKind | null>(
    null,
  );
  const [cacheNotice, setCacheNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [cacheUsage, setCacheUsage] = useState<CacheUsage | null>(null);
  const [revision, setRevision] = useState(0);
  const [resultTotal, setResultTotal] = useState(0);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth > 760);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<SongListTab>("all");
  const [collection, setCollection] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<TagMatchMode>("all");
  const [sort, setSort] = useState<SortKey>(() => {
    const stored = readPreference("sort");
    return isSortKey(stored) ? stored : "title";
  });
  const [descending, setDescending] = useState(() =>
    readPreference("sortDescending"),
  );
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(readPreference("favorites")),
  );
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(
    () => {
      const stored = readPreference("nowPlayingPosition");
      return isCaptionPosition(stored) ? stored : defaultPosition;
    },
  );
  const [sidebarHidden, setSidebarHidden] = useState(() =>
    readPreference("sidebarHidden"),
  );
  const [songListPosition, setSongListPosition] = useState<SongListPosition>(
    () => {
      const stored = readPreference("songListPosition");
      return isSongListPosition(stored) ? stored : defaultSongListPosition;
    },
  );
  const [transportLayout, setTransportLayout] = useState<TransportLayout>(() =>
    readPreference("transportLayout"),
  );
  const [showNowPlayingTitleArtist, setShowNowPlayingTitleArtist] = useState(
    () => readPreference("showNowPlayingTitleArtist"),
  );
  const [debugMode, setDebugMode] = useState(() => readPreference("debugMode"));
  const [visualizerSettings, setVisualizerSettings] = useState(() =>
    readPreference("visualizer"),
  );
  const [visualizerStatus, setVisualizerStatus] = useState<{
    status: VisualizerStatus;
    detail?: string;
  }>({ status: "loading" });
  const updateVisualizerStatus = useCallback(
    (status: VisualizerStatus, detail?: string) => {
      setVisualizerStatus({ status, detail });
    },
    [],
  );
  const [debugInfo, setDebugInfo] = useState<SongDebugInfo | null>(null);
  useEffect(() => {
    const toggleDebugMode = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key.toLowerCase() !== "i" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement)
      ) {
        return;
      }

      setDebugMode((visible) => !visible);
    };

    window.addEventListener("keydown", toggleDebugMode);
    return () => window.removeEventListener("keydown", toggleDebugMode);
  }, []);
  const [artworkThemeEnabled, setArtworkThemeEnabled] = useState(() =>
    readPreference("artworkTheme"),
  );
  const [backgroundDim, setBackgroundDim] = useState(() =>
    readPreference("backgroundDim"),
  );
  const [backgroundBlur, setBackgroundBlur] = useState(() =>
    Math.max(1, readPreference("backgroundBlur")),
  );
  const [backgroundBlurStyle, setBackgroundBlurStyle] = useState(() =>
    readPreference("backgroundBlur") === 0
      ? "none"
      : readPreference("backgroundBlurStyle"),
  );
  const [backgroundBlurDirection, setBackgroundBlurDirection] = useState(() =>
    readPreference("backgroundBlurDirection"),
  );
  const [artworkTheme, setArtworkTheme] = useState<{
    url: string;
    theme: ArtworkTheme;
  } | null>(initialArtworkTheme);
  const [songListWidth, setSongListWidth] = useState(() => {
    const value = readPreference("songListWidth");
    return Number.isFinite(value)
      ? Math.min(720, Math.max(minSongListWidth, value))
      : minSongListWidth;
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [alwaysShowControls, setAlwaysShowControls] = useState(true);
  const [sidePanelOpen, setSidePanelOpen] = useState(() =>
    readPreference("sidePanelOpen"),
  );
  const [sidePanelWidth, setSidePanelWidth] = useState(() => {
    const value = readPreference("sidePanelWidth");
    return Number.isFinite(value)
      ? Math.min(maxSidePanelWidth, Math.max(minSidePanelWidth, value))
      : defaultSidePanelWidth;
  });
  const [sidePanelResizing, setSidePanelResizing] = useState(false);
  const cacheLimitWheelRemainder = useRef(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsResetConfirmation, setSettingsResetConfirmation] =
    useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomIndicatorVisible, setZoomIndicatorVisible] = useState(false);
  const [captionDragging, setCaptionDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [songContextMenu, setSongContextMenu] =
    useState<SongContextMenuState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cacheCancelButtonRef = useRef<HTMLButtonElement>(null);
  const settingsResetCancelButtonRef = useRef<HTMLButtonElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const songListRef = useRef<HTMLElement>(null);
  const sidePanelRef = useRef<HTMLElement>(null);
  const songListKeyboardRef = useRef<VirtualSongListKeyboardControls | null>(
    null,
  );
  const hideControlsTimer = useRef<number | null>(null);
  const zoomIndicatorTimer = useRef<number | null>(null);
  const zoomInitialized = useRef(false);
  const focusSearchAfterSidebar = useRef(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const sidePanelResizeStart = useRef<{ x: number; width: number } | null>(
    null,
  );
  // A bootstrap song has its media source ready, but its queue location is
  // not known yet. Let the first song list result resolve that location so the
  // transport buttons continue from the restored song rather than index 0.
  const songInitialized = useRef(false);
  const initialSongRestore = useRef(0);
  const drag = useRef<{
    pointerId: number;
    element: HTMLDivElement;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    x: number;
    y: number;
    nextX: number;
    nextY: number;
    frame: number | null;
  } | null>(null);
  const stopCaptionDrag = useRef<(() => void) | null>(null);

  const controlsActivity = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current !== null) {
      window.clearTimeout(hideControlsTimer.current);
      hideControlsTimer.current = null;
    }
    if (alwaysShowControls) return;
    hideControlsTimer.current = window.setTimeout(
      () => setControlsVisible(false),
      1000,
    );
  }, [alwaysShowControls]);

  useEffect(
    () => () => {
      stopCaptionDrag.current?.();
    },
    [],
  );

  const loadSongList = useCallback(
    async (installPath?: string) => {
      initialSongRestore.current += 1;
      songInitialized.current = false;
      player.reset();
      setSummary(null);
      setResultTotal(0);
      setImporting(true);
      setLoadError("");
      try {
        const savedId = readPreference("lastPlayedSong");
        const next = await api.loadSongList(
          installPath,
          typeof savedId === "string" ? savedId : undefined,
        );
        setSummary(next);
        setRevision((value) => value + 1);
        writePreference("songListPath", next.installPath);
      } catch (reason) {
        setLoadError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setImporting(false);
      }
    },
    [player.reset],
  );

  useEffect(() => {
    const removeProgress = api.onSongListProgress((next) => {
      if ("summary" in next && next.summary) {
        setSummary(next.summary);
        setRevision((value) => value + 1);
      }
    });
    if (!initialSongList) void loadSongList(readPreference("songListPath"));
    return removeProgress;
  }, [initialSongList, loadSongList]);

  useEffect(() => {
    const removeFullscreen = api.onFullscreenChange(setFullscreen);
    return removeFullscreen;
  }, []);

  useEffect(() => {
    const removeZoom = api.onZoomChange((percent) => {
      const nextPercent = Math.max(25, Math.min(500, Math.round(percent)));
      setZoomPercent(nextPercent);
      if (!zoomInitialized.current) {
        zoomInitialized.current = true;
        return;
      }
      setZoomIndicatorVisible(true);
      if (zoomIndicatorTimer.current !== null)
        window.clearTimeout(zoomIndicatorTimer.current);
      zoomIndicatorTimer.current = window.setTimeout(() => {
        setZoomIndicatorVisible(false);
        zoomIndicatorTimer.current = null;
      }, 1400);
    });
    return () => {
      removeZoom();
      if (zoomIndicatorTimer.current !== null) {
        window.clearTimeout(zoomIndicatorTimer.current);
        zoomIndicatorTimer.current = null;
      }
    };
  }, []);

  const clampSidePanelWidth = useCallback(
    (value: number): number => {
      const contentWidth = mainRef.current?.clientWidth ?? window.innerWidth;
      const visibleSongListWidth =
        isDesktop && sidebarHidden ? 0 : songListWidth;
      const songListResizerWidth = isDesktop && !sidebarHidden ? 7 : 0;
      const max = Math.max(
        minSidePanelWidth,
        Math.min(
          maxSidePanelWidth,
          contentWidth - 360 - 7 - songListResizerWidth - visibleSongListWidth,
        ),
      );
      return Math.min(max, Math.max(minSidePanelWidth, value));
    },
    [isDesktop, songListWidth, sidebarHidden],
  );

  const clampSongListWidth = useCallback(
    (value: number): number => {
      const contentWidth = mainRef.current?.clientWidth ?? window.innerWidth;
      const visibleSidePanelWidth =
        sidePanelOpen && isDesktop ? sidePanelWidth : 0;
      const sidePanelResizerWidth = sidePanelOpen && isDesktop ? 7 : 0;
      const songListResizerWidth = isDesktop && !sidebarHidden ? 7 : 0;
      const max = Math.max(
        minSongListWidth,
        Math.min(
          720,
          contentWidth -
            360 -
            visibleSidePanelWidth -
            sidePanelResizerWidth -
            songListResizerWidth,
        ),
      );
      return Math.min(max, Math.max(minSongListWidth, value));
    },
    [isDesktop, sidePanelOpen, sidePanelWidth, sidebarHidden],
  );

  useEffect(() => {
    const onResize = () => {
      setIsDesktop(window.innerWidth > 760);
      if (window.innerWidth > 760) {
        setSongListWidth((value) => clampSongListWidth(value));
        setSidePanelWidth((value) => clampSidePanelWidth(value));
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampSongListWidth, clampSidePanelWidth]);

  useEffect(() => {
    if (!resizing) return;
    document.body.classList.add("is-resizing-song-list");
    const onMove = (event: globalThis.PointerEvent) => {
      const start = resizeStart.current;
      if (!start) return;
      const delta =
        songListPosition === "right"
          ? start.x - event.clientX
          : event.clientX - start.x;
      setSongListWidth(clampSongListWidth(start.width + delta));
    };
    const finish = () => {
      resizeStart.current = null;
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    window.addEventListener("blur", finish, { once: true });
    return () => {
      document.body.classList.remove("is-resizing-song-list");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  }, [clampSongListWidth, songListPosition, resizing]);

  useEffect(() => {
    if (!sidePanelResizing) return;
    document.body.classList.add("is-resizing-side-panel");
    const onMove = (event: globalThis.PointerEvent) => {
      const start = sidePanelResizeStart.current;
      if (!start) return;
      const delta =
        songListPosition === "right"
          ? event.clientX - start.x
          : start.x - event.clientX;
      setSidePanelWidth(clampSidePanelWidth(start.width + delta));
    };
    const finish = () => {
      sidePanelResizeStart.current = null;
      setSidePanelResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    window.addEventListener("blur", finish, { once: true });
    return () => {
      document.body.classList.remove("is-resizing-side-panel");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  }, [clampSidePanelWidth, songListPosition, sidePanelResizing]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft), 150);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    writePreference("favorites", [...favorites]);
  }, [favorites]);
  useEffect(
    () => writePreference("songListWidth", songListWidth),
    [songListWidth],
  );
  useEffect(
    () => writePreference("sidebarHidden", sidebarHidden),
    [sidebarHidden],
  );
  useEffect(
    () => writePreference("sidePanelOpen", sidePanelOpen),
    [sidePanelOpen],
  );
  useEffect(
    () => writePreference("sidePanelWidth", sidePanelWidth),
    [sidePanelWidth],
  );
  useEffect(
    () => writePreference("songListPosition", songListPosition),
    [songListPosition],
  );
  useEffect(
    () => writePreference("transportLayout", transportLayout),
    [transportLayout],
  );
  useEffect(
    () =>
      writePreference("showNowPlayingTitleArtist", showNowPlayingTitleArtist),
    [showNowPlayingTitleArtist],
  );
  useEffect(() => writePreference("debugMode", debugMode), [debugMode]);
  useEffect(
    () => writePreference("visualizer", visualizerSettings),
    [visualizerSettings],
  );
  useEffect(() => {
    const songId = player.song?.id;
    if (!debugMode || !songId) {
      setDebugInfo(null);
      return;
    }
    let cancelled = false;
    void api
      .getSongDebugInfo(songId, player.videoSource)
      .then((info) => {
        if (!cancelled) setDebugInfo(info);
      })
      .catch(() => {
        if (!cancelled) setDebugInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [debugMode, player.song?.id, player.videoSource]);
  useEffect(
    () => writePreference("showTitleUnicode", showTitleUnicode),
    [showTitleUnicode],
  );
  useEffect(
    () => writePreference("showArtistUnicode", showArtistUnicode),
    [showArtistUnicode],
  );
  useEffect(
    () => writePreference("artworkTheme", artworkThemeEnabled),
    [artworkThemeEnabled],
  );
  useEffect(
    () => writePreference("backgroundDim", backgroundDim),
    [backgroundDim],
  );
  useEffect(
    () => writePreference("backgroundBlur", backgroundBlur),
    [backgroundBlur],
  );
  useEffect(
    () => writePreference("backgroundBlurStyle", backgroundBlurStyle),
    [backgroundBlurStyle],
  );
  useEffect(
    () => writePreference("backgroundBlurDirection", backgroundBlurDirection),
    [backgroundBlurDirection],
  );
  useEffect(
    () => writePreference("nowPlayingPosition", captionPosition),
    [captionPosition],
  );
  useEffect(() => writePreference("sort", sort), [sort]);
  useEffect(() => writePreference("sortDescending", descending), [descending]);

  useEffect(() => {
    if (!player.playing || !player.song) return;
    const themeMatchesSong =
      artworkTheme && artworkTheme.url === player.song.artworkUrl
        ? artworkTheme.theme
        : null;
    if (themeMatchesSong) cacheLastArtworkTheme(themeMatchesSong);
    else clearCachedLastArtworkTheme();
    writePreference("lastPlayedSong", player.song.id);
  }, [artworkTheme, player.playing, player.song]);

  useEffect(() => {
    const artworkUrl = player.song?.artworkUrl;
    if (!artworkThemeEnabled || !artworkUrl) {
      setArtworkTheme(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    const applyTheme = () => {
      if (cancelled) return;
      const theme = extractArtworkTheme(image);
      setArtworkTheme(theme ? { url: artworkUrl, theme } : null);
    };
    image.onload = applyTheme;
    image.onerror = () => {
      if (!cancelled) setArtworkTheme(null);
    };
    image.src = artworkUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [artworkThemeEnabled, player.song?.artworkUrl]);

  const activeArtworkTheme =
    artworkThemeEnabled &&
    artworkTheme &&
    artworkTheme.url === player.song?.artworkUrl
      ? artworkTheme.theme
      : null;

  useEffect(() => {
    const root = document.documentElement;
    const variables = activeArtworkTheme?.variables ?? {};
    const previous = new Map<string, string>();
    const entries = Object.entries(variables);
    for (const [key, value] of entries) {
      previous.set(key, root.style.getPropertyValue(key));
      root.style.setProperty(key, value);
    }
    return () => {
      for (const [key] of entries) {
        const value = previous.get(key);
        if (value) root.style.setProperty(key, value);
        else root.style.removeProperty(key);
      }
    };
  }, [activeArtworkTheme]);

  const focusSearch = useCallback(() => {
    if (isDesktop && sidebarHidden) {
      focusSearchAfterSidebar.current = true;
      setSidebarHidden(false);
      return;
    }
    setSidebarHidden(false);
    searchRef.current?.focus();
  }, [isDesktop, sidebarHidden]);

  useEffect(() => {
    if (!focusSearchAfterSidebar.current || (isDesktop && sidebarHidden))
      return;
    focusSearchAfterSidebar.current = false;
    searchRef.current?.focus();
  }, [isDesktop, sidebarHidden]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (shortcutsOpen && !dialog.open) dialog.showModal();
    else if (!shortcutsOpen && dialog.open) dialog.close();
  }, [shortcutsOpen]);

  useEffect(() => {
    const onActivity = () => controlsActivity();
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("focusin", onActivity);
    controlsActivity();
    return () => {
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("focusin", onActivity);
      if (hideControlsTimer.current !== null) {
        window.clearTimeout(hideControlsTimer.current);
        hideControlsTimer.current = null;
      }
    };
  }, [controlsActivity, fullscreen]);

  useEffect(() => {
    if (alwaysShowControls) setControlsVisible(true);
  }, [alwaysShowControls]);

  useKeyboardShortcuts({
    api,
    player,
    fullscreen,
    sidePanelOpen,
    setSidePanelOpen,
    setSidebarHidden,
    setAlwaysShowControls,
    settingsPanelOpen: sidePanelOpen,
    shortcutsOpen,
    setShortcutsOpen,
    setShowNowPlayingTitleArtist,
    cacheConfirmation,
    settingsResetConfirmation,
    focusSearch,
    songListKeyboardRef,
  });

  const query = useMemo<SongListQuery>(
    () => ({
      search,
      collection: collection || undefined,
      tags: tags.length ? tags : undefined,
      tagMatch: tags.length ? tagMatch : undefined,
      sort,
      descending,
      favoriteIds: tab === "favorites" ? [...favorites] : undefined,
    }),
    [collection, descending, favorites, search, sort, tab, tagMatch, tags],
  );
  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const queryKeyRef = useRef(queryKey);
  if (queryKeyRef.current !== queryKey) {
    if (!player.song) {
      songInitialized.current = false;
      initialSongRestore.current += 1;
    }
    queryKeyRef.current = queryKey;
  }
  const queueMatches = useMemo(
    () => JSON.stringify(player.queueQuery) === JSON.stringify(query),
    [player.queueQuery, query],
  );

  const cueFirstSong = useCallback(
    (song: Song) => {
      if (songInitialized.current) return;
      const savedId = readPreference("lastPlayedSong");
      // Without a saved song, wait until all sorts are stable before choosing
      // the first result. A saved song can be restored as soon as its streamed
      // batch arrives, which makes uncached startup ready much sooner.
      if (typeof savedId !== "string" || !savedId) {
        if (importing) return;
        songInitialized.current = true;
        player.cueSong(song, query, 0);
        return;
      }

      const request = ++initialSongRestore.current;
      const restore = api.getSongLocation
        ? api.getSongLocation(savedId, query)
        : api
            .getSong(savedId)
            .then((savedSong) =>
              savedSong ? { song: savedSong, index: 0 } : null,
            );
      void restore
        .then((location) => {
          if (
            request !== initialSongRestore.current ||
            queryKey !== queryKeyRef.current
          )
            return;
          if (!location) {
            // The saved song may be in a later streamed batch. Keep trying
            // until import completes before treating the saved ID as stale.
            if (importing) return;
            removePreference("lastPlayedSong");
            songInitialized.current = true;
            player.cueSong(song, query, 0);
            return;
          }
          songInitialized.current = true;
          player.cueSong(location.song, query, location.index);
        })
        .catch(() => {
          if (
            request === initialSongRestore.current &&
            queryKey === queryKeyRef.current &&
            !importing
          ) {
            songInitialized.current = true;
            player.cueSong(song, query, 0);
          }
        });
    },
    [api, importing, player.cueSong, query],
  );

  const playSong = useCallback(
    (song: Song, index: number) => {
      initialSongRestore.current += 1;
      songInitialized.current = true;
      writePreference("lastPlayedSong", song.id);
      player.playSong(song, query, index);
    },
    [player.playSong, query],
  );

  const toggleFavorite = useCallback((song: Song) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
  }, []);

  const openSongContextMenu = useCallback(
    (song: Song, x: number, y: number) => {
      setSongContextMenu({
        song,
        x,
        y,
        info: {
          audio: Boolean(song.audioHash),
          background: Boolean(song.backgroundHash),
          video: Boolean(song.videoHash),
          listing: song.onlineId !== undefined,
        },
      });
      void api
        .getSongContextMenuInfo(song.id)
        .then((info) => {
          if (!info) return;
          setSongContextMenu((current) =>
            current?.song.id === song.id ? { ...current, info } : current,
          );
        })
        .catch(() => {
          // The menu can still use the metadata already present in the row.
        });
    },
    [],
  );

  const closeSongContextMenu = useCallback(() => {
    setSongContextMenu(null);
  }, []);

  const performSongContextMenuAction = useCallback(
    (action: SongContextMenuAction) => {
      const current = songContextMenu;
      if (!current) return;
      setSongContextMenu(null);
      void api
        .performSongContextMenuAction(current.song.id, action)
        .catch(() => {
          // Native actions are best-effort; closing the menu keeps the UI responsive.
        });
    },
    [songContextMenu],
  );

  const chooseSongList = useCallback(async () => {
    const path = await api.chooseSongList();
    if (path) {
      setSidePanelOpen(false);
      await loadSongList(path);
    }
  }, [loadSongList]);

  const requestCacheClear = useCallback(
    (kind: CacheKind) => {
      if (clearingCache || (kind === "index" && importing)) return;
      setCacheConfirmation(kind);
      setSidePanelOpen(false);
    },
    [clearingCache, importing],
  );

  const cancelCacheClear = useCallback(() => {
    setCacheConfirmation(null);
    setSidePanelOpen(true);
  }, []);

  const confirmCacheClear = useCallback(async () => {
    const kind = cacheConfirmation;
    if (!kind || clearingCache) return;
    setCacheConfirmation(null);
    setClearingCache(kind);
    setCacheNotice(null);
    try {
      await api.clearCache(kind);
      setCacheNotice({
        kind: "success",
        message: `${cacheName(kind)} deleted.`,
      });
    } catch (reason) {
      setCacheNotice({
        kind: "error",
        message:
          reason instanceof Error
            ? reason.message
            : `Could not delete the ${kind} cache.`,
      });
    } finally {
      setClearingCache(null);
      setSidePanelOpen(true);
      try {
        setCacheUsage(await api.getCacheUsage());
      } catch {
        setCacheUsage(null);
      }
    }
  }, [cacheConfirmation, clearingCache]);

  const requestSettingsReset = useCallback(() => {
    setSettingsResetConfirmation(true);
    setSidePanelOpen(false);
  }, []);

  const cancelSettingsReset = useCallback(() => {
    setSettingsResetConfirmation(false);
    setSidePanelOpen(true);
  }, []);

  const confirmSettingsReset = useCallback(() => {
    player.resetPlaybackSettings();
    setSort("title");
    setDescending(false);
    setCaptionPosition(defaultPosition);
    setSidebarHidden(false);
    setSongListPosition(defaultSongListPosition);
    setTransportLayout("controls-centered");
    setShowTitleUnicode(false);
    setShowArtistUnicode(false);
    setShowNowPlayingTitleArtist(true);
    setDebugMode(false);
    setArtworkThemeEnabled(true);
    setBackgroundDim(0);
    setBackgroundBlur(preferenceDefaults.backgroundBlur);
    setBackgroundBlurStyle(preferenceDefaults.backgroundBlurStyle);
    setBackgroundBlurDirection(preferenceDefaults.backgroundBlurDirection);
    setVisualizerSettings({ ...defaultVisualizerSettings });
    setSongListWidth(minSongListWidth);
    setSidePanelWidth(defaultSidePanelWidth);
    setCacheNotice(null);
    setSettingsResetConfirmation(false);
    setSidePanelOpen(true);
  }, [player.resetPlaybackSettings]);

  useEffect(() => {
    if (!sidePanelOpen) return;
    let cancelled = false;
    void api
      .getCacheUsage()
      .then((usage) => {
        if (!cancelled) setCacheUsage(usage);
      })
      .catch(() => {
        if (!cancelled) setCacheUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sidePanelOpen]);

  useEffect(() => {
    if (!cacheConfirmation) return;
    cacheCancelButtonRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelCacheClear();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cacheConfirmation, cancelCacheClear]);

  useEffect(() => {
    if (!settingsResetConfirmation) return;
    settingsResetCancelButtonRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelSettingsReset();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelSettingsReset, settingsResetConfirmation]);

  const clearFilters = () => {
    setSearchDraft("");
    setSearch("");
    setTags([]);
    setTagMatch("all");
    setCollection("");
    setTab("all");
  };

  const updateCaptionPosition = (event: {
    clientX: number;
    clientY: number;
  }) => {
    const stage = captionRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    );
    const nearest = positions.reduce((best, position) => {
      const points: Record<CaptionPosition, [number, number]> = {
        "top-left": [0, 0],
        "top-center": [0.5, 0],
        "top-right": [1, 0],
        "right-center": [1, 0.5],
        "bottom-right": [1, 1],
        "bottom-center": [0.5, 1],
        "bottom-left": [0, 1],
        "left-center": [0, 0.5],
      };
      const [bestX, bestY] = points[best];
      const [nextX, nextY] = points[position];
      return (nextX - x) ** 2 + (nextY - y) ** 2 <
        (bestX - x) ** 2 + (bestY - y) ** 2
        ? position
        : best;
    });
    setCaptionPosition(nearest);
  };

  const beginCaptionDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    stopCaptionDrag.current?.();
    const target = event.currentTarget.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      offsetX: event.clientX - target.left,
      offsetY: event.clientY - target.top,
      moved: false,
      x: event.clientX,
      y: event.clientY,
      nextX: target.left,
      nextY: target.top,
      frame: null,
    };
    setCaptionDragging(false);
    const move = (next: globalThis.PointerEvent) => {
      const state = drag.current;
      if (!state || next.pointerId !== state.pointerId) return;
      if (
        !state.moved &&
        Math.hypot(next.clientX - state.x, next.clientY - state.y) > 4
      ) {
        state.moved = true;
        state.element.classList.add("is-dragging");
        setCaptionDragging(true);
      }
      if (state.moved) {
        const stage = captionRef.current;
        if (stage) {
          const bounds = stage.getBoundingClientRect();
          state.nextX = next.clientX - bounds.left - state.offsetX;
          state.nextY = next.clientY - bounds.top - state.offsetY;
          if (state.frame === null)
            state.frame = requestAnimationFrame(() => {
              state.frame = null;
              if (drag.current !== state) return;
              state.element.style.setProperty(
                "--caption-drag-x",
                `${state.nextX}px`,
              );
              state.element.style.setProperty(
                "--caption-drag-y",
                `${state.nextY}px`,
              );
            });
        }
      }
    };
    const finish = (
      next?: globalThis.PointerEvent,
      updateDraggingState = true,
    ) => {
      const state = drag.current;
      if (state && next?.pointerId === state.pointerId && state.moved)
        updateCaptionPosition(next);
      if (state?.frame !== null && state?.frame !== undefined)
        cancelAnimationFrame(state.frame);
      state?.element.classList.remove("is-dragging");
      state?.element.style.removeProperty("--caption-drag-x");
      state?.element.style.removeProperty("--caption-drag-y");
      drag.current = null;
      if (updateDraggingState) setCaptionDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      if (stopCaptionDrag.current === cleanup) stopCaptionDrag.current = null;
    };
    const cancel = () => finish();
    const cleanup = () => finish(undefined, false);
    stopCaptionDrag.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  };

  const videoActive = Boolean(
    player.playVideos &&
    player.videoUrl &&
    player.currentTime >= Math.max(0, player.song?.videoOffset ?? 0),
  );
  const hasFilters = Boolean(
    search || tags.length > 0 || collection || tab === "favorites",
  );
  const songListHidden = sidebarHidden && isDesktop;

  const changeSort = (next: SortKey) => {
    setSort(next);
    setDescending(
      next === "added" ||
        next === "dateAdded" ||
        next === "dateSubmitted" ||
        next === "dateRanked" ||
        next === "lastPlayed",
    );
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.key !== "Enter" &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    searchRef.current?.blur();
    if (event.key === "Enter") songListKeyboardRef.current?.playSelected();
    else
      songListKeyboardRef.current?.moveAndPlay(
        event.key === "ArrowUp" ? -1 : 1,
      );
  };

  return (
    <div
      className={
        "app-shell " +
        (activeArtworkTheme ? "dynamic-theme " : "") +
        (player.playing ? "is-playing " : "") +
        (fullscreen ? "is-fullscreen " : "") +
        (alwaysShowControls ? "controls-always-visible " : "") +
        (controlsVisible ? "fullscreen-controls-visible" : "")
      }
      style={activeArtworkTheme?.variables as CSSProperties | undefined}
      onPointerLeave={() =>
        fullscreen && !alwaysShowControls && setControlsVisible(false)
      }
    >
      <div className="workspace">
        <main
          ref={mainRef}
          className={
            "main-content " +
            (resizing ? "is-resizing " : "") +
            (sidePanelResizing ? "is-resizing-side-panel " : "") +
            (sidePanelOpen ? "side-panel-is-open " : "") +
            (songListHidden ? "sidebar-is-hidden " : "") +
            "song-list-position-" +
            songListPosition
          }
          style={
            {
              "--song-list-width": cssRem(songListWidth),
              "--side-panel-width": cssRem(sidePanelOpen ? sidePanelWidth : 0),
            } as CSSProperties
          }
        >
          <NowPlaying
            player={player}
            backgroundDim={backgroundDim}
            backgroundBlur={backgroundBlur}
            backgroundBlurStyle={backgroundBlurStyle}
            backgroundBlurDirection={backgroundBlurDirection}
            visualizerSettings={visualizerSettings}
            onVisualizerStatus={updateVisualizerStatus}
            visualizerThemeKey={activeArtworkTheme}
            showNowPlayingTitleArtist={showNowPlayingTitleArtist}
            debugMode={debugMode}
            debugInfo={debugInfo}
            showTitleUnicode={showTitleUnicode}
            showArtistUnicode={showArtistUnicode}
            captionPosition={captionPosition}
            captionDragging={captionDragging}
            videoActive={videoActive}
            captionRef={captionRef}
            beginCaptionDrag={beginCaptionDrag}
          />

          <PlayerToolsPanel
            panelRef={sidePanelRef}
            open={sidePanelOpen}
            onClose={() => setSidePanelOpen(false)}
            visualizerContent={
              <VisualizerSettingsPanel
                settings={visualizerSettings}
                onChange={setVisualizerSettings}
                status={visualizerStatus.status}
                statusDetail={visualizerStatus.detail}
              />
            }
            settingsContent={
              <SettingsPanel
                summary={summary}
                importing={importing}
                player={player}
                chooseSongList={chooseSongList}
                refreshSongList={async () => {
                  setSidePanelOpen(false);
                  await loadSongList(summary?.installPath);
                }}
                favorites={favorites}
                mergeImportedFavorites={(ids) =>
                  setFavorites((current) => mergeFavorites(current, ids))
                }
                songListPosition={songListPosition}
                setSongListPosition={setSongListPosition}
                transportLayout={transportLayout}
                setTransportLayout={setTransportLayout}
                artworkThemeEnabled={artworkThemeEnabled}
                setArtworkThemeEnabled={setArtworkThemeEnabled}
                backgroundDim={backgroundDim}
                setBackgroundDim={setBackgroundDim}
                backgroundBlur={backgroundBlur}
                setBackgroundBlur={setBackgroundBlur}
                backgroundBlurStyle={backgroundBlurStyle}
                setBackgroundBlurStyle={setBackgroundBlurStyle}
                backgroundBlurDirection={backgroundBlurDirection}
                setBackgroundBlurDirection={setBackgroundBlurDirection}
                showNowPlayingTitleArtist={showNowPlayingTitleArtist}
                setShowNowPlayingTitleArtist={setShowNowPlayingTitleArtist}
                debugMode={debugMode}
                setDebugMode={setDebugMode}
                showTitleUnicode={showTitleUnicode}
                setShowTitleUnicode={setShowTitleUnicode}
                showArtistUnicode={showArtistUnicode}
                setShowArtistUnicode={setShowArtistUnicode}
                clearingCache={clearingCache}
                cacheUsage={cacheUsage}
                cacheNotice={cacheNotice}
                requestCacheClear={requestCacheClear}
                requestSettingsReset={requestSettingsReset}
                cacheLimitWheelRemainder={cacheLimitWheelRemainder}
              />
            }
          />

          <PanelResizers
            songListRef={songListRef}
            sidePanelRef={sidePanelRef}
            resizeStart={resizeStart}
            sidePanelResizeStart={sidePanelResizeStart}
            songListHidden={songListHidden}
            sidePanelOpen={sidePanelOpen}
            isDesktop={isDesktop}
            songListPosition={songListPosition}
            songListWidth={songListWidth}
            minSongListWidth={minSongListWidth}
            sidePanelWidth={sidePanelWidth}
            minSidePanelWidth={minSidePanelWidth}
            maxSidePanelWidth={maxSidePanelWidth}
            setResizing={setResizing}
            setSidePanelResizing={setSidePanelResizing}
            setSongListWidth={setSongListWidth}
            setSidePanelWidth={setSidePanelWidth}
            clampSongListWidth={clampSongListWidth}
            clampSidePanelWidth={clampSidePanelWidth}
            defaultSidePanelWidth={defaultSidePanelWidth}
          />

          <SongListPanel
            api={api}
            songListRef={songListRef}
            songListHidden={songListHidden}
            searchRef={searchRef}
            searchDraft={searchDraft}
            setSearchDraft={setSearchDraft}
            onSearchKeyDown={handleSearchKeyDown}
            importing={importing}
            refreshSongList={async () => {
              await loadSongList(summary?.installPath);
            }}
            summary={summary}
            tab={tab}
            setTab={setTab}
            favorites={favorites}
            tags={tags}
            setTags={setTags}
            tagMatch={tagMatch}
            setTagMatch={setTagMatch}
            collection={collection}
            setCollection={setCollection}
            sort={sort}
            sortOptions={sortOptions}
            onSort={changeSort}
            descending={descending}
            setDescending={setDescending}
            hasFilters={hasFilters}
            search={search}
            clearFilters={clearFilters}
            loadError={loadError}
            chooseSongList={chooseSongList}
            query={query}
            revision={revision}
            currentSongId={player.song?.id}
            followCurrentSongIndex={
              queueMatches ? (player.queueIndex ?? undefined) : undefined
            }
            songListReady={!importing}
            playing={player.playing}
            showTitleUnicode={showTitleUnicode}
            showArtistUnicode={showArtistUnicode}
            onPlay={playSong}
            onFavorite={toggleFavorite}
            onContextMenu={openSongContextMenu}
            onTotal={setResultTotal}
            onFirstSong={cueFirstSong}
            keyboardControlsRef={songListKeyboardRef}
            resultTotal={resultTotal}
          />
        </main>
      </div>

      <Transport
        player={player}
        transportLayout={transportLayout}
        showTitleUnicode={showTitleUnicode}
        showArtistUnicode={showArtistUnicode}
        favorites={favorites}
        onFavorite={toggleFavorite}
        fullscreen={fullscreen}
        sidebarHidden={sidebarHidden}
        songListPosition={songListPosition}
        sidePanelOpen={sidePanelOpen}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onToggleSidePanel={() => {
          if (sidePanelOpen) setSidePanelOpen(false);
          else setSidePanelOpen(true);
        }}
        onToggleSidebar={() => setSidebarHidden((value) => !value)}
        onFullscreen={() => api.windowControl("fullscreen")}
        onControlsActivity={controlsActivity}
      />

      <AppOverlays
        playerError={player.error}
        onClearPlayerError={player.clearError}
        zoomIndicatorVisible={zoomIndicatorVisible}
        zoomPercent={zoomPercent}
        songContextMenu={songContextMenu}
        onSongContextMenuAction={performSongContextMenuAction}
        onCloseSongContextMenu={closeSongContextMenu}
        shortcutsDialogRef={dialogRef}
        shortcutsOpen={shortcutsOpen}
        setShortcutsOpen={setShortcutsOpen}
        cacheConfirmation={cacheConfirmation}
        cancelCacheClear={cancelCacheClear}
        confirmCacheClear={confirmCacheClear}
        cacheCancelButtonRef={cacheCancelButtonRef}
        settingsResetConfirmation={settingsResetConfirmation}
        cancelSettingsReset={cancelSettingsReset}
        confirmSettingsReset={confirmSettingsReset}
        settingsResetCancelButtonRef={settingsResetCancelButtonRef}
      />
    </div>
  );
}
