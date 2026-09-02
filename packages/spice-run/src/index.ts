/**
 * What a simulation request is, and what comes back.
 *
 * ADR 0055 fixes two things this module obeys literally. The testbench is the
 * author's: nothing here writes a `.control` block, an analysis statement, a
 * stimulus, or a load, and nothing infers one. And a refusal is a diagnosis:
 * ngspice's own words reach the author, because "simulation failed" tells a
 * designer nothing they can act on.
 */

export type SimulationAnalysis = "op" | "ac";

export interface SimulationRequest {
  /** Circuit netlist from @icm/netlist. Subcircuits and device cards only. */
  netlist: string;
  /** The author's testbench: stimulus, loads, analysis, prints. Theirs. */
  testbench: string;
  /** Which analyses the caller expects; the first release covers two. */
  analyses: readonly SimulationAnalysis[];
  /** Wall-clock ceiling for the ngspice process, in milliseconds. */
  timeoutMs?: number;
}

/**
 * How one simulator-readable model library enters the final deck.
 *
 * A plain model file is included in full. A sectioned corner library must be
 * selected with `.lib` and an explicit section; a path alone cannot express
 * that distinction and must never be guessed from the filename.
 */
export type ModelLibrarySelection =
  | {
      readonly directive: "include";
      readonly path: string;
    }
  | {
      readonly directive: "lib";
      readonly path: string;
      readonly section: string;
    };

/**
 * One line ngspice said about the run. `severity` is our reading of it; `text`
 * is always ngspice's own, unedited, because a designer reads the original and
 * a paraphrase would lose the node names and line numbers that make it useful.
 */
export interface SimulationDiagnostic {
  severity: "error" | "warning" | "info";
  text: string;
  /**
   * True when the line reports that ngspice DROPPED something — a device it
   * could not parse, a model it could not find. These matter more than their
   * severity suggests: the run continues and reports numbers for a circuit
   * that is no longer the one submitted.
   */
  droppedInput?: boolean;
}

export type SimulationOutcome =
  /** ngspice ran and understood the whole deck. */
  | { status: "completed" }
  /**
   * ngspice ran to completion but discarded part of the deck, so the numbers
   * describe a different circuit than the one submitted. Never reported as a
   * plain success.
   */
  | { status: "completed-with-dropped-input" }
  /** ngspice refused the deck or stopped partway. */
  | { status: "failed" }
  /** We stopped ngspice at the ceiling. Says so in as many words. */
  | { status: "timed-out"; timeoutMs: number };

export interface SimulationResult {
  outcome: SimulationOutcome;
  diagnostics: readonly SimulationDiagnostic[];
  /** ngspice's complete output, for an author who wants to read it whole. */
  log: string;
  /** Milliseconds the simulator process was alive. */
  durationMs: number;
}

/** The ceiling a request gets when it names none. */
export const DEFAULT_SIMULATION_TIMEOUT_MS = 30_000;
/**
 * The ceiling a request cannot exceed. A container bills for the time it is
 * awake, not the time it computes, so an unbounded analysis is an unbounded
 * bill as well as a user waiting on nothing.
 */
export const MAX_SIMULATION_TIMEOUT_MS = 120_000;

export function resolveTimeoutMs(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_SIMULATION_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.trunc(requested), 1),
    MAX_SIMULATION_TIMEOUT_MS,
  );
}

/**
 * The deck handed to ngspice: the circuit, then the author's testbench, in
 * that order and with nothing added between them.
 *
 * The model library line is the one thing we contribute, because the author
 * cannot know the container's paths. Everything after it is theirs verbatim.
 */
export function buildSimulationDeck(
  request: Pick<SimulationRequest, "netlist" | "testbench">,
  modelLibrary: ModelLibrarySelection | null,
): string {
  const lines = ["* Analog Canvas simulation deck"];
  if (modelLibrary) {
    lines.push(formatModelLibrarySelection(modelLibrary));
  }
  lines.push(request.netlist.trimEnd(), request.testbench.trimEnd());
  // `.end` closes the deck. An author who wrote their own is not given a
  // second one, since a duplicate ends the deck early and silently.
  if (!/^\s*\.end\s*$/imu.test(request.testbench)) lines.push(".end");
  return lines.join("\n") + "\n";
}

function formatModelLibrarySelection(selection: ModelLibrarySelection): string {
  const path = selection.path.trim();
  if (path.length === 0 || /[\r\n"]/u.test(path)) {
    throw new Error(
      "A simulation model-library path must be non-empty and contain no quotes or line breaks.",
    );
  }
  const quotedPath = `"${path}"`;
  if (selection.directive === "include") {
    return `.include ${quotedPath}`;
  }

  const section = selection.section.trim();
  if (!/^[a-z0-9_.+-]+$/iu.test(section)) {
    throw new Error(
      "A simulation model-library section must be one non-empty SPICE token.",
    );
  }
  return `.lib ${quotedPath} ${section}`;
}

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
 * The outcome, from the diagnostics rather than the exit status — except for
 * a timeout, which only the caller can know about.
 */
export function classifySimulationOutcome(
  diagnostics: readonly SimulationDiagnostic[],
  options: { timedOut: boolean; timeoutMs: number; exitCode: number | null },
): SimulationOutcome {
  if (options.timedOut) {
    return { status: "timed-out", timeoutMs: options.timeoutMs };
  }
  if (
    diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    (options.exitCode !== null && options.exitCode !== 0)
  ) {
    return { status: "failed" };
  }
  if (diagnostics.some((diagnostic) => diagnostic.droppedInput)) {
    return { status: "completed-with-dropped-input" };
  }
  return { status: "completed" };
}
