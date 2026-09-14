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
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  CircleAlert,
  Disc3,
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
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type {
  LibraryProgress,
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
import { TrackArt } from "./TrackArt";
import { TrackContextMenu } from "./TrackContextMenu";
import { extractArtworkTheme, type ArtworkTheme } from "./artwork-theme";
import {
  VirtualTrackList,
  type VirtualTrackListKeyboardControls,
} from "./VirtualTrackList";
import { AudioVisualizer, VisualizerControls, useVisualizerSettings } from "./AudioVisualizer";
import { usePlayer } from "./usePlayer";

const defaultPosition = "bottom-left";
const defaultLibraryPosition = "right";
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
type SeekPreview = {
  time: number;
  position: number;
};
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
  { value: "duration", label: "Length" },
  { value: "bpm", label: "BPM" },
  { value: "stars", label: "Difficulty" },
  { value: "collection", label: "Collection" },
  { value: "tags", label: "Tags" },
];

const defaultApi: PlayerAPI = {
  loadLibrary: async () => {
    throw new Error(
      "Open osu! music in the desktop app to connect to your osu!lazer songs. Run npm run dev in the project folder.",
    );
  },
  queryLibrary: async () => ({ items: [], total: 0, offset: 0 }),
  getTrack: async () => null,
  prepareVideo: async () => null,
  chooseLibrary: async () => null,
  onLibraryProgress: () => () => {},
  onMediaAction: () => () => {},
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

export function App() {
  const player = usePlayer(api);
  const [visualizer, setVisualizer] = useVisualizerSettings();
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [importing, setImporting] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [progress, setProgress] = useState<LibraryProgress>({
    phase: "reading",
    records: 0,
  });
  const [revision, setRevision] = useState(0);
  const [resultTotal, setResultTotal] = useState(0);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth > 760);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<LibraryTab>("all");
  const [collection, setCollection] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("title");
  const [descending, setDescending] = useState(false);
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
    readStorage<string>("osu-music-transport-layout", "controls-left") ===
    "controls-centered"
      ? "controls-centered"
      : "controls-left",
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
  } | null>(null);
  const [libraryWidth, setLibraryWidth] = useState(() => {
    const value = readStorage("osu-music-library-width", 430);
    return Number.isFinite(value) ? Math.min(720, Math.max(320, value)) : 430;
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
  const [resizing, setResizing] = useState(false);
  const [trackContextMenu, setTrackContextMenu] =
    useState<TrackContextMenuState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const trackListKeyboardRef = useRef<VirtualTrackListKeyboardControls | null>(
    null,
  );
  const hideControlsTimer = useRef<number | null>(null);
  const zoomIndicatorTimer = useRef<number | null>(null);
  const zoomInitialized = useRef(false);
  const focusSearchAfterSidebar = useRef(false);
  const seekPreviewClearTimer = useRef<number | null>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const trackInitialized = useRef(false);
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    x: number;
    y: number;
  } | null>(null);

  trackInitialized.current = Boolean(player.track);

  const loadLibrary = useCallback(
    async (installPath?: string) => {
      trackInitialized.current = false;
      player.reset();
      setSummary(null);
      setResultTotal(0);
      setImporting(true);
      setLoadError("");
      setProgress({ phase: "reading", records: 0 });
      try {
        const next = await api.loadLibrary(installPath);
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
      setProgress(next);
      if ("summary" in next && next.summary) {
        setSummary(next.summary);
        setRevision((value) => value + 1);
      }
    });
    void loadLibrary(
      readStorage<string | undefined>("osu-music-library-path", undefined),
    );
    return removeProgress;
  }, [loadLibrary]);

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

  const clampLibraryWidth = useCallback((value: number): number => {
    const contentWidth = mainRef.current?.clientWidth ?? window.innerWidth;
    const max = Math.max(320, Math.min(720, contentWidth - 360 - 7));
    return Math.min(max, Math.max(320, value));
  }, []);

  useEffect(() => {
    const onResize = () => {
      setIsDesktop(window.innerWidth > 760);
      if (window.innerWidth > 760)
        setLibraryWidth((value) => clampLibraryWidth(value));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampLibraryWidth]);

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
    if ((settingsOpen || shortcutsOpen) && !dialog.open) dialog.showModal();
    else if (!settingsOpen && !shortcutsOpen && dialog.open) dialog.close();
  }, [settingsOpen, shortcutsOpen]);

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
      if (event.key === "F11") {
        event.preventDefault();
        api.windowControl("fullscreen");
        return;
      }
      if (
        event.key === "Escape" &&
        fullscreen &&
        !settingsOpen &&
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
        !settingsOpen &&
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
        !settingsOpen &&
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
      if (settingsOpen || shortcutsOpen || editing) return;
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
    settingsOpen,
    shortcutsOpen,
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
  const queueMatches = useMemo(
    () => JSON.stringify(player.queueQuery) === JSON.stringify(query),
    [player.queueQuery, query],
  );

  const cueFirstTrack = useCallback(
    (track: Track) => {
      if (trackInitialized.current) return;
      trackInitialized.current = true;
      player.cueTrack(track, query, 0);
    },
    [player.cueTrack, query],
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
      setSettingsOpen(false);
      await loadLibrary(path);
    }
  }, [loadLibrary]);

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
    ? Math.max(0, Math.min(100, (player.currentTime / duration) * 100))
    : 0;
  const previewPosition = seekPreview?.position ?? currentProgress;
  const tooltipPosition =
    seekPreview?.position ?? seekTooltipPreview?.position ?? currentProgress;
  const previewStart = Math.min(currentProgress, previewPosition);
  const previewEnd = Math.max(currentProgress, previewPosition);
  const videoActive = Boolean(
    player.videoUrl &&
    player.currentTime >= Math.max(0, player.track?.videoOffset ?? 0),
  );
  const hasFilters = Boolean(
    search || tags.length > 0 || collection || tab === "favorites",
  );
  const libraryHidden = sidebarHidden && isDesktop;

  const changeSort = (next: SortKey) => {
    setSort(next);
    setDescending(next === "added");
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
            (libraryHidden ? "sidebar-is-hidden " : "") +
            "library-position-" +
            libraryPosition
          }
          style={{ "--library-width": libraryWidth + "px" } as CSSProperties}
        >
          <section className="now-playing-panel" aria-label="Now playing">
            <div
              ref={captionRef}
              className={
                "artwork-stage " +
                (player.track?.artworkUrl ? "has-artwork " : "") +
                (player.track?.videoUrl ? "has-video " : "") +
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
              {player.videoUrl && (
                <video
                  ref={player.videoRef}
                  className={"hero-video " + (videoActive ? "is-active" : "")}
                  src={player.videoUrl}
                  muted
                  playsInline
                  disablePictureInPicture
                  preload="metadata"
                  aria-hidden="true"
                  onError={player.handleVideoError}
                />
              )}
              <div className="artwork-grain" />
              <AudioVisualizer analyser={player.analyser} playing={player.playing} settings={visualizer} />
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
              {importing && !summary?.trackCount ? (
                <div className="library-state">
                  <div className="loading-orbit">
                    <Disc3 size={32} />
                  </div>
                  <h3>Finding your rhythm</h3>
                  <p>
                    {progress.phase === "downloading"
                      ? "Downloading OsuFilesUtility…"
                      : progress.phase === "indexing"
                        ? "Organizing your songs…"
                        : "Reading your osu! library…"}
                  </p>
                  {progress.records > 0 && (
                    <small>
                      {progress.records.toLocaleString()} records discovered
                    </small>
                  )}
                </div>
              ) : loadError ? (
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
              ) : (
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
                  onPlay={(track, index) =>
                    player.playTrack(track, query, index)
                  }
                  onFavorite={toggleFavorite}
                  onContextMenu={openTrackContextMenu}
                  onTotal={setResultTotal}
                  onFirstTrack={cueFirstTrack}
                  keyboardControlsRef={trackListKeyboardRef}
                />
              )}
            </div>

            <div className="library-footer">
              <span>
                <i />
                {importing
                  ? summary?.trackCount
                    ? summary.trackCount.toLocaleString() +
                      " songs loaded · Reading library…"
                    : "Connecting to osu!lazer"
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
            {formatDuration(player.currentTime)} / {formatDuration(duration)}
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
            value={Math.min(player.currentTime, duration || 1)}
            disabled={!player.track}
            aria-label="Seek"
            aria-valuetext={
              formatDuration(player.currentTime) +
              " of " +
              formatDuration(duration)
            }
            style={
              {
                "--range-progress": currentProgress + "%",
                "--range-preview-start": previewStart + "%",
                "--range-preview-end": previewEnd + "%",
              } as CSSProperties
            }
            onFocus={resetSeekPreview}
            onPointerMove={updateSeekPreview}
            onChange={(event) => player.seek(Number(event.target.value))}
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
            className="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
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
        onCancel={() => {
          setSettingsOpen(false);
          setShortcutsOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSettingsOpen(false);
            setShortcutsOpen(false);
          }
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2>{shortcutsOpen ? "Keyboard Shortcuts" : "Settings"}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => {
              setSettingsOpen(false);
              setShortcutsOpen(false);
            }}
          >
            <X size={20} />
          </button>
        </div>

        {shortcutsOpen ? (
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
        ) : (
          <>
            <div className="settings-block">
              <span className="settings-label">
                <FolderOpen size={16} /> OSU!LAZER LIBRARY
              </span>
              <p className="install-path">
                {summary?.installPath || "Default osu!lazer installation"}
              </p>
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
                    setSettingsOpen(false);
                    void loadLibrary(summary?.installPath);
                  }}
                >
                  <RefreshCw size={15} /> Refresh library
                </button>
              </div>
            </div>
            <div className="settings-block transport-layout-setting">
              <span className="settings-label">
                <PanelLeft size={16} /> SONG LIST POSITION
              </span>
              <div
                className="transport-layout-options"
                aria-label="Song list position"
              >
                <button
                  type="button"
                  className={
                    "transport-layout-option " +
                    (libraryPosition === "left" ? "active" : "")
                  }
                  aria-pressed={libraryPosition === "left"}
                  onClick={() => setLibraryPosition("left")}
                >
                  <strong>Left side</strong>
                  <span>Show the song list on the left</span>
                </button>
                <button
                  type="button"
                  className={
                    "transport-layout-option " +
                    (libraryPosition === "right" ? "active" : "")
                  }
                  aria-pressed={libraryPosition === "right"}
                  onClick={() => setLibraryPosition("right")}
                >
                  <strong>Right side</strong>
                  <span>Show the song list on the right</span>
                </button>
              </div>
            </div>
            <div className="settings-block transport-layout-setting">
              <span className="settings-label">
                <SlidersHorizontal size={16} /> BOTTOM BAR LAYOUT
              </span>
              <div
                className="transport-layout-options"
                aria-label="Bottom bar layout"
              >
                <button
                  type="button"
                  className={
                    "transport-layout-option " +
                    (transportLayout === "controls-left" ? "active" : "")
                  }
                  aria-pressed={transportLayout === "controls-left"}
                  onClick={() => setTransportLayout("controls-left")}
                >
                  <strong>Controls left</strong>
                  <span>Track details centered</span>
                </button>
                <button
                  type="button"
                  className={
                    "transport-layout-option " +
                    (transportLayout === "controls-centered" ? "active" : "")
                  }
                  aria-pressed={transportLayout === "controls-centered"}
                  onClick={() => setTransportLayout("controls-centered")}
                >
                  <strong>Controls centered</strong>
                  <span>Track details left</span>
                </button>
              </div>
            </div>
            <div className="settings-block artwork-theme-setting">
              <span className="settings-label">
                <Palette size={16} /> APPEARANCE
              </span>
              <button
                type="button"
                className={
                  "settings-toggle " + (artworkThemeEnabled ? "active" : "")
                }
                aria-pressed={artworkThemeEnabled}
                onClick={() => setArtworkThemeEnabled((value) => !value)}
              >
                <span className="settings-toggle-copy">
                  <strong>Match artwork colors</strong>
                  <span>
                    Keep the player dark while tinting it from the current
                    song&apos;s background art
                  </span>
                </span>
                <span className="settings-toggle-status">
                  {artworkThemeEnabled ? "On" : "Off"}
                </span>
              </button>
            </div>
            <div className="settings-block now-playing-display-setting">
              <span className="settings-label">
                {showNowPlayingTitleArtist ? (
                  <Eye size={16} />
                ) : (
                  <EyeOff size={16} />
                )}{" "}
                NOW PLAYING
              </span>
              <button
                type="button"
                className={
                  "settings-toggle " +
                  (showNowPlayingTitleArtist ? "active" : "")
                }
                aria-pressed={showNowPlayingTitleArtist}
                onClick={() => setShowNowPlayingTitleArtist((value) => !value)}
              >
                <span className="settings-toggle-copy">
                  <strong>Show title / artist</strong>
                  <span>Display track details over the artwork</span>
                </span>
                <span className="settings-toggle-status">
                  {showNowPlayingTitleArtist ? "On" : "Off"}
                </span>
              </button>
            </div>
            <VisualizerControls settings={visualizer} onChange={setVisualizer} />
            <div className="settings-stats">
              <span>
                <strong>{summary?.trackCount.toLocaleString() ?? "—"}</strong>{" "}
                songs
              </span>
              <span>
                <strong>{summary?.beatmapCount.toLocaleString() ?? "—"}</strong>{" "}
                beatmaps
              </span>
              <span>
                <strong>{summary?.collectionCount ?? "—"}</strong> collections
              </span>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
