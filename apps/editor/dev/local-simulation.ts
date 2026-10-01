import type { Connect, Plugin } from "vite";
import { createLocalSimulationHandler } from "../../local-host/src/simulation-adapter.js";
import { handleLocalSimulation } from "../../local-host/src/simulation-endpoint.js";

/** Development transport only: reuse local-host's bounded native adapter. */
export function localSimulation(origin?: string): Plugin {
  const handler = origin ? createLocalSimulationHandler(origin) : undefined;
  // The dev server and `vite preview` (the built editor browser tests use)
  // answer the same endpoint.
  const attach = (middlewares: Connect.Server) =>
    middlewares.use((request, response, next) => {
      if (request.url !== "/api/simulate") return next();
      const deny = (status: number, error: string) => {
        request.resume();
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error }));
      };
      if (request.method !== "POST") return deny(405, "method-not-allowed");
      const port = request.socket.localPort;
      const host = request.headers.host;
      if (
        !port ||
        !["127.0.0.1", "localhost", "[::1]"].some(
          (name) => host === `${name}:${port}`,
        ) ||
        (request.headers.origin !== undefined &&
          request.headers.origin !== `http://${host}`)
      )
        return deny(403, "origin-not-allowed");
      if (
        !/^application\/json(?:;|$)/iu.test(
          request.headers["content-type"] ?? "",
        )
      )
        return deny(415, "json-required");
      void handleLocalSimulation(request, response, handler);
    });
  return {
    name: "local-native-simulation",
    apply: "serve",
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}
