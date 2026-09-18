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
  LibraryQuery,
  LibrarySummary,
  PlayerAPI,
  SortKey,
  Track,
  TrackContextMenuInfo,
} from "../../shared/types";
import { FacetPicker } from "./FacetPicker";
import { SortPicker } from "./SortPicker";
import {
  VirtualTrackList,
  type VirtualTrackListKeyboardControls,
} from "./VirtualTrackList";

export type LibraryTab = "all" | "favorites";

export interface LibraryPanelProps {
  api: PlayerAPI;
  libraryRef: RefObject<HTMLElement | null>;
  libraryHidden: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  searchDraft: string;
  setSearchDraft: Dispatch<SetStateAction<string>>;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  importing: boolean;
  refreshLibrary: () => Promise<void>;
  summary: LibrarySummary | null;
  tab: LibraryTab;
  setTab: Dispatch<SetStateAction<LibraryTab>>;
  favorites: Set<string>;
  tags: string[];
  setTags: Dispatch<SetStateAction<string[]>>;
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
  chooseLibrary: () => Promise<void>;
  query: LibraryQuery;
  revision: number;
  currentTrackId: string | undefined;
  followCurrentTrackIndex: number | undefined;
  libraryReady: boolean;
  playing: boolean;
  showTitleUnicode: boolean;
  showArtistUnicode: boolean;
  onPlay: (track: Track, index: number) => void;
  onFavorite: (track: Track) => void;
  onContextMenu: (track: Track, x: number, y: number) => void;
  onTotal: (total: number) => void;
  onFirstTrack: (track: Track) => void;
  keyboardControlsRef: RefObject<VirtualTrackListKeyboardControls | null>;
  resultTotal: number;
}

export function LibraryPanel({
  api,
  libraryRef,
  libraryHidden,
  searchRef,
  searchDraft,
  setSearchDraft,
  onSearchKeyDown,
  importing,
  refreshLibrary,
  summary,
  tab,
  setTab,
  favorites,
  tags,
  setTags,
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
  chooseLibrary,
  query,
  revision,
  currentTrackId,
  followCurrentTrackIndex,
  libraryReady,
  playing,
  showTitleUnicode,
  showArtistUnicode,
  onPlay,
  onFavorite,
  onContextMenu,
  onTotal,
  onFirstTrack,
  keyboardControlsRef,
  resultTotal,
}: LibraryPanelProps) {
  return (
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
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setSearchDraft(event.target.value)
            }
            onKeyDown={onSearchKeyDown}
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
          onClick={() => void refreshLibrary()}
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="library-tabs" role="tablist" aria-label="Library view">
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
              ? tags.map((value) => "#" + value).join(", ")
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
              onClick={() => void refreshLibrary()}
            >
              Try again
            </button>
          </div>
        ) : summary ? (
          <VirtualTrackList
            api={api}
            query={query}
            revision={revision}
            currentTrackId={currentTrackId}
            followCurrentTrackIndex={followCurrentTrackIndex}
            libraryReady={libraryReady}
            playing={playing}
            showTitleUnicode={showTitleUnicode}
            showArtistUnicode={showArtistUnicode}
            favorites={favorites}
            onPlay={onPlay}
            onFavorite={onFavorite}
            onContextMenu={onContextMenu}
            onTotal={onTotal}
            onFirstTrack={onFirstTrack}
            keyboardControlsRef={keyboardControlsRef}
          />
        ) : null}
      </div>

      <div className="library-footer">
        <span>
          <i />
          {importing
            ? (summary?.trackCount ?? 0).toLocaleString() + " songs loaded"
            : resultTotal.toLocaleString() +
              (hasFilters ? " songs found" : " songs in your library")}
        </span>
      </div>
    </section>
  );
}
