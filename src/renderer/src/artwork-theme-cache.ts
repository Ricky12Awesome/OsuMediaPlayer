import type { ArtworkTheme } from "./artwork-theme";

const storageKey = "osu-music-last-artwork-theme";
const legacyStorageKey = "osu-music-artwork-theme-cache";

function isTheme(value: unknown): value is ArtworkTheme {
  if (!value || typeof value !== "object" || !("variables" in value))
    return false;
  const variables = (value as { variables: unknown }).variables;
  if (!variables || typeof variables !== "object") return false;
  const entries = Object.entries(variables);
  return (
    entries.length > 0 &&
    entries.length <= 32 &&
    entries.every(
      ([key, color]) =>
        key.startsWith("--") &&
        typeof color === "string" &&
        color.length <= 256,
    )
  );
}

export function readCachedLastArtworkTheme(): ArtworkTheme | null {
  try {
    localStorage.removeItem(legacyStorageKey);
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function cacheLastArtworkTheme(theme: ArtworkTheme): void {
  try {
    localStorage.removeItem(legacyStorageKey);
    localStorage.setItem(storageKey, JSON.stringify(theme));
  } catch {
    // Themes are an optional startup optimization.
  }
}

export function clearCachedLastArtworkTheme(): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Themes are an optional startup optimization.
  }
}
