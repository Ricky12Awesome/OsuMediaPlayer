import assert from "node:assert/strict";
import { _electron as electron } from "playwright";

// The original integration test suite was not shipped in the surviving
// artifacts. Keep a lightweight smoke test so the recovered packaging path
// remains executable without requiring a user's osu!lazer library.
const electronEnv = { ...process.env, ELECTRON_RENDERER_URL: "" };
delete electronEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  args: [".", "--no-sandbox"],
  env: electronEnv,
});

try {
  const page = await app.firstWindow();
  await page.waitForSelector(".app-shell");
  assert.equal(await page.title(), "osu! music");
  assert.ok(await page.locator(".transport").count());
} finally {
  await app.close();
}
