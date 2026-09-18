export type RepeatMode = "off" | "all" | "one";

export type SortKey =
  | "title"
  | "artist"
  | "duration"
  | "bpm"
  | "added"
  | "dateAdded"
  | "dateSubmitted"
  | "dateRanked"
  | "lastPlayed"
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
  dateAddedAt?: number;
  dateSubmittedAt?: number;
  dateRankedAt?: number;
  lastPlayedAt?: number;
}

/** A media asset's technical metadata used by the now-playing debug widget. */
export interface TrackDebugMediaInfo {
  /** The original asset filename without its parent directories. */
  name: string;
  /** The resolved absolute path on disk. */
  path: string;
  hash: string;
  fileSize: number;
  duration: number | null;
  resolution: { width: number; height: number } | null;
  frameRate: number | null;
  codec: string | null;
  bitrate: number | null;
}

export interface TrackDebugInfo {
  audio: TrackDebugMediaInfo | null;
  background: TrackDebugMediaInfo | null;
  video: TrackDebugMediaInfo | null;
  encodedVideo?: TrackDebugMediaInfo | null;
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
  "stop" | "play" | "pause" | "toggle" | "next" | "previous";

export type CacheKind = "index" | "video";

export interface CacheUsage {
  index: number;
  video: number;
}

export type VideoEncodingQuality =
  "very-low" | "low" | "medium" | "high" | "very-high";
export type VideoEncodingCodec =
  "auto" | "av1" | "hevc" | "h264-hardware" | "h264-software";

export type VideoMaxFps = 0 | 24 | 30 | 60;
export type VideoSource = "none" | "Original" | "Cache" | "HLS";

export interface VideoEncodingSettings {
  codec: VideoEncodingCodec;
  quality: VideoEncodingQuality;
  maxFps: VideoMaxFps;
  forceRemux: boolean;
  /** Converted-video cache size in GiB. 0 disables caching; -1 is unlimited. */
  cacheLimitGb: number;
}

export interface VideoEncodingStatus {
  hash: string;
  encoding: boolean;
  /** FFmpeg encoder name, or "stream copy" when remuxing. */
  encoder?: string;
  /** Encoding completion from 0 to 1 when the source duration is known. */
  progress?: number;
  /** The HLS stream has been finalized into its cached MP4. */
  finalized?: boolean;
}

export interface PreparedVideo {
  url: string;
  /** True only while the URL is serving the shared HLS playlist. */
  streaming: boolean;
}

export interface PlayerAPI {
  loadLibrary: (
    installPath?: string,
    priorityTrackId?: string,
  ) => Promise<LibrarySummary>;
  /** Loads only a valid disk cache. Returns null without scanning Realm on a miss. */
  loadCachedLibrary?: (installPath?: string) => Promise<LibrarySummary | null>;
  queryLibrary: (query?: LibraryQuery) => Promise<LibraryPage>;
  getTrack: (id: string) => Promise<Track | null>;
  getTrackDebugInfo: (
    id: string,
    videoSource?: VideoSource,
  ) => Promise<TrackDebugInfo | null>;
  copyText?: (value: string) => Promise<void>;
  getTrackLocation?: (
    id: string,
    query?: LibraryQuery,
  ) => Promise<TrackLocation | null>;
  prepareVideo: (
    trackId: string,
    settings?: VideoEncodingSettings,
  ) => Promise<PreparedVideo | null>;
  cancelVideoEncoding: () => Promise<void>;
  completeVideoStream: (hash: string) => Promise<void>;
  getCacheUsage: () => Promise<CacheUsage>;
  clearCache: (kind: CacheKind) => Promise<void>;
  chooseLibrary: () => Promise<string | null>;
  onLibraryProgress: (
    listener: (progress: LibraryProgress) => void,
  ) => () => void;
  onMediaAction: (listener: (action: MediaAction) => void) => () => void;
  onVideoEncodingChange: (
    listener: (status: VideoEncodingStatus) => void,
  ) => () => void;
  onFullscreenChange: (listener: (active: boolean) => void) => () => void;
  onZoomChange: (listener: (percent: number) => void) => () => void;
  getTrackContextMenuInfo: (
    trackId: string,
  ) => Promise<TrackContextMenuInfo | null>;
  performTrackContextMenuAction: (
    trackId: string,
    action: TrackContextMenuAction,
  ) => Promise<void>;
  windowControl: (
    action: "minimize" | "maximize" | "fullscreen" | "close",
  ) => void;
  /** Signals that the first renderer frame has been composed. */
  windowReady?: () => void;
  platform: string;
}

declare global {
  interface Window {
    playerAPI?: PlayerAPI;
  }
}

export {};
