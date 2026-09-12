import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist-electron", { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["electron/main.ts"],
    outfile: "dist-electron/main.cjs",
  }),
  build({
    ...common,
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.cjs",
  }),
  build({
    ...common,
    sourcemap: false,
    external: ["electron", "builder-util"],
    entryPoints: ["scripts/bundle-ofu.ts"],
    outfile: "dist-electron/bundle-ofu.cjs",
  }),
]);
