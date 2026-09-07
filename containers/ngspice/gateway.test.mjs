import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

const children = [];
const servers = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  }
  for (const server of servers.splice(0)) {
    server.close();
    await once(server, "close").catch(() => {});
  }
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return server.address().port;
}

async function startGateway(executorPort) {
  const child = spawn(process.execPath, ["containers/ngspice/gateway.mjs"], {
    env: {
      PATH: process.env.PATH,
      PORT: "0",
      SIMULATION_ACCESS_TOKEN: "gateway-secret",
      SIMULATION_EXECUTOR_URL: `http://127.0.0.1:${executorPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk.toString();
    const match = /simulation gateway listening on (\d+)/u.exec(output);
    if (match) return Number(match[1]);
  }
  throw new Error(`gateway exited before listening: ${output}`);
}

describe("operator-host simulation gateway", () => {
  it("authenticates outside the executor and never forwards the credential", async () => {
    const seen = [];
    const executor = createServer((request, response) => {
      seen.push({
        url: request.url,
        authorization: request.headers.authorization,
      });
      const body = JSON.stringify(
        request.url === "/health" ? { status: "ready" } : { accepted: true },
      );
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      response.end(body);
    });
    const gatewayPort = await startGateway(await listen(executor));
    const base = `http://127.0.0.1:${gatewayPort}`;

    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect(
      (
        await fetch(`${base}/run`, {
          method: "POST",
          body: JSON.stringify({ deck: "x" }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/run`, {
          method: "POST",
          headers: {
            authorization: "Bearer gateway-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ deck: "x" }),
        })
      ).status,
    ).toBe(200);
    expect(seen).toEqual([
      { url: "/health", authorization: undefined },
      { url: "/run", authorization: undefined },
    ]);
  });
});
