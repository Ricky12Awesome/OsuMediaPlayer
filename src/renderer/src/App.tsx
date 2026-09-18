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
import { createPortal } from "react-dom";
import { AudioWaveform, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import type {
  CacheKind,
  CacheUsage,
  LibraryQuery,
  LibrarySummary,
  PlayerAPI,
  SortKey,
  Track,
  TrackContextMenuAction,
  TrackContextMenuInfo,
} from "../../shared/types";
import { TrackContextMenu } from "./TrackContextMenu";
import { extractArtworkTheme, type ArtworkTheme } from "./artwork-theme";
import {
  cacheLastArtworkTheme,
  clearCachedLastArtworkTheme,
} from "./artwork-theme-cache";
import { type VirtualTrackListKeyboardControls } from "./VirtualTrackList";
import { VisualizerControls, useVisualizerSettings } from "./AudioVisualizer";
import { usePlayer } from "./usePlayer";
import { parseVisualizer } from "./visualizer-settings";
import { LibraryPanel, type LibraryTab } from "./LibraryPanel";
import { NowPlaying, type CaptionPosition } from "./NowPlaying";
import {
  SettingsPanel,
  type LibraryPosition,
  type TransportLayout,
} from "./SettingsPanel";
import { Transport } from "./Transport";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import {
  readPreference,
  removePreference,
  writePreference,
  type Preferences,
} from "./preferences";

const defaultPosition = "top-left";
const defaultLibraryPosition = "right";
const defaultSidePanelWidth = 320;
const minSidePanelWidth = 280;
const maxSidePanelWidth = 520;
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
type SidePanelTab = "visualizer" | "settings";
type TrackContextMenuState = {
  track: Track;
  x: number;
  y: number;
  info: TrackContextMenuInfo;
};

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

const showTitleUnicodeKey = "osu-music-show-title-unicode";
const showArtistUnicodeKey = "osu-music-show-artist-unicode";
const combinedShowUnicodeKey = "osu-music-show-unicode";
const legacyShowUnicodeTitleKey = "osu-music-show-unicode-title";

const defaultApi: PlayerAPI = {
  loadLibrary: async () => {
    throw new Error(
      "Open osu! music in the desktop app to connect to your osu!lazer songs. Run npm run dev in the project folder.",
    );
  },
  queryLibrary: async () => ({ items: [], total: 0, offset: 0 }),
  getTrack: async () => null,
  prepareVideo: async () => null,
  cancelVideoEncoding: async () => {},
  completeVideoStream: async () => {},
  getCacheUsage: async () => {
    throw new Error("Cache management is only available in the desktop app.");
  },
  clearCache: async () => {
    throw new Error("Cache management is only available in the desktop app.");
  },
  chooseLibrary: async () => null,
  onLibraryProgress: () => () => {},
  onMediaAction: () => () => {},
  onVideoEncodingChange: () => () => {},
  onFullscreenChange: () => () => {},
  onZoomChange: () => () => {},
  getTrackContextMenuInfo: async () => null,
  performTrackContextMenuAction: async () => {},
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
  return sortOptions.some((option) => option.value === value);
}

function isCaptionPosition(value: unknown): value is CaptionPosition {
  return (
    typeof value === "string" && positions.includes(value as CaptionPosition)
  );
}

function isLibraryPosition(value: unknown): value is LibraryPosition {
  return value === "left" || value === "right";
}

function cacheName(kind: CacheKind): string {
  return kind === "index" ? "Index cache" : "Video cache";
}

export function App({
  initialLibrary = null,
  initialTrack = null,
  initialArtworkTheme = null,
}: {
  initialLibrary?: LibrarySummary | null;
  initialTrack?: Track | null;
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
    initialTrack,
    showTitleUnicode,
    showArtistUnicode,
  );
  const [visualizer, setVisualizer] = useVisualizerSettings();
  const [summary, setSummary] = useState<LibrarySummary | null>(initialLibrary);
  const [importing, setImporting] = useState(!initialLibrary);
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
  const [tab, setTab] = useState<LibraryTab>("all");
  const [collection, setCollection] = useState("");
  const [tags, setTags] = useState<string[]>([]);
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
  const [libraryPosition, setLibraryPosition] = useState<LibraryPosition>(
    () => {
      const stored = readPreference("libraryPosition");
      return isLibraryPosition(stored) ? stored : defaultLibraryPosition;
    },
  );
  const [transportLayout, setTransportLayout] = useState<TransportLayout>(() =>
    readPreference("transportLayout"),
  );
  const [showNowPlayingTitleArtist, setShowNowPlayingTitleArtist] = useState(
    () => readPreference("showNowPlayingTitleArtist"),
  );
  const [artworkThemeEnabled, setArtworkThemeEnabled] = useState(() =>
    readPreference("artworkTheme"),
  );
  const [artworkTheme, setArtworkTheme] = useState<{
    url: string;
    theme: ArtworkTheme;
  } | null>(initialArtworkTheme);
  const [libraryWidth, setLibraryWidth] = useState(() => {
    const value = readPreference("libraryWidth");
    return Number.isFinite(value) ? Math.min(720, Math.max(320, value)) : 430;
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sidePanelOpen, setSidePanelOpen] = useState(() =>
    readPreference("visualizerPanelOpen"),
  );
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>("settings");
  const [sidePanelWidth, setSidePanelWidth] = useState(() => {
    const value = readPreference("sidePanelWidth");
    return Number.isFinite(value)
      ? Math.min(maxSidePanelWidth, Math.max(minSidePanelWidth, value))
      : defaultSidePanelWidth;
  });
  const [sidePanelResizing, setSidePanelResizing] = useState(false);
  const cacheLimitWheelRemainder = useRef(0);
  const settingsPanelOpen = sidePanelOpen && sidePanelTab === "settings";
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsResetConfirmation, setSettingsResetConfirmation] =
    useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomIndicatorVisible, setZoomIndicatorVisible] = useState(false);
  const [captionDragging, setCaptionDragging] = useState(false);
  const [captionDragPosition, setCaptionDragPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [trackContextMenu, setTrackContextMenu] =
    useState<TrackContextMenuState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cacheCancelButtonRef = useRef<HTMLButtonElement>(null);
  const settingsResetCancelButtonRef = useRef<HTMLButtonElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const sidePanelRef = useRef<HTMLElement>(null);
  const trackListKeyboardRef = useRef<VirtualTrackListKeyboardControls | null>(
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
  // A bootstrap track has its media source ready, but its queue location is
  // not known yet. Let the first library result resolve that location so the
  // transport buttons continue from the restored track rather than index 0.
  const trackInitialized = useRef(false);
  const initialTrackRestore = useRef(0);
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    x: number;
    y: number;
  } | null>(null);

  const loadLibrary = useCallback(
    async (installPath?: string) => {
      initialTrackRestore.current += 1;
      trackInitialized.current = false;
      player.reset();
      setSummary(null);
      setResultTotal(0);
      setImporting(true);
      setLoadError("");
      try {
        const savedId = readPreference("lastPlayedTrack");
        const next = await api.loadLibrary(
          installPath,
          typeof savedId === "string" ? savedId : undefined,
        );
        setSummary(next);
        setRevision((value) => value + 1);
        writePreference("libraryPath", next.installPath);
      } catch (reason) {
        setLoadError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setImporting(false);
      }
    },
    [player.reset],
  );

  useEffect(() => {
    const removeProgress = api.onLibraryProgress((next) => {
      if ("summary" in next && next.summary) {
        setSummary(next.summary);
        setRevision((value) => value + 1);
      }
    });
    if (!initialLibrary) void loadLibrary(readPreference("libraryPath"));
    return removeProgress;
  }, [initialLibrary, loadLibrary]);

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
      const visibleLibraryWidth = isDesktop && sidebarHidden ? 0 : libraryWidth;
      const libraryResizerWidth = isDesktop && !sidebarHidden ? 7 : 0;
      const max = Math.max(
        minSidePanelWidth,
        Math.min(
          maxSidePanelWidth,
          contentWidth - 360 - 7 - libraryResizerWidth - visibleLibraryWidth,
        ),
      );
      return Math.min(max, Math.max(minSidePanelWidth, value));
    },
    [isDesktop, libraryWidth, sidebarHidden],
  );

  const clampLibraryWidth = useCallback(
    (value: number): number => {
      const contentWidth = mainRef.current?.clientWidth ?? window.innerWidth;
      const visibleSidePanelWidth =
        sidePanelOpen && isDesktop ? sidePanelWidth : 0;
      const sidePanelResizerWidth = sidePanelOpen && isDesktop ? 7 : 0;
      const libraryResizerWidth = isDesktop && !sidebarHidden ? 7 : 0;
      const max = Math.max(
        320,
        Math.min(
          720,
          contentWidth -
            360 -
            visibleSidePanelWidth -
            sidePanelResizerWidth -
            libraryResizerWidth,
        ),
      );
      return Math.min(max, Math.max(320, value));
    },
    [isDesktop, sidePanelOpen, sidePanelWidth, sidebarHidden],
  );

  useEffect(() => {
    const onResize = () => {
      setIsDesktop(window.innerWidth > 760);
      if (window.innerWidth > 760) {
        setLibraryWidth((value) => clampLibraryWidth(value));
        setSidePanelWidth((value) => clampSidePanelWidth(value));
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampLibraryWidth, clampSidePanelWidth]);

  useEffect(() => {
    if (!resizing) return;
    document.body.classList.add("is-resizing-library");
    const onMove = (event: globalThis.PointerEvent) => {
      const start = resizeStart.current;
      if (!start) return;
      const delta =
        libraryPosition === "right"
          ? start.x - event.clientX
          : event.clientX - start.x;
      setLibraryWidth(clampLibraryWidth(start.width + delta));
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
      document.body.classList.remove("is-resizing-library");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  }, [clampLibraryWidth, libraryPosition, resizing]);

  useEffect(() => {
    if (!sidePanelResizing) return;
    document.body.classList.add("is-resizing-side-panel");
    const onMove = (event: globalThis.PointerEvent) => {
      const start = sidePanelResizeStart.current;
      if (!start) return;
      const delta =
        libraryPosition === "right"
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
  }, [clampSidePanelWidth, libraryPosition, sidePanelResizing]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft), 150);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    writePreference("favorites", [...favorites]);
  }, [favorites]);
  useEffect(
    () => writePreference("libraryWidth", libraryWidth),
    [libraryWidth],
  );
  useEffect(
    () => writePreference("sidebarHidden", sidebarHidden),
    [sidebarHidden],
  );
  useEffect(
    () => writePreference("visualizerPanelOpen", sidePanelOpen),
    [sidePanelOpen],
  );
  useEffect(
    () => writePreference("sidePanelWidth", sidePanelWidth),
    [sidePanelWidth],
  );
  useEffect(
    () => writePreference("libraryPosition", libraryPosition),
    [libraryPosition],
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
    () => writePreference("nowPlayingPosition", captionPosition),
    [captionPosition],
  );
  useEffect(() => writePreference("sort", sort), [sort]);
  useEffect(() => writePreference("sortDescending", descending), [descending]);

  useEffect(() => {
    if (!player.playing || !player.track) return;
    const themeMatchesTrack =
      artworkTheme && artworkTheme.url === player.track.artworkUrl
        ? artworkTheme.theme
        : null;
    if (themeMatchesTrack) cacheLastArtworkTheme(themeMatchesTrack);
    else clearCachedLastArtworkTheme();
    writePreference("lastPlayedTrack", player.track.id);
  }, [artworkTheme, player.playing, player.track]);

  useEffect(() => {
    const artworkUrl = player.track?.artworkUrl;
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
  }, [artworkThemeEnabled, player.track?.artworkUrl]);

  const activeArtworkTheme =
    artworkThemeEnabled &&
    artworkTheme &&
    artworkTheme.url === player.track?.artworkUrl
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
    if (!fullscreen) {
      setControlsVisible(true);
      return;
    }
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
  }, [fullscreen]);

  useKeyboardShortcuts({
    api,
    player,
    fullscreen,
    sidePanelOpen,
    setSidePanelOpen,
    setSidebarHidden,
    settingsPanelOpen,
    shortcutsOpen,
    setShortcutsOpen,
    setShowNowPlayingTitleArtist,
    cacheConfirmation,
    settingsResetConfirmation,
    focusSearch,
    trackListKeyboardRef,
  });

  const query = useMemo<LibraryQuery>(
    () => ({
      search,
      collection: collection || undefined,
      tags: tags.length ? tags : undefined,
      sort,
      descending,
      favoriteIds: tab === "favorites" ? [...favorites] : undefined,
    }),
    [collection, descending, favorites, search, sort, tab, tags],
  );
  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const queryKeyRef = useRef(queryKey);
  if (queryKeyRef.current !== queryKey) {
    if (!player.track) {
      trackInitialized.current = false;
      initialTrackRestore.current += 1;
    }
    queryKeyRef.current = queryKey;
  }
  const queueMatches = useMemo(
    () => JSON.stringify(player.queueQuery) === JSON.stringify(query),
    [player.queueQuery, query],
  );

  const cueFirstTrack = useCallback(
    (track: Track) => {
      if (trackInitialized.current) return;
      const savedId = readPreference("lastPlayedTrack");
      // Without a saved song, wait until all sorts are stable before choosing
      // the first result. A saved song can be restored as soon as its streamed
      // batch arrives, which makes uncached startup ready much sooner.
      if (typeof savedId !== "string" || !savedId) {
        if (importing) return;
        trackInitialized.current = true;
        player.cueTrack(track, query, 0);
        return;
      }

      const request = ++initialTrackRestore.current;
      const restore = api.getTrackLocation
        ? api.getTrackLocation(savedId, query)
        : api
            .getTrack(savedId)
            .then((savedTrack) =>
              savedTrack ? { track: savedTrack, index: 0 } : null,
            );
      void restore
        .then((location) => {
          if (
            request !== initialTrackRestore.current ||
            queryKey !== queryKeyRef.current
          )
            return;
          if (!location) {
            // The saved song may be in a later streamed batch. Keep trying
            // until import completes before treating the saved ID as stale.
            if (importing) return;
            removePreference("lastPlayedTrack");
            trackInitialized.current = true;
            player.cueTrack(track, query, 0);
            return;
          }
          trackInitialized.current = true;
          player.cueTrack(location.track, query, location.index);
        })
        .catch(() => {
          if (
            request === initialTrackRestore.current &&
            queryKey === queryKeyRef.current &&
            !importing
          ) {
            trackInitialized.current = true;
            player.cueTrack(track, query, 0);
          }
        });
    },
    [api, importing, player.cueTrack, query],
  );

  const playTrack = useCallback(
    (track: Track, index: number) => {
      initialTrackRestore.current += 1;
      trackInitialized.current = true;
      writePreference("lastPlayedTrack", track.id);
      player.playTrack(track, query, index);
    },
    [player.playTrack, query],
  );

  const toggleFavorite = useCallback((track: Track) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(track.id)) next.delete(track.id);
      else next.add(track.id);
      return next;
    });
  }, []);

  const openTrackContextMenu = useCallback(
    (track: Track, x: number, y: number) => {
      setTrackContextMenu({
        track,
        x,
        y,
        info: {
          audio: Boolean(track.audioHash),
          background: Boolean(track.backgroundHash),
          video: Boolean(track.videoHash),
          listing: track.onlineId !== undefined,
        },
      });
      void api
        .getTrackContextMenuInfo(track.id)
        .then((info) => {
          if (!info) return;
          setTrackContextMenu((current) =>
            current?.track.id === track.id ? { ...current, info } : current,
          );
        })
        .catch(() => {
          // The menu can still use the metadata already present in the row.
        });
    },
    [],
  );

  const closeTrackContextMenu = useCallback(() => {
    setTrackContextMenu(null);
  }, []);

  const performTrackContextMenuAction = useCallback(
    (action: TrackContextMenuAction) => {
      const current = trackContextMenu;
      if (!current) return;
      setTrackContextMenu(null);
      void api
        .performTrackContextMenuAction(current.track.id, action)
        .catch(() => {
          // Native actions are best-effort; closing the menu keeps the UI responsive.
        });
    },
    [trackContextMenu],
  );

  const chooseLibrary = useCallback(async () => {
    const path = await api.chooseLibrary();
    if (path) {
      setSidePanelOpen(false);
      await loadLibrary(path);
    }
  }, [loadLibrary]);

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
    setSidePanelTab("settings");
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
      setSidePanelTab("settings");
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
    setSidePanelTab("settings");
    setSidePanelOpen(true);
  }, []);

  const confirmSettingsReset = useCallback(() => {
    player.resetPlaybackSettings();
    setVisualizer(parseVisualizer(null));
    setSort("title");
    setDescending(false);
    setCaptionPosition(defaultPosition);
    setSidebarHidden(false);
    setLibraryPosition(defaultLibraryPosition);
    setTransportLayout("controls-centered");
    setShowTitleUnicode(false);
    setShowArtistUnicode(false);
    setShowNowPlayingTitleArtist(true);
    setArtworkThemeEnabled(true);
    setLibraryWidth(430);
    setSidePanelWidth(defaultSidePanelWidth);
    setCacheNotice(null);
    setSettingsResetConfirmation(false);
    setSidePanelTab("settings");
    setSidePanelOpen(true);
  }, [player.resetPlaybackSettings]);

  useEffect(() => {
    if (!settingsPanelOpen) return;
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
  }, [settingsPanelOpen]);

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
    setCollection("");
    setTab("all");
  };

  const updateCaptionPosition = (event: PointerEvent<HTMLDivElement>) => {
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
    const target = event.currentTarget.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - target.left,
      offsetY: event.clientY - target.top,
      moved: false,
      x: event.clientX,
      y: event.clientY,
    };
    setCaptionDragging(false);
    const move = (next: globalThis.PointerEvent) => {
      const state = drag.current;
      if (!state || next.pointerId !== state.pointerId) return;
      state.moved ||=
        Math.hypot(next.clientX - state.x, next.clientY - state.y) > 4;
      if (state.moved) {
        const stage = captionRef.current;
        if (stage) {
          const bounds = stage.getBoundingClientRect();
          setCaptionDragPosition({
            x: next.clientX - bounds.left - state.offsetX,
            y: next.clientY - bounds.top - state.offsetY,
          });
        }
        setCaptionDragging(true);
      }
    };
    const finish = (next?: globalThis.PointerEvent) => {
      const state = drag.current;
      if (state && next?.pointerId === state.pointerId && state.moved)
        updateCaptionPosition(next as unknown as PointerEvent<HTMLDivElement>);
      drag.current = null;
      setCaptionDragPosition(null);
      setCaptionDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
    const cancel = () => finish();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  };

  const controlsActivity = () => {
    if (!fullscreen) return;
    setControlsVisible(true);
    if (hideControlsTimer.current !== null)
      window.clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = window.setTimeout(
      () => setControlsVisible(false),
      2500,
    );
  };
  const videoActive = Boolean(
    player.playVideos &&
    player.videoUrl &&
    player.currentTime >= Math.max(0, player.track?.videoOffset ?? 0),
  );
  const hasFilters = Boolean(
    search || tags.length > 0 || collection || tab === "favorites",
  );
  const libraryHidden = sidebarHidden && isDesktop;

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
    if (event.key === "Enter") trackListKeyboardRef.current?.playSelected();
    else
      trackListKeyboardRef.current?.moveAndPlay(
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
        (controlsVisible ? "fullscreen-controls-visible" : "")
      }
      style={activeArtworkTheme?.variables as CSSProperties | undefined}
      onPointerLeave={() => fullscreen && setControlsVisible(false)}
    >
      <div className="workspace">
        <main
          ref={mainRef}
          className={
            "main-content " +
            (resizing ? "is-resizing " : "") +
            (sidePanelResizing ? "is-resizing-side-panel " : "") +
            (sidePanelOpen ? "side-panel-is-open " : "") +
            (libraryHidden ? "sidebar-is-hidden " : "") +
            "library-position-" +
            libraryPosition
          }
          style={
            {
              "--library-width": libraryWidth + "px",
              "--side-panel-width": (sidePanelOpen ? sidePanelWidth : 0) + "px",
            } as CSSProperties
          }
        >
          <NowPlaying
            player={player}
            visualizer={visualizer}
            showNowPlayingTitleArtist={showNowPlayingTitleArtist}
            showTitleUnicode={showTitleUnicode}
            showArtistUnicode={showArtistUnicode}
            captionPosition={captionPosition}
            captionDragging={captionDragging}
            captionDragPosition={captionDragPosition}
            videoActive={videoActive}
            captionRef={captionRef}
            beginCaptionDrag={beginCaptionDrag}
          />

          <aside
            ref={sidePanelRef}
            id="side-settings-panel"
            className={"side-panel " + (sidePanelOpen ? "is-open" : "")}
            aria-label="Player tools"
            aria-hidden={!sidePanelOpen}
            inert={!sidePanelOpen || undefined}
          >
            <div className="side-panel-heading">
              <div>
                <span className="settings-label">
                  {sidePanelTab === "visualizer" ? (
                    <AudioWaveform size={16} />
                  ) : (
                    <Settings2 size={16} />
                  )}{" "}
                  {sidePanelTab === "visualizer"
                    ? "AUDIO VISUALIZER"
                    : "PLAYER SETTINGS"}
                </span>
                <h2>
                  {sidePanelTab === "visualizer" ? "Visualizer" : "Settings"}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close player tools"
                onClick={() => setSidePanelOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div
              className="side-panel-tabs"
              role="tablist"
              aria-label="Player tools"
            >
              <button
                type="button"
                role="tab"
                id="settings-tab"
                className={sidePanelTab === "settings" ? "active" : ""}
                aria-selected={sidePanelTab === "settings"}
                aria-controls="side-panel-tab-panel"
                tabIndex={sidePanelTab === "settings" ? 0 : -1}
                onClick={() => setSidePanelTab("settings")}
              >
                <Settings2 size={15} /> Settings
              </button>
              <button
                type="button"
                role="tab"
                id="visualizer-tab"
                className={sidePanelTab === "visualizer" ? "active" : ""}
                aria-selected={sidePanelTab === "visualizer"}
                aria-controls="side-panel-tab-panel"
                tabIndex={sidePanelTab === "visualizer" ? 0 : -1}
                onClick={() => setSidePanelTab("visualizer")}
              >
                <AudioWaveform size={15} /> Visualizer
              </button>
            </div>
            <div
              className="side-panel-content"
              id="side-panel-tab-panel"
              role="tabpanel"
              aria-labelledby={sidePanelTab + "-tab"}
            >
              {sidePanelTab === "visualizer" ? (
                <VisualizerControls
                  settings={visualizer}
                  onChange={setVisualizer}
                />
              ) : (
                <SettingsPanel
                  summary={summary}
                  importing={importing}
                  player={player}
                  chooseLibrary={chooseLibrary}
                  refreshLibrary={async () => {
                    setSidePanelOpen(false);
                    await loadLibrary(summary?.installPath);
                  }}
                  libraryPosition={libraryPosition}
                  setLibraryPosition={setLibraryPosition}
                  transportLayout={transportLayout}
                  setTransportLayout={setTransportLayout}
                  artworkThemeEnabled={artworkThemeEnabled}
                  setArtworkThemeEnabled={setArtworkThemeEnabled}
                  showNowPlayingTitleArtist={showNowPlayingTitleArtist}
                  setShowNowPlayingTitleArtist={setShowNowPlayingTitleArtist}
                  showTitleUnicode={showTitleUnicode}
                  setShowTitleUnicode={setShowTitleUnicode}
                  showArtistUnicode={showArtistUnicode}
                  setShowArtistUnicode={setShowArtistUnicode}
                  visualizer={visualizer}
                  setVisualizer={setVisualizer}
                  clearingCache={clearingCache}
                  cacheUsage={cacheUsage}
                  cacheNotice={cacheNotice}
                  requestCacheClear={requestCacheClear}
                  requestSettingsReset={requestSettingsReset}
                  cacheLimitWheelRemainder={cacheLimitWheelRemainder}
                />
              )}
            </div>
          </aside>

          <div
            className="side-panel-resizer"
            role="separator"
            aria-label="Resize player tools panel"
            aria-hidden={!sidePanelOpen || !isDesktop}
            aria-orientation="vertical"
            aria-valuemin={minSidePanelWidth}
            aria-valuemax={maxSidePanelWidth}
            aria-valuenow={Math.round(sidePanelWidth)}
            tabIndex={!sidePanelOpen || !isDesktop ? -1 : 0}
            title="Drag to resize · double-click to reset"
            onPointerDown={(event) => {
              if (event.button !== 0 || !sidePanelOpen || !isDesktop) return;
              event.preventDefault();
              sidePanelResizeStart.current = {
                x: event.clientX,
                width:
                  sidePanelRef.current?.getBoundingClientRect().width ??
                  sidePanelWidth,
              };
              setSidePanelResizing(true);
            }}
            onDoubleClick={() =>
              setSidePanelWidth(clampSidePanelWidth(defaultSidePanelWidth))
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const sign = libraryPosition === "right" ? 1 : -1;
                setSidePanelWidth((value) =>
                  clampSidePanelWidth(value + direction * sign * 16),
                );
              }
            }}
          >
            <span aria-hidden="true" />
          </div>

          <div
            className="library-resizer"
            role="separator"
            aria-label="Resize library sidebar"
            aria-hidden={libraryHidden}
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={720}
            aria-valuenow={Math.round(libraryWidth)}
            tabIndex={libraryHidden ? -1 : 0}
            title="Drag to resize · double-click to reset"
            onPointerDown={(event) => {
              if (event.button !== 0 || libraryHidden) return;
              event.preventDefault();
              resizeStart.current = {
                x: event.clientX,
                width:
                  libraryRef.current?.getBoundingClientRect().width ??
                  libraryWidth,
              };
              setResizing(true);
            }}
            onDoubleClick={() => setLibraryWidth(clampLibraryWidth(430))}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setLibraryWidth((value) =>
                  clampLibraryWidth(
                    value + (libraryPosition === "right" ? 16 : -16),
                  ),
                );
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setLibraryWidth((value) =>
                  clampLibraryWidth(
                    value + (libraryPosition === "right" ? -16 : 16),
                  ),
                );
              } else if (event.key === "Home") {
                event.preventDefault();
                setLibraryWidth(320);
              } else if (event.key === "End") {
                event.preventDefault();
                setLibraryWidth(clampLibraryWidth(720));
              }
            }}
          >
            <span />
          </div>

          <LibraryPanel
            api={api}
            libraryRef={libraryRef}
            libraryHidden={libraryHidden}
            searchRef={searchRef}
            searchDraft={searchDraft}
            setSearchDraft={setSearchDraft}
            onSearchKeyDown={handleSearchKeyDown}
            importing={importing}
            refreshLibrary={async () => {
              await loadLibrary(summary?.installPath);
            }}
            summary={summary}
            tab={tab}
            setTab={setTab}
            favorites={favorites}
            tags={tags}
            setTags={setTags}
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
            chooseLibrary={chooseLibrary}
            query={query}
            revision={revision}
            currentTrackId={player.track?.id}
            followCurrentTrackIndex={
              queueMatches ? (player.queueIndex ?? undefined) : undefined
            }
            libraryReady={!importing}
            playing={player.playing}
            showTitleUnicode={showTitleUnicode}
            showArtistUnicode={showArtistUnicode}
            onPlay={playTrack}
            onFavorite={toggleFavorite}
            onContextMenu={openTrackContextMenu}
            onTotal={setResultTotal}
            onFirstTrack={cueFirstTrack}
            keyboardControlsRef={trackListKeyboardRef}
            resultTotal={resultTotal}
          />
        </main>
      </div>

      {player.error && (
        <div className="playback-error" role="alert">
          <span>{player.error}</span>
          <button
            aria-label="Dismiss playback error"
            onClick={player.clearError}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {zoomIndicatorVisible && (
        <div className="zoom-indicator" role="status" aria-live="polite">
          Zoom {zoomPercent}%
        </div>
      )}

      {trackContextMenu &&
        createPortal(
          <TrackContextMenu
            track={trackContextMenu.track}
            x={trackContextMenu.x}
            y={trackContextMenu.y}
            info={trackContextMenu.info}
            onAction={performTrackContextMenuAction}
            onClose={closeTrackContextMenu}
          />,
          document.body,
        )}

      <Transport
        player={player}
        transportLayout={transportLayout}
        showTitleUnicode={showTitleUnicode}
        showArtistUnicode={showArtistUnicode}
        favorites={favorites}
        onFavorite={toggleFavorite}
        fullscreen={fullscreen}
        sidebarHidden={sidebarHidden}
        libraryPosition={libraryPosition}
        sidePanelOpen={sidePanelOpen}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onToggleSidePanel={() => {
          if (sidePanelOpen) setSidePanelOpen(false);
          else {
            setSidePanelTab("settings");
            setSidePanelOpen(true);
          }
        }}
        onToggleSidebar={() => setSidebarHidden((value) => !value)}
        onFullscreen={() => api.windowControl("fullscreen")}
        onControlsActivity={controlsActivity}
      />

      <dialog
        ref={dialogRef}
        className="settings-dialog"
        onCancel={() => setShortcutsOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setShortcutsOpen(false);
          }
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2>Keyboard Shortcuts</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => setShortcutsOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        {shortcutsOpen && (
          <div className="shortcuts">
            {[
              ["Play / pause", "Space"],
              ["Previous track", "A"],
              ["Next track", "D"],
              ["Toggle song list", "Ctrl / ⌘ S"],
              ["Show / hide title / artist", "Tab"],
              ["Random track", "F2"],
              ["Previous random track", "Shift F2"],
              ["Browse songs", "↑ / ↓"],
              ["Play selected song", "Enter"],
              ["Seek 5 seconds", "← / →"],
              ["Search your library", "Ctrl / ⌘ F"],
              ["Zoom in", "Ctrl / ⌘ ="],
              ["Zoom out", "Ctrl / ⌘ -"],
              ["Reset zoom", "Ctrl / ⌘ 0"],
              ["Mute / unmute", "M"],
              ["Keyboard shortcuts", "?"],
              ["Fullscreen view", "F11"],
            ].map(([label, key]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        )}
      </dialog>
      {cacheConfirmation && (
        <div
          className="cache-confirmation-layer"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) cancelCacheClear();
          }}
        >
          <section
            className="cache-confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cache-confirmation-title"
            aria-describedby="cache-confirmation-description"
          >
            <div className="cache-confirmation-heading">
              <span className="cache-confirmation-icon" aria-hidden="true">
                <Trash2 size={19} />
              </span>
              <div>
                <h2 id="cache-confirmation-title">
                  Delete {cacheName(cacheConfirmation).toLowerCase()}?
                </h2>
                <p id="cache-confirmation-description">
                  {cacheConfirmation === "index"
                    ? "The library index will be rebuilt from your osu!lazer files the next time you refresh."
                    : "Converted video files will be generated again when they are needed."}
                </p>
              </div>
            </div>
            <div className="cache-confirmation-actions">
              <button
                ref={cacheCancelButtonRef}
                type="button"
                className="secondary-button"
                onClick={cancelCacheClear}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void confirmCacheClear()}
              >
                <Trash2 size={15} /> Delete cache
              </button>
            </div>
          </section>
        </div>
      )}
      {settingsResetConfirmation && (
        <div
          className="cache-confirmation-layer"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) cancelSettingsReset();
          }}
        >
          <section
            className="cache-confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="settings-reset-confirmation-title"
            aria-describedby="settings-reset-confirmation-description"
          >
            <div className="cache-confirmation-heading">
              <span className="cache-confirmation-icon" aria-hidden="true">
                <RefreshCw size={19} />
              </span>
              <div>
                <h2 id="settings-reset-confirmation-title">
                  Reset settings to defaults?
                </h2>
                <p id="settings-reset-confirmation-description">
                  Playback, layout, appearance, sorting, and visualizer
                  preferences will be restored. Your library folder, favorites,
                  and cached files will be kept.
                </p>
              </div>
            </div>
            <div className="cache-confirmation-actions">
              <button
                ref={settingsResetCancelButtonRef}
                type="button"
                className="secondary-button"
                onClick={cancelSettingsReset}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={confirmSettingsReset}
              >
                <RefreshCw size={15} /> Reset settings
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
