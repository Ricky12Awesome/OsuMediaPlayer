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

const lastPlayedSongKey = "omp-last-played-song";

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
  let initialSongList = null;
  let initialSong = null;
  let initialArtworkTheme = null;
  try {
    const installPath = localStorage.getItem("omp-song-list-path");
    const savedId = localStorage.getItem(lastPlayedSongKey);
    const parsedPath = installPath
      ? (JSON.parse(installPath) as unknown)
      : undefined;
    const parsedId = savedId ? (JSON.parse(savedId) as unknown) : undefined;
    if (
      typeof parsedPath === "string" &&
      window.playerAPI?.loadCachedSongList
    ) {
      initialSongList = await window.playerAPI.loadCachedSongList(parsedPath);
      if (initialSongList && typeof parsedId === "string")
        initialSong = await window.playerAPI.getSong(parsedId);
      if (initialSong?.artworkUrl) {
        const theme =
          readCachedLastArtworkTheme() ??
          (await loadArtworkTheme(initialSong.artworkUrl));
        if (theme) cacheLastArtworkTheme(theme);
        if (theme) initialArtworkTheme = { url: initialSong.artworkUrl, theme };
      }
    }
  } catch {
    // Storage and cache failures fall through to the regular startup flow.
    initialSongList = null;
    initialSong = null;
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App
        initialSongList={initialSongList}
        initialSong={initialSong}
        initialArtworkTheme={initialArtworkTheme}
      />
    </StrictMode>,
  );
  requestAnimationFrame(() => window.playerAPI?.windowReady?.());
}

void bootstrap();
