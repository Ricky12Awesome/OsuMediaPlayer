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
  artworkUrl?: string;
  videoUrl?: string;
  videoOffset?: number;
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

export type LibraryProgress =
  | { phase: "downloading" | "reading" | "indexing"; records: number }
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
  prepareVideo: (trackId: string) => Promise<string | null>;
  chooseLibrary: () => Promise<string | null>;
  onLibraryProgress: (listener: (progress: LibraryProgress) => void) => () => void;
  onMediaAction: (listener: (action: MediaAction) => void) => () => void;
  onFullscreenChange: (listener: (active: boolean) => void) => () => void;
  onZoomChange: (listener: (percent: number) => void) => () => void;
  windowControl: (action: "minimize" | "maximize" | "fullscreen" | "close") => void;
  platform: string;
}

declare global {
  interface Window {
    playerAPI?: PlayerAPI;
  }
}

export {};
