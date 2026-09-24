import { execFile, spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
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
const viteOrigin = "http://127.0.0.1:5173";
const testEnvironment = process.argv.includes("--test-environment");
const cleanTestEnvironment = process.argv.includes("--clean");
// The viewer uses Vite's root while Electron loads the renderer on the same origin.
const rendererUrl = testEnvironment
  ? `${viteOrigin}/index.html`
  : `${viteOrigin}/`;
const testUserData = testEnvironment
  ? resolve("tests/environment/user-data")
  : null;

if (testEnvironment) {
  let hasTestEnvironment = false;
  try {
    hasTestEnvironment = (
      await stat(resolve("tests/environment/client.realm"))
    ).isFile();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (cleanTestEnvironment || !hasTestEnvironment) {
    await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      "scripts/create-test-environment.ts",
    ]);
  }
  await mkdir(testUserData, { recursive: true });
}

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
  env: {
    ...process.env,
    OSU_MEDIA_PLAYER_TEST_VIEWER: testEnvironment ? "1" : "0",
  },
});

try {
  await waitForServer(rendererUrl);
  const electronEnv = {
    ...process.env,
    ELECTRON_RENDERER_URL: rendererUrl,
    ...(testEnvironment
      ? {
          OSU_MEDIA_PLAYER_OFFSCREEN_TEST: "1",
          OSU_MEDIA_PLAYER_TEST_INSTALL_PATH: resolve("tests/environment"),
          OSU_MEDIA_PLAYER_TEST_USER_DATA: testUserData,
          OSU_MEDIA_PLAYER_TEST_VIEWER: "1",
        }
      : {}),
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const electron = spawn(
    electronCommand,
    [
      ".",
      "--no-sandbox",
      ...(testEnvironment &&
      process.platform === "linux" &&
      !process.env.DISPLAY &&
      !process.env.WAYLAND_DISPLAY
        ? ["--ozone-platform=headless"]
        : []),
    ],
    {
      stdio: "inherit",
      env: electronEnv,
    },
  );

  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
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
