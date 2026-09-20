import { CapabilitiesSchema } from "./contract.js";
import { SimulationResultSchema, readSimulationData } from "@icm/spice-run";
import {
  ExecutionFailure,
  validateExecutionOutput,
  type Executor,
  type ExecutionInput,
} from "./executor.js";

export type HostedExecutionPayload = Record<string, unknown> | null;

export function decodeHostedExecutionPayload(
  input: ExecutionInput,
  body: HostedExecutionPayload,
) {
  const {
    rawfile,
    rawfiles,
    executedFiles,
    executedDeck,
    cancelled,
    collectionStatus,
    ...value
  } = body ?? {};
  const output = validateExecutionOutput(input, {
    result: value,
    rawfile,
    rawfiles,
    executedFiles,
    executedDeck,
    cancelled,
    collectionStatus,
  });
  const result = output.result;
  // Older executor images projected padded short vectors as sweep samples.
  // Re-read explicit dimension declarations with the shared reader, without
  // promoting a result the executor withheld (for example a truncated file).
  if (
    result.metadata.environment.simulator.name === "ngspice" &&
    result.data &&
    typeof rawfile === "string" &&
    /^\s*\d+\s+\S+\s+\S+[^\r\n]*\bdims=/mu.test(rawfile)
  ) {
    const reading = readSimulationData(rawfile);
    result.diagnostics.push(
      ...reading.diagnostics.filter(
        (d) => !result.diagnostics.some((existing) => existing.text === d.text),
      ),
    );
    if (reading.status === "read")
      result.data = SimulationResultSchema.shape.data.parse(reading.data);
    else delete result.data;
    if (
      reading.diagnostics.some((d) => d.severity === "error") &&
      result.outcome.status !== "timed-out"
    )
      result.outcome = { status: "failed" };
  }
  return {
    ...output,
    cancelled: cancelled === true,
  };
}

export function createHostedExecutor(
  fetchImpl: typeof fetch = fetch,
): Executor {
  async function post(body: unknown, stage: "start" | "cancel") {
    let response: Response;
    try {
      response = await fetchImpl("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(stage === "cancel" ? 10000 : 150000),
      });
    } catch {
      throw new ExecutionFailure(
        {
          code: "RUN_RESPONSE_UNKNOWN",
          message:
            "The response was lost. Read this run; do not submit a new start.",
          stage,
          recovery: "retry-same-request",
        },
        true,
      );
    }
    let payload: Record<string, unknown> | null;
    try {
      payload = await response.json();
    } catch {
      throw new ExecutionFailure(
        {
          code:
            stage === "cancel"
              ? "cancel-response-unknown"
              : "RUN_RESPONSE_UNKNOWN",
          message:
            "The executor response was incomplete or unreadable. Read this run; do not submit a new start.",
          stage,
          recovery: "retry-same-request",
        },
        true,
      );
    }
    if (!response.ok) {
      const code =
        typeof payload?.reason === "string"
          ? payload.reason
          : typeof payload?.error === "string"
            ? payload.error
            : "SIMULATION_HTTP_ERROR";
      throw new ExecutionFailure(
        {
          code,
          message:
            typeof payload?.message === "string" ? payload.message : code,
          stage,
          recovery:
            code === "simulator-busy"
              ? "retry-after"
              : [
                    "simulator-unreachable",
                    "cancel-response-unknown",
                    "executor-receipt-invalid",
                  ].includes(code)
                ? "retry-same-request"
                : [
                      "simulation-not-configured",
                      "simulation-executor-unavailable",
                      "simulator-not-ready",
                      "simulator-unauthorized",
                    ].includes(code)
                  ? "retry-after"
                  : [
                        "prepared-environment-changed",
                        "simulation-profile-unavailable",
                      ].includes(code)
                    ? "reprepare"
                    : "fix-input",
          ...(code === "simulator-busy"
            ? {
                retryAfterMs: retryAfterMilliseconds(
                  response.headers.get("retry-after"),
                ),
              }
            : {}),
        },
        code === "simulator-unreachable" || code === "executor-receipt-invalid",
      );
    }
    return payload;
  }
  return {
    async capabilities(profileId) {
      const response = await fetchImpl("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "capabilities",
          ...(profileId ? { environment: { profileId } } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {
        throw new ExecutionFailure({
          code: "SIMULATION_CAPABILITIES_UNAVAILABLE",
          message:
            "Cannot read deployment capabilities; the session remains usable",
          stage: "read",
          recovery: "retry-after",
        });
      });
      const parsed = CapabilitiesSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success)
        throw new ExecutionFailure({
          code: "SIMULATION_CAPABILITIES_UNAVAILABLE",
          message: "This deployment does not advertise simulation capabilities",
          stage: "read",
          recovery: "retry-after",
        });
      return parsed.data;
    },
    async execute(input: ExecutionInput, runToken: string, timeoutMs?: number) {
      const body = await post(
        {
          ...input,
          runToken,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        },
        "start",
      );
      return decodeHostedExecutionPayload(input, body);
    },
    async cancel(runToken: string, profileId) {
      await post(
        {
          operation: "cancel",
          runToken,
          ...(profileId ? { environment: { profileId } } : {}),
        },
        "cancel",
      );
    },
  };
}

function retryAfterMilliseconds(value: string | null): number {
  if (value === null) return 2000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 2000;
}
