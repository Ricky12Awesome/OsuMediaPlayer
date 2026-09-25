import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  SongListQuery,
  PlayerAPI,
  RepeatMode,
  Song,
  VideoEncodingCodec,
  VideoEncodingQuality,
  VideoMaxFps,
  VideoSource,
} from "../../shared/types";
import {
  cloneQueueQuery,
  defaultPlaybackSettings,
  navigateRandomHistory,
  navigateShuffleHistory,
  nextQueueIndex,
  type ShuffleHistory,
} from "./player-utils";
import {
  fallbackMediaArtwork,
  resolveMediaArtwork,
  type ResolvedMediaArtwork,
} from "./media-artwork";
import { displaySongArtist, displaySongTitle } from "./song-title";
import { usePlayerVideo } from "./usePlayerVideo";
import { readPreference, writePreference } from "./preferences";
import { PlayerAudioAnalysis } from "./visualizer-audio";

function readSettings() {
  return readPreference("playback");
}

function playbackError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "Press play to allow audio playback.";
  return "This song could not be played. Its audio file may be missing or unsupported. Try another song.";
}

export interface PlayerState {
  song: Song | null;
  queuedSongs: Song[];
  queueIndex: number | null;
  queueQuery: SongListQuery;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  setVolume: (volume: number) => void;
  muted: boolean;
  toggleMute: () => void;
  shuffle: boolean;
  setShuffle: React.Dispatch<React.SetStateAction<boolean>>;
  repeat: RepeatMode;
  cycleRepeat: () => void;
  playVideos: boolean;
  setPlayVideos: React.Dispatch<React.SetStateAction<boolean>>;
  videoEncodingCodec: VideoEncodingCodec;
  setVideoEncodingCodec: React.Dispatch<
    React.SetStateAction<VideoEncodingCodec>
  >;
  videoEncodingQuality: VideoEncodingQuality;
  setVideoEncodingQuality: React.Dispatch<
    React.SetStateAction<VideoEncodingQuality>
  >;
  videoMaxFps: VideoMaxFps;
  setVideoMaxFps: React.Dispatch<React.SetStateAction<VideoMaxFps>>;
  videoForceRemux: boolean;
  setVideoForceRemux: React.Dispatch<React.SetStateAction<boolean>>;
  videoCacheLimitGb: number;
  setVideoCacheLimitGb: React.Dispatch<React.SetStateAction<number>>;
  resetPlaybackSettings: () => void;
  error: string | null;
  clearError: () => void;
  loading: boolean;
  playSong: (song: Song, query?: SongListQuery, index?: number) => void;
  cueSong: (song: Song, query?: SongListQuery, index?: number) => void;
  addToQueue: (song: Song, query?: SongListQuery, index?: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  reset: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  jumpRandom: (direction: 1 | -1) => Promise<void>;
  audioRef: RefObject<HTMLAudioElement | null>;
  getAudioAnalyser: () => AnalyserNode | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  videoSource: VideoSource;
  videoLoading: boolean;
  videoEncoding: boolean;
  videoEncodingProgress: number | null;
  videoEncoder: string | null;
  videoError: string | null;
  handleVideoError: () => void;
}

interface QueueTrailEntry {
  song: Song;
  query: SongListQuery;
  index: number;
  manual: boolean;
}

interface QueueTrail {
  entries: QueueTrailEntry[];
  position: number;
}

export function usePlayer(
  api: PlayerAPI,
  initialSong: Song | null = null,
  showTitleUnicode = false,
  showArtistUnicode = false,
): PlayerState {
  const [audio] = useState(() => {
    const element = new Audio();
    element.crossOrigin = "anonymous";
    return element;
  });
  const audioRef = useRef<HTMLAudioElement | null>(audio);
  const [audioAnalysis] = useState(() => new PlayerAudioAnalysis(audio));
  const getAudioAnalyser = useCallback(
    () => audioAnalysis.getAnalyser(),
    [audioAnalysis],
  );
  useEffect(() => audioAnalysis.mount(), [audioAnalysis]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [settings] = useState(readSettings);
  const [song, setSong] = useState<Song | null>(initialSong);
  const [queuedSongs, setQueuedSongs] = useState<Song[]>([]);
  const [queueIndex, setQueueIndex] = useState<number | null>(
    initialSong ? 0 : null,
  );
  const [queueQuery, setQueueQuery] = useState<SongListQuery>({});
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(settings.volume);
  const [muted, setMuted] = useState(settings.muted);
  const [shuffle, setShuffle] = useState(settings.shuffle);
  const [repeat, setRepeat] = useState(settings.repeat);
  const [playVideos, setPlayVideos] = useState(settings.playVideos);
  const [videoEncodingCodec, setVideoEncodingCodec] = useState(
    settings.videoEncodingCodec,
  );
  const [videoEncodingQuality, setVideoEncodingQuality] = useState(
    settings.videoEncodingQuality,
  );
  const [videoMaxFps, setVideoMaxFps] = useState(settings.videoMaxFps);
  const [videoForceRemux, setVideoForceRemux] = useState(
    settings.videoForceRemux,
  );
  const [videoCacheLimitGb, setVideoCacheLimitGb] = useState(
    settings.videoCacheLimitGb,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSong = useRef<Song | null>(initialSong);
  const queue = useRef<{ query: SongListQuery; index: number; total?: number }>(
    {
      query: {},
      index: 0,
    },
  );
  const pendingSongs = useRef<Song[]>([]);
  const queueTrail = useRef<QueueTrail | null>(null);
  const history = useRef<number[]>([]);
  const historyPosition = useRef(-1);
  const generation = useRef(0);
  const mounted = useRef(false);
  const latestModes = useRef({ shuffle, repeat });
  const playVideosRef = useRef(playVideos);

  const updatePendingSongs = useCallback((songs: Song[]) => {
    pendingSongs.current = songs;
    setQueuedSongs(songs);
  }, []);

  latestModes.current = { shuffle, repeat };
  playVideosRef.current = playVideos;

  const syncVideo = useCallback(
    (autoPlay = !audio.paused) => {
      const video = videoRef.current;
      const current = activeSong.current;
      if (!playVideosRef.current) {
        video?.pause();
        return;
      }
      if (!video || !current?.videoUrl) return;
      const time = audio.currentTime - (current.videoOffset ?? 0);
      if (time < 0) {
        video.pause();
        if (video.readyState > 0 && video.currentTime > 0.05)
          video.currentTime = 0;
        return;
      }
      if (video.readyState === 0) return;
      const videoDuration = video.duration;
      const ended = Number.isFinite(videoDuration) && time >= videoDuration;
      const target = Number.isFinite(videoDuration)
        ? Math.min(time, Math.max(0, videoDuration - 0.01))
        : time;
      if (!video.seeking && Math.abs(video.currentTime - target) > 0.3) {
        try {
          video.currentTime = target;
        } catch {
          // The video may be changing source.
        }
      }
      video.playbackRate = audio.playbackRate;
      if (autoPlay && !ended && video.paused) void video.play().catch(() => {});
      if ((!autoPlay || ended) && !video.paused) video.pause();
    },
    [audio],
  );

  const {
    videoUrl,
    videoSource,
    videoLoading,
    videoEncoding,
    videoEncodingProgress,
    videoEncoder,
    videoError,
    resetVideo,
    handleVideoError,
  } = usePlayerVideo({
    api,
    song,
    activeSong,
    playVideos,
    videoEncodingCodec,
    videoEncodingQuality,
    videoMaxFps,
    videoForceRemux,
    videoCacheLimitGb,
    videoRef,
    syncVideo,
  });

  const reset = useCallback(() => {
    generation.current++;
    activeSong.current = null;
    queue.current = { query: {}, index: 0 };
    updatePendingSongs([]);
    queueTrail.current = null;
    history.current = [];
    historyPosition.current = -1;
    audio.pause();
    videoRef.current?.pause();
    audio.removeAttribute("src");
    audio.load();
    setSong(null);
    setQueueIndex(null);
    setQueueQuery({});
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoading(false);
    setError(null);
    resetVideo();
  }, [audio, resetVideo, updatePendingSongs]);

  const resumeGeneration = useCallback(
    async (id: number) => {
      try {
        if (id !== generation.current || !mounted.current) return;
        audioAnalysis.resume();
        await audio.play();
        if (id === generation.current && mounted.current) {
          syncVideo(true);
          setError(null);
        }
      } catch (reason) {
        if (
          id !== generation.current ||
          !mounted.current ||
          (reason instanceof DOMException && reason.name === "AbortError")
        )
          return;
        setPlaying(false);
        setLoading(false);
        setError(playbackError(reason));
      }
    },
    [audio, audioAnalysis, syncVideo],
  );

  const loadSong = useCallback(
    (
      nextSong: Song,
      query: SongListQuery = {},
      index = 0,
      autoPlay = true,
      fromShuffle = false,
      manual = false,
    ) => {
      const id = ++generation.current;
      const nextIndex = Math.max(0, Math.trunc(index));
      const copiedQuery = cloneQueueQuery(query);
      queue.current = { query: copiedQuery, index: nextIndex };
      if (!fromShuffle) {
        history.current = [nextIndex];
        historyPosition.current = 0;
      }
      activeSong.current = nextSong;
      audio.pause();
      videoRef.current?.pause();
      setLoading(false);
      setSong(nextSong);
      setQueueIndex(manual ? null : nextIndex);
      setQueueQuery(copiedQuery);
      setCurrentTime(0);
      setDuration(nextSong.duration);
      setPlaying(false);
      setError(null);
      resetVideo();
      audio.src = nextSong.audioUrl;
      audio.load();
      if (autoPlay) void resumeGeneration(id);
    },
    [audio, resetVideo, resumeGeneration],
  );

  const playSong = useCallback(
    (nextSong: Song, query: SongListQuery = {}, index = 0) => {
      queueTrail.current = null;
      loadSong(nextSong, query, index, true);
    },
    [loadSong],
  );
  const cueSong = useCallback(
    (nextSong: Song, query: SongListQuery = {}, index = 0) => {
      queueTrail.current = null;
      loadSong(nextSong, query, index, false);
    },
    [loadSong],
  );

  const addToQueue = useCallback(
    (nextSong: Song, query: SongListQuery = {}, index = 0) => {
      if (!activeSong.current) {
        cueSong(nextSong, query, index);
        return;
      }
      updatePendingSongs([...pendingSongs.current, nextSong]);
    },
    [cueSong, updatePendingSongs],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= pendingSongs.current.length
      )
        return;
      updatePendingSongs(
        pendingSongs.current.filter((_, position) => position !== index),
      );
    },
    [updatePendingSongs],
  );
  const clearQueue = useCallback(
    () => updatePendingSongs([]),
    [updatePendingSongs],
  );

  const seek = useCallback(
    (time: number) => {
      if (!activeSong.current || !Number.isFinite(time)) return;
      const max = Number.isFinite(audio.duration)
        ? audio.duration
        : activeSong.current.duration;
      const next = Math.max(0, Math.min(time, max || 0));
      try {
        audio.currentTime = next;
        setCurrentTime(next);
        syncVideo();
      } catch {
        // Ignore seeks made while a source is being replaced.
      }
    },
    [audio, syncVideo],
  );

  const resume = useCallback(() => {
    if (!activeSong.current) return;
    const id = ++generation.current;
    setError(null);
    if (audio.ended) seek(0);
    if (audio.error) {
      audio.load();
      setLoading(true);
    }
    void resumeGeneration(id);
  }, [audio, resumeGeneration, seek]);

  const pause = useCallback(() => {
    generation.current++;
    audio.pause();
    videoRef.current?.pause();
    setPlaying(false);
    setLoading(false);
  }, [audio]);

  const toggle = useCallback(() => {
    if (audio.paused) resume();
    else pause();
  }, [audio.paused, pause, resume]);

  const playNextPending = useCallback(() => {
    const nextSong = pendingSongs.current[0];
    const currentSong = activeSong.current;
    if (!nextSong || !currentSong) return false;
    updatePendingSongs(pendingSongs.current.slice(1));
    const currentQueue = queue.current;
    const trail = queueTrail.current ?? {
      entries: [
        {
          song: currentSong,
          query: currentQueue.query,
          index: currentQueue.index,
          manual: false,
        },
      ],
      position: 0,
    };
    const entries = trail.entries.slice(0, trail.position + 1);
    queueTrail.current = {
      entries: [
        ...entries,
        {
          song: nextSong,
          query: currentQueue.query,
          index: currentQueue.index,
          manual: true,
        },
      ],
      position: entries.length,
    };
    loadSong(
      nextSong,
      currentQueue.query,
      currentQueue.index,
      true,
      true,
      true,
    );
    return true;
  }, [loadSong, updatePendingSongs]);

  const navigate = useCallback(
    async (direction: 1 | -1, ended = false) => {
      if (!activeSong.current) return;
      const id = ++generation.current;
      if (direction === -1 && audio.currentTime > 3) {
        setLoading(false);
        setError(null);
        seek(0);
        return;
      }
      if (ended && latestModes.current.repeat === "one") {
        seek(0);
        resume();
        return;
      }
      if (direction === 1 && playNextPending()) return;
      const trail = queueTrail.current;
      if (
        trail &&
        direction === 1 &&
        trail.position < trail.entries.length - 1
      ) {
        const position = trail.position + 1;
        const entry = trail.entries[position]!;
        trail.position = position;
        loadSong(
          entry.song,
          entry.query,
          entry.index,
          true,
          true,
          entry.manual,
        );
        return;
      }
      if (trail && direction === -1 && trail.position > 0) {
        const position = trail.position - 1;
        const entry = trail.entries[position]!;
        trail.position = position;
        loadSong(
          entry.song,
          entry.query,
          entry.index,
          true,
          true,
          entry.manual,
        );
        return;
      }
      const currentQueue = queue.current;
      setLoading(true);
      setError(null);
      try {
        let total = currentQueue.total;
        if (total === undefined) {
          const page = await api.querySongList({
            ...currentQueue.query,
            offset: currentQueue.index,
            limit: 1,
          });
          if (id !== generation.current || !mounted.current) return;
          total = page.total;
          currentQueue.total = total;
        }
        if (direction === 1 && playNextPending()) return;
        const selected = latestModes.current.shuffle
          ? navigateShuffleHistory({
              history: {
                entries: history.current,
                position: historyPosition.current,
              },
              current: currentQueue.index,
              total,
              direction,
              repeat: latestModes.current.repeat,
            })
          : null;
        const nextIndex =
          selected?.index ??
          nextQueueIndex({
            current: currentQueue.index,
            total,
            direction,
            ended,
            ...latestModes.current,
          });
        if (nextIndex === null) {
          setLoading(false);
          if (ended) setPlaying(false);
          else if (direction === -1) seek(0);
          return;
        }
        const page =
          selected === null
            ? await api.querySongList({
                ...currentQueue.query,
                offset: nextIndex,
                limit: 1,
              })
            : await api.querySongList({
                ...currentQueue.query,
                offset: nextIndex,
                limit: 1,
              });
        if (id !== generation.current || !mounted.current) return;
        const nextSong = page.items[0];
        if (!nextSong) {
          currentQueue.total = page.total;
          setLoading(false);
          setError(
            "This queue changed. Select a song from the song list to continue.",
          );
          return;
        }
        if (direction === 1 && playNextPending()) return;
        if (selected) {
          history.current = selected.history.entries;
          historyPosition.current = selected.history.position;
        }
        const remainingTrail = queueTrail.current;
        if (
          direction === 1 &&
          remainingTrail?.entries[remainingTrail.position]?.manual
        ) {
          const entries = remainingTrail.entries.slice(
            0,
            remainingTrail.position + 1,
          );
          queueTrail.current = {
            entries: [
              ...entries,
              {
                song: nextSong,
                query: currentQueue.query,
                index: nextIndex,
                manual: false,
              },
            ],
            position: entries.length,
          };
        } else queueTrail.current = null;
        loadSong(
          nextSong,
          currentQueue.query,
          nextIndex,
          true,
          Boolean(selected),
        );
        currentQueue.total = page.total;
      } catch {
        if (id !== generation.current || !mounted.current) return;
        setLoading(false);
        setError(
          "Could not load the next song. Please select a song or try again.",
        );
      }
    },
    [api, audio, loadSong, playNextPending, resume, seek],
  );

  const next = useCallback(() => navigate(1), [navigate]);
  const previous = useCallback(() => navigate(-1), [navigate]);

  const jumpRandom = useCallback(
    async (direction: 1 | -1) => {
      if (!activeSong.current) return;
      const id = ++generation.current;
      const currentQueue = queue.current;
      setLoading(true);
      setError(null);
      try {
        let total = currentQueue.total;
        if (total === undefined) {
          const page = await api.querySongList({
            ...currentQueue.query,
            offset: currentQueue.index,
            limit: 1,
          });
          if (id !== generation.current || !mounted.current) return;
          total = page.total;
          currentQueue.total = total;
        }

        const selected = navigateRandomHistory({
          history: {
            entries: history.current,
            position: historyPosition.current,
          },
          current: currentQueue.index,
          total,
          direction,
        });
        if (selected.index === null) {
          setLoading(false);
          return;
        }

        const page = await api.querySongList({
          ...currentQueue.query,
          offset: selected.index,
          limit: 1,
        });
        if (id !== generation.current || !mounted.current) return;
        const nextSong = page.items[0];
        if (!nextSong) {
          currentQueue.total = page.total;
          setLoading(false);
          setError(
            "This queue changed. Select a song from the song list to continue.",
          );
          return;
        }

        history.current = selected.history.entries;
        historyPosition.current = selected.history.position;
        queueTrail.current = null;
        loadSong(nextSong, currentQueue.query, selected.index, true, true);
        queue.current.total = page.total;
      } catch {
        if (id !== generation.current || !mounted.current) return;
        setLoading(false);
        setError(
          "Could not load a random song. Please select a song or try again.",
        );
      }
    },
    [api, loadSong],
  );

  const setVolume = useCallback((nextVolume: number) => {
    if (!Number.isFinite(nextVolume)) return;
    setVolumeState(Math.max(0, Math.min(1, nextVolume)));
    if (nextVolume > 0) setMuted(false);
  }, []);
  const toggleMute = useCallback(() => setMuted((value) => !value), []);
  const cycleRepeat = useCallback(
    () =>
      setRepeat((value) =>
        value === "off" ? "all" : value === "all" ? "one" : "off",
      ),
    [],
  );
  const resetPlaybackSettings = useCallback(() => {
    setVolumeState(defaultPlaybackSettings.volume);
    setMuted(defaultPlaybackSettings.muted);
    setShuffle(defaultPlaybackSettings.shuffle);
    setRepeat(defaultPlaybackSettings.repeat);
    setPlayVideos(defaultPlaybackSettings.playVideos);
    setVideoEncodingCodec(defaultPlaybackSettings.videoEncodingCodec);
    setVideoEncodingQuality(defaultPlaybackSettings.videoEncodingQuality);
    setVideoMaxFps(defaultPlaybackSettings.videoMaxFps);
    setVideoForceRemux(defaultPlaybackSettings.videoForceRemux);
    setVideoCacheLimitGb(defaultPlaybackSettings.videoCacheLimitGb);
  }, []);

  const controls = useRef({
    navigate,
    resume,
    pause,
    toggle,
    next,
    previous,
    seek,
  });
  controls.current = { navigate, resume, pause, toggle, next, previous, seek };

  useEffect(() => {
    audio.volume = muted ? 0 : volume;
    audio.muted = false;
    try {
      writePreference("playback", {
        volume,
        muted,
        shuffle,
        repeat,
        playVideos,
        videoEncodingCodec,
        videoEncodingQuality,
        videoMaxFps,
        videoForceRemux,
        videoCacheLimitGb,
      });
    } catch {
      // Local storage is optional.
    }
  }, [
    audio,
    muted,
    playVideos,
    videoEncodingCodec,
    repeat,
    shuffle,
    videoEncodingQuality,
    videoCacheLimitGb,
    videoForceRemux,
    videoMaxFps,
    volume,
  ]);

  useEffect(() => {
    mounted.current = true;
    audio.preload = "metadata";
    const timeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
      syncVideo();
    };
    const metadata = () => {
      setDuration(
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : (activeSong.current?.duration ?? 0),
      );
      setLoading(false);
    };
    const playingEvent = () => {
      setPlaying(true);
      setLoading(false);
      setError(null);
      syncVideo(true);
    };
    const pauseEvent = () => {
      setPlaying(false);
      videoRef.current?.pause();
    };
    const waiting = () => {
      if (!audio.paused) {
        setLoading(true);
        videoRef.current?.pause();
      }
    };
    const events: Array<[string, EventListener]> = [
      ["timeupdate", timeUpdate],
      ["loadedmetadata", metadata],
      ["durationchange", metadata],
      ["playing", playingEvent],
      ["pause", pauseEvent],
      ["waiting", waiting],
      ["stalled", waiting],
      ["canplay", () => setLoading(false)],
      [
        "ended",
        () => {
          setPlaying(false);
          void controls.current.navigate(1, true);
        },
      ],
      [
        "error",
        () => {
          if (activeSong.current) {
            setPlaying(false);
            setLoading(false);
            setError(playbackError(audio.error));
          }
        },
      ],
    ];
    for (const [name, listener] of events)
      audio.addEventListener(name, listener);
    // The cleanup below clears the source during React Strict Mode's mount
    // replay. Load the bootstrap song after listeners are attached so that
    // the second setup restores it and cannot leave the visible song without
    // a media source.
    if (initialSong) {
      audio.src = initialSong.audioUrl;
      audio.load();
    }
    const removeMediaListener = api.onMediaAction?.((action) => {
      const current = controls.current;
      if (action === "stop") {
        current.pause();
        current.seek(0);
      } else if (action === "play") current.resume();
      else if (action === "pause") current.pause();
      else if (action === "toggle") current.toggle();
      else if (action === "next") current.next();
      else if (action === "previous") current.previous();
    });
    const mediaSession = navigator.mediaSession;
    type MediaSessionDetails = {
      seekTime?: number;
      seekOffset?: number;
    };
    const handlers: Array<
      [MediaSessionAction, (details?: MediaSessionDetails) => void]
    > = [
      ["play", () => controls.current.resume()],
      ["pause", () => controls.current.pause()],
      ["nexttrack", () => controls.current.next()],
      ["previoustrack", () => controls.current.previous()],
      [
        "stop",
        () => {
          controls.current.pause();
          controls.current.seek(0);
        },
      ],
      [
        "seekto",
        (details) => {
          if (details?.seekTime !== undefined)
            controls.current.seek(details.seekTime);
        },
      ],
      ["seekbackward", () => controls.current.seek(audio.currentTime - 10)],
      ["seekforward", () => controls.current.seek(audio.currentTime + 10)],
    ];
    if (mediaSession) {
      for (const [action, handler] of handlers) {
        try {
          mediaSession.setActionHandler(action, handler);
        } catch {
          // Some actions are unavailable on older Electron builds.
        }
      }
    }
    return () => {
      mounted.current = false;
      generation.current++;
      for (const [name, listener] of events)
        audio.removeEventListener(name, listener);
      removeMediaListener?.();
      if (mediaSession) {
        for (const [action] of handlers) {
          try {
            mediaSession.setActionHandler(action, null);
          } catch {
            // Ignore unsupported handlers during teardown.
          }
        }
        mediaSession.metadata = null;
        mediaSession.playbackState = "none";
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [api, audio, initialSong, syncVideo]);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession) return;
    if (!song) {
      mediaSession.metadata = null;
      mediaSession.playbackState = "none";
      try {
        mediaSession.setPositionState();
      } catch {
        // Ignore unsupported position state.
      }
      return;
    }
    if (typeof MediaMetadata === "undefined") return;

    let cancelled = false;
    let ownedArtworkUrl: string | undefined;
    const setMetadata = (artwork?: ResolvedMediaArtwork) => {
      if (cancelled) return;
      mediaSession.metadata = new MediaMetadata({
        title: displaySongTitle(song, showTitleUnicode),
        artist: displaySongArtist(song, showArtistUnicode),
        album: song.source || "OsuMediaPlayer",
        artwork: artwork
          ? [
              {
                src: artwork.url,
                sizes: "512x512",
                ...(artwork.type ? { type: artwork.type } : {}),
              },
            ]
          : [],
      });
    };
    const artworkUrl = song.backgroundHash ? song.artworkUrl : undefined;

    // Keep song metadata even when there is no background, but never provide
    // an actual background candidate in that case.
    setMetadata(fallbackMediaArtwork);
    if (!artworkUrl) return;

    const controller = new AbortController();
    void resolveMediaArtwork(artworkUrl, controller.signal)
      .then((artwork) => {
        if (cancelled) {
          if (artwork?.owned) URL.revokeObjectURL(artwork.url);
          return;
        }
        if (artwork?.owned) ownedArtworkUrl = artwork.url;
        setMetadata(artwork);
      })
      .catch(() => {
        if (!cancelled) setMetadata(fallbackMediaArtwork);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (ownedArtworkUrl) URL.revokeObjectURL(ownedArtworkUrl);
    };
  }, [showArtistUnicode, showTitleUnicode, song]);

  useEffect(() => {
    if (
      !navigator.mediaSession ||
      !song ||
      !duration ||
      !Number.isFinite(duration)
    )
      return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(duration, Math.max(0, currentTime)),
      });
    } catch {
      // Ignore invalid transient media states.
    }
  }, [currentTime, duration, playing, song]);

  return {
    song,
    queuedSongs,
    queueIndex,
    queueQuery,
    playing,
    currentTime,
    duration,
    volume,
    setVolume,
    muted,
    toggleMute,
    shuffle,
    setShuffle,
    repeat,
    cycleRepeat,
    playVideos,
    setPlayVideos,
    videoEncodingCodec,
    setVideoEncodingCodec,
    videoEncodingQuality,
    setVideoEncodingQuality,
    videoMaxFps,
    setVideoMaxFps,
    videoForceRemux,
    setVideoForceRemux,
    videoCacheLimitGb,
    setVideoCacheLimitGb,
    resetPlaybackSettings,
    error,
    clearError: () => setError(null),
    loading,
    playSong,
    cueSong,
    addToQueue,
    removeFromQueue,
    clearQueue,
    reset,
    toggle,
    seek,
    next,
    previous,
    jumpRandom,
    audioRef,
    getAudioAnalyser,
    videoRef,
    videoUrl,
    videoSource,
    videoLoading,
    videoEncoding,
    videoEncodingProgress,
    videoEncoder,
    videoError,
    handleVideoError,
  };
}
