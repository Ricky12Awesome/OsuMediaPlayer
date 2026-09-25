import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PlayerAPI,
  Song,
  VideoSource,
  VideoEncodingCodec,
  VideoEncodingQuality,
  VideoMaxFps,
} from "../../shared/types";

type VideoSync = (autoPlay?: boolean) => void;

export interface PlayerVideoState {
  videoUrl: string | null;
  videoSource: VideoSource;
  videoLoading: boolean;
  videoEncoding: boolean;
  videoEncodingProgress: number | null;
  videoEncoder: string | null;
  videoError: string | null;
  resetVideo: () => void;
  handleVideoError: () => void;
}

interface UsePlayerVideoOptions {
  api: PlayerAPI;
  song: Song | null;
  activeSong: { current: Song | null };
  playVideos: boolean;
  videoEncodingCodec: VideoEncodingCodec;
  videoEncodingQuality: VideoEncodingQuality;
  videoMaxFps: VideoMaxFps;
  videoForceRemux: boolean;
  videoCacheLimitGb: number;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  syncVideo: VideoSync;
}

/** Owns source preparation, HLS attachment, and encoding status for the player video. */
export function usePlayerVideo({
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
}: UsePlayerVideoOptions): PlayerVideoState {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoStreaming, setVideoStreaming] = useState(false);
  const [videoSourceRevision, setVideoSourceRevision] = useState(0);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [encodingHash, setEncodingHash] = useState<string | null>(null);
  const [videoEncodingProgress, setVideoEncodingProgress] = useState<
    number | null
  >(null);
  const [videoEncoder, setVideoEncoder] = useState<string | null>(null);
  const videoRequestVersion = useRef(0);
  const videoHls = useRef<{ destroy: () => void } | null>(null);
  const lastVideoSongId = useRef<string | null>(null);
  const currentSource = useRef<{ url: string | null; streaming: boolean }>({
    url: null,
    streaming: false,
  });

  const showVideo = useCallback(
    (url: string, streaming: boolean, force = false) => {
      if (
        !force &&
        currentSource.current.url === url &&
        currentSource.current.streaming === streaming
      )
        return;
      currentSource.current = { url, streaming };
      setVideoUrl(url);
      setVideoStreaming(streaming);
      setVideoSourceRevision((revision) => revision + 1);
    },
    [],
  );

  const stopCurrentVideo = useCallback(() => {
    videoRequestVersion.current += 1;
    videoHls.current?.destroy();
    videoHls.current = null;
    const currentVideo = videoRef.current;
    if (currentVideo) {
      currentVideo.pause();
      currentVideo.removeAttribute("src");
      currentVideo.load();
    }
    currentSource.current = { url: null, streaming: false };
    setVideoUrl(null);
  }, [videoRef]);

  const resetVideo = useCallback(() => {
    stopCurrentVideo();
    setVideoStreaming(false);
    setVideoLoading(false);
    setVideoError(null);
  }, [stopCurrentVideo]);

  useEffect(() => {
    return api.onVideoEncodingChange((status) => {
      setEncodingHash((current) =>
        status.encoding
          ? status.hash
          : current === status.hash
            ? null
            : current,
      );
      if (status.encoding) {
        setVideoEncodingProgress(status.progress ?? null);
        setVideoEncoder(status.encoder ?? null);
      } else {
        setVideoEncodingProgress(null);
        setVideoEncoder(null);
      }
      if (
        status.finalized &&
        activeSong.current?.videoHash?.toLowerCase() === status.hash &&
        currentSource.current.url?.startsWith("omp://video-cache/")
      ) {
        currentSource.current.streaming = false;
        setVideoStreaming(false);
        setVideoSourceRevision((revision) => revision + 1);
      }
    });
  }, [activeSong, api]);

  useEffect(() => {
    let active = true;
    setVideoError(null);
    const sameSong = lastVideoSongId.current === (song?.id ?? null);
    lastVideoSongId.current = song?.id ?? null;
    if (!playVideos || !song?.videoUrl) {
      stopCurrentVideo();
      void api.cancelVideoEncoding().catch(() => {
        // Video cancellation is best-effort while the renderer is changing sources.
      });
      setVideoStreaming(false);
      setVideoLoading(false);
      return;
    }
    if (!sameSong) stopCurrentVideo();
    if (song.videoDirectPlayable && !currentSource.current.url) {
      showVideo(song.videoUrl, false, true);
      setVideoLoading(false);
    }
    const prepare = () => {
      if (!active) return;
      if (!currentSource.current.url) setVideoLoading(true);
      api
        .prepareVideo(song.id, {
          codec: videoEncodingCodec,
          quality: videoEncodingQuality,
          maxFps: videoMaxFps,
          forceRemux: videoForceRemux,
          cacheLimitGb: videoCacheLimitGb,
        })
        .then((prepared) => {
          if (active && activeSong.current?.id === song.id) {
            if (prepared) {
              showVideo(prepared.url, prepared.streaming);
              setVideoError(null);
            } else if (!currentSource.current.url) {
              setVideoError("The beatmap video could not be prepared.");
            }
            setVideoLoading(false);
          }
        })
        .catch((reason: unknown) => {
          if (active && activeSong.current?.id === song.id) {
            setVideoLoading(false);
            if (!currentSource.current.url)
              setVideoError(
                reason instanceof Error
                  ? reason.message
                  : "The beatmap video could not be prepared.",
              );
          }
        });
    };
    const timer = window.setTimeout(prepare, sameSong ? 150 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    api,
    playVideos,
    showVideo,
    stopCurrentVideo,
    song?.id,
    song?.videoUrl,
    videoCacheLimitGb,
    videoEncodingQuality,
    videoEncodingCodec,
    videoForceRemux,
    videoMaxFps,
  ]);

  const handleVideoError = useCallback(() => {
    currentSource.current = { url: null, streaming: false };
    setVideoUrl(null);
    setVideoStreaming(false);
    setVideoLoading(false);
    setVideoError("This video's codec is not supported by Electron.");
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    const requestVersion = videoRequestVersion.current;
    video.defaultMuted = true;
    video.muted = true;
    video.preload = "metadata";
    const sync = () => syncVideo();
    let hls: import("hls.js").default | null = null;
    let disposed = false;
    let isManagedVideo = false;
    try {
      const source = new URL(videoUrl);
      isManagedVideo =
        source.protocol === "omp:" && source.host === "video-cache";
    } catch {
      // Let the media element report a malformed direct URL normally.
    }
    const loadedMetadata = () => {
      sync();
      if (!videoStreaming && isManagedVideo && song?.videoHash)
        void api.completeVideoStream(song.videoHash);
    };
    const mediaError = () => {
      if (!disposed && requestVersion === videoRequestVersion.current)
        handleVideoError();
    };
    video.removeEventListener("loadedmetadata", sync);
    video.addEventListener("loadedmetadata", loadedMetadata);
    video.addEventListener("error", mediaError);
    const loadNative = () => {
      if (disposed || requestVersion !== videoRequestVersion.current) return;
      video.src = videoUrl;
      video.load();
      sync();
    };
    if (videoStreaming) {
      void import("hls.js/light")
        .then(({ default: Hls }) => {
          if (disposed || requestVersion !== videoRequestVersion.current)
            return;
          if (!Hls.isSupported()) {
            loadNative();
            return;
          }
          const instance = new Hls({
            backBufferLength: 20,
            enableWorker: false,
            maxBufferLength: 20,
            maxMaxBufferLength: 60,
            startFragPrefetch: true,
            startPosition: 0,
          });
          hls = instance;
          videoHls.current = instance;
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (
              !disposed &&
              data.fatal &&
              requestVersion === videoRequestVersion.current
            )
              handleVideoError();
          });
          instance.loadSource(videoUrl);
          instance.attachMedia(video);
        })
        .catch(loadNative);
    } else {
      loadNative();
    }
    return () => {
      disposed = true;
      video.removeEventListener("loadedmetadata", loadedMetadata);
      video.removeEventListener("error", mediaError);
      video.removeEventListener("canplay", sync);
      video.pause();
      hls?.destroy();
      if (videoHls.current === hls) videoHls.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [
    api,
    handleVideoError,
    syncVideo,
    song?.videoHash,
    song?.videoOffset,
    videoSourceRevision,
    videoStreaming,
    videoUrl,
    videoRef,
  ]);

  return {
    videoUrl,
    videoSource:
      !playVideos || !song?.videoUrl || !videoUrl
        ? "none"
        : videoStreaming
          ? "HLS"
          : videoUrl.startsWith("omp://video-cache/")
            ? "Cache"
            : "Original",
    videoLoading,
    videoEncoding:
      Boolean(song?.videoHash) &&
      encodingHash === song?.videoHash?.toLowerCase(),
    videoEncodingProgress,
    videoEncoder,
    videoError,
    resetVideo,
    handleVideoError,
  };
}
