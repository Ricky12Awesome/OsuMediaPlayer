import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { CacheKind, PlayerAPI } from "../../shared/types";
import type { PlayerState } from "./usePlayer";
import type { VirtualTrackListKeyboardControls } from "./VirtualTrackList";

export interface KeyboardShortcutsOptions {
  api: PlayerAPI;
  player: PlayerState;
  fullscreen: boolean;
  sidePanelOpen: boolean;
  setSidePanelOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarHidden: Dispatch<SetStateAction<boolean>>;
  setAlwaysShowControls: Dispatch<SetStateAction<boolean>>;
  settingsPanelOpen: boolean;
  shortcutsOpen: boolean;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setShowNowPlayingTitleArtist: Dispatch<SetStateAction<boolean>>;
  cacheConfirmation: CacheKind | null;
  settingsResetConfirmation: boolean;
  focusSearch: () => void;
  trackListKeyboardRef: RefObject<VirtualTrackListKeyboardControls | null>;
}

export function useKeyboardShortcuts({
  api,
  player,
  fullscreen,
  sidePanelOpen,
  setSidePanelOpen,
  setSidebarHidden,
  setAlwaysShowControls,
  settingsPanelOpen,
  shortcutsOpen,
  setShortcutsOpen,
  setShowNowPlayingTitleArtist,
  cacheConfirmation,
  settingsResetConfirmation,
  focusSearch,
  trackListKeyboardRef,
}: KeyboardShortcutsOptions): void {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing =
        target &&
        (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) ||
          target.isContentEditable);
      const inTransport = Boolean(target?.closest(".transport"));
      if (cacheConfirmation || settingsResetConfirmation) return;
      if (event.key === "F11") {
        event.preventDefault();
        api.windowControl("fullscreen");
        return;
      }
      if (event.key === "Escape" && sidePanelOpen && !shortcutsOpen) {
        event.preventDefault();
        setSidePanelOpen(false);
        return;
      }
      if (
        event.key === "Escape" &&
        fullscreen &&
        !sidePanelOpen &&
        !shortcutsOpen
      ) {
        event.preventDefault();
        api.windowControl("fullscreen");
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        ["f", "k"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSidebarHidden((value) => !value);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setAlwaysShowControls((value) => !value);
        return;
      }
      if (
        !settingsPanelOpen &&
        !shortcutsOpen &&
        event.key === "Tab" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        target?.blur();
        setShowNowPlayingTitleArtist((value) => !value);
        return;
      }
      if (
        inTransport &&
        event.code === "Space" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        target?.blur();
        player.toggle();
        return;
      }
      if (
        !settingsPanelOpen &&
        !shortcutsOpen &&
        !target?.closest(".facet-picker, .sort-picker") &&
        !target?.matches("input[type='range']") &&
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        trackListKeyboardRef.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        trackListKeyboardRef.current.moveAndPlay(
          event.key === "ArrowUp" ? -1 : 1,
        );
        return;
      }
      if (settingsPanelOpen || shortcutsOpen || editing) return;
      if (
        event.key === "F2" &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        void player.jumpRandom(event.shiftKey ? -1 : 1);
      } else if (
        event.code === "Space" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        player.toggle();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        player.seek(player.currentTime + 5);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        player.seek(player.currentTime - 5);
      } else if (
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        void player.previous();
      } else if (
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        void player.next();
      } else if (event.key.toLowerCase() === "m") player.toggleMute();
      else if (event.key === "?") setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    api,
    fullscreen,
    player.currentTime,
    player.jumpRandom,
    player.next,
    player.previous,
    player.seek,
    player.toggle,
    player.toggleMute,
    focusSearch,
    sidePanelOpen,
    settingsPanelOpen,
    shortcutsOpen,
    cacheConfirmation,
    settingsResetConfirmation,
    trackListKeyboardRef,
  ]);
}
