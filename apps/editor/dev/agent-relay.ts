import { fileURLToPath } from "node:url";

import type { Plugin, ProxyOptions } from "vite";
import type { Unstable_DevWorker } from "wrangler";

/** Start a real local relay only when an Agent API or WebSocket is requested. */
export function localAgentRelay(): Plugin {
  let worker: Promise<Unstable_DevWorker> | undefined;
  let proxyOptions: ProxyOptions;
  let closing = false;

  function start(): Promise<Unstable_DevWorker> {
    if (closing)
      return Promise.reject(new Error("Local Agent relay is closing"));
    worker ??= import("wrangler")
      .then(({ unstable_dev }) =>
        unstable_dev(
          fileURLToPath(new URL("./agent-worker.ts", import.meta.url)),
          {
            config: fileURLToPath(new URL("./wrangler.json", import.meta.url)),
            envFiles: [],
            local: true,
            ip: "127.0.0.1",
            port: 0,
            inspectorPort: 0,
            persist: false,
            logLevel: "error",
            experimental: {
              disableExperimentalWarning: true,
              disableDevRegistry: true,
              showInteractiveDevSession: false,
              watch: true,
            },
          },
        ),
      )
      .catch((error: unknown) => {
        worker = undefined;
        throw error;
      });
    return worker;
  }

  const agentProxy: ProxyOptions = {
    ws: true,
    // Keep the editor's Host and Origin so the real router's same-origin
    // validation and generated hand-off URLs work through the Vite proxy.
    changeOrigin: false,
    configure(_server, options) {
      proxyOptions = options;
    },
    async bypass(req, res) {
      try {
        const runtime = await start();
        proxyOptions.target = `http://${runtime.address}:${runtime.port}`;
      } catch (error) {
        console.error("Local Agent relay could not start:", error);
        const body = JSON.stringify({
          ok: false,
          error: {
            message:
              "Local Agent relay could not start. Check the pnpm dev terminal, then retry.",
          },
        });
        if (res) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(body);
        } else {
          req.socket.end(
            "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
          );
        }
        return req.url ?? "/api/agent/";
      }
    },
  };

  return {
    name: "local-agent-relay",
    apply: (_config, env) => env.command === "serve" && !env.isPreview,
    config() {
      return { server: { proxy: { "/api/agent/": agentProxy } } };
    },
    async closeBundle() {
      closing = true;
      await worker?.then(
        (runtime) => runtime.stop(),
        () => undefined,
      );
    },
  };
}
