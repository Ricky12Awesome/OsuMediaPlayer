import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";

export function defaultLazerInstallPath(
  platform: string = process.platform,
  home = homedir(),
  appData = process.env.APPDATA,
): string {
  switch (platform) {
    case "win32":
      return win32.join(
        appData || win32.join(home, "AppData", "Roaming"),
        "osu",
      );
    case "darwin":
      return join(home, "Library", "Application Support", "osu");
    case "linux":
      return join(home, ".local", "share", "osu");
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export async function resolveLazerInstallPath(
  requestedPath = defaultLazerInstallPath(),
): Promise<string> {
  if (!isAbsolute(requestedPath))
    throw new Error("Choose an absolute osu!lazer directory path.");
  let contents: string;
  try {
    contents = await readFile(join(requestedPath, "storage.ini"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return requestedPath;
    throw error;
  }
  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = /^\s*FullPath\s*=\s*(.*?)\s*$/.exec(rawLine);
    if (!match) continue;
    const fullPath = match[1];
    if (!isAbsolute(fullPath))
      throw new Error(
        `FullPath in ${join(requestedPath, "storage.ini")} must be an absolute path.`,
      );
    return fullPath;
  }
  return requestedPath;
}
