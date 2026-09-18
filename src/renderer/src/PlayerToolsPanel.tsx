import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { AudioWaveform, Settings2, X } from "lucide-react";
import type { VisualizerSettings } from "./visualizer-settings";
import { VisualizerControls } from "./AudioVisualizer";

export type SidePanelTab = "visualizer" | "settings";

interface PlayerToolsPanelProps {
  panelRef: RefObject<HTMLElement | null>;
  open: boolean;
  tab: SidePanelTab;
  setTab: Dispatch<SetStateAction<SidePanelTab>>;
  onClose: () => void;
  visualizer: VisualizerSettings;
  setVisualizer: (settings: VisualizerSettings) => void;
  settingsContent: ReactNode;
}

export function PlayerToolsPanel({
  panelRef,
  open,
  tab,
  setTab,
  onClose,
  visualizer,
  setVisualizer,
  settingsContent,
}: PlayerToolsPanelProps) {
  return (
    <aside
      ref={panelRef}
      id="side-settings-panel"
      className={"side-panel " + (open ? "is-open" : "")}
      aria-label="Player tools"
      aria-hidden={!open}
      inert={!open || undefined}
    >
      <div className="side-panel-heading">
        <div>
          <span className="settings-label">
            {tab === "visualizer" ? (
              <AudioWaveform size={16} />
            ) : (
              <Settings2 size={16} />
            )}{" "}
            {tab === "visualizer" ? "AUDIO VISUALIZER" : "PLAYER SETTINGS"}
          </span>
          <h2>{tab === "visualizer" ? "Visualizer" : "Settings"}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close player tools"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="side-panel-tabs" role="tablist" aria-label="Player tools">
        <button
          type="button"
          role="tab"
          id="settings-tab"
          className={tab === "settings" ? "active" : ""}
          aria-selected={tab === "settings"}
          aria-controls="side-panel-tab-panel"
          tabIndex={tab === "settings" ? 0 : -1}
          onClick={() => setTab("settings")}
        >
          <Settings2 size={15} /> Settings
        </button>
        <button
          type="button"
          role="tab"
          id="visualizer-tab"
          className={tab === "visualizer" ? "active" : ""}
          aria-selected={tab === "visualizer"}
          aria-controls="side-panel-tab-panel"
          tabIndex={tab === "visualizer" ? 0 : -1}
          onClick={() => setTab("visualizer")}
        >
          <AudioWaveform size={15} /> Visualizer
        </button>
      </div>
      <div
        className="side-panel-content"
        id="side-panel-tab-panel"
        role="tabpanel"
        aria-labelledby={tab + "-tab"}
      >
        {tab === "visualizer" ? (
          <VisualizerControls settings={visualizer} onChange={setVisualizer} />
        ) : (
          settingsContent
        )}
      </div>
    </aside>
  );
}
