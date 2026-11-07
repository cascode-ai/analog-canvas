import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";

import { handleLocalSimulation } from "./local-simulation-endpoint.js";

/** The endpoint alone on a loopback server, with `/healthz` beside it. */
async function withEndpoint(
  handler: (request: Request) => Promise<Response>,
  check: (origin: string) => Promise<void>,
) {
  const server = createServer((request, response) => {
    if (request.url === "/healthz") {
      response.end("ok");
      return;
    }
    void handleLocalSimulation(request, response, handler);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await check(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const post = (origin: string) =>
  fetch(origin + "/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

it("contains adapter failures and keeps serving", async () => {
  await withEndpoint(
    async () => {
      throw new Error("offline");
    },
    async (origin) => {
      const response = await post(origin);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "simulation-executor-unavailable",
      });
      expect((await fetch(origin + "/healthz")).status).toBe(200);
    },
  );
});

it("closes an adapter reply that fails after its headers and keeps serving", async () => {
  await withEndpoint(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("adapter stream broke"));
          },
        }),
      ),
    async (origin) => {
      await expect(
        post(origin).then((response) => response.arrayBuffer()),
      ).rejects.toThrow();
      expect((await fetch(origin + "/healthz")).status).toBe(200);
    },
  );
});
