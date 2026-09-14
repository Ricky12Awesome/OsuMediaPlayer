import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  type VisualizerLayoutSettings,
  type VisualizerSettings,
  parseVisualizer,
  fftLeadingOffset,
  retainWaveform,
  visualizerBarIndex,
} from "./visualizer-settings";

const key = "osu-music-visualizer";

function normalizeVisualizerValue(name: string, value: number): number {
  return name === "rotation" ? Math.round(value * 4) / 4 : value;
}

function visualizerStep(name: string): number {
  return name === "rotation" ? 0.25 : 1;
}

export function useVisualizerSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      return parseVisualizer(localStorage.getItem(key));
    } catch {
      return parseVisualizer(null);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {
      /* Optional storage. */
    }
  }, [settings]);
  return [settings, setSettings] as const;
}

export function VisualizerControls({
  settings,
  onChange,
}: {
  settings: VisualizerSettings;
  onChange: (settings: VisualizerSettings) => void;
}) {
  const layoutSettings = settings[settings.layout];
  const updateLayout = (patch: Partial<VisualizerLayoutSettings>) =>
    onChange({
      ...settings,
      [settings.layout]: { ...layoutSettings, ...patch },
    });
  const toggleGlobal = (title: string, description: string) => (
    <button
      type="button"
      className={"settings-toggle " + (settings.enabled ? "active" : "")}
      aria-pressed={settings.enabled}
      title={description}
      onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
    >
      <span className="settings-toggle-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="settings-toggle-status">
        {settings.enabled ? "On" : "Off"}
      </span>
    </button>
  );
  const toggle = (
    key: "mirrored" | "flipped" | "mirrorVertically",
    title: string,
    description: string,
    disabled = false,
  ) => (
    <button
      type="button"
      className={"settings-toggle " + (layoutSettings[key] ? "active" : "")}
      aria-pressed={layoutSettings[key]}
      disabled={disabled}
      title={description}
      onClick={() => updateLayout({ [key]: !layoutSettings[key] })}
    >
      <span className="settings-toggle-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="settings-toggle-status">
        {layoutSettings[key] ? "On" : "Off"}
      </span>
    </button>
  );
  return (
    <div className="settings-block visualizer-settings">
      <span className="settings-label">AUDIO VISUALIZER</span>
      {toggleGlobal("Show visualizer", "Display bars over the artwork")}
      <fieldset>
        <legend>Style</legend>
        <div className="transport-layout-options visualizer-variant-options">
          {(
            [
              ["circle", "fft", "Circle (FFT)"],
              ["circle", "waveform", "Circle (Waveform)"],
              ["line", "fft", "Line (FFT)"],
              ["line", "waveform", "Line (Waveform)"],
            ] as const
          ).map(([layout, mode, title]) => (
            <button
              key={`${layout}-${mode}`}
              type="button"
              aria-pressed={
                settings.layout === layout && layoutSettings.mode === mode
              }
              className={
                "transport-layout-option " +
                (settings.layout === layout && layoutSettings.mode === mode
                  ? "active"
                  : "")
              }
              onClick={() =>
                onChange({
                  ...settings,
                  layout,
                  [layout]: { ...settings[layout], mode },
                })
              }
            >
              <strong>{title}</strong>
            </button>
          ))}
        </div>
      </fieldset>
      {settings.layout === "line" ? (
        <fieldset>
          <legend>Mirroring</legend>
          {toggle(
            "mirrored",
            "Mirror bar sequence",
            "Reflect the sequence around its peak",
          )}
          {toggle(
            "flipped",
            "Flip mirrored direction",
            "Place the lowest frequency at the center",
            !layoutSettings.mirrored,
          )}
          {toggle(
            "mirrorVertically",
            "Mirror vertically",
            "Extend bars equally above and below the baseline",
          )}
        </fieldset>
      ) : (
        <fieldset>
          <legend>Mirroring</legend>
          {toggle(
            "mirrored",
            "Mirror bar sequence",
            "Reflect the sequence around the ring",
          )}
          {toggle(
            "flipped",
            "Flip mirrored direction",
            "Reverse the mirrored frequency order",
            !layoutSettings.mirrored,
          )}
          {toggle(
            "mirrorVertically",
            "Mirror vertically",
            "Reflect one semicircle onto the other",
          )}
        </fieldset>
      )}
      <fieldset className="visualizer-dimensions">
        <legend>Bars</legend>
        {(
          [
            [
              "bars",
              layoutSettings.mirrored
                ? "Bars before mirroring"
                : "Amount of bars",
              8,
              256,
              "",
            ],
            ["width", "Bar width (%)", 10, 100, "%"],
            ["length", "Bar length (%)", 10, 100, "%"],
            ...(layoutSettings.mode === "waveform"
              ? ([
                  ["waveformMultiplier", "Waveform multiplier", 1, 25, "×"],
                  ["waveformRetention", "Waveform retention", 0, 250, " ms"],
                ] as const)
              : []),
            ...(layoutSettings.mode === "fft"
              ? ([["fftRetention", "FFT retention", 0, 250, " ms"]] as const)
              : []),
            ...(settings.layout === "circle"
              ? ([
                  ["inwardLength", "Inward length", 0, 100, "%"],
                  ["radius", "Circle radius", 8, 45, "%"],
                  ["rotation", "Circle rotation", -6, 6, ""],
                ] as const)
              : []),
          ] as const
        ).map(([name, label, min, max, unit]) => (
          <div className="visualizer-slider-card" key={name}>
            <div className="visualizer-slider-heading">
              <label htmlFor={`visualizer-${name}`}>
                {label.replace(" (%)", "")}
              </label>
              <output htmlFor={`visualizer-${name}`}>
                {name === "rotation" &&
                normalizeVisualizerValue(name, layoutSettings[name]) === 0
                  ? "Off"
                  : `${normalizeVisualizerValue(name, layoutSettings[name])}${unit}`}
              </output>
            </div>
            <div className="visualizer-slider-control">
              <button
                type="button"
                aria-label={`Decrease ${label}`}
                disabled={
                  normalizeVisualizerValue(name, layoutSettings[name]) <= min
                }
                onClick={() =>
                  updateLayout({
                    [name]: Math.max(
                      min,
                      normalizeVisualizerValue(name, layoutSettings[name]) -
                        visualizerStep(name),
                    ),
                  })
                }
              >
                −
              </button>
              <input
                id={`visualizer-${name}`}
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={visualizerStep(name)}
                value={normalizeVisualizerValue(name, layoutSettings[name])}
                aria-valuetext={
                  name === "rotation" &&
                  normalizeVisualizerValue(name, layoutSettings[name]) === 0
                    ? "Off"
                    : `${normalizeVisualizerValue(name, layoutSettings[name])}${name === "bars" ? " bars" : unit}`
                }
                style={
                  {
                    "--slider-progress": `${((normalizeVisualizerValue(name, layoutSettings[name]) - min) / (max - min)) * 100}%`,
                  } as CSSProperties
                }
                onChange={(e) =>
                  updateLayout({
                    [name]: normalizeVisualizerValue(
                      name,
                      Number(e.target.value),
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Increase ${label}`}
                disabled={
                  normalizeVisualizerValue(name, layoutSettings[name]) >= max
                }
                onClick={() =>
                  updateLayout({
                    [name]: Math.min(
                      max,
                      normalizeVisualizerValue(name, layoutSettings[name]) +
                        visualizerStep(name),
                    ),
                  })
                }
              >
                +
              </button>
            </div>
            <div className="visualizer-slider-limits" aria-hidden="true">
              <span>
                {min}
                {unit}
              </span>
              <span>
                {max}
                {unit}
              </span>
            </div>
          </div>
        ))}
      </fieldset>
    </div>
  );
}

export function AudioVisualizer({
  analyser,
  playing,
  settings,
}: {
  analyser: AnalyserNode | null;
  playing: boolean;
  settings: VisualizerSettings;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(settings);
  latest.current = settings;
  const playbackRef = useRef(playing);
  playbackRef.current = playing;
  const playbackMixRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !settings.enabled) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      setUnavailable(true);
      return;
    }
    let frame = 0,
      visible = true,
      lost = false;
    let width = 0,
      height = 0;
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram()!;
    const buffer = gl.createBuffer()!;
    const setup = () => {
      for (const [type, code] of [
        [
          gl.VERTEX_SHADER,
          "attribute vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}",
        ],
        [
          gl.FRAGMENT_SHADER,
          "precision mediump float; uniform vec3 color; void main(){gl_FragColor=vec4(color * 0.8,0.8);}",
        ],
      ] as const) {
        const shader = gl.createShader(type)!;
        shaders.push(shader);
        gl.shaderSource(shader, code);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return false;
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, 1022 * 12 * 4, gl.DYNAMIC_DRAW);
      const position = gl.getAttribLocation(program, "p");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      return true;
    };
    const ready = setup();
    setUnavailable(!ready);
    const sampleSize = analyser?.fftSize ?? 2048;
    const samples = new Uint8Array(sampleSize);
    const waveform = new Float32Array(sampleSize);
    const retained = new Float32Array(256);
    const initialLayoutSettings = settings[settings.layout];
    let previousMode = initialLayoutSettings.mode;
    let previousBars = initialLayoutSettings.bars;
    let previousLayout = settings.layout;
    const amplitudes = new Float32Array(256);
    const liveAmplitudes = new Float32Array(256);
    const vertices = new Float32Array(1022 * 12);
    let lastFrame = -Infinity;
    const draw = (time: number) => {
      frame = 0;
      if (!ready || lost) return;

      if (document.hidden || !visible || width === 0 || height === 0) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      if (time - lastFrame < 1000 / 60 - 1) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const elapsed = Number.isFinite(lastFrame) ? time - lastFrame : 1000 / 60;
      lastFrame = time;
      const activeAnalyser = playbackRef.current ? analyser : null;
      const targetMix = activeAnalyser ? 1 : 0;
      const mixStep = Math.min(1, Math.max(0, elapsed / 280));
      const playbackMix =
        playbackMixRef.current + (targetMix - playbackMixRef.current) * mixStep;
      playbackMixRef.current = playbackMix;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const s = latest.current;
      const layoutSettings = s[s.layout];
      const mode = layoutSettings.mode;
      const bars = layoutSettings.bars;
      if (
        s.layout !== previousLayout ||
        mode !== previousMode ||
        bars !== previousBars
      ) {
        retained.fill(0);
        liveAmplitudes.fill(0);
      }
      previousLayout = s.layout;
      previousMode = mode;
      previousBars = bars;
      if (activeAnalyser && mode === "fft")
        activeAnalyser.getByteFrequencyData(samples);
      else if (activeAnalyser) activeAnalyser.getFloatTimeDomainData(waveform);
      const scale = Math.min(width, height);
      const radius =
        scale * (s.layout === "circle" ? layoutSettings.radius / 100 : 0.23);
      const maxLength = (scale * 0.2 * layoutSettings.length) / 100;
      // Analyze once before mirroring, so trimming preserves all symmetries.
      for (let i = 0; i < bars; i++) {
        let liveAmplitude = liveAmplitudes[i];
        if (activeAnalyser) {
          let amplitude = 0;
          if (mode === "fft") {
            const endBin = Math.min(
              activeAnalyser.frequencyBinCount,
              Math.floor(
                (18000 * activeAnalyser.fftSize) /
                  activeAnalyser.context.sampleRate,
              ),
            );
            const start = Math.floor(Math.pow(endBin, i / bars));
            const end = Math.max(
              start + 1,
              Math.floor(Math.pow(endBin, (i + 1) / bars)),
            );
            for (let j = start; j < end; j++)
              amplitude = Math.max(amplitude, samples[j] / 255);
            amplitude = retainWaveform(
              retained[i],
              amplitude,
              elapsed,
              layoutSettings.fftRetention,
            );
            retained[i] = amplitude;
          } else {
            const sample =
              waveform[Math.floor((i * (waveform.length - 1)) / (bars - 1))];
            const target = Math.min(
              1,
              Math.abs(sample) * layoutSettings.waveformMultiplier,
            );
            amplitude = retainWaveform(
              retained[i],
              target,
              elapsed,
              layoutSettings.waveformRetention,
            );
            retained[i] = amplitude;
          }
          liveAmplitude = amplitude;
          liveAmplitudes[i] = amplitude;
        }

        const breath = 0.08 + 0.045 * (0.5 + 0.5 * Math.sin(time * 0.0012));
        const ripple = 0.025 * Math.sin(time * 0.0018 + i * 0.24);
        const idleAmplitude = Math.max(0, Math.min(1, breath + ripple));
        amplitudes[i] = Math.max(
          idleAmplitude,
          liveAmplitude * playbackMix + idleAmplitude * (1 - playbackMix),
        );
      }
      const offset = mode === "fft" ? fftLeadingOffset(amplitudes, bars) : 0;
      const count = bars - offset;
      const mirrored = layoutSettings.mirrored;
      const flipped = layoutSettings.flipped;
      const barCount = count === 0 ? 0 : mirrored ? count * 2 - 1 : count;
      const mirrorCircle =
        s.layout === "circle" && layoutSettings.mirrorVertically;
      const drawnBars = mirrorCircle ? barCount * 2 : barCount;
      const rotationRpm = normalizeVisualizerValue(
        "rotation",
        layoutSettings.rotation,
      );
      const circleRotation =
        s.layout === "circle" ? (time / 60000) * rotationRpm * Math.PI * 2 : 0;
      for (let i = 0; i < barCount; i++) {
        const sampleIndex = visualizerBarIndex(i, count, mirrored, flipped);
        const amplitude = amplitudes[offset + sampleIndex];
        const angle = mirrorCircle
          ? ((i + 0.5) / drawnBars) * Math.PI * 2
          : (i / barCount) * Math.PI * 2 - Math.PI / 2;
        const dx = s.layout === "circle" ? Math.cos(angle) : 0;
        const dy = s.layout === "circle" ? Math.sin(angle) : -1;
        const x =
          s.layout === "circle"
            ? width / 2 + dx * radius
            : width * (0.08 + (0.84 * (i + 0.5)) / barCount);
        const y = s.layout === "circle" ? height / 2 + dy * radius : height / 2;
        const halfWidth =
          (((s.layout === "circle" ? 2 * Math.PI * radius : width * 0.84) /
            drawnBars) *
            layoutSettings.width) /
          200;
        const length = amplitude * maxLength;
        const mirrorBaseline =
          layoutSettings.mirrorVertically && s.layout === "line";
        const inwardLength =
          s.layout === "circle"
            ? length * (layoutSettings.inwardLength / 100)
            : 0;
        const low =
          s.layout === "circle"
            ? -inwardLength
            : mirrorBaseline
              ? -Math.abs(length)
              : 0;
        const high = mirrorBaseline ? Math.abs(length) : length;
        // Two triangles per bar, uploaded and drawn together in one call.
        for (let v = 0; v < 6; v++) {
          const side = v === 0 || v === 3 || v === 5 ? -halfWidth : halfWidth;
          const along = v === 0 || v === 1 || v === 3 ? low : high;
          vertices[i * 12 + v * 2] =
            ((x + dx * along - dy * side) / width) * 2 - 1;
          vertices[i * 12 + v * 2 + 1] =
            1 - ((y + dy * along + dx * side) / height) * 2;
          if (mirrorCircle) {
            // Reflect the same geometry across the horizontal diameter.
            const reflected = (drawnBars - 1 - i) * 12 + v * 2;
            vertices[reflected] = vertices[i * 12 + v * 2];
            vertices[reflected + 1] = -vertices[i * 12 + v * 2 + 1];
          }
        }
      }
      if (s.layout === "circle" && circleRotation !== 0) {
        // Rotate around the canvas center in pixel space. NDC x/y have
        // different scales when the canvas is not square, so compensate for
        // the aspect ratio while applying the clockwise screen-space turn.
        const cosine = Math.cos(circleRotation);
        const sine = Math.sin(circleRotation);
        const heightToWidth = height / width;
        const widthToHeight = width / height;
        for (let i = 0; i < drawnBars * 12; i += 2) {
          const x = vertices[i];
          const y = vertices[i + 1];
          vertices[i] = cosine * x + sine * heightToWidth * y;
          vertices[i + 1] = -sine * widthToHeight * x + cosine * y;
        }
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
      gl.drawArrays(gl.TRIANGLES, 0, drawnBars * 6);
      frame = requestAnimationFrame(draw);
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    const colorLocation = gl.getUniformLocation(program, "color");
    const updateColor = () => {
      if (!ready || lost) return;
      const rgb = getComputedStyle(canvas)
        .getPropertyValue("--pink-rgb")
        .trim()
        .split(/\s+/)
        .map(Number);
      const color =
        rgb.length === 3 && rgb.every(Number.isFinite) ? rgb : [255, 102, 170];
      gl.uniform3f(
        colorLocation,
        color[0] / 255,
        color[1] / 255,
        color[2] / 255,
      );
      refresh();
    };
    // Theme variables live on the app shell; react only to theme mutations.
    const themeObserver = new MutationObserver(updateColor);
    for (
      let element: Element | null = canvas;
      element;
      element = element.parentElement
    )
      themeObserver.observe(element, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    updateColor();
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      refresh();
    });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    const contextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      setUnavailable(true);
    };
    // Remounting restores all GPU resources after a context loss.
    const contextRestored = () => setRevision((value) => value + 1);
    resize.observe(canvas);
    intersection.observe(canvas);
    document.addEventListener("visibilitychange", refresh);
    canvas.addEventListener("webglcontextlost", contextLost);
    canvas.addEventListener("webglcontextrestored", contextRestored);
    refresh();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      themeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
    };
  }, [analyser, settings.enabled, revision]);
  if (!settings.enabled) return null;
  return (
    <>
      <canvas className="audio-visualizer" ref={canvasRef} aria-hidden="true" />
      {unavailable && (
        <span className="visualizer-unavailable">
          Visualizer unavailable: WebGL is not available.
        </span>
      )}
    </>
  );
}
