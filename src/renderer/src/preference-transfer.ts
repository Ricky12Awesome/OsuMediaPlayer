import {
  defaultVisualizerSettings,
  parseVisualizerSettings,
  type VisualizerSettings,
} from "./visualizer-settings";

const version = 1;

function readDocument(text: string, type: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The file does not contain a valid export.");
  }
  const document = value as Record<string, unknown>;
  if (document.type !== type || document.version !== version) {
    throw new Error("This file is not a supported export for these settings.");
  }
  return document;
}

export function exportFavorites(favorites: ReadonlySet<string>): string {
  return JSON.stringify(
    { type: "osu-media-player-favorites", version, favorites: [...favorites] },
    null,
    2,
  );
}

export function importFavorites(text: string): string[] {
  const { favorites } = readDocument(text, "osu-media-player-favorites");
  if (
    !Array.isArray(favorites) ||
    !favorites.every((id) => typeof id === "string" && id.length > 0)
  ) {
    throw new Error("The favorites file contains invalid song IDs.");
  }
  return [...new Set(favorites)];
}

export function mergeFavorites(
  current: ReadonlySet<string>,
  imported: readonly string[],
): Set<string> {
  return new Set([...current, ...imported]);
}

export function exportVisualizerSettings(settings: VisualizerSettings): string {
  return JSON.stringify(
    { type: "osu-media-player-visualizer", version, settings },
    null,
    2,
  );
}

export function importVisualizerSettings(text: string): VisualizerSettings {
  const { settings } = readDocument(text, "osu-media-player-visualizer");
  if (
    !settings ||
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    !Object.keys(defaultVisualizerSettings).every((key) => key in settings)
  ) {
    throw new Error("The visualizer file contains invalid settings.");
  }
  return parseVisualizerSettings(settings);
}
