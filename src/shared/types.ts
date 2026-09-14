export type RepeatMode = "off" | "all" | "one";

export type SortKey =
  | "title"
  | "artist"
  | "duration"
  | "bpm"
  | "added"
  | "stars"
  | "collection"
  | "tags";

export interface Track {
  id: string;
  title: string;
  titleUnicode?: string;
  artist: string;
  artistUnicode?: string;
  source: string;
  tags: string[];
  collections: string[];
  duration: number;
  bpm: number;
  stars: number;
  difficultyCount: number;
  audioUrl: string;
  audioHash?: string;
  artworkUrl?: string;
  backgroundHash?: string;
  videoUrl?: string;
  videoHash?: string;
  videoOffset?: number;
  onlineId?: number;
  md5Hash?: string;
  addedAt: number;
}

export interface LibraryFacet {
  name: string;
  count: number;
}

export interface LibrarySummary {
  trackCount: number;
  beatmapCount: number;
  collectionCount: number;
  collections: LibraryFacet[];
  tags: LibraryFacet[];
  installPath: string;
  skippedCount: number;
}

export interface LibraryQuery {
  search?: string;
  collection?: string;
  tag?: string;
  tags?: string[];
  sort?: SortKey;
  descending?: boolean;
  favoriteIds?: string[];
  offset?: number;
  limit?: number;
}

export interface LibraryPage {
  items: Track[];
  total: number;
  offset: number;
}

export interface TrackLocation {
  track: Track;
  index: number;
}

export interface TrackContextMenuInfo {
  audio: boolean;
  background: boolean;
  video: boolean;
  listing: boolean;
}

export type TrackContextMenuAction =
  | "copy-title"
  | "copy-title-unicode"
  | "copy-artist"
  | "copy-artist-unicode"
  | "copy-audio"
  | "copy-audio-path"
  | "copy-background"
  | "copy-background-path"
  | "copy-video"
  | "copy-video-path"
  | "copy-online-id"
  | "copy-md5"
  | "open-listing"
  | "open-audio"
  | "open-background"
  | "open-video";

export type LibraryProgress =
  | { phase: "reading" | "indexing"; records: number }
  | {
      phase: "reading";
      records: number;
      summary: LibrarySummary;
    };

export type MediaAction =
  | "stop"
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous";

export interface PlayerAPI {
  loadLibrary: (installPath?: string) => Promise<LibrarySummary>;
  queryLibrary: (query?: LibraryQuery) => Promise<LibraryPage>;
  getTrack: (id: string) => Promise<Track | null>;
  getTrackLocation?: (
    id: string,
    query?: LibraryQuery,
  ) => Promise<TrackLocation | null>;
  prepareVideo: (trackId: string) => Promise<string | null>;
  chooseLibrary: () => Promise<string | null>;
  onLibraryProgress: (listener: (progress: LibraryProgress) => void) => () => void;
  onMediaAction: (listener: (action: MediaAction) => void) => () => void;
  onFullscreenChange: (listener: (active: boolean) => void) => () => void;
  onZoomChange: (listener: (percent: number) => void) => () => void;
  getTrackContextMenuInfo: (
    trackId: string,
  ) => Promise<TrackContextMenuInfo | null>;
  performTrackContextMenuAction: (
    trackId: string,
    action: TrackContextMenuAction,
  ) => Promise<void>;
  windowControl: (action: "minimize" | "maximize" | "fullscreen" | "close") => void;
  platform: string;
}

declare global {
  interface Window {
    playerAPI?: PlayerAPI;
  }
}

export {};
