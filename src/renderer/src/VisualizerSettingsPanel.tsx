import { useEffect, useId, useState } from "react";
import { AudioLines, RotateCcw } from "lucide-react";
import { SettingsPicker } from "./SettingsPicker";
import {
  applyVisualizerPreset,
  defaultVisualizerSettings,
  parseVisualizerSettings,
  visualizerOptions,
  visualizerPresets,
  visualizerRanges,
  type VisualizerRangeKey,
  type VisualizerSettings,
  type VisualizerStatus,
} from "./visualizer-settings";
import "./visualizer-settings.css";

export interface VisualizerSettingsPanelProps {
  settings: VisualizerSettings;
  onChange: (settings: VisualizerSettings) => void;
  status: VisualizerStatus;
  statusDetail?: string;
}

const statusLabels: Record<VisualizerStatus, string> = {
  off: "Visualizer is off",
  loading: "Starting visualizer…",
  ready: "Ready · WebGPU",
  unsupported: "WebGPU is unavailable on this device",
  error: "Visualizer could not start",
};

function NumberControl({
  field,
  value,
  onChange,
  hint,
}: {
  field: VisualizerRangeKey;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  const id = useId();
  const range = visualizerRanges[field];
  const [draft, setDraft] = useState(String(value));
  const label = range.label + (range.unit ? ` (${range.unit})` : "");
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const candidate = draft.trim() ? Number(draft) : NaN;
    let next = Number.isFinite(candidate)
      ? Math.min(range.max, Math.max(range.min, candidate))
      : value;
    if (field === "barCount") next = Math.round(next);
    setDraft(String(next));
    onChange(next);
  };
  return (
    <div className="visualizer-number-setting">
      <div className="settings-row">
        <label className="settings-row-label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="settings-number-input"
          type="number"
          min={range.min}
          max={range.max}
          step={range.step}
          value={draft}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(String(value));
            }
          }}
        />
      </div>
      <input
        className="settings-range-input"
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={`${range.label} slider`}
        aria-valuetext={`${value}${range.unit ? ` ${range.unit}` : ""}`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && (
        <p className="settings-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function VisualizerSettingsPanel({
  settings,
  onChange,
  status,
  statusDetail,
}: VisualizerSettingsPanelProps) {
  const id = useId();
  const update = (patch: Partial<VisualizerSettings>) => {
    if (
      patch.maxFrequency !== undefined &&
      patch.maxFrequency <= settings.minFrequency
    ) {
      patch.minFrequency = Math.max(20, patch.maxFrequency - 1);
    }
    onChange(parseVisualizerSettings({ ...settings, ...patch }));
  };
  const number = (field: VisualizerRangeKey, hint?: string) => (
    <NumberControl
      key={field}
      field={field}
      value={settings[field]}
      onChange={(value) => update({ [field]: value })}
      hint={hint}
    />
  );
  const choice = (field: keyof typeof visualizerOptions, label: string) => (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <SettingsPicker<string | number>
        label={label}
        value={settings[field]}
        options={visualizerOptions[field]}
        onChange={(value) => update({ [field]: value })}
      />
    </div>
  );
  const toggle = (
    field: "enabled" | "mirror" | "reverse" | "respectReducedMotion",
    label: string,
  ) => (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <button
        type="button"
        className={`settings-switch ${settings[field] ? "active" : ""}`}
        aria-label={label}
        aria-pressed={settings[field]}
        onClick={() => update({ [field]: !settings[field] })}
      >
        {settings[field] ? "On" : "Off"}
      </button>
    </div>
  );

  return (
    <>
      <div className="settings-block">
        <span className="settings-label">
          <AudioLines size={16} /> AUDIO VISUALIZER
        </span>
        {toggle("enabled", "Enable visualizer")}
        <p className="settings-hint" role="status">
          {statusLabels[settings.enabled ? status : "off"]}
          {settings.enabled && statusDetail ? `. ${statusDetail}` : ""}
        </p>
        <p className="settings-hint">
          Reacts to the playing audio over your artwork or video.
        </p>
        <div
          className="settings-actions visualizer-presets"
          aria-label="Visualizer presets"
        >
          {visualizerPresets.map((preset, index) => (
            <button
              key={preset.label}
              type="button"
              className="secondary-button"
              onClick={() => onChange(applyVisualizerPreset(settings, index))}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <details className="settings-block visualizer-section" open>
        <summary className="settings-label">STYLE & GEOMETRY</summary>
        {choice("style", "Visualizer style")}
        {settings.style === "line" && choice("linePosition", "Line placement")}
        {number("barCount")}
        {number("barWidth", "Width within each bar's available space.")}
        {number(
          "barLength",
          "Maximum response length as a percentage of the shorter canvas side.",
        )}
        {number("gap")}
        {number(
          "centerOffset",
          "Moves this percentage of each bar opposite its growth direction. 50% balances both sides; circles shift toward their center.",
        )}
        {settings.style !== "line" &&
          number("radius", "Percentage of the shorter canvas side.")}
        {number("lineThickness")}
        {number("scale")}
        {number("positionX")}
        {number("positionY")}
        {settings.style !== "line" && (
          <>
            {number("rotation")}
            {number(
              "rotationSpeed",
              "Negative values rotate in the opposite direction.",
            )}
          </>
        )}
        {toggle("mirror", "Mirror frequency layout")}
        {toggle("reverse", "Reverse frequency order")}
      </details>

      <details className="settings-block visualizer-section" open>
        <summary className="settings-label">AUDIO RESPONSE</summary>
        {choice("mode", "Analysis mode")}
        {number(
          "responsivenessMs",
          "Time to reach each new target, both up and down. 0 ms responds instantly.",
        )}
        {number("sensitivity")}
        {choice("fftSize", "FFT size")}
        <p className="settings-hint">
          Larger FFT sizes separate nearby frequencies with a longer audio
          window.
        </p>
        {settings.mode === "energy" && (
          <p className="settings-hint">
            All bars pulse together with the audio's overall loudness.
          </p>
        )}
        {settings.mode === "spectrum" && (
          <>
            {choice("frequencyScale", "Frequency spacing")}
            {number("minFrequency")}
            {number("maxFrequency")}
          </>
        )}
      </details>

      <details className="settings-block visualizer-section">
        <summary className="settings-label">MOTION & EFFECTS</summary>
        {number(
          "boom",
          "Pulses the visualizer's size with the music. 0% disables the pulse.",
        )}
        {number("bassImpact", "Adds emphasis when low frequencies are strong.")}
        {number("beatImpact", "Highlights sudden increases in audio energy.")}
        {number("glow")}
      </details>

      <details className="settings-block visualizer-section">
        <summary className="settings-label">COLOR & OPACITY</summary>
        {choice("colorMode", "Visualizer colors")}
        {settings.colorMode === "custom" &&
          (["color1", "color2"] as const).map((field, index) => (
            <div className="settings-row" key={field}>
              <label className="settings-row-label" htmlFor={`${id}-${field}`}>
                Color {index + 1}
              </label>
              <input
                id={`${id}-${field}`}
                className="settings-color-input"
                type="color"
                value={settings[field]}
                onChange={(event) => update({ [field]: event.target.value })}
              />
            </div>
          ))}
        {number("opacity")}
      </details>

      <details className="settings-block visualizer-section">
        <summary className="settings-label">
          PERFORMANCE & ACCESSIBILITY
        </summary>
        {choice("maxFps", "Frame rate")}
        {choice("resolution", "Render resolution")}
        <p className="settings-hint">Lower values reduce graphics usage.</p>
        {toggle("respectReducedMotion", "Respect reduced motion")}
        <p className="settings-hint">
          Uses calmer motion when your system requests reduced motion.
        </p>
      </details>

      <div className="settings-block settings-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={() =>
            onChange({
              ...defaultVisualizerSettings,
              enabled: settings.enabled,
            })
          }
        >
          <RotateCcw size={15} /> Restore visualizer defaults
        </button>
      </div>
    </>
  );
}
