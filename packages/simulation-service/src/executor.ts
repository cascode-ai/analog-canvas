import { SimulationResultSchema } from "@icm/spice-run";
import { SimulationRawFileSchema } from "@icm/model";
import { z } from "zod";
import type { Capabilities, Prepared, Problem } from "./contract.js";

export interface ExecutionInput {
  /** Native inputs must never be dispatched to or accepted from a legacy engine. */
  language?: "vacask";
  mode: "structured" | "raw";
  netlist: string;
  testbench: string;
  inputRevision: string;
  environment: Prepared["environment"];
  files: { path: string; text: string }[];
  dependencies: { id: string; mountPath: string; sha256: string }[];
  entryPath?: string;
  preparedDeck?: string;
  /** Exact run-local collector, independent of how the native script writes it. */
  collection?: { kind: "native-multi-ascii" } | { rawfile: string | null };
}
const ExecutionFilesSchema = z
  .array(SimulationRawFileSchema)
  .superRefine((files, context) => {
    const seen = new Set<string>();
    for (const [index, file] of files.entries()) {
      if (seen.has(file.path))
        context.addIssue({
          code: "custom",
          path: [index, "path"],
          message: "Duplicate execution file path",
        });
      seen.add(file.path);
    }
  });

/** Native files retain run-local paths and exact text; they are never concatenated. */
export const ExecutionOutputSchema = z
  .strictObject({
    result: SimulationResultSchema,
    rawfiles: ExecutionFilesSchema.optional(),
    executedFiles: ExecutionFilesSchema.optional(),
    // Historical single-file replies remain readable until the old executors retire.
    rawfile: z.string().optional(),
    executedDeck: z.string().optional(),
    cancelled: z.boolean().optional(),
    /** Collector completeness is independent of process/analysis success. */
    collectionStatus: z.enum(["complete", "partial"]).optional(),
  })
  .superRefine((output, context) => {
    if (output.result.metadata.environment.simulator.name !== "vacask") {
      if (output.rawfiles !== undefined || output.executedFiles !== undefined)
        context.addIssue({
          code: "custom",
          message: "Native file collections require VACASK identity",
        });
      return;
    }
    if (
      output.rawfiles === undefined ||
      output.executedFiles === undefined ||
      output.rawfile !== undefined ||
      output.executedDeck !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "VACASK requires native rawfiles and executedFiles collections",
      });
      return;
    }
    const paths = new Set(output.rawfiles.map((file) => file.path));
    if (output.result.data && !output.result.data.rawPlots?.length)
      context.addIssue({
        code: "custom",
        message: "Native numeric data requires original plot evidence",
      });
    for (const plot of output.result.data?.rawPlots ?? []) {
      if (
        plot.artifactPath === undefined ||
        !paths.has(plot.artifactPath) ||
        plot.artifactPlotOrdinal === undefined
      )
        context.addIssue({
          code: "custom",
          message:
            "Native plot must reference a collected file and its local plot ordinal",
        });
    }
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
  const native = output.result.metadata.environment.simulator.name === "vacask";
  const needsEntryEvidence =
    !!output.executedFiles?.length ||
    !!output.result.data ||
    output.result.outcome.status === "completed" ||
    output.result.outcome.status === "completed-with-dropped-input";
  if (
    output.result.metadata.input.inputRevision !== input.inputRevision ||
    output.result.metadata.environment.profileId !==
      input.environment.profileId ||
    native !== (input.language === "vacask") ||
    (native &&
      needsEntryEvidence &&
      (!input.entryPath ||
        !output.executedFiles?.some((file) => file.path === input.entryPath)))
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
  ) {
    super(problem.message);
  }
}
