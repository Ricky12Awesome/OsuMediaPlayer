const developmentRendererOrigin = "http://127.0.0.1:5173";

/**
 * Return the development renderer URL only for the local Vite origin.
 *
 * The renderer has access to the preload API, so this value must never select
 * a page controlled by an arbitrary environment variable or by a packaged
 * application launch.
 */
export function resolveRendererUrl(
  value: string | undefined,
  isPackaged: boolean,
): string | undefined {
  if (isPackaged || !value) return undefined;
  try {
    if (new URL(value).origin !== developmentRendererOrigin) return undefined;
  } catch {
    return undefined;
  }
  return value;
}

export { developmentRendererOrigin };
