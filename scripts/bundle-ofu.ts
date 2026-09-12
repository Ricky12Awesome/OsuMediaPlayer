import { cp } from "node:fs/promises";
import { join } from "node:path";
import { Arch } from "builder-util";
import { ensureOfu } from "../electron/ofu";

export default async function bundleOfu(context: {
  electronPlatformName: string;
  targets: Array<{ name: string }>;
  arch: number;
  packager: { projectDir: string };
  appOutDir: string;
}): Promise<void> {
  if (
    context.electronPlatformName !== "linux" ||
    !context.targets.some((target) => target.name.toLowerCase() === "appimage")
  )
    return;

  const executable = await ensureOfu(
    join(context.packager.projectDir, "node_modules", ".cache", "ofu"),
    { platform: "linux", arch: Arch[context.arch] },
  );
  await cp(
    join(executable, ".."),
    join(context.appOutDir, "resources", "ofu"),
    { recursive: true },
  );
}
