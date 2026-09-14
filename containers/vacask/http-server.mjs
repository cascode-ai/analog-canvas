import { createServer } from "node:http";
import { CapabilitiesSchema } from "@icm/simulation-service";
import { verifySimulationEnvironmentMetadata } from "@icm/spice-run";
import { executeVacask } from "./execute.mjs";
import { validVacaskLimits } from "./run-job.mjs";
import {
  resolveRunTimeout,
  SimulationRunSupervisor,
} from "../ngspice/run-supervisor.mjs";

const tokenValid = (token) =>
  typeof token === "string" && /^[0-9a-f-]{36}$/u.test(token);
const unavailable = {
  configured: false,
  inputs: [],
  analyses: [],
  parsedAnalyses: [],
  profiles: [],
  maxTimeoutMs: 0,
  maxInputBytes: 0,
  cancel: false,
};

/** Internal executor transport, not a public authenticated gateway. Bind only
 * to loopback or the private executor network; reuse the existing separate
 * credential-owning gateway for remote callers. This module never reads tokens,
 * launches a listener, selects models or claims a Profile has been qualified.
 * Capabilities come from the deployment's independently accepted Profile. */
export function createVacaskHttpServer({
  runtimeReady,
  capabilities,
  limits,
  supervisor = new SimulationRunSupervisor(),
  maxRequestBytes = 4 * 1024 * 1024,
  maxResponseBytes = 4 * 1024 * 1024,
  maxConnections = 16,
}) {
  if (
    ![maxRequestBytes, maxResponseBytes, maxConnections].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new Error("HTTP limits must be positive integer counts.");
  let runtime, caps;
  // Keep health responsive while boot identity is measured, including failure.
  Promise.resolve(runtimeReady)
    .then(async (value) => {
      const measured = await verifySimulationEnvironmentMetadata(
        value.environment,
      );
      const declared = CapabilitiesSchema.parse(capabilities);
      const profile = declared.profiles[0];
      if (
        !validVacaskLimits(limits) ||
        !measured ||
        measured.simulator.name !== "vacask" ||
        !declared.configured ||
        declared.rawfileCollection !== "native-multi-ascii" ||
        declared.inputs.length !== 1 ||
        declared.inputs[0] !== "source" ||
        declared.profiles.length !== 1 ||
        profile.id !== measured.profileId ||
        declared.maxInputBytes !== limits.maxInputBytes ||
        declared.maxInputFiles !== limits.maxInputFiles ||
        declared.maxOutputBytes !== limits.maxOutputBytes ||
        declared.maxTimeoutMs <= 0 ||
        declared.maxTimeoutMs > supervisor.limits.maxTimeoutMs ||
        (profile.dependencies ?? []).some(
          (d) =>
            !(value.dependencies ?? []).some(
              (actual) => actual.id === d.id && actual.sha256 === d.sha256,
            ),
        )
      )
        throw new Error("Native capability/runtime contract mismatch.");
      runtime = value;
      caps = declared;
    })
    .catch(() => {
      runtime = undefined;
      caps = undefined;
    });
  const cancelled = new Map();
  const ready = () =>
    runtime && caps && supervisor.snapshot().state !== "fatal";
  const prune = () => {
    const now = Date.now();
    for (const [token, expires] of cancelled)
      if (expires <= now) cancelled.delete(token);
  };
  const server = createServer(
    { requestTimeout: 10000, headersTimeout: 5000, maxHeaderSize: 16384 },
    (request, response) => {
      const send = (status, payload, headers = {}) => {
        if (response.destroyed || response.writableEnded) return;
        let body = JSON.stringify(payload);
        if (Buffer.byteLength(body) > maxResponseBytes) {
          status = 502;
          body = JSON.stringify({
            error: "executor-response-too-large",
            message:
              "The run reply exceeded transport limits; do not assume it was not executed.",
          });
        }
        response.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(body),
          ...headers,
        });
        response.end(body);
      };
      if (request.method === "GET" && request.url === "/health") {
        send(ready() ? 200 : 503, {
          status: ready() ? "ready" : "not-ready",
          activity: supervisor.snapshot(),
          limits: { ...limits, ...supervisor.limits },
          ...(ready()
            ? { environment: runtime.environment, capabilities: caps }
            : {}),
        });
        return;
      }
      if (
        request.method !== "POST" ||
        !["/run", "/cancel", "/api/simulate"].includes(request.url)
      ) {
        send(404, { error: "not-found" });
        request.resume();
        return;
      }
      if (request.headers.origin !== undefined) {
        send(403, { error: "origin-not-allowed" });
        request.resume();
        return;
      }
      if (
        !/^application\/json(?:;|$)/iu.test(
          request.headers["content-type"] ?? "",
        )
      ) {
        send(415, { error: "json-required" });
        request.resume();
        return;
      }
      // No CORS or browser-access grant is supplied by this internal service.
      const chunks = [];
      let size = 0,
        rejected = false;
      request.on("data", (chunk) => {
        if (rejected) return;
        size += chunk.length;
        if (size > maxRequestBytes) {
          rejected = true;
          chunks.length = 0;
          response.once("finish", () => request.destroy());
          send(413, { error: "request-too-large" }, { connection: "close" });
          return;
        }
        chunks.push(chunk);
      });
      request.on("error", () => {
        rejected = true;
        chunks.length = 0;
      });
      request.on("end", () => {
        if (rejected) return;
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          send(400, { error: "invalid-json" });
          return;
        }
        chunks.length = 0;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          send(400, { error: "invalid-request" });
          return;
        }
        const operation = request.url === "/cancel" ? "cancel" : body.operation;
        if (request.url === "/api/simulate" && operation === "capabilities") {
          send(200, ready() ? caps : unavailable);
          return;
        }
        if (operation === "cancel" && request.url !== "/run") {
          if (!tokenValid(body.runToken)) {
            send(400, { error: "invalid-run-token" });
            return;
          }
          prune();
          if (!cancelled.has(body.runToken) && cancelled.size >= 256) {
            send(503, { error: "cancel-capacity" });
            return;
          }
          cancelled.set(body.runToken, Date.now() + 180000);
          supervisor.cancel(body.runToken);
          send(200, { accepted: true });
          return;
        }
        if (operation !== undefined) {
          send(400, { error: "invalid-operation" });
          return;
        }
        if (!ready()) {
          send(503, {
            error: "simulator-not-ready",
            message:
              "The native executor is not ready; editing remains available.",
          });
          return;
        }
        prune();
        if (body.runToken && cancelled.has(body.runToken)) {
          send(409, { error: "run-cancelled" });
          return;
        }
        const timeoutMs = resolveRunTimeout(body.timeoutMs, {
          defaultTimeoutMs: supervisor.limits.defaultTimeoutMs,
          maxTimeoutMs: caps.maxTimeoutMs,
        });
        executeVacask({ ...body, timeoutMs }, runtime, limits, supervisor).then(
          (reply) => {
            if (reply.ok) {
              const { result, ...artifacts } = reply.output;
              send(200, { ...result, ...artifacts });
            } else {
              const status =
                reply.error.code === "simulator-busy"
                  ? 429
                  : reply.error.code === "input-too-large"
                    ? 413
                    : reply.error.recovery === "retry-after"
                      ? 503
                      : 400;
              send(
                status,
                { error: reply.error.code, message: reply.error.message },
                reply.retryAfterSeconds
                  ? { "retry-after": String(reply.retryAfterSeconds) }
                  : {},
              );
            }
          },
          () =>
            send(503, {
              error: "simulator-unreachable",
              message:
                "Execution completion could not be established. Read the existing run before retrying.",
            }),
        );
      });
    },
  );
  // Bound simultaneous request buffers without creating another execution queue.
  server.maxConnections = maxConnections;
  return server;
}
