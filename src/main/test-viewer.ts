import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserWindow } from "electron";

const origin = "http://127.0.0.1:5173";
const modifiers = new Set([
  "shift",
  "control",
  "alt",
  "meta",
  "leftbuttondown",
  "middlebuttondown",
  "rightbuttondown",
]);

async function readInput(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Input is too large.");
    chunks.push(chunk);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid input.");
  return value as Record<string, unknown>;
}

function sendInput(
  window: BrowserWindow,
  input: Record<string, unknown>,
): void {
  const inputModifiers = Array.isArray(input.modifiers)
    ? input.modifiers.filter(
        (
          value,
        ): value is NonNullable<Electron.InputEvent["modifiers"]>[number] =>
          typeof value === "string" && modifiers.has(value),
      )
    : [];
  if (
    (input.type === "rawKeyDown" ||
      input.type === "keyUp" ||
      input.type === "char") &&
    typeof input.keyCode === "string" &&
    input.keyCode.length <= 24
  ) {
    window.webContents.sendInputEvent({
      type: input.type,
      keyCode: input.keyCode,
      modifiers: inputModifiers,
    });
    return;
  }
  const [width, height] = window.getContentSize();
  if (
    typeof input.x !== "number" ||
    typeof input.y !== "number" ||
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y)
  )
    throw new Error("Invalid pointer coordinates.");
  const x = Math.max(0, Math.min(width - 1, Math.round(input.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(input.y)));
  if (input.type === "mouseWheel") {
    if (
      typeof input.deltaX !== "number" ||
      typeof input.deltaY !== "number" ||
      !Number.isFinite(input.deltaX) ||
      !Number.isFinite(input.deltaY)
    )
      throw new Error("Invalid wheel delta.");
    window.webContents.sendInputEvent({
      type: "mouseWheel",
      x,
      y,
      deltaX: input.deltaX,
      deltaY: input.deltaY,
      hasPreciseScrollingDeltas: true,
      canScroll: true,
      modifiers: inputModifiers,
    });
    return;
  }
  if (
    input.type !== "mouseMove" &&
    input.type !== "mouseDown" &&
    input.type !== "mouseUp"
  )
    throw new Error("Invalid input type.");
  const button =
    input.button === "right" || input.button === "middle"
      ? input.button
      : "left";
  window.webContents.sendInputEvent({
    type: input.type,
    x,
    y,
    button,
    clickCount:
      input.type === "mouseMove" ? undefined : input.clickCount === 2 ? 2 : 1,
    modifiers: inputModifiers,
  });
}

export async function startOffscreenViewer(window: BrowserWindow): Promise<{
  close: () => Promise<void>;
}> {
  const html = await readFile(resolve("tests/fixtures/offscreen-viewer.html"));
  let frame: Buffer | null = null;
  let capturing = false;
  let lastFrameRequest = 0;
  const capture = async () => {
    if (capturing || window.isDestroyed() || window.webContents.isDestroyed())
      return;
    capturing = true;
    try {
      const image = await window.webContents.capturePage();
      if (!image.isEmpty()) frame = image.toJPEG(75);
    } catch {
      // The renderer can close while a frame is being captured.
    } finally {
      capturing = false;
    }
  };
  const timer = setInterval(() => {
    if (Date.now() - lastFrameRequest < 1000) void capture();
  }, 100);
  timer.unref();
  const server = createServer(
    async (request: IncomingMessage, reply: ServerResponse) => {
      try {
        const pathname = new URL(request.url ?? "/", origin).pathname;
        if (request.method === "GET" && pathname === "/") {
          reply.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": html.length,
            "Cache-Control": "no-store",
          });
          reply.end(html);
          return;
        }
        if (request.method === "GET" && pathname === "/__offscreen/frame") {
          lastFrameRequest = Date.now();
          if (!frame) void capture();
          if (!frame) {
            reply.writeHead(204).end();
            return;
          }
          reply.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Content-Length": frame.length,
            "Cache-Control": "no-store",
          });
          reply.end(frame);
          return;
        }
        if (request.method === "GET" && pathname === "/__offscreen/size") {
          reply.writeHead(200, { "Content-Type": "application/json" });
          reply.end(JSON.stringify(window.getContentSize()));
          return;
        }
        if (request.method === "POST" && pathname === "/__offscreen/input") {
          if (
            request.headers.origin !== origin ||
            !request.headers["content-type"]?.startsWith("application/json")
          ) {
            reply.writeHead(403).end();
            return;
          }
          const input = await readInput(request);
          sendInput(window, input);
          reply.writeHead(204).end();
          return;
        }
        reply.writeHead(404).end();
      } catch (error) {
        reply.writeHead(400).end(String(error));
      }
    },
  );
  try {
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(5174, "127.0.0.1", done);
    });
  } catch (error) {
    clearInterval(timer);
    throw error;
  }
  return {
    close: () =>
      new Promise<void>((done, reject) => {
        clearInterval(timer);
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : done()));
      }),
  };
}
