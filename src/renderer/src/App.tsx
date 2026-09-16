import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  AudioWaveform,
  CircleAlert,
  Eye,
  EyeOff,
  FolderHeart,
  FolderOpen,
  Heart,
  Keyboard,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Music2,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
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
import { FacetPicker } from "./FacetPicker";
import { SortPicker } from "./SortPicker";
import { SettingsPicker } from "./SettingsPicker";
import { TrackArt } from "./TrackArt";
import { TrackContextMenu } from "./TrackContextMenu";
import { extractArtworkTheme, type ArtworkTheme } from "./artwork-theme";
import {
  cacheLastArtworkTheme,
  clearCachedLastArtworkTheme,
} from "./artwork-theme-cache";
import {
  VirtualTrackList,
  type VirtualTrackListKeyboardControls,
} from "./VirtualTrackList";
import {
  AudioVisualizer,
  VisualizerControls,
  useVisualizerSettings,
} from "./AudioVisualizer";
import { usePlayer } from "./usePlayer";
import { parseVisualizer } from "./visualizer-settings";

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
type CaptionPosition = (typeof positions)[number];
type LibraryTab = "all" | "favorites";
type LibraryPosition = "left" | "right";
type TransportLayout = "controls-left" | "controls-centered";
type SidePanelTab = "visualizer" | "settings";
type SeekPreview = {
  time: number;
  position: number;
};
const videoCodecOptions = [
  { value: "auto", label: "Auto (best available)" },
  { value: "av1", label: "AV1" },
  { value: "hevc", label: "H.265 / HEVC" },
  { value: "h264-hardware", label: "H.264 (hardware)" },
  { value: "h264-software", label: "H.264 (software)" },
] as const;
const videoQualityOptions = [
  { value: "very-low", label: "Very low" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "very-high", label: "Very high" },
] as const;
const videoFpsOptions = [
  { value: 0, label: "No cap" },
  { value: 24, label: "24 FPS" },
  { value: 30, label: "30 FPS" },
  { value: 60, label: "60 FPS" },
] as const;
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

const lastPlayedTrackKey = "osu-music-last-played-track";
const sortKey = "osu-music-sort";
const sortDescendingKey = "osu-music-sort-descending";

const defaultApi: PlayerAPI = {
  loadLibrary: async () => {
    throw new Error(
      "Open osu! music in the desktop app to connect to your osu!lazer songs. Run npm run dev in the project folder.",
    );
  },
  queryLibrary: async () => ({ items: [], total: 0, offset: 0 }),
  getTrack: async () => null,
  prepareVideo: async () => null,
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

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are optional.
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Preferences are optional.
  }
}

function isSortKey(value: unknown): value is SortKey {
  return sortOptions.some((option) => option.value === value);
}

function formatDuration(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
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

function formatCacheSize(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(unit === 0 || value >= 10 ? 0 : 1)} ${units[unit]}`;
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
  const player = usePlayer(api, initialTrack);
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
    const stored = readStorage<unknown>(sortKey, "title");
    return isSortKey(stored) ? stored : "title";
  });
  const [descending, setDescending] = useState(
    () => readStorage<unknown>(sortDescendingKey, false) === true,
  );
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(readStorage<string[]>("osu-music-favorites", [])),
  );
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(
    () => {
      const stored = readStorage(
        "osu-music-now-playing-position",
        defaultPosition,
      );
      return isCaptionPosition(stored) ? stored : defaultPosition;
    },
  );
  const [sidebarHidden, setSidebarHidden] = useState(() =>
    readStorage("osu-music-sidebar-hidden", false),
  );
  const [libraryPosition, setLibraryPosition] = useState<LibraryPosition>(
    () => {
      const stored = readStorage(
        "osu-music-library-position",
        defaultLibraryPosition,
      );
      return isLibraryPosition(stored) ? stored : defaultLibraryPosition;
    },
  );
  const [transportLayout, setTransportLayout] = useState<TransportLayout>(() =>
    readStorage<string>("osu-music-transport-layout", "controls-centered") ===
    "controls-left"
      ? "controls-left"
      : "controls-centered",
  );
  const [showNowPlayingTitleArtist, setShowNowPlayingTitleArtist] = useState(
    () => readStorage("osu-music-show-now-playing-title-artist", true),
  );
  const [artworkThemeEnabled, setArtworkThemeEnabled] = useState(() =>
    readStorage("osu-music-artwork-theme", true),
  );
  const [artworkTheme, setArtworkTheme] = useState<{
    url: string;
    theme: ArtworkTheme;
  } | null>(initialArtworkTheme);
  const [libraryWidth, setLibraryWidth] = useState(() => {
    const value = readStorage("osu-music-library-width", 430);
    return Number.isFinite(value) ? Math.min(720, Math.max(320, value)) : 430;
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sidePanelOpen, setSidePanelOpen] = useState(() =>
    readStorage("osu-music-visualizer-panel-open", false),
  );
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>("visualizer");
  const [sidePanelWidth, setSidePanelWidth] = useState(() => {
    const value = readStorage(
      "osu-music-side-panel-width",
      defaultSidePanelWidth,
    );
    return Number.isFinite(value)
      ? Math.min(maxSidePanelWidth, Math.max(minSidePanelWidth, value))
      : defaultSidePanelWidth;
  });
  const [sidePanelResizing, setSidePanelResizing] = useState(false);
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
  const [seekPreview, setSeekPreview] = useState<SeekPreview | null>(null);
  const [seekTooltipPreview, setSeekTooltipPreview] =
    useState<SeekPreview | null>(null);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
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
  const seekPreviewClearTimer = useRef<number | null>(null);
  const scrubPointer = useRef<number | null>(null);
  const scrubTimeRef = useRef<number | null>(null);
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
        const savedId = readStorage<unknown>(lastPlayedTrackKey, null);
        const next = await api.loadLibrary(
          installPath,
          typeof savedId === "string" ? savedId : undefined,
        );
        setSummary(next);
        setRevision((value) => value + 1);
        writeStorage("osu-music-library-path", next.installPath);
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
    if (!initialLibrary)
      void loadLibrary(
        readStorage<string | undefined>("osu-music-library-path", undefined),
      );
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
    writeStorage("osu-music-favorites", [...favorites]);
  }, [favorites]);
  useEffect(
    () => writeStorage("osu-music-library-width", libraryWidth),
    [libraryWidth],
  );
  useEffect(
    () => writeStorage("osu-music-sidebar-hidden", sidebarHidden),
    [sidebarHidden],
  );
  useEffect(
    () => writeStorage("osu-music-visualizer-panel-open", sidePanelOpen),
    [sidePanelOpen],
  );
  useEffect(
    () => writeStorage("osu-music-side-panel-width", sidePanelWidth),
    [sidePanelWidth],
  );
  useEffect(
    () => writeStorage("osu-music-library-position", libraryPosition),
    [libraryPosition],
  );
  useEffect(
    () => writeStorage("osu-music-transport-layout", transportLayout),
    [transportLayout],
  );
  useEffect(
    () =>
      writeStorage(
        "osu-music-show-now-playing-title-artist",
        showNowPlayingTitleArtist,
      ),
    [showNowPlayingTitleArtist],
  );
  useEffect(
    () => writeStorage("osu-music-artwork-theme", artworkThemeEnabled),
    [artworkThemeEnabled],
  );
  useEffect(
    () => writeStorage("osu-music-now-playing-position", captionPosition),
    [captionPosition],
  );
  useEffect(() => writeStorage(sortKey, sort), [sort]);
  useEffect(() => writeStorage(sortDescendingKey, descending), [descending]);

  useEffect(() => {
    if (!player.playing || !player.track) return;
    const themeMatchesTrack =
      artworkTheme && artworkTheme.url === player.track.artworkUrl
        ? artworkTheme.theme
        : null;
    if (themeMatchesTrack) cacheLastArtworkTheme(themeMatchesTrack);
    else clearCachedLastArtworkTheme();
    writeStorage(lastPlayedTrackKey, player.track.id);
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

  useEffect(
    () => () => {
      if (seekPreviewClearTimer.current !== null) {
        window.clearTimeout(seekPreviewClearTimer.current);
        seekPreviewClearTimer.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    scrubPointer.current = null;
    scrubTimeRef.current = null;
    setScrubTime(null);
  }, [player.track?.id]);

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

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing =
        target &&
        (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) ||
          target.isContentEditable);
      const inTransport = Boolean(target?.closest(".transport"));
      if (cacheConfirmation || settingsResetConfirmation) return;
      if (event.key === "F11") {
        event.preventDefault();
        api.windowControl("fullscreen");
        return;
      }
      if (event.key === "Escape" && sidePanelOpen && !shortcutsOpen) {
        event.preventDefault();
        setSidePanelOpen(false);
        return;
      }
      if (
        event.key === "Escape" &&
        fullscreen &&
        !sidePanelOpen &&
        !shortcutsOpen
      ) {
        event.preventDefault();
        api.windowControl("fullscreen");
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        ["f", "k"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSidebarHidden((value) => !value);
        return;
      }
      if (
        !settingsPanelOpen &&
        !shortcutsOpen &&
        event.key === "Tab" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        target?.blur();
        setShowNowPlayingTitleArtist((value) => !value);
        return;
      }
      if (
        inTransport &&
        event.code === "Space" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        target?.blur();
        player.toggle();
        return;
      }
      if (
        !settingsPanelOpen &&
        !shortcutsOpen &&
        !target?.closest(".facet-picker, .sort-picker") &&
        !target?.matches("input[type='range']") &&
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        trackListKeyboardRef.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        trackListKeyboardRef.current.moveAndPlay(
          event.key === "ArrowUp" ? -1 : 1,
        );
        return;
      }
      if (settingsPanelOpen || shortcutsOpen || editing) return;
      if (
        event.key === "F2" &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        void player.jumpRandom(event.shiftKey ? -1 : 1);
      } else if (
        event.code === "Space" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        player.toggle();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        player.seek(player.currentTime + 5);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        player.seek(player.currentTime - 5);
      } else if (
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        void player.previous();
      } else if (
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        void player.next();
      } else if (event.key.toLowerCase() === "m") player.toggleMute();
      else if (event.key === "?") setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    fullscreen,
    player.currentTime,
    player.jumpRandom,
    player.next,
    player.previous,
    player.seek,
    player.toggle,
    player.toggleMute,
    focusSearch,
    sidePanelOpen,
    settingsPanelOpen,
    shortcutsOpen,
    cacheConfirmation,
    settingsResetConfirmation,
  ]);

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
      const savedId = readStorage<unknown>(lastPlayedTrackKey, null);
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
            removeStorage(lastPlayedTrackKey);
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
      writeStorage(lastPlayedTrackKey, track.id);
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
  const duration = player.duration || player.track?.duration || 0;
  const displayedTime = scrubTime ?? player.currentTime;
  const beginScrubbing = (event: PointerEvent<HTMLInputElement>) => {
    if (!player.track) return;
    scrubPointer.current = event.pointerId;
    const next = Number(event.currentTarget.value);
    scrubTimeRef.current = next;
    setScrubTime(next);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const updateScrubbing = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    if (scrubPointer.current === null) {
      player.seek(next);
      return;
    }
    scrubTimeRef.current = next;
    setScrubTime(next);
  };
  const finishScrubbing = (event: PointerEvent<HTMLInputElement>) => {
    if (
      scrubPointer.current === null ||
      scrubPointer.current !== event.pointerId
    )
      return;
    const next = scrubTimeRef.current ?? Number(event.currentTarget.value);
    scrubPointer.current = null;
    scrubTimeRef.current = null;
    setScrubTime(null);
    player.seek(next);
  };
  const cancelSeekPreviewClear = () => {
    if (seekPreviewClearTimer.current !== null) {
      window.clearTimeout(seekPreviewClearTimer.current);
      seekPreviewClearTimer.current = null;
    }
  };
  const updateSeekPreview = (event: PointerEvent<HTMLInputElement>) => {
    if (!duration || !player.track) return;
    cancelSeekPreviewClear();
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const position = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const preview = { time: position * duration, position: position * 100 };
    setSeekPreview(preview);
    setSeekTooltipPreview(preview);
  };
  const clearSeekPreview = () => {
    cancelSeekPreviewClear();
    // The range highlight should disappear as soon as the pointer leaves.
    setSeekPreview(null);
    // Keep the tooltip snapshot while it fades out. Clearing it now would
    // briefly replace it with the live position during that fade.
    seekPreviewClearTimer.current = window.setTimeout(() => {
      setSeekTooltipPreview(null);
      seekPreviewClearTimer.current = null;
    }, 150);
  };
  const resetSeekPreview = () => {
    cancelSeekPreviewClear();
    setSeekPreview(null);
    setSeekTooltipPreview(null);
  };
  const currentProgress = duration
    ? Math.max(0, Math.min(100, (displayedTime / duration) * 100))
    : 0;
  const previewPosition = seekPreview?.position ?? currentProgress;
  const tooltipPosition =
    seekPreview?.position ?? seekTooltipPreview?.position ?? currentProgress;
  const previewStart = Math.min(currentProgress, previewPosition);
  const previewEnd = Math.max(currentProgress, previewPosition);
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

  const settingsSwitch = (
    title: string,
    description: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <div className="settings-row">
      <span className="settings-row-label" title={description}>
        {title}
      </span>
      <button
        type="button"
        className={"settings-switch " + (active ? "active" : "")}
        aria-label={title}
        aria-pressed={active}
        title={description}
        onClick={onClick}
      >
        {active ? "On" : "Off"}
      </button>
    </div>
  );

  const settingsPanelContent = (
    <>
      <div className="settings-block settings-library">
        <span className="settings-label">
          <FolderOpen size={16} /> OSU!LAZER LIBRARY
        </span>
        <div className="settings-row">
          <span className="settings-row-label">Folder</span>
          <span
            className="settings-row-value install-path"
            title={summary?.installPath || "Default osu!lazer installation"}
          >
            {summary?.installPath || "Default osu!lazer installation"}
          </span>
        </div>
        <div className="settings-actions">
          <button
            className="primary-button"
            onClick={() => void chooseLibrary()}
          >
            <FolderOpen size={15} /> Choose folder
          </button>
          <button
            className="secondary-button"
            disabled={importing}
            onClick={() => {
              setSidePanelOpen(false);
              void loadLibrary(summary?.installPath);
            }}
          >
            <RefreshCw size={15} /> Refresh library
          </button>
        </div>
      </div>
      <div className="settings-block transport-layout-setting">
        <div className="settings-row">
          <span className="settings-row-label">
            <PanelLeft size={15} /> Panel
          </span>
          <div
            className="settings-choice-group"
            aria-label="Song list position"
          >
            <button
              type="button"
              className={
                "settings-choice-option " +
                (libraryPosition === "left" ? "active" : "")
              }
              aria-pressed={libraryPosition === "left"}
              title="Show the song list on the left"
              onClick={() => setLibraryPosition("left")}
            >
              Left
            </button>
            <button
              type="button"
              className={
                "settings-choice-option " +
                (libraryPosition === "right" ? "active" : "")
              }
              aria-pressed={libraryPosition === "right"}
              title="Show the song list on the right"
              onClick={() => setLibraryPosition("right")}
            >
              Right
            </button>
          </div>
        </div>
      </div>
      <div className="settings-block transport-layout-setting">
        <div className="settings-row">
          <span className="settings-row-label">
            <SlidersHorizontal size={15} /> Controls
          </span>
          <div className="settings-choice-group" aria-label="Bottom bar layout">
            <button
              type="button"
              className={
                "settings-choice-option " +
                (transportLayout === "controls-left" ? "active" : "")
              }
              aria-pressed={transportLayout === "controls-left"}
              title="Keep playback controls on the left"
              onClick={() => setTransportLayout("controls-left")}
            >
              Left
            </button>
            <button
              type="button"
              className={
                "settings-choice-option " +
                (transportLayout === "controls-centered" ? "active" : "")
              }
              aria-pressed={transportLayout === "controls-centered"}
              title="Center playback controls"
              onClick={() => setTransportLayout("controls-centered")}
            >
              Center
            </button>
          </div>
        </div>
      </div>
      <div className="settings-block artwork-theme-setting">
        <span className="settings-label">
          <Palette size={16} /> APPEARANCE
        </span>
        {settingsSwitch(
          "Show Videos",
          "Show beatmap videos when available; otherwise show the background art",
          player.playVideos,
          () => player.setPlayVideos((value) => !value),
        )}
        {settingsSwitch(
          "Dynamic Theme",
          "Theme the app background from the current song's artwork",
          artworkThemeEnabled,
          () => setArtworkThemeEnabled((value) => !value),
        )}
      </div>
      <div className="settings-block video-encoding-setting">
        <span className="settings-label">
          <SlidersHorizontal size={16} /> VIDEO ENCODING
        </span>
        <div className="settings-row">
          <span className="settings-row-label">Codec</span>
          <SettingsPicker
            label="Video codec"
            value={player.videoEncodingCodec}
            options={videoCodecOptions}
            onChange={player.setVideoEncodingCodec}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Quality</span>
          <SettingsPicker
            label="Video quality"
            value={player.videoEncodingQuality}
            options={videoQualityOptions}
            onChange={player.setVideoEncodingQuality}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">FPS Cap</span>
          <SettingsPicker
            label="Video FPS cap"
            value={player.videoMaxFps}
            options={videoFpsOptions}
            onChange={player.setVideoMaxFps}
          />
        </div>
        {settingsSwitch(
          "Force remux when possible",
          "Copy compatible video without re-encoding; automatically encode when copying is not supported",
          player.videoForceRemux,
          () => player.setVideoForceRemux((value) => !value),
        )}
      </div>
      <div className="settings-block now-playing-display-setting">
        <span className="settings-label">
          {showNowPlayingTitleArtist ? <Eye size={16} /> : <EyeOff size={16} />}{" "}
          NOW PLAYING
        </span>
        {settingsSwitch(
          "Show title / artist",
          "Display track details over the artwork",
          showNowPlayingTitleArtist,
          () => setShowNowPlayingTitleArtist((value) => !value),
        )}
      </div>
      <div className="settings-stats">
        <span>
          <strong>{summary?.trackCount.toLocaleString() ?? "—"}</strong> songs
        </span>
        <span>
          <strong>{summary?.beatmapCount.toLocaleString() ?? "—"}</strong>{" "}
          beatmaps
        </span>
        <span>
          <strong>{summary?.collectionCount ?? "—"}</strong> collections
        </span>
      </div>
      <div className="settings-block maintenance-setting">
        <span className="settings-label">
          <Trash2 size={16} /> CACHE &amp; SETTINGS
        </span>
        <div className="settings-actions maintenance-actions">
          <button
            type="button"
            className="secondary-button settings-reset-button"
            title="Restore playback, layout, appearance, sorting, and visualizer preferences to their original defaults"
            onClick={requestSettingsReset}
          >
            <RefreshCw size={15} /> Reset
          </button>
          {(["index", "video"] as CacheKind[]).map((kind) => {
            const active = clearingCache === kind;
            const disabled =
              clearingCache !== null || (kind === "index" && importing);
            return (
              <button
                key={kind}
                type="button"
                className="danger-button cache-button"
                aria-label={`Clear ${cacheName(kind)} cache`}
                disabled={disabled}
                onClick={() => requestCacheClear(kind)}
              >
                <strong>
                  {active && <LoaderCircle className="spin" size={13} />}
                  {active ? "Deleting…" : cacheName(kind)}
                </strong>
                <span className="cache-button-usage">
                  {formatCacheSize(cacheUsage?.[kind])}
                </span>
              </button>
            );
          })}
        </div>
        {cacheNotice && (
          <p className={"cache-notice " + cacheNotice.kind} role="status">
            {cacheNotice.message}
          </p>
        )}
      </div>
    </>
  );

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
          <section className="now-playing-panel" aria-label="Now playing">
            <div
              ref={captionRef}
              className={
                "artwork-stage " +
                (player.track?.artworkUrl ? "has-artwork " : "") +
                (player.playVideos && player.track?.videoUrl
                  ? "has-video "
                  : "") +
                (videoActive ? "video-is-active" : "")
              }
            >
              {player.track?.artworkUrl && (
                <img
                  className="hero-background"
                  src={player.track.artworkUrl}
                  alt=""
                  draggable={false}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )}
              {player.playVideos && player.videoUrl && (
                <video
                  ref={player.videoRef}
                  className={"hero-video " + (videoActive ? "is-active" : "")}
                  muted
                  playsInline
                  disablePictureInPicture
                  preload="metadata"
                  aria-hidden="true"
                  onError={player.handleVideoError}
                />
              )}
              <div className="artwork-grain" />
              {player.videoEncoding && (
                <div className="video-encoding-indicator" role="status">
                  <LoaderCircle className="spin" size={14} />
                  Encoding video…
                </div>
              )}
              <AudioVisualizer
                analyser={player.analyser}
                playing={player.playing}
                settings={visualizer}
              />
              {showNowPlayingTitleArtist && (
                <div
                  className={
                    "hero-caption hero-caption-" +
                    captionPosition +
                    (captionDragging ? " is-dragging" : "")
                  }
                  aria-label="Now playing information. Drag to move it to an edge."
                  style={
                    captionDragPosition
                      ? ({
                          "--caption-drag-x": captionDragPosition.x + "px",
                          "--caption-drag-y": captionDragPosition.y + "px",
                        } as CSSProperties)
                      : undefined
                  }
                  onPointerDown={beginCaptionDrag}
                >
                  <h2 title={player.track?.title}>
                    {player.track?.title || "A little more rhythm."}
                  </h2>
                  <p title={player.track?.artist}>
                    {player.track?.artist ||
                      "Your osu! library. A whole new way to listen."}
                  </p>
                  {player.track?.source && (
                    <span className="hero-source">{player.track.source}</span>
                  )}
                </div>
              )}
            </div>
            <div className="player-note">
              <span className="tiny-osu">osu!</span>
              <span>Less clicking circles. More listening.</span>
              <Sparkles size={14} />
            </div>
          </section>

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
                id="visualizer-tab"
                className={sidePanelTab === "visualizer" ? "active" : ""}
                aria-selected={sidePanelTab === "visualizer"}
                aria-controls="side-panel-tab-panel"
                tabIndex={sidePanelTab === "visualizer" ? 0 : -1}
                onClick={() => setSidePanelTab("visualizer")}
              >
                <AudioWaveform size={15} /> Visualizer
              </button>
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
                settingsPanelContent
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

          <section
            ref={libraryRef}
            className="library-panel"
            aria-label="Music library"
            aria-hidden={libraryHidden}
            inert={libraryHidden || undefined}
          >
            <div className="library-search-row">
              <div className="search-box">
                <Search size={19} />
                <input
                  ref={searchRef}
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search songs, artists, tags…"
                  aria-label="Search library"
                />
                {searchDraft ? (
                  <button
                    aria-label="Clear search"
                    onClick={() => setSearchDraft("")}
                  >
                    <X size={15} />
                  </button>
                ) : (
                  <kbd>Ctrl F</kbd>
                )}
              </div>
              <button
                className={
                  "icon-button refresh-button " + (importing ? "spinning" : "")
                }
                title="Refresh library"
                aria-label="Refresh library"
                disabled={importing}
                onClick={() => void loadLibrary(summary?.installPath)}
              >
                <RefreshCw size={17} />
              </button>
            </div>

            <div
              className="library-tabs"
              role="tablist"
              aria-label="Library view"
            >
              <button
                role="tab"
                aria-selected={tab === "all"}
                className={tab === "all" ? "active" : ""}
                onClick={() => setTab("all")}
              >
                <Music2 size={15} /> All songs
              </button>
              <button
                role="tab"
                aria-selected={tab === "favorites"}
                className={tab === "favorites" ? "active" : ""}
                onClick={() => setTab("favorites")}
              >
                <Heart size={15} /> Favorites
                {favorites.size > 0 && <span>{favorites.size}</span>}
              </button>
            </div>

            <div className="filter-bar">
              <FacetPicker
                label="Filter by tag"
                allLabel="All tags"
                value={tags}
                multiple
                onChange={(value) =>
                  setTags(Array.isArray(value) ? value : value ? [value] : [])
                }
                items={summary?.tags ?? []}
                icon={<Tag size={13} />}
              />
              <div className="collection-filter">
                <FacetPicker
                  label="Filter by collection"
                  allLabel="All collections"
                  value={collection}
                  onChange={setCollection}
                  items={summary?.collections ?? []}
                  icon={<FolderHeart size={16} />}
                />
              </div>
              <div className="sort-controls">
                <span>Sort by</span>
                <div className="sort-select">
                  <SortPicker
                    value={sort}
                    options={sortOptions}
                    onChange={changeSort}
                  />
                </div>
                <button
                  className="icon-button sort-direction"
                  aria-label={descending ? "Sort ascending" : "Sort descending"}
                  title={descending ? "Descending order" : "Ascending order"}
                  onClick={() => setDescending((value) => !value)}
                >
                  {descending ? (
                    <ArrowDownWideNarrow size={16} />
                  ) : (
                    <ArrowUpWideNarrow size={16} />
                  )}
                </button>
              </div>
            </div>

            {hasFilters && (
              <div className="active-filters">
                <span>
                  {tags.length
                    ? tags.map((value) => "#" + value).join(", ")
                    : collection ||
                      (tab === "favorites"
                        ? "Your favorites"
                        : "“" + search + "”")}
                </span>
                <button onClick={clearFilters}>
                  Clear filters <X size={12} />
                </button>
              </div>
            )}

            <div className="list-area">
              {loadError ? (
                <div className="library-state error-state">
                  <CircleAlert size={35} />
                  <h3>Let’s find your music</h3>
                  <p>{loadError}</p>
                  <button
                    className="primary-button"
                    onClick={() => void chooseLibrary()}
                  >
                    <FolderOpen size={16} /> Choose osu! folder
                  </button>
                  <button
                    className="text-button"
                    onClick={() => void loadLibrary(summary?.installPath)}
                  >
                    Try again
                  </button>
                </div>
              ) : summary ? (
                <VirtualTrackList
                  api={api}
                  query={query}
                  revision={revision}
                  currentTrackId={player.track?.id}
                  followCurrentTrackIndex={
                    queueMatches ? (player.queueIndex ?? undefined) : undefined
                  }
                  playing={player.playing}
                  favorites={favorites}
                  onPlay={playTrack}
                  onFavorite={toggleFavorite}
                  onContextMenu={openTrackContextMenu}
                  onTotal={setResultTotal}
                  onFirstTrack={cueFirstTrack}
                  keyboardControlsRef={trackListKeyboardRef}
                />
              ) : null}
            </div>

            <div className="library-footer">
              <span>
                <i />
                {importing
                  ? (summary?.trackCount ?? 0).toLocaleString() +
                    " songs loaded"
                  : resultTotal.toLocaleString() +
                    (hasFilters ? " songs found" : " songs in your library")}
              </span>
            </div>
          </section>
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

      <footer
        className={
          "transport " +
          (transportLayout === "controls-centered"
            ? "transport-controls-centered"
            : "")
        }
        aria-label="Playback controls"
        onPointerMove={controlsActivity}
        onFocus={controlsActivity}
      >
        <div
          className="transport-scrubber"
          onPointerEnter={cancelSeekPreviewClear}
          onPointerLeave={clearSeekPreview}
        >
          <span
            className="seek-tooltip seek-current-tooltip"
            aria-hidden="true"
            style={
              {
                "--seek-tooltip-position": currentProgress + "%",
              } as CSSProperties
            }
          >
            {formatDuration(displayedTime)} / {formatDuration(duration)}
          </span>
          {seekTooltipPreview && (
            <span
              className="seek-tooltip seek-hover-tooltip"
              aria-hidden="true"
              style={
                {
                  "--seek-tooltip-position": tooltipPosition + "%",
                } as CSSProperties
              }
            >
              {formatDuration(seekTooltipPreview.time)}
            </span>
          )}
          <input
            className="seek-slider"
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(displayedTime, duration || 1)}
            disabled={!player.track}
            aria-label="Seek"
            aria-valuetext={
              formatDuration(displayedTime) + " of " + formatDuration(duration)
            }
            style={
              {
                "--range-progress": currentProgress + "%",
                "--range-preview-start": previewStart + "%",
                "--range-preview-end": previewEnd + "%",
              } as CSSProperties
            }
            onFocus={resetSeekPreview}
            onPointerDown={beginScrubbing}
            onPointerMove={updateSeekPreview}
            onPointerUp={finishScrubbing}
            onPointerCancel={finishScrubbing}
            onLostPointerCapture={finishScrubbing}
            onChange={updateScrubbing}
          />
        </div>

        {transportLayout !== "controls-centered" && (
          <button
            className={
              "icon-button shuffle-button " + (player.shuffle ? "active" : "")
            }
            aria-label="Shuffle"
            aria-pressed={player.shuffle}
            title={player.shuffle ? "Turn off shuffle" : "Turn on shuffle"}
            onClick={() => player.setShuffle((value) => !value)}
          >
            <Shuffle size={17} />
          </button>
        )}
        <div className="transport-buttons">
          {transportLayout === "controls-centered" && (
            <button
              className={
                "icon-button shuffle-button " + (player.shuffle ? "active" : "")
              }
              aria-label="Shuffle"
              aria-pressed={player.shuffle}
              title={player.shuffle ? "Turn off shuffle" : "Turn on shuffle"}
              onClick={() => player.setShuffle((value) => !value)}
            >
              <Shuffle size={17} />
            </button>
          )}
          <button
            className="icon-button skip-button"
            aria-label="Previous track"
            disabled={!player.track}
            onClick={() => void player.previous()}
          >
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button
            className="play-button"
            aria-label={player.playing ? "Pause" : "Play"}
            disabled={!player.track}
            onClick={player.toggle}
          >
            {player.loading ? (
              <LoaderCircle className="spin" size={21} />
            ) : player.playing ? (
              <Pause size={21} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button skip-button"
            aria-label="Next track"
            disabled={!player.track}
            onClick={() => void player.next()}
          >
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button
            className={
              "icon-button repeat-button " +
              (player.repeat !== "off" ? "active" : "")
            }
            aria-label={
              player.repeat === "one"
                ? "Repeat one"
                : player.repeat === "all"
                  ? "Repeat all"
                  : "Repeat off"
            }
            aria-pressed={player.repeat !== "off"}
            title={
              player.repeat === "one"
                ? "Repeat one"
                : player.repeat === "all"
                  ? "Repeat all"
                  : "Repeat off"
            }
            onClick={player.cycleRepeat}
          >
            {player.repeat === "one" ? (
              <Repeat1 size={17} />
            ) : (
              <Repeat size={17} />
            )}
          </button>
        </div>

        <div className="transport-track">
          <TrackArt
            className="transport-track-art"
            track={player.track}
            playing={false}
          />
          <div className="transport-track-text">
            <strong title={player.track?.title}>
              {player.track?.title || "Your soundtrack starts here"}
            </strong>
            <span title={player.track?.artist}>
              {player.track?.artist || "Pick a song and press play"}
            </span>
          </div>
          <button
            className={
              "icon-button transport-heart " +
              (player.track && favorites.has(player.track.id)
                ? "is-favorite"
                : "")
            }
            disabled={!player.track}
            aria-label={
              player.track && favorites.has(player.track.id)
                ? "Unfavorite song"
                : "Favorite song"
            }
            onClick={() => player.track && toggleFavorite(player.track)}
          >
            <Heart
              size={17}
              fill={
                player.track && favorites.has(player.track.id)
                  ? "currentColor"
                  : "none"
              }
            />
          </button>
        </div>

        <div className="transport-extra">
          <button
            className="icon-button"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard size={17} />
          </button>
          <button
            className={
              "icon-button settings-panel-toggle " +
              (settingsPanelOpen ? "active" : "")
            }
            aria-label={settingsPanelOpen ? "Hide settings" : "Show settings"}
            aria-pressed={settingsPanelOpen}
            aria-expanded={sidePanelOpen}
            aria-controls="side-settings-panel"
            title={settingsPanelOpen ? "Hide settings" : "Show settings"}
            onClick={() => {
              if (settingsPanelOpen) {
                setSidePanelOpen(false);
              } else {
                setSidePanelTab("settings");
                setSidePanelOpen(true);
              }
            }}
          >
            <Settings2 size={17} />
          </button>
          <button
            className={
              "icon-button sidebar-toggle " + (sidebarHidden ? "" : "active")
            }
            aria-label={
              sidebarHidden ? "Show library sidebar" : "Hide library sidebar"
            }
            onClick={() => setSidebarHidden((value) => !value)}
          >
            {sidebarHidden ? (
              libraryPosition === "left" ? (
                <PanelLeftOpen size={19} />
              ) : (
                <PanelRightOpen size={19} />
              )
            ) : libraryPosition === "left" ? (
              <PanelLeftClose size={19} />
            ) : (
              <PanelRightClose size={19} />
            )}
          </button>
          <button
            className="icon-button"
            aria-label={player.muted ? "Unmute" : "Mute"}
            onClick={player.toggleMute}
          >
            {player.muted || player.volume === 0 ? (
              <VolumeX size={19} />
            ) : player.volume < 0.5 ? (
              <Volume1 size={19} />
            ) : (
              <Volume2 size={19} />
            )}
          </button>
          <input
            className="volume-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={player.muted ? 0 : player.volume}
            aria-label="Volume"
            style={
              {
                "--range-progress":
                  (player.muted ? 0 : player.volume) * 100 + "%",
              } as CSSProperties
            }
            onChange={(event) => player.setVolume(Number(event.target.value))}
          />
          <button
            className="icon-button fullscreen-toggle"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={
              fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen view (F11)"
            }
            onClick={() => api.windowControl("fullscreen")}
          >
            {fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
          </button>
        </div>
      </footer>

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
