import type { SimulationResultData } from "./result-data.js";
export type SimulationAnalysis = "op" | "dc" | "ac" | "tran";

export interface SimulationRequest {
  /** Circuit netlist from @icm/netlist. Subcircuits and device cards only. */
  netlist: string;
  /** The author's testbench: stimulus, loads, analysis, prints. Theirs. */
  testbench: string;
  /** Which analyses the caller expects from the prepared deck. */
  analyses: readonly SimulationAnalysis[];
  /** Wall-clock ceiling for the ngspice process, in milliseconds. */
  timeoutMs?: number;
  /** Opaque caller revision, echoed so stale results can be rejected. */
  inputRevision?: string;
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

export interface SimulationInputMetadata {
  /** Opaque and revision-scoped; null when the caller supplied no revision. */
  inputRevision: string | null;
  netlistSha256: string;
  testbenchSha256: string;
  /** Hash of the exact bytes handed to ngspice. */
  deckSha256: string;
}

export interface SimulationConfigurationMetadata {
  /** The path is deliberately omitted: the deck hash already covers it. */
  modelLibrary:
    | { directive: "include"; section: null }
    | { directive: "lib"; section: string }
    | null;
}

export interface SimulationEnvironmentFacts {
  executor: "hosted-container" | "local-host";
  /** `pinned` is reserved for a build verified against an environment lock. */
  reproducibility: "observed" | "pinned";
  /** Named runtime contract, or null for an unqualified local environment. */
  profileId: string | null;
  platform: string;
  simulator: {
    name: "ngspice";
    version: string;
    binarySha256: string | null;
  };
  models: {
    id: string;
    contentSha256: string;
  } | null;
  /** Exact startup-policy bytes used for this run, when managed by a Profile. */
  startupSha256: string | null;
}

export interface SimulationEnvironmentMetadata extends SimulationEnvironmentFacts {
  /** SHA-256 of the canonical environment facts above. */
  fingerprint: string;
}

export interface SimulationRunMetadata {
  schemaVersion: 1;
  input: SimulationInputMetadata;
  configuration: SimulationConfigurationMetadata;
  environment: SimulationEnvironmentMetadata;
}

export function isSimulationInputRevision(
  value: unknown,
): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === "string" && value.length > 0 && value.length <= 256)
  );
}

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
  /** Identity of the input and environment that produced this result. */
  metadata: SimulationRunMetadata;
  /**
   * The numbers, when the runner read the simulator's rawfile. Absent when it
   * produced none to read — a testbench that never called `write`, or a
   * failure before any analysis ran.
   *
   * Present is not the same as non-empty: `analyses` is never an empty list,
   * because a run that produced no vectors is an unusable result carrying a
   * diagnostic, not a success carrying nothing. See `readSimulationData`.
   */
  data?: SimulationResultData;
}
