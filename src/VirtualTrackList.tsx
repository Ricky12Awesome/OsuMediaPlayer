import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Disc3,
  Heart,
  LoaderCircle,
  Music2,
  SearchX,
} from "lucide-react";
import type { LibraryQuery, PlayerAPI, Track } from "../shared/types";

const pageSize = 64;
const rowHeight = 86;

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  return (
    Math.floor(seconds / 60) +
    ":" +
    String(seconds % 60).padStart(2, "0")
  );
}

function TrackArt({ track, playing }: { track: Track; playing: boolean }) {
  const [failed, setFailed] = useState(false);
  const hasArt = Boolean(track.artworkUrl) && !failed;
  return (
    <div className={"track-art" + (hasArt ? "" : " art-fallback")} aria-hidden="true">
      {hasArt ? (
        <img
          src={track.artworkUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <Music2 size={22} />
      )}
      {playing && (
        <span className="playing-bars">
          <span />
          <span />
          <span />
        </span>
      )}
    </div>
  );
}

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
  onTotal: (total: number) => void;
  onFirstTrack?: (track: Track) => void;
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
  onTotal,
  onFirstTrack,
}: VirtualTrackListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const latest = useRef({
    query,
    onPlay,
    onFavorite,
    onTotal,
    onFirstTrack,
  });
  latest.current = { query, onPlay, onFavorite, onTotal, onFirstTrack };
  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const [pages, setPages] = useState<Map<number, Track[]>>(new Map());
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [total, setTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [loading, setLoading] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    setPages(new Map());
    setErrors(new Map());
    setTotal(null);
    setSelected(0);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
    latest.current.onTotal(0);
  }, [queryKey, revision]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const resize = () => setHeight(Math.max(rowHeight, list.clientHeight));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const loadPage = useCallback(
    async (page: number, retry = false) => {
      if (page < 0 || loading) return;
      if (!retry && (pages.has(page) || errors.has(page))) return;
      if (total !== null && page * pageSize >= total) return;
      setLoading(true);
      try {
        const result = await api.queryLibrary({
          ...latest.current.query,
          offset: page * pageSize,
          limit: pageSize,
        });
        setTotal(result.total);
        latest.current.onTotal(result.total);
        setPages((current) => {
          const next = new Map(current);
          next.set(page, result.items);
          return next;
        });
        setErrors((current) => {
          const next = new Map(current);
          next.delete(page);
          return next;
        });
        if (page === 0 && result.items[0]) latest.current.onFirstTrack?.(result.items[0]);
      } catch (reason) {
        setErrors((current) => {
          const next = new Map(current);
          next.set(
            page,
            reason instanceof Error ? reason.message : "Unable to load tracks.",
          );
          return next;
        });
      } finally {
        setLoading(false);
      }
    },
    [api, errors, loading, pages, total],
  );

  useEffect(() => {
    void loadPage(0, retryToken > 0);
  }, [loadPage, retryToken]);

  const visibleFirst = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const visibleLast = Math.min(
    total ?? 0,
    Math.ceil((scrollTop + height) / rowHeight) + 5,
  );
  const firstPage = Math.floor(visibleFirst / pageSize);
  const lastPage = Math.floor(Math.max(visibleFirst, visibleLast - 1) / pageSize);

  useEffect(() => {
    for (let page = firstPage; page <= lastPage; page++) void loadPage(page);
  }, [firstPage, lastPage, loadPage]);

  useEffect(() => {
    if (followCurrentTrackIndex === undefined || total === null) return;
    const next = Math.max(0, Math.min(total - 1, followCurrentTrackIndex));
    setSelected(next);
    listRef.current?.scrollTo({
      top: Math.max(0, next * rowHeight - (height - rowHeight) / 2),
    });
  }, [followCurrentTrackIndex, height, total]);

  const getTrack = (index: number) =>
    pages.get(Math.floor(index / pageSize))?.[index % pageSize];
  const choose = (index: number) => {
    const track = getTrack(index);
    setSelected(index);
    if (track) latest.current.onPlay(track, index);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest("button") ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    let next: number | undefined;
    const page = Math.max(1, Math.floor(height / rowHeight));
    if (event.key === "ArrowDown") next = selected + 1;
    else if (event.key === "ArrowUp") next = selected - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = (total ?? 1) - 1;
    else if (event.key === "PageDown") next = selected + page;
    else if (event.key === "PageUp") next = selected - page;
    else if (event.key === "Enter") {
      event.preventDefault();
      choose(selected);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    const maximum = Math.max(0, (total ?? 1) - 1);
    const clamped = Math.max(0, Math.min(maximum, next));
    setSelected(clamped);
    listRef.current?.scrollTo({
      top:
        clamped * rowHeight < (listRef.current?.scrollTop ?? 0)
          ? clamped * rowHeight
          : clamped * rowHeight + rowHeight > (listRef.current?.scrollTop ?? 0) + height
            ? clamped * rowHeight - height + rowHeight
            : listRef.current?.scrollTop ?? 0,
    });
  };

  const firstError = total === null ? errors.get(0) : undefined;
  if (total === null)
    return (
      <div className="track-list list-state" role={firstError ? "alert" : "status"}>
        {firstError ? (
          <>
            <CircleAlert size={28} />
            <strong>Couldn’t load your music</strong>
            <p>{firstError}</p>
            <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
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
    );
  if (total === 0)
    return (
      <div className="track-list list-state" role="status">
        <SearchX size={30} />
        <strong>No tracks found</strong>
        <p>Try another search or filter.</p>
      </div>
    );

  const rows = [];
  for (let index = visibleFirst; index < visibleLast; index++) {
    const track = getTrack(index);
    const current = Boolean(track && track.id === currentTrackId);
    const error = errors.get(Math.floor(index / pageSize));
    rows.push(
      <div
        key={track?.id ?? "loading-" + index}
        className={
          "track-row" +
          (current ? " is-current" : "") +
          (selected === index ? " is-selected" : "") +
          (track ? "" : " row-placeholder")
        }
        role="option"
        aria-selected={selected === index}
        aria-posinset={index + 1}
        aria-setsize={total}
        aria-label={
          track
            ? track.title + ", " + track.artist + (current ? ", current track" : "")
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
          if (track) {
            setSelected(index);
            listRef.current?.focus({ preventScroll: true });
            choose(index);
          }
        }}
      >
        <span className="track-number" aria-hidden="true">
          String(index + 1).padStart(2, "0")
        </span>
        {track ? (
          <>
            <TrackArt track={track} playing={current && playing} />
            <div className="track-details">
              <div className="track-title" title={track.title}>
                {track.title}
              </div>
              <div className="track-artist" title={track.artist}>
                {track.artist}
              </div>
              <div className="track-meta">
                {Math.round(track.bpm)} <span>BPM</span>
              </div>
            </div>
            <span className="track-duration">{formatDuration(track.duration)}</span>
            <button
              type="button"
              className={"track-favorite" + (favorites.has(track.id) ? " is-favorite" : "")}
              aria-label={
                (favorites.has(track.id) ? "Remove " : "Add ") +
                track.title +
                (favorites.has(track.id) ? " from favorites" : " to favorites")
              }
              aria-pressed={favorites.has(track.id)}
              title={favorites.has(track.id) ? "Remove favorite" : "Add favorite"}
              onClick={(event) => {
                event.stopPropagation();
                latest.current.onFavorite(track);
              }}
            >
              <Heart size={17} fill={favorites.has(track.id) ? "currentColor" : "none"} />
            </button>
          </>
        ) : (
          <>
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

  return (
    <div
      className="track-list"
      ref={listRef}
      role="listbox"
      aria-label="Music library"
      tabIndex={-1}
      aria-busy={loading}
      onKeyDown={onKeyDown}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: total * rowHeight, position: "relative" }}>{rows}</div>
    </div>
  );
}
