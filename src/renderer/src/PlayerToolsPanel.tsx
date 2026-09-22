import type { ReactNode, RefObject } from "react";
import { Settings2, X } from "lucide-react";

interface PlayerToolsPanelProps {
  panelRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  settingsContent: ReactNode;
}

export function PlayerToolsPanel({
  panelRef,
  open,
  onClose,
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
      <div className="side-panel-content">{settingsContent}</div>
    </aside>
  );
}
