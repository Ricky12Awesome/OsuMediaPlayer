import type { Dispatch, RefObject, SetStateAction } from "react";

type ResizeStart = { x: number; width: number };

interface PanelResizersProps {
  songListRef: RefObject<HTMLElement | null>;
  sidePanelRef: RefObject<HTMLElement | null>;
  resizeStart: RefObject<ResizeStart | null>;
  sidePanelResizeStart: RefObject<ResizeStart | null>;
  songListHidden: boolean;
  sidePanelOpen: boolean;
  isDesktop: boolean;
  songListPosition: "left" | "right";
  songListWidth: number;
  sidePanelWidth: number;
  minSongListWidth: number;
  minSidePanelWidth: number;
  maxSidePanelWidth: number;
  setResizing: Dispatch<SetStateAction<boolean>>;
  setSidePanelResizing: Dispatch<SetStateAction<boolean>>;
  setSongListWidth: Dispatch<SetStateAction<number>>;
  setSidePanelWidth: Dispatch<SetStateAction<number>>;
  clampSongListWidth: (value: number) => number;
  clampSidePanelWidth: (value: number) => number;
  defaultSidePanelWidth: number;
}

export function PanelResizers({
  songListRef,
  sidePanelRef,
  resizeStart,
  sidePanelResizeStart,
  songListHidden,
  sidePanelOpen,
  isDesktop,
  songListPosition,
  songListWidth,
  sidePanelWidth,
  minSongListWidth,
  minSidePanelWidth,
  maxSidePanelWidth,
  setResizing,
  setSidePanelResizing,
  setSongListWidth,
  setSidePanelWidth,
  clampSongListWidth,
  clampSidePanelWidth,
  defaultSidePanelWidth,
}: PanelResizersProps) {
  return (
    <>
      <div
        className="side-panel-resizer"
        role="separator"
        aria-label="Resize player tools panel"
        aria-hidden={!sidePanelOpen || !isDesktop}
        aria-orientation="vertical"
        aria-valuemin={minSidePanelWidth}
        aria-valuemax={maxSidePanelWidth}
        aria-valuenow={Math.round(sidePanelWidth)}
        tabIndex={!sidePanelOpen || !isDesktop ? -1 : 0}
        title="Drag to resize · double-click to reset"
        onPointerDown={(event) => {
          if (event.button !== 0 || !sidePanelOpen || !isDesktop) return;
          event.preventDefault();
          sidePanelResizeStart.current = {
            x: event.clientX,
            width:
              sidePanelRef.current?.getBoundingClientRect().width ??
              sidePanelWidth,
          };
          setSidePanelResizing(true);
        }}
        onDoubleClick={() =>
          setSidePanelWidth(clampSidePanelWidth(defaultSidePanelWidth))
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const sign = songListPosition === "right" ? 1 : -1;
            setSidePanelWidth((value) =>
              clampSidePanelWidth(value + direction * sign * 16),
            );
          }
        }}
      >
        <span aria-hidden="true" />
      </div>

      <div
        className="song-list-resizer"
        role="separator"
        aria-label="Resize song list sidebar"
        aria-hidden={songListHidden}
        aria-orientation="vertical"
        aria-valuemin={minSongListWidth}
        aria-valuemax={720}
        aria-valuenow={Math.round(songListWidth)}
        tabIndex={songListHidden ? -1 : 0}
        title="Drag to resize · double-click to reset"
        onPointerDown={(event) => {
          if (event.button !== 0 || songListHidden) return;
          event.preventDefault();
          resizeStart.current = {
            x: event.clientX,
            width:
              songListRef.current?.getBoundingClientRect().width ??
              songListWidth,
          };
          setResizing(true);
        }}
        onDoubleClick={() =>
          setSongListWidth(clampSongListWidth(minSongListWidth))
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setSongListWidth((value) =>
              clampSongListWidth(
                value + (songListPosition === "right" ? 16 : -16),
              ),
            );
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setSongListWidth((value) =>
              clampSongListWidth(
                value + (songListPosition === "right" ? -16 : 16),
              ),
            );
          } else if (event.key === "Home") {
            event.preventDefault();
            setSongListWidth(minSongListWidth);
          } else if (event.key === "End") {
            event.preventDefault();
            setSongListWidth(clampSongListWidth(720));
          }
        }}
      >
        <span />
      </div>
    </>
  );
}
