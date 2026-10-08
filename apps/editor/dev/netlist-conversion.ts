import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Connect, Plugin } from "vite";
import { handleNetlistConversionRequest } from "../../../packages/spice/src/conversion-request.js";

/**
 * The same pure Worker endpoint also works under pnpm dev, and under
 * `vite preview`, which serves the built editor to browser tests.
 */
export function localNetlistConversion(): Plugin {
  const convert = async (
    request: Connect.IncomingMessage,
    response: ServerResponse,
    next: Connect.NextFunction,
  ): Promise<void> => {
    if (request.url?.split("?")[0] !== "/api/netlist/convert") return next();
    const result = await handleNetlistConversionRequest(
      new Request(`http://localhost${request.url}`, {
        method: request.method,
        headers: new Headers(
          Object.entries(request.headers).flatMap(([key, value]) =>
            value === undefined
              ? []
              : [[key, Array.isArray(value) ? value.join(",") : value]],
          ),
        ),
        ...(request.method === "GET" || request.method === "HEAD"
          ? {}
          : {
              body: Readable.toWeb(request) as ReadableStream<Uint8Array>,
              duplex: "half",
            }),
      } as RequestInit),
    );
    if (!result) return next();
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  };
  // A failed conversion reaches Vite's error handler instead of being lost.
  const attach = (middlewares: Connect.Server) =>
    middlewares.use((request, response, next) => {
      convert(request, response, next).catch(next);
    });
  return {
    name: "local-netlist-conversion",
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}
