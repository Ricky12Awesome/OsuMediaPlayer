import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  CircleAlert,
  Heart,
  LoaderCircle,
  Music2,
  SearchX,
} from "lucide-react";
import type { LibraryQuery, PlayerAPI, Track } from "../../shared/types";
import { TrackArt } from "./TrackArt";

const pageSize = 64;
const pageCacheLimit = 8;
const maxConcurrentRequests = 3;
const overscanRows = 5;
const rowHeight = 78;

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

type LibraryCache = {
  query: LibraryQuery;
  pages: Map<number, Track[]>;
  requests: Map<number, Promise<Track[] | null>>;
  errors: Map<number, string>;
  total: number | null;
  active: boolean;
  firstReported: boolean;
};

export interface VirtualTrackListProps {
  api: PlayerAPI;
  query: LibraryQuery;
  revision: number;
  currentTrackId?: string;
  followCurrentTrackIndex?: number;
  playing: boolean;
  favorites: Set<string>;
  onPlay: (track: Track, index: number) => void;
  onFavorite: (track: Track) => void;
  onContextMenu: (track: Track, x: number, y: number) => void;
  onTotal: (total: number) => void;
  onFirstTrack?: (track: Track) => void;
  keyboardControlsRef?: {
    current: VirtualTrackListKeyboardControls | null;
  };
}

export interface VirtualTrackListKeyboardControls {
  moveAndPlay: (direction: -1 | 1) => void;
  playSelected: () => void;
}

export function VirtualTrackList({
  api,
  query,
  revision,
  currentTrackId,
  followCurrentTrackIndex,
  playing,
  favorites,
  onPlay,
  onFavorite,
  onContextMenu,
  onTotal,
  onFirstTrack,
  keyboardControlsRef,
}: VirtualTrackListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const latest = useRef({
    query,
    onPlay,
    onFavorite,
    onContextMenu,
    onTotal,
    onFirstTrack,
  });
  const queryKey = useMemo(
    () =>
      JSON.stringify({
        search: query.search ?? "",
        collection: query.collection ?? "",
        tag: query.tag ?? "",
        tags: query.tags ?? [],
        sort: query.sort ?? "title",
        descending: query.descending ?? false,
        favoriteIds: query.favoriteIds,
      }),
    [query],
  );
  const cache = useMemo<LibraryCache>(
    () => ({
      query: JSON.parse(queryKey) as LibraryQuery,
      pages: new Map(),
      requests: new Map(),
      errors: new Map(),
      total: null,
      active: false,
      firstReported: false,
    }),
    [api, queryKey, revision],
  );
  const activeCache = useRef(cache);
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const activeRequests = useRef(0);
  const pendingActivation = useRef<{
    cache: LibraryCache;
    index: number;
  } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const selectedIndex = useRef(0);
  const [selected, setSelected] = useState(0);
  const keyboardNavigation = useRef(false);
  const visiblePages = useRef({ first: 0, last: 0 });
  const listId = useId();
  const previousQueryKey = useRef(queryKey);

  useLayoutEffect(() => {
    latest.current = {
      query,
      onPlay,
      onFavorite,
      onContextMenu,
      onTotal,
      onFirstTrack,
    };
  });

  useLayoutEffect(() => {
    activeCache.current = cache;
    cache.active = true;
    pendingActivation.current = null;
    if (previousQueryKey.current !== queryKey) {
      selectedIndex.current = 0;
      setSelected(0);
      setScrollTop(0);
      if (listRef.current) listRef.current.scrollTop = 0;
    }
    previousQueryKey.current = queryKey;
    latest.current.onTotal(0);
    return () => {
      cache.active = false;
    };
  }, [cache, queryKey]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const resize = () => setHeight(Math.max(rowHeight, list.clientHeight));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const loadPage = useCallback(
    (page: number, retry = false): Promise<Track[] | null> => {
      if (!cache.active || activeCache.current !== cache || page < 0)
        return Promise.resolve(null);

      const cached = cache.pages.get(page);
      if (cached) {
        // Touch the page so eviction behaves like a small LRU cache.
        cache.pages.delete(page);
        cache.pages.set(page, cached);
        return Promise.resolve(cached);
      }

      const request = cache.requests.get(page);
      if (request) return request;

      if (cache.errors.has(page) && !retry) return Promise.resolve(null);
      if (cache.total !== null && page * pageSize >= cache.total)
        return Promise.resolve(null);
      if (cache.errors.has(page)) cache.errors.delete(page);
      if (activeRequests.current >= maxConcurrentRequests)
        return Promise.resolve(null);

      activeRequests.current += 1;
      const nextRequest = Promise.resolve()
        .then(() =>
          api.queryLibrary({
            ...cache.query,
            offset: page * pageSize,
            limit: pageSize,
          }),
        )
        .then((result) => {
          if (!cache.active || activeCache.current !== cache) return null;

          cache.total = result.total;
          cache.pages.set(page, result.items);
          while (cache.pages.size > pageCacheLimit) {
            const evicted =
              [...cache.pages.keys()].find(
                (key) =>
                  key < visiblePages.current.first ||
                  key > visiblePages.current.last,
              ) ?? cache.pages.keys().next().value;
            if (evicted === undefined) break;
            cache.pages.delete(evicted);
          }

          latest.current.onTotal(result.total);
          if (page === 0 && result.items[0] && !cache.firstReported) {
            cache.firstReported = true;
            latest.current.onFirstTrack?.(result.items[0]);
          }
          if (selectedIndex.current >= result.total && result.total > 0) {
            selectedIndex.current = result.total - 1;
            setSelected(result.total - 1);
          }
          return result.items;
        })
        .catch((reason: unknown) => {
          if (cache.active && activeCache.current === cache) {
            cache.errors.set(
              page,
              reason instanceof Error
                ? reason.message
                : "Unable to load tracks.",
            );
          }
          return null;
        })
        .finally(() => {
          cache.requests.delete(page);
          activeRequests.current -= 1;
          if (activeCache.current.active) rerender();
        });

      cache.requests.set(page, nextRequest);
      return nextRequest;
    },
    [api, cache],
  );

  const total = cache.total;
  const visibleFirst = Math.max(
    0,
    Math.floor(scrollTop / rowHeight) - overscanRows,
  );
  const visibleLast = Math.min(
    total ?? 0,
    Math.ceil((scrollTop + height) / rowHeight) + overscanRows,
  );
  const firstPage = Math.floor(visibleFirst / pageSize);
  const lastPage = Math.floor(
    Math.max(visibleFirst, visibleLast - 1) / pageSize,
  );
  visiblePages.current = { first: firstPage, last: lastPage };

  useEffect(() => {
    if (total === null) {
      void loadPage(0);
      return;
    }
    if (!total) return;

    const pending = pendingActivation.current;
    if (pending?.cache === cache && pending.index === selectedIndex.current) {
      const page = Math.floor(pending.index / pageSize);
      const track = cache.pages.get(page)?.[pending.index % pageSize];
      if (track) {
        pendingActivation.current = null;
        latest.current.onPlay(track, pending.index);
      } else if (cache.errors.has(page)) {
        pendingActivation.current = null;
      } else {
        void loadPage(page);
      }
    }

    for (let page = firstPage; page <= lastPage; page += 1) void loadPage(page);
    void loadPage(lastPage + 1);
    if (firstPage > 0) void loadPage(firstPage - 1);
  }, [cache, firstPage, lastPage, loadPage, rerender, total]);

  const select = useCallback(
    (index: number, center = false) => {
      if (!total) return;
      const next = Math.max(0, Math.min(total - 1, index));
      if (pendingActivation.current?.index !== next)
        pendingActivation.current = null;
      selectedIndex.current = next;
      setSelected(next);

      const list = listRef.current;
      if (list) {
        const top = next * rowHeight;
        const bottom = top + rowHeight;
        if (center) {
          const maxScroll = Math.max(0, total * rowHeight - list.clientHeight);
          list.scrollTop = Math.max(
            0,
            Math.min(maxScroll, top - (list.clientHeight - rowHeight) / 2),
          );
        } else if (top < list.scrollTop) {
          list.scrollTop = top;
        } else if (bottom > list.scrollTop + list.clientHeight) {
          list.scrollTop = bottom - list.clientHeight;
        }
        setScrollTop(list.scrollTop);
      }
      void loadPage(Math.floor(next / pageSize));
    },
    [loadPage, total],
  );

  useEffect(() => {
    if (followCurrentTrackIndex !== undefined)
      select(followCurrentTrackIndex, true);
  }, [followCurrentTrackIndex, select]);

  const getTrack = (index: number) =>
    cache.pages.get(Math.floor(index / pageSize))?.[index % pageSize];

  const choose = useCallback(
    (index: number) => {
      if (
        !cache.active ||
        activeCache.current !== cache ||
        selectedIndex.current !== index ||
        !total
      )
        return;
      const page = Math.floor(index / pageSize);
      const track = getTrack(index);
      if (track) {
        pendingActivation.current = null;
        latest.current.onPlay(track, index);
      } else {
        pendingActivation.current = { cache, index };
        void loadPage(page, true);
      }
    },
    [cache, loadPage, total],
  );

  const focusList = useCallback(() => {
    listRef.current?.focus();
  }, []);
  const playSelected = useCallback(() => {
    focusList();
    choose(selectedIndex.current);
  }, [choose, focusList]);
  const moveAndPlay = useCallback(
    (direction: -1 | 1) => {
      if (!total) return;
      const next = Math.max(
        0,
        Math.min(total - 1, selectedIndex.current + direction),
      );
      focusList();
      select(next, true);
      choose(next);
    },
    [choose, focusList, select, total],
  );

  useLayoutEffect(() => {
    if (!keyboardControlsRef) return;
    const controls = { moveAndPlay, playSelected };
    keyboardControlsRef.current = controls;
    return () => {
      if (keyboardControlsRef.current === controls)
        keyboardControlsRef.current = null;
    };
  }, [keyboardControlsRef, moveAndPlay, playSelected]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("button"))
      return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const page = Math.max(1, Math.floor(height / rowHeight));
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = selectedIndex.current + 1;
        break;
      case "ArrowUp":
        next = selectedIndex.current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = (total ?? 1) - 1;
        break;
      case "PageDown":
        next = selectedIndex.current + page;
        break;
      case "PageUp":
        next = selectedIndex.current - page;
        break;
      case "Enter":
        event.preventDefault();
        event.stopPropagation();
        choose(selectedIndex.current);
        return;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    select(next, event.key === "ArrowDown" || event.key === "ArrowUp");
    if (event.key === "ArrowDown" || event.key === "ArrowUp")
      keyboardNavigation.current = true;
  };

  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("button"))
      return;
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.key !== "ArrowDown" && event.key !== "ArrowUp") ||
      !keyboardNavigation.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    keyboardNavigation.current = false;
    choose(selectedIndex.current);
  };

  const rows = [];
  for (let index = visibleFirst; index < visibleLast; index += 1) {
    const track = getTrack(index);
    const current = Boolean(track && track.id === currentTrackId);
    const error = cache.errors.get(Math.floor(index / pageSize));
    rows.push(
      <div
        id={`${listId}-track-${index}`}
        key={track?.id ?? `loading-${index}`}
        className={
          "track-row" +
          (current ? " is-current" : "") +
          (selected === index ? " is-selected" : "") +
          (track ? "" : " row-placeholder")
        }
        role="option"
        aria-selected={selected === index}
        aria-posinset={index + 1}
        aria-setsize={total ?? undefined}
        aria-disabled={!track || undefined}
        aria-label={
          track
            ? track.title +
              ", " +
              track.artist +
              (current ? ", current track" : "")
            : "Loading track " + (index + 1)
        }
        style={{
          position: "absolute",
          top: index * rowHeight,
          height: rowHeight,
          left: 0,
          right: 0,
        }}
        onClick={() => {
          if (!track) return;
          select(index);
          listRef.current?.focus({ preventScroll: true });
          choose(index);
        }}
        onContextMenu={(event) => {
          if (!track) return;
          event.preventDefault();
          event.stopPropagation();
          select(index);
          listRef.current?.focus({ preventScroll: true });
          latest.current.onContextMenu(track, event.clientX, event.clientY);
        }}
      >
        {track ? (
          <>
            <span className="track-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <TrackArt track={track} playing={current && playing} />
            <div className="track-details">
              <div className="track-title" title={track.title}>
                {track.title}
              </div>
              <div className="track-artist" title={track.artist}>
                {track.artist}
              </div>
            </div>
            <span className="track-duration">
              {formatDuration(track.duration)}
            </span>
            <button
              type="button"
              className={
                "track-favorite" +
                (favorites.has(track.id) ? " is-favorite" : "")
              }
              aria-label={
                (favorites.has(track.id) ? "Remove " : "Add ") +
                track.title +
                (favorites.has(track.id) ? " from favorites" : " to favorites")
              }
              aria-pressed={favorites.has(track.id)}
              title={
                favorites.has(track.id) ? "Remove favorite" : "Add favorite"
              }
              onClick={(event) => {
                event.stopPropagation();
                latest.current.onFavorite(track);
              }}
            >
              <Heart
                size={17}
                fill={favorites.has(track.id) ? "currentColor" : "none"}
              />
            </button>
          </>
        ) : (
          <>
            <span className="track-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="track-art art-fallback" aria-hidden="true">
              <Music2 size={22} />
            </span>
            <div className="track-details">
              <div className="track-title">
                {error ? "Unable to load track" : "Loading…"}
              </div>
            </div>
            {error && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void loadPage(Math.floor(index / pageSize), true);
                }}
              >
                Retry
              </button>
            )}
          </>
        )}
      </div>,
    );
  }

  const firstError = total === null ? cache.errors.get(0) : undefined;
  return (
    <div
      className="track-list"
      ref={listRef}
      role="listbox"
      aria-label="Music library"
      tabIndex={-1}
      aria-busy={total === null && !firstError}
      aria-activedescendant={
        selected >= visibleFirst && selected < visibleLast
          ? `${listId}-track-${selected}`
          : undefined
      }
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {total === null ? (
        <div className="list-state" role={firstError ? "alert" : "status"}>
          {firstError ? (
            <>
              <CircleAlert size={28} />
              <strong>Couldn’t load your music</strong>
              <p>{firstError}</p>
              <button type="button" onClick={() => void loadPage(0, true)}>
                Try again
              </button>
            </>
          ) : (
            <>
              <LoaderCircle className="spin" size={28} />
              <span>Loading your music…</span>
            </>
          )}
        </div>
      ) : total === 0 ? (
        <div className="list-state" role="status">
          <SearchX size={30} />
          <strong>No tracks found</strong>
          <p>Try another search or filter.</p>
        </div>
      ) : (
        <div style={{ height: total * rowHeight, position: "relative" }}>
          {rows}
        </div>
      )}
    </div>
  );
}
