import type { SimulationResultSchema } from "@icm/spice-run";
import type { z } from "zod";
type SimulationResult = z.infer<typeof SimulationResultSchema>;
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
  /** Exact run-local collector, independent of how the native script writes it. */
  collection?: { rawfile: string | null };
}
export interface ExecutionIdentity {
  preparedId: string;
  preparedDigest: string;
}
export interface Executor {
  capabilities(): Promise<Capabilities>;
  execute(
    input: ExecutionInput,
    runToken: string,
    timeoutMs?: number,
    identity?: ExecutionIdentity,
  ): Promise<{
    result: SimulationResult;
    rawfile?: string;
    executedDeck?: string;
    cancelled?: boolean;
  }>;
  cancel(runToken: string): Promise<void>;
}
export class ExecutionFailure extends Error {
  constructor(
    readonly problem: Problem,
    readonly acceptedUnknown = false,
  ) {
    super(problem.message);
  }
}
