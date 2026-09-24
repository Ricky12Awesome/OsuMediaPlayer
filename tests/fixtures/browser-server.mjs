import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import { serveMedia } from "../../src/main/media.ts";

const dist = resolve("dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function startBrowserFixtureServer(index) {
  const server = createServer(async (request, reply) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname.startsWith("/__fixture_asset/")) {
        const hash = pathname.slice("/__fixture_asset/".length);
        const response = await serveMedia(
          new Request(`omp://asset/${hash}`, {
            method: request.method,
            headers: request.headers.range
              ? { Range: request.headers.range }
              : undefined,
          }),
          index,
        );
        reply.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body)
          for await (const chunk of response.body) reply.write(chunk);
        reply.end();
        return;
      }
      const filename = resolve(
        dist,
        pathname === "/" ? "index.html" : `.${pathname}`,
      );
      const within = relative(dist, filename);
      if (!within || within.startsWith("..") || within.startsWith("/")) {
        reply.writeHead(404).end();
        return;
      }
      const info = await stat(filename);
      if (!info.isFile()) {
        reply.writeHead(404).end();
        return;
      }
      reply.writeHead(200, {
        "Content-Type": types[extname(filename)] ?? "application/octet-stream",
        "Content-Length": info.size,
      });
      createReadStream(filename).pipe(reply);
    } catch {
      if (!reply.headersSent) reply.writeHead(404);
      reply.end();
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server address");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise((done, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : done()));
      }),
  };
}
