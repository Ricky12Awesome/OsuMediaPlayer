import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { AudioLines, ChevronDown, RotateCcw } from "lucide-react";
import { SettingsPicker } from "./SettingsPicker";
import {
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
  previewVisualizerColor,
  type VisualizerColorField,
} from "./visualizer-color";
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
import { PreferenceTransferControls } from "./PreferenceTransferControls";
import {
  exportVisualizerSettings,
  importVisualizerSettings,
} from "./preference-transfer";

export interface VisualizerSettingsPanelProps {
  settings: VisualizerSettings;
  onChange: Dispatch<SetStateAction<VisualizerSettings>>;
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

function rangeProgressStyle(value: number, min: number, max: number) {
  const progress = Math.min(
    100,
    Math.max(0, ((value - min) / (max - min)) * 100),
  );
  return { "--range-progress": `${progress}%` } as CSSProperties;
}

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
        style={rangeProgressStyle(value, range.min, range.max)}
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

function ColorControl({
  id,
  field,
  label,
  value,
  onChange,
}: {
  id: string;
  field: VisualizerColorField;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const persistedRef = useRef(value);
  const draftRef = useRef(value);
  const hexRef = useRef(value);
  const hsvRef = useRef(hexToHsv(value));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hexText, setHexText] = useState(value);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [position, setPosition] = useState({ left: 0, top: 0, width: 272 });
  onChangeRef.current = onChange;
  persistedRef.current = value;
  const portalTarget = triggerRef.current?.closest("dialog") ?? document.body;

  const preview = (next: string, nextHsv = hexToHsv(next)) => {
    draftRef.current = next;
    hexRef.current = next;
    hsvRef.current = nextHsv;
    setDraft(next);
    setHexText(next);
    setHsv(nextHsv);
    previewVisualizerColor(field, next);
  };

  const apply = (focus = true) => {
    const next = normalizeHexColor(hexRef.current) ?? draftRef.current;
    if (next !== persistedRef.current) {
      persistedRef.current = next;
      onChangeRef.current(next);
    }
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  };

  const cancel = () => {
    preview(persistedRef.current);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    draftRef.current = value;
    hexRef.current = value;
    hsvRef.current = hexToHsv(value);
    setDraft(value);
    setHexText(value);
    setHsv(hsvRef.current);
  }, [value]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const popup = popupRef.current;
      if (!trigger || !popup) return;
      const width = Math.min(272, window.innerWidth - 24);
      const height = popup.offsetHeight;
      const below = window.innerHeight - trigger.bottom - 12;
      const above = trigger.top - 12;
      setPosition({
        width,
        left: Math.max(
          12,
          Math.min(trigger.right - width, window.innerWidth - width - 12),
        ),
        top:
          below < height && above > below
            ? Math.max(12, trigger.top - height - 6)
            : Math.min(trigger.bottom + 6, window.innerHeight - height - 12),
      });
    };
    updatePosition();
    popupRef.current
      ?.querySelector<HTMLInputElement>("input[type=range]")
      ?.focus({
        preventScroll: true,
      });
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !popupRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      )
        apply(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const changeHsv = (patch: Partial<typeof hsv>) => {
    const next = { ...hsvRef.current, ...patch };
    preview(hsvToHex(next.hue, next.saturation, next.brightness), next);
  };

  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="settings-color-input visualizer-color-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-picker` : undefined}
        onClick={() => (open ? apply() : setOpen(true))}
      >
        <span
          className="visualizer-color-swatch"
          style={{ background: value }}
        />
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            id={`${id}-picker`}
            className="control-popover visualizer-color-popup"
            role="dialog"
            aria-label={`${label} picker`}
            style={
              {
                ...position,
                "--picker-hue": `${Math.round(hsv.hue)}`,
                "--picker-full-color": hsvToHex(hsv.hue, hsv.saturation, 100),
              } as CSSProperties
            }
          >
            <div className="visualizer-color-header">
              <span>{label}</span>
              <span
                className="visualizer-color-preview"
                style={{ background: draft }}
              />
            </div>
            <label className="visualizer-color-control">
              <span>Hue</span>
              <input
                className="settings-range-input visualizer-hue-range"
                type="range"
                min={0}
                max={359}
                value={Math.round(hsv.hue)}
                aria-label={`${label} hue`}
                onChange={(event) =>
                  changeHsv({ hue: Number(event.target.value) })
                }
              />
            </label>
            <label className="visualizer-color-control">
              <span>Saturation</span>
              <input
                className="settings-range-input visualizer-saturation-range"
                type="range"
                min={0}
                max={100}
                value={Math.round(hsv.saturation)}
                aria-label={`${label} saturation`}
                onChange={(event) =>
                  changeHsv({ saturation: Number(event.target.value) })
                }
              />
            </label>
            <label className="visualizer-color-control">
              <span>Brightness</span>
              <input
                className="settings-range-input visualizer-brightness-range"
                type="range"
                min={0}
                max={100}
                value={Math.round(hsv.brightness)}
                aria-label={`${label} brightness`}
                onChange={(event) =>
                  changeHsv({ brightness: Number(event.target.value) })
                }
              />
            </label>
            <label className="visualizer-color-control">
              <span>Hex color</span>
              <input
                className="settings-number-input visualizer-color-hex"
                type="text"
                maxLength={7}
                value={hexText}
                aria-label={`${label} hex color`}
                onChange={(event) => {
                  const text = event.target.value;
                  hexRef.current = text;
                  setHexText(text);
                  const next = normalizeHexColor(text);
                  if (next) preview(next);
                }}
                onBlur={() => {
                  if (!normalizeHexColor(hexRef.current)) {
                    hexRef.current = draftRef.current;
                    setHexText(draftRef.current);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") apply();
                }}
              />
            </label>
            <div className="visualizer-color-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={cancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => apply()}
              >
                Apply
              </button>
            </div>
          </div>,
          portalTarget,
        )}
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
        style={rangeProgressStyle(value, min, max)}
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
    onChange((current) => parseVisualizerSettings({ ...current, ...patch }));
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
        {number("glow")}
      </details>

      <details className="settings-block visualizer-section">
        <summary className="settings-label">COLOR & OPACITY</summary>
        {choice("colorMode", "Visualizer colors")}
        {settings.colorMode === "custom" &&
          (["color1", "color2"] as const).map((field, index) => (
            <ColorControl
              key={field}
              id={`${id}-${field}`}
              field={field}
              label={`Color ${index + 1}`}
              value={settings[field]}
              onChange={(value) => update({ [field]: value })}
            />
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
      <div className="settings-block">
        <span className="settings-label">IMPORT &amp; EXPORT</span>
        <p className="settings-hint">
          Import replaces all visualizer settings.
        </p>
        <PreferenceTransferControls
          name="Visualizer settings"
          filename="osu-media-player-visualizer.json"
          exportData={() => exportVisualizerSettings(settings)}
          parseImport={importVisualizerSettings}
          onImport={onChange}
        />
      </div>
    </>
  );
}
