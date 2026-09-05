import { CapabilitiesSchema } from "./contract.js";
import { SimulationResultSchema } from "@icm/spice-run";
import {
  ExecutionFailure,
  type Executor,
  type ExecutionInput,
} from "./service.js";

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
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
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
              : code === "simulator-unreachable"
                ? "retry-same-request"
                : "fix-input",
          ...(code === "simulator-busy" ? { retryAfterMs: 2000 } : {}),
        },
        code === "simulator-unreachable",
      );
    }
    return payload;
  }
  return {
    async capabilities() {
      const response = await fetchImpl("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "capabilities" }),
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
      const { rawfile, executedDeck, cancelled, ...value } = body ?? {};
      const parsed = SimulationResultSchema.safeParse(value);
      if (!parsed.success)
        throw new ExecutionFailure(
          {
            code: "SIMULATION_RESULT_INVALID",
            message:
              "The executor returned an invalid result; this run was not retried.",
            stage: "read",
            recovery: "not-retryable",
          },
          true,
        );
      if (
        parsed.data.metadata.input.inputRevision !== input.inputRevision ||
        parsed.data.metadata.environment.profileId !==
          input.environment.profileId
      )
        throw new ExecutionFailure({
          code: "SIMULATION_IDENTITY_MISMATCH",
          message:
            "Result input/environment identity differs from the prepared input",
          stage: "read",
          recovery: "not-retryable",
        });
      return {
        result: parsed.data,
        cancelled: cancelled === true,
        ...(typeof rawfile === "string" ? { rawfile } : {}),
        ...(typeof executedDeck === "string" ? { executedDeck } : {}),
      };
    },
    async cancel(runToken: string) {
      await post({ operation: "cancel", runToken }, "cancel");
    },
  };
}
