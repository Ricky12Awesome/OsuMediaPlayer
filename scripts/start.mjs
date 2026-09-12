import { spawn } from "node:child_process";

const electronCommand =
  process.platform === "win32"
    ? "node_modules/.bin/electron.cmd"
    : "node_modules/.bin/electron";

const electronEnv = { ...process.env };
delete electronEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronCommand, [".", "--no-sandbox"], {
  stdio: "inherit",
  env: electronEnv,
});

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
