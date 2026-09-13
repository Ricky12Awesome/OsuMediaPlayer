import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Arch } from "builder-util";
import { ensureOfu } from "../src/main/ofu";

export default async function bundleOfu(context: {
  electronPlatformName: string;
  targets: Array<{ name: string }>;
  arch: number;
  packager: {
    projectDir: string;
    appInfo: { productFilename: string };
  };
  appOutDir: string;
}): Promise<void> {
  const platform = context.electronPlatformName;
  if (platform !== "linux" && platform !== "win32" && platform !== "darwin")
    return;

  const executable = await ensureOfu(
    join(context.packager.projectDir, "node_modules", ".cache", "ofu"),
    { platform, arch: Arch[context.arch] },
  );
  const resourcesDirectory =
    platform === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  const bundledDirectory = join(resourcesDirectory, "ofu");
  await rm(bundledDirectory, { recursive: true, force: true });
  await cp(join(executable, ".."), bundledDirectory, {
    recursive: true,
  });
}
