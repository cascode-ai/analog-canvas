import {
  ManagedRunRecordSchema,
  type ManagedRunRecord,
} from "./managed-run.js";
import { CapabilitiesSchema, ProblemSchema } from "./contract.js";
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

  async function jsonResponse(path: string, init?: RequestInit) {
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
    let body: Record<string, unknown> | null;
    try {
      body = await response.json();
    } catch {
      throw new ExecutionFailure(
        {
          code: "RUN_RESPONSE_UNKNOWN",
          message:
            "The managed response body could not be read completely. The existing run remains server-owned; do not submit a new start.",
          stage: "read",
          recovery: "retry-same-request",
        },
        true,
      );
    }
    return { response, body };
  }

  function throwHttpFailure(
    response: Response,
    body: Record<string, unknown> | null,
  ): never {
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
              retryAfterMs: Number(response.headers.get("retry-after")) * 1_000,
            }
          : {}),
      },
      code === "RUN_RESPONSE_UNKNOWN",
    );
  }

  async function jsonRequest(path: string, init?: RequestInit) {
    const { response, body } = await jsonResponse(path, init);
    if (!response.ok) throwHttpFailure(response, body);
    return body;
  }

  function timestamp(response: Response, name: string): number | undefined {
    const value = response.headers.get(name);
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  function retainedProblem(
    body: Record<string, unknown> | null,
    fallbackStage: "cancel" | "read" = "read",
  ) {
    return ProblemSchema.safeParse({
      code:
        typeof body?.error === "string" ? body.error : "SIMULATION_HTTP_ERROR",
      message:
        typeof body?.message === "string"
          ? body.message
          : typeof body?.error === "string"
            ? body.error
            : "The managed run did not produce a readable result.",
      stage: typeof body?.stage === "string" ? body.stage : fallbackStage,
      recovery:
        typeof body?.recovery === "string" ? body.recovery : "not-retryable",
      ...(typeof body?.retryAfterMs === "number"
        ? { retryAfterMs: body.retryAfterMs }
        : {}),
    });
  }

  async function waitForResult(
    input: ExecutionInput,
    initialRun: ManagedRunRecord,
  ): ReturnType<Executor["execute"]> {
    const waitStarted = performance.now();
    let pollCount = 0;
    let pollSleepMs = 0;
    while (true) {
      const resultFetchStarted = performance.now();
      const { response, body } = await jsonResponse(
        `/api/simulation/runs/${encodeURIComponent(initialRun.id)}/result`,
      );
      pollCount++;
      if (response.status === 409 && body?.error === "RESULT_NOT_READY") {
        if (
          typeof body.state === "string" &&
          !["queued", "running", "cancelling"].includes(body.state)
        )
          throw new ExecutionFailure({
            code:
              body.state === "expired"
                ? "RESULT_EXPIRED"
                : "RESULT_UNAVAILABLE",
            message: "The managed run is terminal and has no readable result.",
            stage: "read",
            recovery: "not-retryable",
          });
        const sleepStarted = performance.now();
        await pause(pollIntervalMs);
        pollSleepMs += performance.now() - sleepStarted;
        continue;
      }
      if (!response.ok) {
        // Transport failures are not retained simulation Problems. Preserve
        // retry/reauthorize classification instead of defaulting to permanent.
        if (
          typeof body?.recovery !== "string" &&
          typeof body?.state !== "string"
        )
          throwHttpFailure(response, body);
        const problem = retainedProblem(
          body,
          body?.error === "run-cancelled" ? "cancel" : "read",
        );
        if (problem.success)
          throw new ExecutionFailure(
            problem.data,
            body?.state === "infrastructure-failed",
          );
        throwHttpFailure(response, body);
      }
      const resultFetchMs = performance.now() - resultFetchStarted;
      // A retained executor refusal is evidence, not a SimulationResult. Keep
      // its server-owned Problem; genuine failed analyses still carry results.
      if (typeof body?.error === "string" && !body.outcome) {
        const problem = retainedProblem(body);
        if (problem.success) throw new ExecutionFailure(problem.data);
      }
      const output = decodeHostedExecutionPayload(input, body);
      const startedAt = timestamp(response, "x-analog-canvas-run-started-at");
      const finishedAt = timestamp(response, "x-analog-canvas-run-finished-at");
      return {
        ...output,
        timing: {
          managed: {
            ...(startedAt === undefined
              ? {}
              : {
                  queueMs: Math.max(0, startedAt - initialRun.queuedAt),
                }),
            ...(startedAt === undefined || finishedAt === undefined
              ? {}
              : {
                  executionMs: Math.max(0, finishedAt - startedAt),
                }),
            ...(finishedAt === undefined
              ? {}
              : {
                  runTotalMs: Math.max(0, finishedAt - initialRun.createdAt),
                }),
            resultFetchMs,
            clientWaitMs: performance.now() - waitStarted,
            pollCount,
            pollSleepMs,
          },
        },
      };
    }
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
        return parsed.data;
      });
      serverRuns.set(
        runToken,
        starting.then((run) => run.id),
      );
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
