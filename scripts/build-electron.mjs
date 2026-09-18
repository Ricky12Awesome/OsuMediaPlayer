import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist-electron", { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["electron", "realm"],
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/library/worker.ts"],
    outfile: "dist-electron/library-worker.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/main/index.ts"],
    outfile: "dist-electron/main.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist-electron/preload.cjs",
  }),
]);
