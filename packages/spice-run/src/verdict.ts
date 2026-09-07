import {
  readSimulationData,
  type SimulationResultData,
} from "./result-data.js";
import type { SimulationDiagnostic, SimulationOutcome } from "./contract.js";
const DROPPED_INPUT_PATTERNS = [
  /is not a valid .* line, ignored/iu,
  /could not find a valid modelname/iu,
  /unknown subckt/iu,
  /ignored\s*!?$/iu,
];

const ERROR_PATTERNS = [
  /^\s*error[: ]/iu,
  /simulation interrupted/iu,
  /could not find a valid modelname/iu,
  /singular matrix/iu,
  /no convergence/iu,
  /iteration limit reached/iu,
  /fatal/iu,
];

/**
 * Read ngspice's output into diagnostics.
 *
 * The exit status is deliberately not the input. Measured against ngspice
 * 44: a deck whose resistor line is malformed exits **0** while printing
 * "Warning: 'r1 in out' is not a valid resistor instance line, ignored!" and
 * then solving the circuit that remains. Trusting the status there would
 * report a clean success for numbers describing a circuit the author never
 * drew.
 */
export function readNgspiceDiagnostics(output: string): SimulationDiagnostic[] {
  const diagnostics: SimulationDiagnostic[] = [];
  for (const raw of output.split(/\r?\n/u)) {
    const text = raw.trim();
    if (text.length === 0) continue;
    const dropped = DROPPED_INPUT_PATTERNS.some((pattern) =>
      pattern.test(text),
    );
    const isError = ERROR_PATTERNS.some((pattern) => pattern.test(text));
    const isWarning = /^\s*warning/iu.test(text);
    if (!dropped && !isError && !isWarning) continue;
    diagnostics.push({
      severity: isError ? "error" : isWarning ? "warning" : "info",
      text,
      ...(dropped ? { droppedInput: true } : {}),
    });
  }
  return diagnostics;
}

/**
 * The diagnostic a non-zero exit deserves, or null when the exit says nothing.
 *
 * ngspice's exit status is not a verdict on the circuit. Version 39 exits
 * non-zero after a batch pass that has already run the author's `.control`
 * block and printed every value asked for, because that pass then finds no
 * `.plot`/`.print`/`.fourier` card and says so; version 46 exits 0 for the
 * identical deck. So the status varies with the build, not with the run.
 *
 * It is still worth reporting. A caller that ignored it entirely would hide
 * the one clue available when a run goes wrong in a way nothing printed.
 */
export function describeExitStatus(
  exitCode: number | null,
): SimulationDiagnostic | null {
  if (exitCode === null || exitCode === 0) return null;
  return {
    severity: "warning",
    text:
      `The simulator exited with code ${exitCode}. Some builds of ngspice do ` +
      `this after a run that produced everything asked of it, so check the ` +
      `results below before treating it as a problem.`,
  };
}

/**
 * The outcome, from the diagnostics rather than the exit status — except for
 * a timeout, which only the caller can know about.
 *
 * The exit status was once enough on its own to fail a run, which discarded
 * correct answers: on 2026-09-04 every simulation the hosted container ran
 * came back `failed` with an empty `diagnostics` array while the response
 * carried the right values, including a five-transistor OTA whose operating
 * point matched ngspice 46 with a full PDK to every digit (#568). Nothing had
 * gone wrong; ngspice 39 exits non-zero for its own reasons.
 *
 * This remains the small final reduction from diagnostics to a terminal
 * outcome. `evaluateSimulationRun` below owns the stronger evidence policy:
 * it first proves that the run produced what its deck requested, then calls
 * this function. Consumers must use that evaluator rather than treating this
 * reduction as a complete run policy.
 */
export function classifySimulationOutcome(
  diagnostics: readonly SimulationDiagnostic[],
  options: { timedOut: boolean; timeoutMs: number },
): SimulationOutcome {
  if (options.timedOut) {
    return { status: "timed-out", timeoutMs: options.timeoutMs };
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { status: "failed" };
  }
  if (diagnostics.some((diagnostic) => diagnostic.droppedInput)) {
    return { status: "completed-with-dropped-input" };
  }
  return { status: "completed" };
}

/** Facts observed after the simulator process stopped. No field is a verdict. */
export interface SimulationExecutionObservation {
  /** Human-readable combined output retained by the public result contract. */
  readonly log: string;
  /** Separate streams when the harness supplies them; optional during rollout. */
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly rawfile: string | null;
  readonly rawfileFormat: "ascii" | "binary" | null;
  readonly rawfileTruncated: boolean;
}

/** What the submitted deck promised to produce for this run. */
export interface SimulationRunExpectations {
  readonly rawfile: "required" | "not-required";
}

/** The policy-owned part of a SimulationResult, before metadata is attached. */
export interface EvaluatedSimulationRun {
  readonly outcome: SimulationOutcome;
  readonly diagnostics: readonly SimulationDiagnostic[];
  readonly data?: SimulationResultData;
}

/**
 * Evidence that ngspice at least accepted and entered a batch run.
 *
 * This is deliberately a fallback for decks that requested no rawfile. A
 * readable rawfile is stronger evidence and does not need a console banner.
 * Keep the test narrow: arbitrary non-empty stderr is not proof that a deck
 * ran, which is the exact hole recorded by #613.
 */
export function hasNgspiceExecutionEvidence(output: string): boolean {
  return (
    /^\s*circuit\s*:/imu.test(output) ||
    /^\s*doing analysis at\b/imu.test(output) ||
    /^\s*no\. of data rows\s*:/imu.test(output) ||
    /^\s*note:\s*simulation executed from \.control section\b/imu.test(output)
  );
}

/**
 * Turn one execution observation into the only product terminal verdict.
 *
 * Success is positive evidence, not the absence of a recognised error line:
 * a deck that requested vectors must return readable vectors; a deck that did
 * not must at least show that ngspice accepted the deck. The exit code remains
 * diagnostic because supported ngspice builds can exit non-zero after
 * producing every requested result.
 */
export function evaluateSimulationRun(
  expectations: SimulationRunExpectations,
  observation: SimulationExecutionObservation,
  options: { timeoutMs: number },
): EvaluatedSimulationRun {
  const diagnostics = readNgspiceDiagnostics(observation.log);

  if (
    !observation.timedOut &&
    observation.signal !== null &&
    observation.signal.length > 0
  ) {
    diagnostics.push({
      severity: "error",
      text: `The simulator was terminated by ${observation.signal} before it finished.`,
    });
  }

  let data: SimulationResultData | undefined;
  if (observation.rawfileTruncated) {
    diagnostics.push({
      severity: "error",
      text: "The simulator rawfile was truncated, so its numeric result is incomplete.",
    });
  } else if (observation.rawfileFormat === "binary") {
    diagnostics.push({
      severity: "error",
      text:
        "The simulator wrote a binary rawfile, which carries no numbers this " +
        "reader can use. Put `set filetype=ascii` before `write`.",
    });
  } else if (
    observation.rawfile !== null &&
    observation.rawfile.trim().length > 0
  ) {
    const reading = readSimulationData(observation.rawfile);
    diagnostics.push(...reading.diagnostics);
    if (reading.status === "read") data = reading.data;
  }

  if (!observation.timedOut && data === undefined) {
    if (expectations.rawfile === "required") {
      const alreadyExplained = diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      );
      if (!alreadyExplained) {
        diagnostics.push({
          severity: "error",
          text: "The deck requested a rawfile, but the simulator returned no readable vectors.",
        });
      }
    } else if (
      !hasNgspiceExecutionEvidence(
        observation.stdout === undefined && observation.stderr === undefined
          ? observation.log
          : `${observation.stdout ?? ""}${observation.stderr ?? ""}`,
      )
    ) {
      diagnostics.push({
        severity: "error",
        text:
          observation.log.trim().length === 0
            ? "The simulator produced no output, so this run has no result."
            : "The simulator output contains no evidence that ngspice accepted or ran the deck.",
      });
    }
  }

  const exitStatus = describeExitStatus(observation.exitCode);
  if (exitStatus) diagnostics.push(exitStatus);

  const outcome = classifySimulationOutcome(diagnostics, {
    timedOut: observation.timedOut,
    timeoutMs: options.timeoutMs,
  });
  return {
    outcome,
    diagnostics,
    ...(data === undefined ? {} : { data }),
  };
}
