import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  CapabilitiesSchema,
  encodeExecutionReceipt,
  EXECUTION_RECEIPT_HEADER,
  decodeHostedExecutionPayload,
} from "@icm/simulation-service";
import {
  SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES,
  SIMULATION_EXECUTOR_STREAM_MAX_BYTES,
  SIMULATION_EXECUTOR_TRANSFER_HEADER,
  verifySimulationEnvironmentMetadata,
} from "@icm/spice-run";
import { executeVacask } from "./execute.mjs";
import { validVacaskLimits } from "./run-job.mjs";
import { verifyVacaskModelSymbols } from "./model-symbols.mjs";
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
  maxResponseBytes = SIMULATION_EXECUTOR_STREAM_MAX_BYTES,
  maxConnections = 16,
}) {
  if (
    maxResponseBytes > SIMULATION_EXECUTOR_STREAM_MAX_BYTES ||
    ![maxRequestBytes, maxResponseBytes, maxConnections].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new Error(
      "HTTP limits must be positive integers within the shared response ceiling.",
    );
  let runtime, caps;
  // Keep health responsive while boot identity is measured, including failure.
  const initialized = Promise.resolve(runtimeReady)
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
      await verifyVacaskModelSymbols(profile.modelSymbols, value.dependencies);
      runtime = value;
      caps = declared;
    })
    .catch((error) => {
      runtime = undefined;
      caps = undefined;
      throw error;
    });
  // Embedders may keep the unavailable health endpoint alive. The standalone
  // launcher awaits this same validation and reports boot errors to its operator.
  void initialized.catch(() => {});
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
      const responseLimit =
        request.headers[SIMULATION_EXECUTOR_TRANSFER_HEADER] === "receipt-v1"
          ? maxResponseBytes
          : Math.min(maxResponseBytes, SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES);
      const send = (status, payload, headers = {}, serialized) => {
        if (response.destroyed || response.writableEnded) return;
        let body = serialized ?? JSON.stringify(payload);
        if (Buffer.byteLength(body) > responseLimit) {
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
              let payload = { ...result, ...artifacts };
              if (
                ["cloudflare-container", "operator-host"].includes(
                  body.execution?.target,
                )
              )
                payload.execution = { target: body.execution.target };
              let serialized = JSON.stringify(payload);
              if (Buffer.byteLength(serialized) > responseLimit) {
                // The process has terminated: preserve that fact instead of a
                // proxy error that loses timeout/cancel status. Never advertise
                // successful numerical data after dropping its evidence.
                const { data: _data, ...boundedResult } = result;
                payload = {
                  ...boundedResult,
                  outcome:
                    result.outcome?.status === "timed-out"
                      ? result.outcome
                      : { status: "failed" },
                  log: (result.log ?? "").slice(0, 2048),
                  diagnostics: [
                    {
                      severity: "error",
                      text: "Native reply exceeded the transport byte limit. Numeric data and raw files were withheld; reduce recorded output before running again.",
                    },
                  ],
                  ...artifacts,
                  rawfiles: [],
                  collectionStatus: "partial",
                  ...(payload.execution
                    ? { execution: payload.execution }
                    : {}),
                };
                serialized = JSON.stringify(payload);
              }
              const headers = {};
              // Only canonical successful executor replies carry a receipt.
              // The existing body remains unchanged for older clients. Hashing
              // here lets durable storage verify a streamed body without forcing
              // the Worker to buffer it merely to calculate its artifact digest.
              if (
                tokenValid(body.runToken) &&
                payload.metadata &&
                payload.outcome &&
                payload.collectionStatus &&
                Buffer.byteLength(serialized) <= responseLimit
              ) {
                try {
                  // The producer validates numeric/file relationships before
                  // issuing a digest-bound receipt; streaming proxies need not
                  // repeat that validation by materializing the same arrays.
                  decodeHostedExecutionPayload(body, payload);
                  headers[EXECUTION_RECEIPT_HEADER] = encodeExecutionReceipt({
                    schemaVersion: 1,
                    runToken: body.runToken,
                    byteLength: Buffer.byteLength(serialized),
                    sha256: createHash("sha256")
                      .update(serialized)
                      .digest("hex"),
                    executedFilesSha256: createHash("sha256")
                      .update(JSON.stringify(payload.executedFiles ?? []))
                      .digest("hex"),
                    outcome: payload.outcome,
                    metadata: payload.metadata,
                    ...(payload.execution
                      ? { execution: payload.execution }
                      : {}),
                    cancelled: payload.cancelled === true,
                    collectionStatus: payload.collectionStatus,
                  });
                } catch {
                  send(502, {
                    error: "executor-receipt-invalid",
                    message:
                      "Execution ended but its transfer receipt could not be produced; do not resubmit the run.",
                  });
                  return;
                }
              }
              send(200, payload, headers, serialized);
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
  server.initialized = initialized;
  return server;
}
