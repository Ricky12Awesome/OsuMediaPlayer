import type {
  ChangeEvent,
  Dispatch,
  KeyboardEvent,
  RefObject,
  SetStateAction,
} from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  CircleAlert,
  FolderHeart,
  FolderOpen,
  Heart,
  Music2,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import type {
  SongListQuery,
  SongListSummary,
  PlayerAPI,
  SortKey,
  TagMatchMode,
  Song,
  SongContextMenuInfo,
} from "../../shared/types";
import { FacetPicker } from "./FacetPicker";
import { SortPicker } from "./SortPicker";
import {
  VirtualSongList,
  type VirtualSongListKeyboardControls,
} from "./VirtualSongList";

export type SongListTab = "all" | "favorites";

export interface SongListPanelProps {
  api: PlayerAPI;
  songListRef: RefObject<HTMLElement | null>;
  songListHidden: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  searchDraft: string;
  setSearchDraft: Dispatch<SetStateAction<string>>;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  importing: boolean;
  refreshSongList: () => Promise<void>;
  summary: SongListSummary | null;
  tab: SongListTab;
  setTab: Dispatch<SetStateAction<SongListTab>>;
  favorites: Set<string>;
  tags: string[];
  setTags: Dispatch<SetStateAction<string[]>>;
  tagMatch: TagMatchMode;
  setTagMatch: Dispatch<SetStateAction<TagMatchMode>>;
  collection: string;
  setCollection: Dispatch<SetStateAction<string>>;
  sort: SortKey;
  sortOptions: Array<{ value: SortKey; label: string }>;
  onSort: (sort: SortKey) => void;
  descending: boolean;
  setDescending: Dispatch<SetStateAction<boolean>>;
  hasFilters: boolean;
  search: string;
  clearFilters: () => void;
  loadError: string;
  chooseSongList: () => Promise<void>;
  query: SongListQuery;
  revision: number;
  currentSongId: string | undefined;
  followCurrentSongIndex: number | undefined;
  songListReady: boolean;
  playing: boolean;
  showTitleUnicode: boolean;
  showArtistUnicode: boolean;
  onPlay: (song: Song, index: number) => void;
  onFavorite: (song: Song) => void;
  onContextMenu: (song: Song, x: number, y: number) => void;
  onTotal: (total: number) => void;
  onFirstSong: (song: Song) => void;
  keyboardControlsRef: RefObject<VirtualSongListKeyboardControls | null>;
  resultTotal: number;
}

export function SongListPanel({
  api,
  songListRef,
  songListHidden,
  searchRef,
  searchDraft,
  setSearchDraft,
  onSearchKeyDown,
  importing,
  refreshSongList,
  summary,
  tab,
  setTab,
  favorites,
  tags,
  setTags,
  tagMatch,
  setTagMatch,
  collection,
  setCollection,
  sort,
  sortOptions,
  onSort,
  descending,
  setDescending,
  hasFilters,
  search,
  clearFilters,
  loadError,
  chooseSongList,
  query,
  revision,
  currentSongId,
  followCurrentSongIndex,
  songListReady,
  playing,
  showTitleUnicode,
  showArtistUnicode,
  onPlay,
  onFavorite,
  onContextMenu,
  onTotal,
  onFirstSong,
  keyboardControlsRef,
  resultTotal,
}: SongListPanelProps) {
  return (
    <section
      ref={songListRef}
      className="song-list-panel"
      aria-label="Song list"
      aria-hidden={songListHidden}
      inert={songListHidden || undefined}
    >
      <div className="song-list-search-row">
        <div className="search-box">
          <Search size={19} />
          <input
            ref={searchRef}
            value={searchDraft}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setSearchDraft(event.target.value)
            }
            onKeyDown={onSearchKeyDown}
            placeholder="Search songs or try length>=120"
            aria-label="Search song list"
            title="Search filters: artist, title, source, bpm, length, lastplayed, played, created, submitted, ranked, status, tag. Example: status=r,l length>=120"
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
          title="Refresh song list"
          aria-label="Refresh song list"
          disabled={importing}
          onClick={() => void refreshSongList()}
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <div
        className="panel-tabs song-list-tabs"
        role="tablist"
        aria-label="Song list view"
      >
        <button
          role="tab"
          aria-selected={tab === "all"}
          className={"panel-tab " + (tab === "all" ? "active" : "")}
          onClick={() => setTab("all")}
        >
          <Music2 size={15} /> All songs
        </button>
        <button
          role="tab"
          aria-selected={tab === "favorites"}
          className={"panel-tab " + (tab === "favorites" ? "active" : "")}
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
          matchMode={tagMatch}
          onMatchModeChange={setTagMatch}
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
            <SortPicker value={sort} options={sortOptions} onChange={onSort} />
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
              ? tags
                  .map((value) => "#" + value)
                  .join(tagMatch === "any" ? " or " : " + ")
              : collection ||
                (tab === "favorites" ? "Your favorites" : "“" + search + "”")}
          </span>
          <button onClick={clearFilters}>
            Clear filters <X size={12} />
          </button>
        </div>
      )}

      <div className="list-area">
        {loadError ? (
          <div className="song-list-state error-state">
            <CircleAlert size={35} />
            <h3>Let’s find your music</h3>
            <p>{loadError}</p>
            <button
              className="primary-button"
              onClick={() => void chooseSongList()}
            >
              <FolderOpen size={16} /> Choose osu! folder
            </button>
            <button
              className="text-button"
              onClick={() => void refreshSongList()}
            >
              Try again
            </button>
          </div>
        ) : summary ? (
          <VirtualSongList
            api={api}
            query={query}
            revision={revision}
            currentSongId={currentSongId}
            followCurrentSongIndex={followCurrentSongIndex}
            songListReady={songListReady}
            playing={playing}
            showTitleUnicode={showTitleUnicode}
            showArtistUnicode={showArtistUnicode}
            favorites={favorites}
            onPlay={onPlay}
            onFavorite={onFavorite}
            onContextMenu={onContextMenu}
            onTotal={onTotal}
            onFirstSong={onFirstSong}
            keyboardControlsRef={keyboardControlsRef}
          />
        ) : null}
      </div>

      <div className="song-list-footer">
        <span>
          <i />
          {importing
            ? (summary?.songCount ?? 0).toLocaleString() + " songs loaded"
            : resultTotal.toLocaleString() +
              (hasFilters ? " songs found" : " songs in your song list")}
        </span>
      </div>
    </section>
  );
}
