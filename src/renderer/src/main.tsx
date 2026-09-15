import "./styles.css";
import "./seek-tooltip.css";
import "./zoom-indicator.css";
import "./sort-picker.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { extractArtworkTheme, type ArtworkTheme } from "./artwork-theme";
import {
  cacheLastArtworkTheme,
  readCachedLastArtworkTheme,
} from "./artwork-theme-cache";

const lastPlayedTrackKey = "osu-music-last-played-track";

async function loadArtworkTheme(url: string): Promise<ArtworkTheme | null> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  try {
    await image.decode();
    return extractArtworkTheme(image);
  } catch {
    return null;
  }
}

async function bootstrap() {
  let initialLibrary = null;
  let initialTrack = null;
  let initialArtworkTheme = null;
  try {
    const installPath = localStorage.getItem("osu-music-library-path");
    const savedId = localStorage.getItem(lastPlayedTrackKey);
    const parsedPath = installPath
      ? (JSON.parse(installPath) as unknown)
      : undefined;
    const parsedId = savedId ? (JSON.parse(savedId) as unknown) : undefined;
    if (typeof parsedPath === "string" && window.playerAPI?.loadCachedLibrary) {
      initialLibrary = await window.playerAPI.loadCachedLibrary(parsedPath);
      if (initialLibrary && typeof parsedId === "string")
        initialTrack = await window.playerAPI.getTrack(parsedId);
      if (initialTrack?.artworkUrl) {
        const theme =
          readCachedLastArtworkTheme() ??
          (await loadArtworkTheme(initialTrack.artworkUrl));
        if (theme) cacheLastArtworkTheme(theme);
        if (theme)
          initialArtworkTheme = { url: initialTrack.artworkUrl, theme };
      }
    }
  } catch {
    // Storage and cache failures fall through to the regular startup flow.
    initialLibrary = null;
    initialTrack = null;
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App
        initialLibrary={initialLibrary}
        initialTrack={initialTrack}
        initialArtworkTheme={initialArtworkTheme}
      />
    </StrictMode>,
  );
  requestAnimationFrame(() => window.playerAPI?.windowReady?.());
}

void bootstrap();
