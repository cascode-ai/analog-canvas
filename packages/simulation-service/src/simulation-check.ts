// The Gallery's simulation check (#1545): how one run of a testbench folder
// is judged, and how an entry's folders make its verdict. The Worker's
// hosted check and the Owner's local check (scripts/gallery-sim-verify.mjs)
// both judge through these functions, so a verdict means the same wherever
// the testbench ran.

import type { ExecutionInput, ExecutionOutput } from "./executor.js";
import type { Problem } from "./contract.js";
import { executionSpecReport } from "./spec-results.js";
import {
  formatSimulationSpec,
  type SimulationSpecReport,
  type SimulationSpecResult,
} from "./spec-contract.js";

/**
 * The rule a stored verdict answered. Rule 1: every simulation folder runs
 * to completion, the testbench states at least one Spec, and every Spec it
 * states passes. A verdict of another rule shows no mark; the Owner checks
 * again.
 */
export const SIMULATION_CHECK_RULE_VERSION = 1;

/** One folder's run, and each Spec it states. */
export interface SimulationCheckFolder {
  name: string;
  status: "pass" | "fail" | "error";
  /** Why it did not pass: the run's Problem code, or a Spec's reason. */
  code?: string;
  message?: string;
  /** The simulator and Profile its result named, such as `ngspice ngspice-46`. */
  simulator?: string;
  profileId?: string;
  specs: {
    name: string;
    expected: string;
    value: number | null;
    unit: string;
    judgment: string;
    reason?: string;
  }[];
}

/** An entry's latest check, as the Gallery stores it. */
export interface SimulationCheck {
  status: "pass" | "fail" | "error" | "no-testbench";
  checkedAt: string;
  rule: number;
  simulator: string | null;
  /** Why it did not pass, when it did not. */
  reason?: string;
  /**
   * Where the testbench ran: `local` for a run the Owner recorded from their
   * own machine; absent for the hosted simulator.
   */
  origin?: "local";
  folders: SimulationCheckFolder[];
}

const MAX_CHECK_SPECS = 24;
const MAX_CHECK_TEXT = 300;

function clipped(text: string, limit = MAX_CHECK_TEXT): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** A folder's name as its verdict carries it. */
export function simulationCheckFolderName(name: string): string {
  return clipped(name, 80);
}

/** A folder that could not be prepared or run: `error`, with why. */
export function simulationCheckFolderFailure(
  folder: { name: string },
  problem: Pick<Problem, "code" | "message">,
): SimulationCheckFolder {
  return {
    name: simulationCheckFolderName(folder.name),
    status: "error",
    code: problem.code,
    message: clipped(problem.message),
    specs: [],
  };
}

/** A Spec the testbench states: a condition, or an attempt at one. */
function statesSpec(result: SimulationSpecResult): boolean {
  return result.expected !== null || result.reason === "invalid-spec";
}

/**
 * One folder's run, judged by the Specs its captured input states:
 * `error` when the run did not complete, `fail` when a stated Spec did not
 * pass, else `pass`.
 */
export function judgeSimulationCheckFolder(
  folder: { name: string },
  input: Pick<ExecutionInput, "files" | "entryPath">,
  output: Pick<ExecutionOutput, "result" | "cancelled">,
  identity: Pick<SimulationSpecReport, "runId" | "preparedId" | "inputDigest">,
): SimulationCheckFolder {
  const { specs } = executionSpecReport(input, output, identity);
  const { result } = output;
  const environment = result.metadata.environment;
  const stated = specs.results.filter(statesSpec);
  const missed = stated.find((spec) => spec.judgment !== "pass");
  const completed = result.outcome.status === "completed" && !output.cancelled;
  const firstError = result.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  return {
    name: simulationCheckFolderName(folder.name),
    status: !completed ? "error" : missed ? "fail" : "pass",
    ...(!completed
      ? {
          code: output.cancelled
            ? "run-cancelled"
            : `run-${result.outcome.status}`,
          ...(firstError ? { message: clipped(firstError.text) } : {}),
        }
      : missed
        ? { code: missed.reason, message: clipped(missed.detail) }
        : {}),
    simulator: `${environment.simulator.name} ${environment.simulator.version}`,
    ...(environment.profileId ? { profileId: environment.profileId } : {}),
    specs: stated.slice(0, MAX_CHECK_SPECS).map((spec) => ({
      name: clipped(spec.name, 80),
      expected: formatSimulationSpec(spec.expected),
      value: spec.value,
      unit: clipped(spec.unit, 24),
      judgment: spec.judgment,
      ...(spec.judgment === "pass" ? {} : { reason: spec.reason }),
    })),
  };
}

/**
 * An entry's verdict from its folders' results: no folder is
 * `no-testbench`; a folder that errs or fails decides it; else it passes
 * when its testbench states a Spec at all.
 */
export function simulationCheckVerdict(
  folders: SimulationCheckFolder[],
  folderCount: number,
  checkedAt: string,
): SimulationCheck {
  const missed = folders.find((folder) => folder.status !== "pass");
  const status: SimulationCheck["status"] =
    folderCount === 0
      ? "no-testbench"
      : missed
        ? missed.status
        : folders.some((folder) => folder.specs.length > 0)
          ? "pass"
          : "fail";
  const reason =
    status === "no-testbench"
      ? "no-testbench"
      : missed
        ? (missed.code ?? missed.status)
        : status === "fail"
          ? "no-specs"
          : undefined;
  return {
    status,
    checkedAt,
    rule: SIMULATION_CHECK_RULE_VERSION,
    simulator: folders.find((folder) => folder.simulator)?.simulator ?? null,
    ...(reason ? { reason } : {}),
    folders,
  };
}
