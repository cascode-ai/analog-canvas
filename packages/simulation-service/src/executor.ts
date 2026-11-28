import { SimulationResultSchema } from "@icm/spice-run";
import { z } from "zod";
import type { Capabilities, Prepared, Problem } from "./contract.js";

export interface ExecutionInput {
  mode: "structured" | "raw";
  netlist: string;
  testbench: string;
  inputRevision: string;
  environment: Prepared["environment"];
  files: { path: string; text: string }[];
  dependencies: { id: string; mountPath: string; sha256: string }[];
  entryPath?: string;
  preparedDeck?: string;
  /** Exact run-local rawfile collector declared by the simulation source. */
  collection?: { rawfile: string | null };
}

export const ExecutionOutputSchema = z.strictObject({
  result: SimulationResultSchema,
  rawfile: z.string().optional(),
  executedDeck: z.string().optional(),
  cancelled: z.boolean().optional(),
  /** Collector completeness is independent of process/analysis success. */
  collectionStatus: z.enum(["complete", "partial"]).optional(),
  /** Client-observed managed-plane timing; simulator duration remains in result.durationMs. */
  timing: z
    .strictObject({
      managed: z.strictObject({
        queueMs: z.number().nonnegative().optional(),
        executionMs: z.number().nonnegative().optional(),
        runTotalMs: z.number().nonnegative().optional(),
        inputReadMs: z.number().nonnegative().optional(),
        upstreamMs: z.number().nonnegative().optional(),
        resultCommitMs: z.number().nonnegative().optional(),
        resultFetchMs: z.number().nonnegative(),
        serverWaitMs: z.number().nonnegative().optional(),
        clientWaitMs: z.number().nonnegative(),
        pollCount: z.number().int().nonnegative(),
        pollSleepMs: z.number().nonnegative(),
      }),
    })
    .optional(),
});
export type ExecutionOutput = z.infer<typeof ExecutionOutputSchema>;

/** Shared by local and hosted execution; errors do not authorize a second start. */
export function validateExecutionOutput(
  input: ExecutionInput,
  value: unknown,
): ExecutionOutput {
  const parsed = ExecutionOutputSchema.safeParse(value);
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
  const output = parsed.data;
  if (
    output.result.metadata.input.inputRevision !== input.inputRevision ||
    output.result.metadata.environment.profileId !== input.environment.profileId
  )
    throw new ExecutionFailure({
      code: "SIMULATION_IDENTITY_MISMATCH",
      message:
        "Result input/environment identity differs from the prepared input",
      stage: "read",
      recovery: "not-retryable",
    });
  return output;
}
export interface ExecutionIdentity {
  preparedId: string;
  preparedDigest: string;
}
export interface Executor {
  capabilities(profileId?: string): Promise<Capabilities>;
  execute(
    input: ExecutionInput,
    runToken: string,
    timeoutMs?: number,
    identity?: ExecutionIdentity,
  ): Promise<ExecutionOutput>;
  cancel(runToken: string, profileId?: string): Promise<void>;
}
export class ExecutionFailure extends Error {
  constructor(
    readonly problem: Problem,
    readonly acceptedUnknown = false,
    /** Read an already-admitted run only; never submit or execute new work. */
    readonly readResult?: () => Promise<ExecutionOutput>,
  ) {
    super(problem.message);
  }
}
