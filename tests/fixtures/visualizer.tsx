import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PlayerAudioAnalysis } from "../../src/renderer/src/visualizer-audio";
import { AudioVisualizer } from "../../src/renderer/src/AudioVisualizer";
import { PlayerToolsPanel } from "../../src/renderer/src/PlayerToolsPanel";
import { VisualizerSettingsPanel } from "../../src/renderer/src/VisualizerSettingsPanel";
import {
  readPreference,
  writePreference,
} from "../../src/renderer/src/preferences";
import {
  parseVisualizerSettings,
  type VisualizerSettings,
  type VisualizerStatus,
} from "../../src/renderer/src/visualizer-settings";
import "../../src/renderer/src/styles.css";

interface FrameMetrics {
  visible: number;
  transparent: number;
  alpha: number;
  red: number;
  green: number;
  blue: number;
  minRadius: number;
  maxRadius: number;
  hash: number;
}

declare global {
  interface Window {
    captureVisualizerFrame?: () => void;
    visualizerTest: {
      play: (amplitude: number) => Promise<void>;
      pause: () => void;
      settings: () => VisualizerSettings;
      update: (settings: Partial<VisualizerSettings>) => void;
      theme: (color: string) => void;
      snapshot: () => Promise<FrameMetrics>;
      analyserPeak: () => number;
      analyserFrequencyPeak: () => { bin: number; value: number; hz: number };
      unmount: () => void;
    };
  }
}

// A small PCM fixture exercises HTML media decoding and Web Audio together.
// Playwright mutes browser output while the production audio graph remains intact.
function tone(amplitude: number): Blob {
  const sampleRate = 48000;
  const length = sampleRate * 2;
  const buffer = new ArrayBuffer(44 + length * 2);
  const data = new DataView(buffer);
  const word = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      data.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  word(0, "RIFF");
  data.setUint32(4, buffer.byteLength - 8, true);
  word(8, "WAVEfmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  word(36, "data");
  data.setUint32(40, length * 2, true);
  for (let sample = 0; sample < length; sample++) {
    const value = Math.sin((sample * Math.PI * 2 * 110) / sampleRate);
    data.setInt16(44 + sample * 2, value * amplitude * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const audio = new Audio();
audio.loop = true;
const audioAnalysis = new PlayerAudioAnalysis(audio);
let audioUrl: string | null = null;
const getAudioAnalyser = () => audioAnalysis.getAnalyser();
const root = createRoot(document.getElementById("root")!);

function Fixture() {
  const audioRef = useRef<HTMLAudioElement | null>(audio);
  const panelRef = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState(() => readPreference("visualizer"));
  const [status, setStatus] = useState<VisualizerStatus>("loading");
  const [statusDetail, setStatusDetail] = useState<string>();
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => audioAnalysis.mount(), []);
  useEffect(() => writePreference("visualizer", settings), [settings]);
  window.visualizerTest = {
    play: async (amplitude) => {
      audio.pause();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(tone(amplitude));
      audio.src = audioUrl;
      audioAnalysis.resume();
      await audio.play();
    },
    pause: () => audio.pause(),
    settings: () => settings,
    update: (next) =>
      setSettings((previous) =>
        parseVisualizerSettings({ ...previous, ...next }),
      ),
    theme: (color) => {
      document.documentElement.style.setProperty("--pink", color);
      document.documentElement.style.setProperty("--pink-bright", color);
      document.documentElement.style.setProperty("--pink-pale", color);
      setThemeKey((previous) => previous + 1);
    },
    snapshot: () =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("No visualizer frame arrived")),
          5000,
        );
        window.captureVisualizerFrame = () => {
          const canvas = document.querySelector("canvas");
          if (!canvas) throw new Error("Missing visualizer canvas");
          const copy = document.createElement("canvas");
          copy.width = canvas.width;
          copy.height = canvas.height;
          const target = copy.getContext("2d")!;
          target.drawImage(canvas, 0, 0);
          const pixels = target.getImageData(
            0,
            0,
            copy.width,
            copy.height,
          ).data;
          const result: FrameMetrics = {
            visible: 0,
            transparent: 0,
            alpha: 0,
            red: 0,
            green: 0,
            blue: 0,
            minRadius: Infinity,
            maxRadius: 0,
            hash: 2166136261,
          };
          for (let offset = 0; offset < pixels.length; offset += 4) {
            const alpha = pixels[offset + 3];
            if (alpha === 0) result.transparent++;
            else result.visible++;
            result.hash = Math.imul(result.hash ^ alpha, 16777619) >>> 0;
            if (alpha > 10) {
              const pixel = offset / 4;
              const radius = Math.hypot(
                (pixel % copy.width) - copy.width / 2,
                Math.floor(pixel / copy.width) - copy.height / 2,
              );
              result.minRadius = Math.min(result.minRadius, radius);
              result.maxRadius = Math.max(result.maxRadius, radius);
            }
            result.alpha += alpha;
            result.red += pixels[offset] * alpha;
            result.green += pixels[offset + 1] * alpha;
            result.blue += pixels[offset + 2] * alpha;
          }
          clearTimeout(timeout);
          delete window.captureVisualizerFrame;
          resolve(result);
        };
      }),
    analyserPeak: () => {
      const analyser = getAudioAnalyser();
      if (!analyser) return 0;
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return samples.reduce(
        (peak, sample) => Math.max(peak, Math.abs(sample)),
        0,
      );
    },
    analyserFrequencyPeak: () => {
      const analyser = getAudioAnalyser();
      if (!analyser) return { bin: -1, value: 0, hz: 0 };
      const bins = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(bins);
      let peak = 0;
      for (let index = 1; index < bins.length; index++) {
        if (bins[index] > bins[peak]) peak = index;
      }
      return {
        bin: peak,
        value: bins[peak],
        hz: (peak * analyser.context.sampleRate) / analyser.fftSize,
      };
    },
    unmount: () => {
      root.unmount();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
  };

  return (
    <main
      className="main-content side-panel-is-open"
      style={{
        height: "100dvh",
        gridTemplateColumns: "760px 440px",
        gridTemplateAreas: '"player side-panel"',
      }}
    >
      <div
        className="artwork-stage"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 760,
          height: 680,
          background: "linear-gradient(145deg, #162f41, #3e234a)",
          borderRadius: 0,
        }}
      >
        <AudioVisualizer
          audioRef={audioRef}
          getAudioAnalyser={getAudioAnalyser}
          settings={settings}
          themeKey={themeKey}
          onStatus={(next, detail) => {
            setStatus(next);
            setStatusDetail(detail);
          }}
        />
        <output
          data-testid="visualizer-status"
          style={{ position: "absolute", top: 8, left: 8 }}
        >
          {status}
          {statusDetail ? `: ${statusDetail}` : ""}
        </output>
      </div>
      <PlayerToolsPanel
        panelRef={panelRef}
        open
        onClose={() => {}}
        settingsContent={<p>General settings fixture</p>}
        visualizerContent={
          <VisualizerSettingsPanel
            settings={settings}
            onChange={setSettings}
            status={status}
            statusDetail={statusDetail}
          />
        }
      />
    </main>
  );
}

root.render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
