import type { Dispatch, RefObject, SetStateAction } from "react";

type ResizeStart = { x: number; width: number };

interface PanelResizersProps {
  libraryRef: RefObject<HTMLElement | null>;
  sidePanelRef: RefObject<HTMLElement | null>;
  resizeStart: RefObject<ResizeStart | null>;
  sidePanelResizeStart: RefObject<ResizeStart | null>;
  libraryHidden: boolean;
  sidePanelOpen: boolean;
  isDesktop: boolean;
  libraryPosition: "left" | "right";
  libraryWidth: number;
  sidePanelWidth: number;
  minSidePanelWidth: number;
  maxSidePanelWidth: number;
  setResizing: Dispatch<SetStateAction<boolean>>;
  setSidePanelResizing: Dispatch<SetStateAction<boolean>>;
  setLibraryWidth: Dispatch<SetStateAction<number>>;
  setSidePanelWidth: Dispatch<SetStateAction<number>>;
  clampLibraryWidth: (value: number) => number;
  clampSidePanelWidth: (value: number) => number;
  defaultSidePanelWidth: number;
}

export function PanelResizers({
  libraryRef,
  sidePanelRef,
  resizeStart,
  sidePanelResizeStart,
  libraryHidden,
  sidePanelOpen,
  isDesktop,
  libraryPosition,
  libraryWidth,
  sidePanelWidth,
  minSidePanelWidth,
  maxSidePanelWidth,
  setResizing,
  setSidePanelResizing,
  setLibraryWidth,
  setSidePanelWidth,
  clampLibraryWidth,
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
            const sign = libraryPosition === "right" ? 1 : -1;
            setSidePanelWidth((value) =>
              clampSidePanelWidth(value + direction * sign * 16),
            );
          }
        }}
      >
        <span aria-hidden="true" />
      </div>

      <div
        className="library-resizer"
        role="separator"
        aria-label="Resize library sidebar"
        aria-hidden={libraryHidden}
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={720}
        aria-valuenow={Math.round(libraryWidth)}
        tabIndex={libraryHidden ? -1 : 0}
        title="Drag to resize · double-click to reset"
        onPointerDown={(event) => {
          if (event.button !== 0 || libraryHidden) return;
          event.preventDefault();
          resizeStart.current = {
            x: event.clientX,
            width:
              libraryRef.current?.getBoundingClientRect().width ?? libraryWidth,
          };
          setResizing(true);
        }}
        onDoubleClick={() => setLibraryWidth(clampLibraryWidth(430))}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setLibraryWidth((value) =>
              clampLibraryWidth(
                value + (libraryPosition === "right" ? 16 : -16),
              ),
            );
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setLibraryWidth((value) =>
              clampLibraryWidth(
                value + (libraryPosition === "right" ? -16 : 16),
              ),
            );
          } else if (event.key === "Home") {
            event.preventDefault();
            setLibraryWidth(320);
          } else if (event.key === "End") {
            event.preventDefault();
            setLibraryWidth(clampLibraryWidth(720));
          }
        }}
      >
        <span />
      </div>
    </>
  );
}
