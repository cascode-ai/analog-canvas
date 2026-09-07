import {
  ManagedRunRecordSchema,
  type ManagedRunRecord,
} from "./managed-run.js";
import { CapabilitiesSchema } from "./contract.js";
import {
  ExecutionFailure,
  type ExecutionIdentity,
  type ExecutionInput,
  type Executor,
} from "./executor.js";
import { decodeHostedExecutionPayload } from "./hosted-executor.js";

export interface ManagedHostedExecutorOptions {
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const activeStates = new Set(["queued", "running", "cancelling"]);
const resultStates = new Set(["succeeded", "failed", "timed-out", "cancelled"]);

/**
 * Browser/Agent adapter for the hosted operations plane.
 *
 * The service still owns prepare and presentation. Start, queueing, retries,
 * cancellation and evidence retention belong to the server. There is no
 * fallback to `/api/simulate`: the composition root selects one transport.
 */
export function createManagedHostedExecutor(
  options: ManagedHostedExecutorOptions = {},
): Executor {
  const fetchImpl = options.fetch ?? fetch;
  const pause =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const pollIntervalMs = options.pollIntervalMs ?? 750;
  const serverRuns = new Map<string, Promise<string>>();

  async function jsonRequest(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetchImpl(path, {
        ...init,
        headers: {
          ...(init?.body ? { "content-type": "application/json" } : {}),
          ...Object.fromEntries(new Headers(init?.headers)),
        },
      });
    } catch {
      throw new ExecutionFailure(
        {
          code: "RUN_RESPONSE_UNKNOWN",
          message:
            "The managed run remains server-owned, but its response could not be read.",
          stage: "read",
          recovery: "retry-same-request",
        },
        true,
      );
    }
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok) {
      const code =
        typeof body?.error === "string" ? body.error : "SIMULATION_HTTP_ERROR";
      throw new ExecutionFailure(
        {
          code,
          message: typeof body?.message === "string" ? body.message : code,
          stage: "read",
          recovery:
            response.status === 429 || response.status === 503
              ? "retry-after"
              : response.status === 401
                ? "reauthorize"
                : "not-retryable",
          ...(response.headers.get("retry-after")
            ? {
                retryAfterMs:
                  Number(response.headers.get("retry-after")) * 1_000,
              }
            : {}),
        },
        code === "RUN_RESPONSE_UNKNOWN",
      );
    }
    return body;
  }

  async function readRun(runId: string): Promise<ManagedRunRecord> {
    const body = await jsonRequest(
      `/api/simulation/runs/${encodeURIComponent(runId)}`,
    );
    const parsed = ManagedRunRecordSchema.safeParse(body?.run);
    if (!parsed.success)
      throw new ExecutionFailure({
        code: "MANAGED_RUN_INVALID",
        message: "The simulation control plane returned an invalid run record.",
        stage: "read",
        recovery: "not-retryable",
      });
    return parsed.data;
  }

  async function waitForResult(
    input: ExecutionInput,
    runId: string,
  ): ReturnType<Executor["execute"]> {
    while (true) {
      const run = await readRun(runId);
      if (activeStates.has(run.state)) {
        await pause(pollIntervalMs);
        continue;
      }
      if (resultStates.has(run.state)) {
        const payload = await jsonRequest(
          `/api/simulation/runs/${encodeURIComponent(runId)}/result`,
        );
        return decodeHostedExecutionPayload(input, payload);
      }
      throw new ExecutionFailure(
        run.error ?? {
          code: "MANAGED_RUN_UNAVAILABLE",
          message: `The managed run ended in state ${run.state}.`,
          stage: "read",
          recovery: run.state === "expired" ? "reprepare" : "retry-after",
        },
        run.state === "infrastructure-failed",
      );
    }
  }

  return {
    async capabilities() {
      const response = await fetchImpl("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "capabilities" }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      const parsed = CapabilitiesSchema.safeParse(
        await response?.json().catch(() => null),
      );
      if (!response?.ok || !parsed.success)
        throw new ExecutionFailure({
          code: "SIMULATION_CAPABILITIES_UNAVAILABLE",
          message: "This deployment does not advertise simulation capabilities",
          stage: "read",
          recovery: "retry-after",
        });
      return parsed.data;
    },
    async execute(
      input: ExecutionInput,
      runToken: string,
      timeoutMs?: number,
      identity?: ExecutionIdentity,
    ) {
      if (!identity)
        throw new ExecutionFailure({
          code: "MANAGED_RUN_IDENTITY_REQUIRED",
          message: "Prepare this input before starting a managed run.",
          stage: "start",
          recovery: "reprepare",
        });
      const starting = jsonRequest("/api/simulation/runs", {
        method: "POST",
        body: JSON.stringify({
          requestId: runToken,
          preparedId: identity.preparedId,
          preparedDigest: identity.preparedDigest,
          input: {
            ...input,
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          },
        }),
      }).then((body) => {
        const parsed = ManagedRunRecordSchema.safeParse(body?.run);
        if (!parsed.success)
          throw new ExecutionFailure({
            code: "MANAGED_RUN_INVALID",
            message:
              "The simulation control plane did not accept a run identity.",
            stage: "start",
            recovery: "retry-same-request",
          });
        return parsed.data.id;
      });
      serverRuns.set(runToken, starting);
      try {
        return await waitForResult(input, await starting);
      } finally {
        serverRuns.delete(runToken);
      }
    },
    async cancel(runToken: string) {
      const runId = await serverRuns.get(runToken);
      if (!runId) return;
      await jsonRequest(
        `/api/simulation/runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST", body: "{}" },
      );
    },
  };
}
