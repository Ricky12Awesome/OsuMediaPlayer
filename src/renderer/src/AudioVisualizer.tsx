import { useEffect, useRef, type RefObject } from "react";
import { VisualizerAnalysis } from "./visualizer-analysis";
import {
  createVisualizerRenderer,
  WebGPUUnavailableError,
  type VisualizerColors,
  type VisualizerRenderer,
} from "./visualizer-gpu";
import type {
  VisualizerSettings,
  VisualizerStatus,
} from "./visualizer-settings";
import "./visualizer.css";

interface AudioVisualizerProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  getAudioAnalyser: () => AnalyserNode | null;
  settings: VisualizerSettings;
  onStatus: (status: VisualizerStatus, detail?: string) => void;
  themeKey?: unknown;
  trackKey?: string;
}

function hexColor(value: string): [number, number, number] {
  return [1, 3, 5].map(
    (offset) => parseInt(value.slice(offset, offset + 2), 16) / 255,
  ) as [number, number, number];
}

export function AudioVisualizer({
  audioRef,
  getAudioAnalyser,
  settings,
  onStatus,
  themeKey,
  trackKey,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef<HTMLSpanElement>(null);
  const latest = useRef({
    settings,
    getAudioAnalyser,
    onStatus,
    trackKey,
  });
  latest.current = { settings, getAudioAnalyser, onStatus, trackKey };
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!settings.enabled) {
      latest.current.onStatus("off");
      return;
    }
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    const colorProbe = colorRef.current;
    if (!canvas || !audio || !colorProbe) return;
    let cancelled = false;
    const controller = new AbortController();
    let failed = false;
    let renderer: VisualizerRenderer | null = null;
    let frameId: number | null = null;
    let previousTime = 0;
    let angle = 0;
    let width = 0;
    let height = 0;
    let visible = true;
    let colorPreviewPending = false;
    let colors: VisualizerColors = [
      [1, 0.4, 0.67],
      [1, 0.7, 0.83],
    ];
    const analysis = new VisualizerAnalysis();
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const active = () =>
      !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 2;
    const stop = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      previousTime = 0;
    };
    const fail = (message: string) => {
      if (cancelled || failed) return;
      failed = true;
      stop();
      renderer?.dispose();
      renderer = null;
      canvas.style.visibility = "hidden";
      latest.current.onStatus("error", message);
    };
    const draw = (now: number) => {
      frameId = null;
      if (
        cancelled ||
        failed ||
        !renderer ||
        document.hidden ||
        !visible ||
        !width ||
        !height
      )
        return;
      const current = latest.current.settings;
      const playing = active();
      const interval = current.maxFps > 0 ? 1000 / current.maxFps : 0;
      if (
        interval > 0 &&
        playing &&
        previousTime &&
        !colorPreviewPending &&
        now - previousTime < interval - 0.5
      ) {
        frameId = requestAnimationFrame(draw);
        return;
      }
      try {
        const analyser = latest.current.getAudioAnalyser();
        if (analyser) {
          const result = analysis.update(
            analyser,
            current,
            now,
            playing,
            latest.current.trackKey,
          );
          const reduced =
            current.respectReducedMotion && motionPreference.matches;
          if (playing && previousTime && !reduced)
            angle =
              (angle +
                ((Math.min(100, now - previousTime) / 1000) *
                  current.rotationSpeed *
                  Math.PI) /
                  180) %
              (Math.PI * 2);
          renderer.resize(width, height, current.resolution);
          renderer.render(current, result, angle, colors, reduced);
          colorPreviewPending = false;
          canvas.style.visibility = "visible";
        }
      } catch {
        fail(
          "The visualizer could not read or render audio. Toggle it off and on to retry.",
        );
        return;
      }
      previousTime = playing ? now : 0;
      if (playing) frameId = requestAnimationFrame(draw);
    };
    const schedule = () => {
      if (
        !cancelled &&
        !failed &&
        renderer &&
        frameId === null &&
        !document.hidden &&
        visible
      )
        frameId = requestAnimationFrame(draw);
    };
    const updateColors = () => {
      const current = latest.current.settings;
      const readColor = (value: string): [number, number, number] => {
        if (value.startsWith("#")) return hexColor(value);
        colorProbe.style.color = value;
        const parts = getComputedStyle(colorProbe)
          .color.match(/[\d.]+/g)
          ?.map(Number);
        return parts && parts.length >= 3
          ? [parts[0] / 255, parts[1] / 255, parts[2] / 255]
          : [1, 0.4, 0.67];
      };
      colors = [
        readColor(
          current.colorMode === "theme" ? "var(--pink)" : current.color1,
        ),
        readColor(
          current.colorMode === "theme" ? "var(--pink-pale)" : current.color2,
        ),
      ];
      schedule();
    };
    const previewColor = (event: Event) => {
      const input = event.target;
      if (
        !(input instanceof HTMLInputElement) ||
        latest.current.settings.colorMode !== "custom" ||
        !/^#[0-9a-f]{6}$/i.test(input.value)
      )
        return;
      const field = input.dataset.visualizerColor;
      if (field !== "color1" && field !== "color2") return;
      colors[field === "color1" ? 0 : 1] = hexColor(input.value);
      colorPreviewPending = true;
      schedule();
    };
    refresh.current = updateColors;
    const reset = () => {
      analysis.reset();
      previousTime = 0;
      schedule();
    };
    const pause = () => {
      stop();
      reset();
    };
    const visibility = () => {
      if (document.hidden) stop();
      else reset();
    };
    const colorBlur = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.dataset.visualizerColor
      )
        updateColors();
    };
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      schedule();
    });
    resize.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) stop();
      else reset();
    });
    intersection.observe(canvas);
    const events: Array<[string, () => void]> = [
      ["play", reset],
      ["playing", schedule],
      ["pause", pause],
      ["ended", pause],
      ["seeking", pause],
      ["seeked", reset],
      ["emptied", pause],
      ["loadeddata", reset],
    ];
    for (const [event, handler] of events)
      audio.addEventListener(event, handler);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("input", previewColor, true);
    document.addEventListener("focusout", colorBlur);
    motionPreference.addEventListener("change", reset);
    latest.current.onStatus("loading");
    canvas.style.visibility = "hidden";
    updateColors();
    void createVisualizerRenderer(canvas, fail, controller.signal)
      .then((created) => {
        if (cancelled || failed) {
          created.dispose();
          return;
        }
        renderer = created;
        latest.current.onStatus("ready");
        schedule();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        failed = true;
        latest.current.onStatus(
          error instanceof WebGPUUnavailableError ? "unsupported" : "error",
          error instanceof WebGPUUnavailableError
            ? "WebGPU is unavailable on this device. Audio and video playback still work."
            : "The visualizer could not start. Toggle it off and on to retry.",
        );
      });
    const cleanup = () => {
      cancelled = true;
      controller.abort();
      stop();
      refresh.current = null;
      resize.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("input", previewColor, true);
      document.removeEventListener("focusout", colorBlur);
      motionPreference.removeEventListener("change", reset);
      for (const [event, handler] of events)
        audio.removeEventListener(event, handler);
      renderer?.dispose();
      window.removeEventListener("pagehide", cleanup);
    };
    window.addEventListener("pagehide", cleanup);
    return cleanup;
  }, [audioRef, settings.enabled]);

  useEffect(() => {
    refresh.current?.();
  }, [settings, themeKey]);

  if (!settings.enabled) return null;
  return (
    <>
      <canvas ref={canvasRef} className="audio-visualizer" aria-hidden="true" />
      <span
        ref={colorRef}
        className="visualizer-color-probe"
        aria-hidden="true"
      />
    </>
  );
}
