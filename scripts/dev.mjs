import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const electronCommand =
  process.platform === "win32"
    ? "node_modules/.bin/electron.cmd"
    : "node_modules/.bin/electron";
const viteCommand =
  process.platform === "win32"
    ? "node_modules/.bin/vite.cmd"
    : "node_modules/.bin/vite";
const viteUrl = "http://127.0.0.1:5173/";

// The Electron entry points are generated files. Build them here so a clean
// checkout can start with `npm run dev` without requiring a previous package build.
await execFileAsync(process.execPath, ["scripts/build-electron.mjs"], {
  stdio: "inherit",
});

function waitForServer(url) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - started > 30_000)
            reject(new Error("Vite did not start."));
          else setTimeout(check, 100);
        });
    };
    check();
  });
}

const vite = spawn(viteCommand, ["--host", "127.0.0.1", "--port", "5173"], {
  stdio: "inherit",
});

try {
  await waitForServer(viteUrl);
  const electronEnv = {
    ...process.env,
    ELECTRON_RENDERER_URL: viteUrl,
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const electron = spawn(electronCommand, [".", "--no-sandbox"], {
    stdio: "inherit",
    env: electronEnv,
  });

  const stop = (code = 0) => {
    vite.kill("SIGTERM");
    electron.kill("SIGTERM");
    process.exit(code);
  };
  electron.once("exit", (code) => stop(code ?? 0));
  process.once("SIGINT", () => stop());
  process.once("SIGTERM", () => stop());
} catch (error) {
  vite.kill("SIGTERM");
  throw error;
}
