import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import {
  SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES,
  SIMULATION_EXECUTOR_STREAM_MAX_BYTES,
} from "@icm/spice-run";

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

async function startGateway(executorPort, environment = {}) {
  const child = spawn(process.execPath, ["containers/ngspice/gateway.mjs"], {
    env: {
      PATH: process.env.PATH,
      PORT: "0",
      SIMULATION_ACCESS_TOKEN: "gateway-secret",
      SIMULATION_EXECUTOR_URL: `http://127.0.0.1:${executorPort}`,
      ...environment,
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
  it("preserves internal receipts while streaming and rejects an overlong chunked body", async () => {
    let oversized = false;
    const executor = createServer((request, response) => {
      request.resume();
      response.writeHead(200, {
        "x-analog-simulation-receipt": "receipt",
        "set-cookie": "private=1",
      });
      response.write("first");
      response.end(oversized ? "x".repeat(2048) : "last");
    });
    const port = await startGateway(await listen(executor), {
      SIMULATION_GATEWAY_MAX_RESPONSE_BYTES: "1024",
    });
    const run = () =>
      fetch(`http://127.0.0.1:${port}/run`, {
        method: "POST",
        headers: { authorization: "Bearer gateway-secret" },
        body: "{}",
      });
    const reply = await run();
    expect(reply.headers.get("x-analog-simulation-receipt")).toBe("receipt");
    expect(reply.headers.get("set-cookie")).toBeNull();
    expect(await reply.text()).toBe("firstlast");
    oversized = true;
    await expect(run().then((response) => response.text())).rejects.toThrow();
  });
  it("preserves native replies above 4 MiB while enforcing the shared ceiling", async () => {
    const compose = await readFile(
      "containers/vacask/host/compose.yaml",
      "utf8",
    );
    const configuredLimit = Number(
      /SIMULATION_GATEWAY_MAX_RESPONSE_BYTES: "(\d+)"/u.exec(compose)?.[1],
    );
    expect(configuredLimit).toBe(SIMULATION_EXECUTOR_STREAM_MAX_BYTES);
    const limit = SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES;
    let bytes = 4 * 1024 * 1024 + 512;
    const executor = createServer((_request, response) =>
      response.end("x".repeat(bytes)),
    );
    const gatewayPort = await startGateway(await listen(executor), {
      SIMULATION_GATEWAY_MAX_RESPONSE_BYTES: String(limit),
    });
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
    expect(response.status).toBe(200);
    expect((await response.text()).length).toBe(bytes);
    bytes = limit + 1;
    const oversized = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
    expect(oversized.status).toBe(502);
    expect(await oversized.json()).toEqual({
      error: "executor-response-too-large",
    });
  });
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
