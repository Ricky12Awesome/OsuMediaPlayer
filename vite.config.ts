import { request } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function offscreenViewerProxy(): Plugin {
  return {
    name: "offscreen-viewer-proxy",
    configureServer(server) {
      server.middlewares.use((incoming, outgoing, next) => {
        const pathname = new URL(incoming.url ?? "/", "http://127.0.0.1")
          .pathname;
        if (pathname !== "/" && !pathname.startsWith("/__offscreen/"))
          return next();
        const upstream = request(
          {
            hostname: "127.0.0.1",
            port: 5174,
            path: incoming.url,
            method: incoming.method,
            headers: incoming.headers,
          },
          (response) => {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
          },
        );
        upstream.on("error", () => {
          if (!outgoing.headersSent) outgoing.writeHead(503);
          outgoing.end("Offscreen viewer is starting.");
        });
        incoming.pipe(upstream);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  root: "src/renderer",
  plugins: [
    react(),
    ...(command === "serve" && process.env.OSU_MEDIA_PLAYER_TEST_VIEWER === "1"
      ? [offscreenViewerProxy()]
      : []),
  ],
  base: "./",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
}));
