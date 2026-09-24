import { createServer } from "node:http";

// The app permits this exact development origin for its preload bridge.
export async function startElectronBootstrap() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><title>Fixture bootstrap</title>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(5173, "127.0.0.1", resolve);
  });
  return {
    url: "http://127.0.0.1:5173/",
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
