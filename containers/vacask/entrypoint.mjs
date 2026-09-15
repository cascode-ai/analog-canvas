import { readFile, mkdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import { CapabilitiesSchema } from "@icm/simulation-service";
import { SimulationRunSupervisor } from "../ngspice/run-supervisor.mjs";
import { initializeVacaskRuntime } from "./runtime.mjs";
import { validVacaskLimits } from "./run-job.mjs";
import { createVacaskHttpServer } from "./http-server.mjs";

/** Deployment composition only: existing runtime facts, capability declaration
 * and resource limits. This file is not a Project format or a model Profile. */
export async function startVacaskService(configuration) {
  const config = structuredClone(configuration);
  const capabilities = CapabilitiesSchema.parse(config.capabilities);
  const host = config.listen?.host ?? "127.0.0.1",
    port = config.listen?.port ?? 0;
  if (
    !isIP(host) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    (config.runtime?.executor !== "hosted-container" &&
      !["127.0.0.1", "::1"].includes(host))
  )
    throw new Error(
      "Local native services require loopback; hosted bindings must be explicit IP addresses.",
    );
  if (
    !isAbsolute(config.runtime?.runRoot ?? "") ||
    !validVacaskLimits(config.limits) ||
    !Number.isSafeInteger(capabilities.maxTimeoutMs) ||
    capabilities.maxTimeoutMs <= 0
  )
    throw new Error(
      "Native runtime requires an absolute run root and valid resource limits.",
    );
  const supervisor = new SimulationRunSupervisor({
    defaultTimeoutMs: Math.min(30000, capabilities.maxTimeoutMs),
    maxTimeoutMs: capabilities.maxTimeoutMs,
  });
  const ready = (async () => {
    await mkdir(config.runtime.runRoot, { recursive: true });
    return initializeVacaskRuntime(config.runtime);
  })();
  let server;
  try {
    server = createVacaskHttpServer({
      runtimeReady: ready,
      capabilities,
      limits: config.limits,
      supervisor,
      maxRequestBytes: config.http?.maxRequestBytes,
      maxResponseBytes: config.http?.maxResponseBytes,
      maxConnections: config.http?.maxConnections,
    });
  } catch (error) {
    await ready.catch(() => {});
    throw error;
  }
  let stopping;
  const stop = () =>
    (stopping ??= (async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections();
      await Promise.all([supervisor.shutdown(), ready.catch(() => {})]);
      // Cleanup must finish even when a requester disconnected; unfinished HTTP
      // readers must not keep shutdown alive. A shutdown may lose a pending reply.
      server.closeAllConnections();
      await closed;
    })());
  try {
    await new Promise((yes, no) => {
      server.once("error", no);
      server.listen(port, host, () => {
        server.off("error", no);
        yes();
      });
    });
  } catch (error) {
    await stop();
    throw error;
  }
  // Readiness includes capability and model-symbol validation, not only binary
  // measurement. Otherwise CLI stderr omits failures which keep /health at 503.
  const initialized = server.initialized.then(() => ready);
  void initialized.catch(() => {});
  return { server, ready: initialized, stop };
}

async function main() {
  const path = process.argv[2];
  if (process.argv.length !== 3 || !path || !isAbsolute(path))
    throw new Error(
      "Usage: node containers/vacask/entrypoint.mjs <absolute runtime-config.json>",
    );
  const info = await stat(path);
  if (!info.isFile() || info.size > 262144)
    throw new Error(
      "Runtime configuration must be a regular JSON file no larger than 256 KiB.",
    );
  const config = JSON.parse(await readFile(path, "utf8"));
  const service = await startVacaskService(config);
  const address = service.server.address();
  console.log(
    JSON.stringify({
      event: "vacask-listening",
      address: address.address,
      port: address.port,
    }),
  );
  service.ready.catch((error) =>
    console.error(
      JSON.stringify({
        event: "vacask-runtime-not-ready",
        message: error.message,
      }),
    ),
  );
  const stop = () => {
    void service.stop().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 70;
      },
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        event: "vacask-startup-failed",
        message: error.message,
      }),
    );
    process.exitCode = 1;
  });
