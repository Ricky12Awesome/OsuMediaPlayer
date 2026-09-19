import type { Dispatch, RefObject, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Trash2, X } from "lucide-react";
import type {
  CacheKind,
  Song,
  SongContextMenuAction,
  SongContextMenuInfo,
} from "../../shared/types";
import { SongContextMenu } from "./SongContextMenu";

export type SongContextMenuState = {
  song: Song;
  x: number;
  y: number;
  info: SongContextMenuInfo;
};

interface AppOverlaysProps {
  playerError: string | null;
  onClearPlayerError: () => void;
  zoomIndicatorVisible: boolean;
  zoomPercent: number;
  songContextMenu: SongContextMenuState | null;
  onSongContextMenuAction: (action: SongContextMenuAction) => void;
  onCloseSongContextMenu: () => void;
  shortcutsDialogRef: RefObject<HTMLDialogElement | null>;
  shortcutsOpen: boolean;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  cacheConfirmation: CacheKind | null;
  cancelCacheClear: () => void;
  confirmCacheClear: () => void | Promise<void>;
  cacheCancelButtonRef: RefObject<HTMLButtonElement | null>;
  settingsResetConfirmation: boolean;
  cancelSettingsReset: () => void;
  confirmSettingsReset: () => void;
  settingsResetCancelButtonRef: RefObject<HTMLButtonElement | null>;
}

function cacheName(kind: CacheKind): string {
  return kind === "index" ? "Index cache" : "Video cache";
}

export function AppOverlays({
  playerError,
  onClearPlayerError,
  zoomIndicatorVisible,
  zoomPercent,
  songContextMenu,
  onSongContextMenuAction,
  onCloseSongContextMenu,
  shortcutsDialogRef,
  shortcutsOpen,
  setShortcutsOpen,
  cacheConfirmation,
  cancelCacheClear,
  confirmCacheClear,
  cacheCancelButtonRef,
  settingsResetConfirmation,
  cancelSettingsReset,
  confirmSettingsReset,
  settingsResetCancelButtonRef,
}: AppOverlaysProps) {
  return (
    <>
      {playerError && (
        <div className="playback-error" role="alert">
          <span>{playerError}</span>
          <button
            aria-label="Dismiss playback error"
            onClick={onClearPlayerError}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {zoomIndicatorVisible && (
        <div className="zoom-indicator" role="status" aria-live="polite">
          Zoom {zoomPercent}%
        </div>
      )}

      {songContextMenu &&
        createPortal(
          <SongContextMenu
            song={songContextMenu.song}
            x={songContextMenu.x}
            y={songContextMenu.y}
            info={songContextMenu.info}
            onAction={onSongContextMenuAction}
            onClose={onCloseSongContextMenu}
          />,
          document.body,
        )}

      <dialog
        ref={shortcutsDialogRef}
        className="settings-dialog"
        onCancel={() => setShortcutsOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setShortcutsOpen(false);
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2>Keyboard Shortcuts</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => setShortcutsOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        {shortcutsOpen && (
          <div className="shortcuts">
            {[
              ["Play / pause", "Space"],
              ["Previous song", "A"],
              ["Next song", "D"],
              ["Toggle song list", "Ctrl / ⌘ S"],
              ["Always show bottom bar", "Ctrl / ⌘ E"],
              ["Show / hide title / artist", "Tab"],
              ["Random song", "F2"],
              ["Previous random song", "Shift F2"],
              ["Browse songs", "↑ / ↓"],
              ["Play selected song", "Enter"],
              ["Seek 5 seconds", "← / →"],
              ["Search your song list", "Ctrl / ⌘ F"],
              ["Zoom in", "Ctrl / ⌘ ="],
              ["Zoom out", "Ctrl / ⌘ -"],
              ["Reset zoom", "Ctrl / ⌘ 0"],
              ["Mute / unmute", "M"],
              ["Keyboard shortcuts", "?"],
              ["Fullscreen view", "F11"],
            ].map(([label, key]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        )}
      </dialog>

      {cacheConfirmation && (
        <div
          className="cache-confirmation-layer"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) cancelCacheClear();
          }}
        >
          <section
            className="cache-confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cache-confirmation-title"
            aria-describedby="cache-confirmation-description"
          >
            <div className="cache-confirmation-heading">
              <span className="cache-confirmation-icon" aria-hidden="true">
                <Trash2 size={19} />
              </span>
              <div>
                <h2 id="cache-confirmation-title">
                  Delete {cacheName(cacheConfirmation).toLowerCase()}?
                </h2>
                <p id="cache-confirmation-description">
                  {cacheConfirmation === "index"
                    ? "The song list index will be rebuilt from your osu!lazer files the next time you refresh."
                    : "Converted video files will be generated again when they are needed."}
                </p>
              </div>
            </div>
            <div className="cache-confirmation-actions">
              <button
                ref={cacheCancelButtonRef}
                type="button"
                className="secondary-button"
                onClick={cancelCacheClear}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void confirmCacheClear()}
              >
                <Trash2 size={15} /> Delete cache
              </button>
            </div>
          </section>
        </div>
      )}

      {settingsResetConfirmation && (
        <div
          className="cache-confirmation-layer"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) cancelSettingsReset();
          }}
        >
          <section
            className="cache-confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="settings-reset-confirmation-title"
            aria-describedby="settings-reset-confirmation-description"
          >
            <div className="cache-confirmation-heading">
              <span className="cache-confirmation-icon" aria-hidden="true">
                <RefreshCw size={19} />
              </span>
              <div>
                <h2 id="settings-reset-confirmation-title">
                  Reset settings to defaults?
                </h2>
                <p id="settings-reset-confirmation-description">
                  Playback, layout, appearance, sorting, and visualizer
                  preferences will be restored. Your song list folder,
                  favorites, and cached files will be kept.
                </p>
              </div>
            </div>
            <div className="cache-confirmation-actions">
              <button
                ref={settingsResetCancelButtonRef}
                type="button"
                className="secondary-button"
                onClick={cancelSettingsReset}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={confirmSettingsReset}
              >
                <RefreshCw size={15} /> Reset settings
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
