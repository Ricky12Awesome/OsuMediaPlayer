const supportedMediaImageProtocols = new Set([
  "http:",
  "https:",
  "data:",
  "blob:",
]);

export interface ResolvedMediaArtwork {
  url: string;
  owned: boolean;
  type?: string;
}

const fallbackSongArtworkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24" fill="none">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
      <stop stop-color="#644b78" />
      <stop offset="1" stop-color="#31283a" />
    </linearGradient>
  </defs>
  <rect width="24" height="24" rx="4" fill="url(#background)" />
  <g stroke="#a68caf" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
    <circle cx="8" cy="18" r="4" />
    <path d="M12 18V2l7 4" />
  </g>
</svg>`;

export const fallbackMediaArtwork: ResolvedMediaArtwork = {
  url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(fallbackSongArtworkSvg)}`,
  owned: false,
  type: "image/svg+xml",
};

/** Returns a URL scheme accepted by Chromium's MediaImage implementation. */
export function directMediaImageUrl(
  url: string | undefined,
): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return supportedMediaImageProtocols.has(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves an omp artwork URL into a blob URL for MediaMetadata.
 * Chromium accepts custom URLs in page elements, but MediaImage only accepts
 * http(s), data, and blob URLs.
 */
export async function resolveMediaArtwork(
  url: string | undefined,
  signal?: AbortSignal,
): Promise<ResolvedMediaArtwork | undefined> {
  const directUrl = directMediaImageUrl(url);
  if (directUrl) return { url: directUrl, owned: false };
  if (!url) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "omp:") return undefined;

  const response = await fetch(parsed.href, { signal });
  if (!response.ok) return undefined;
  const blob = await response.blob();
  if (signal?.aborted || typeof URL.createObjectURL !== "function")
    return undefined;

  // Match the bottom bar's square object-fit: cover crop before handing the
  // image to platform media controls.
  const cropped = await squareArtworkBlob(blob);
  if (signal?.aborted) return undefined;
  const artwork = cropped ?? blob;
  return {
    url: URL.createObjectURL(artwork),
    owned: true,
    type: artwork.type || "image/png",
  };
}

async function squareArtworkBlob(blob: Blob): Promise<Blob | undefined> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob);
    const size = Math.min(bitmap.width, bitmap.height);
    if (!size) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(
      bitmap,
      (bitmap.width - size) / 2,
      (bitmap.height - size) / 2,
      size,
      size,
      0,
      0,
      512,
      512,
    );
    return (
      (await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      )) ?? undefined
    );
  } catch {
    return undefined;
  } finally {
    bitmap?.close();
  }
}
