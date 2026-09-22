import { useEffect, useId, useState } from "react";
import { AudioLines, RotateCcw } from "lucide-react";
import { SettingsPicker } from "./SettingsPicker";
import {
  defaultVisualizerSettings,
  parseVisualizerSettings,
  visualizerOptions,
  visualizerRanges,
  type FrequencyRange,
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
}: {
  field: VisualizerRangeKey;
  value: number;
  onChange: (value: number) => void;
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
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function FrequencyRangeField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (candidate: number) => {
    const next = Math.min(max, Math.max(min, candidate));
    if (onCommit(next)) setDraft(String(next));
    else setDraft(String(value));
  };
  return (
    <div className="visualizer-frequency-endpoint">
      <label>
        <span>{label}</span>
        <input
          className="settings-number-input"
          type="number"
          min={min}
          max={max}
          step={1}
          aria-label={label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const candidate = Number(draft);
            if (Number.isFinite(candidate)) commit(candidate);
            else setDraft(String(value));
          }}
        />
      </label>
      <input
        className="settings-range-input"
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={`${label} slider`}
        aria-valuetext={`${value} Hz`}
        onChange={(event) => commit(Number(event.target.value))}
      />
    </div>
  );
}

function FrequencyRangesControl({
  ranges,
  onChange,
}: {
  ranges: FrequencyRange[];
  onChange: (ranges: FrequencyRange[]) => void;
}) {
  const updateRange = (index: number, patch: Partial<FrequencyRange>) => {
    const next = ranges.map((range, rangeIndex) =>
      rangeIndex === index ? { ...range, ...patch } : range,
    );
    if (next[index].min >= next[index].max) return false;
    onChange(next);
    return true;
  };
  return (
    <div className="visualizer-frequency-ranges">
      <div className="settings-label">Frequency ranges (Hz)</div>
      {ranges.map((range, index) => (
        <div className="visualizer-frequency-range" key={index}>
          <div className="visualizer-frequency-range-header">
            <span>Range {index + 1}</span>
            <button
              className="secondary-button"
              type="button"
              aria-label={`Remove frequency range ${index + 1}`}
              disabled={ranges.length === 1}
              onClick={() => onChange(ranges.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <div className="visualizer-frequency-range-endpoints">
            <FrequencyRangeField
              label={`Range ${index + 1} lowest frequency`}
              value={range.min}
              min={20}
              max={range.max - 1}
              onCommit={(min) => updateRange(index, { min })}
            />
            <FrequencyRangeField
              label={`Range ${index + 1} highest frequency`}
              value={range.max}
              min={range.min + 1}
              max={22050}
              onCommit={(max) => updateRange(index, { max })}
            />
          </div>
        </div>
      ))}
      <button
        className="secondary-button"
        type="button"
        onClick={() => {
          const last = ranges.at(-1);
          const min = last && last.max < 22049 ? last.max + 1 : 20;
          const max = min === 20 ? 1000 : Math.min(22050, min + 5000);
          onChange([...ranges, { min, max }]);
        }}
      >
        Add frequency range
      </button>
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
    onChange(parseVisualizerSettings({ ...settings, ...patch }));
  };
  const number = (field: VisualizerRangeKey) => (
    <NumberControl
      key={field}
      field={field}
      value={settings[field]}
      onChange={(value) => update({ [field]: value })}
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
      </div>

      <details className="settings-block visualizer-section" open>
        <summary className="settings-label">STYLE & GEOMETRY</summary>
        {choice("style", "Visualizer style")}
        {(settings.style === "line" ||
          settings.style === "wire-line" ||
          settings.style === "ripple-line") && (
          <>
            {choice("linePosition", "Line placement")}
            {number("linePadding")}
          </>
        )}
        {number("barCount")}
        {number("barWidth")}
        {number("barLength")}
        {number("gap")}
        {number("centerOffset")}
        {settings.style !== "line" &&
          settings.style !== "wire-line" &&
          settings.style !== "ripple-line" &&
          number("radius")}
        {number("lineThickness")}
        {number("scale")}
        {number("positionX")}
        {number("positionY")}
        {settings.style !== "line" &&
          settings.style !== "wire-line" &&
          settings.style !== "ripple-line" && (
            <>
              {number("rotation")}
              {number("rotationSpeed")}
            </>
          )}
        {toggle("mirror", "Mirror frequency layout")}
        {toggle("reverse", "Reverse frequency order")}
      </details>

      <details className="settings-block visualizer-section" open>
        <summary className="settings-label">AUDIO RESPONSE</summary>
        {choice("mode", "Analysis mode")}
        {number("responsivenessMs")}
        {number("sensitivity")}
        {choice("fftSize", "FFT size")}
        {settings.mode === "spectrum" && (
          <>
            {choice("frequencyScale", "Frequency spacing")}
            <FrequencyRangesControl
              ranges={settings.frequencyRanges}
              onChange={(frequencyRanges) => update({ frequencyRanges })}
            />
          </>
        )}
      </details>

      <details className="settings-block visualizer-section">
        <summary className="settings-label">MOTION & EFFECTS</summary>
        {number("boom")}
        {number("bassImpact")}
        {number("beatImpact")}
        {choice("beatMode", "Beat response")}
        {settings.beatMode === "detected" && number("beatSensitivity")}
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
        {toggle("respectReducedMotion", "Respect reduced motion")}
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
