import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Settings2, X } from "lucide-react";

interface PlayerToolsPanelProps {
  panelRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  settingsContent: ReactNode;
  visualizerContent: ReactNode;
}

export function PlayerToolsPanel({
  panelRef,
  open,
  onClose,
  settingsContent,
  visualizerContent,
}: PlayerToolsPanelProps) {
  const id = useId();
  const [tab, setTab] = useState<"general" | "visualizer">("general");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = ["general", "visualizer"] as const;
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
            <Settings2 size={16} /> PLAYER SETTINGS
          </span>
          <h2>Settings</h2>
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
      <div
        className="panel-tabs"
        role="tablist"
        aria-label="Settings categories"
      >
        {tabs.map((value, index) => (
          <button
            key={value}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`${id}-${value}-tab`}
            type="button"
            className={`panel-tab ${tab === value ? "active" : ""}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`${id}-${value}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                next =
                  (index +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    tabs.length) %
                  tabs.length;
              } else if (event.key === "Home" || event.key === "End") {
                next = event.key === "Home" ? 0 : tabs.length - 1;
              } else {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              setTab(tabs[next]!);
              tabRefs.current[next]?.focus();
            }}
          >
            {value === "general" ? "General" : "Visualizer"}
          </button>
        ))}
      </div>
      <div
        key={tab}
        id={`${id}-${tab}-panel`}
        className="side-panel-content"
        role="tabpanel"
        aria-labelledby={`${id}-${tab}-tab`}
        tabIndex={0}
      >
        {tab === "general" ? settingsContent : visualizerContent}
      </div>
    </aside>
  );
}
