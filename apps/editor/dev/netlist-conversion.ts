import { Readable } from "node:stream";
import type { Plugin } from "vite";
import { handleNetlistConversionRequest } from "../../../packages/spice/src/conversion-request.js";

/** The same pure Worker endpoint also works under pnpm dev. */
export function localNetlistConversion(): Plugin {
  return {
    name: "local-netlist-conversion",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split("?")[0] !== "/api/netlist/convert")
          return next();
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
      });
    },
  };
}
