/**
 * What a simulation request is, and what comes back.
 *
 * ADR 0055 fixes two things this module obeys literally. The testbench is the
 * author's: nothing here writes a `.control` block, an analysis statement, a
 * stimulus, or a load, and nothing infers one. And a refusal is a diagnosis:
 * ngspice's own words reach the author, because "simulation failed" tells a
 * designer nothing they can act on.
 */

export * from "./rawfile.js";
export * from "./result-schema.js";
export * from "./result-data.js";
export * from "./environment-profile.js";

import {
  readSimulationData,
  type SimulationResultData,
} from "./result-data.js";

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

/**
 * The ceiling a request gets when it names none. Loading the Sky130 `tt`
 * corner alone costs about 16 s of CPU on a fast core (measured 2026-09-04
 * with ngspice 46 on a resistor divider), so a circuit that needs models
 * cannot fit a 30 s ceiling on a shared container core.
 */
export const DEFAULT_SIMULATION_TIMEOUT_MS = 60_000;
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
 * Whether a deck needs the environment's device-model library at all.
 *
 * Loading the Sky130 corner is the single most expensive thing a run does:
 * about 16 s of CPU for the `tt` section alone, before any analysis. A
 * resistor divider or an RC network has no model card to look up, so it
 * pays that cost for nothing. The library is added when the deck contains a
 * semiconductor device card (MOSFET, diode, BJT, JFET) or names a Sky130
 * model anywhere; passives, sources, and dependent sources run without it.
 * Comments and continuation lines are skipped so a remark cannot trigger it.
 */
export function deckNeedsModelLibrary(text: string): boolean {
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("*") || line.startsWith("+")) {
      continue;
    }
    if (/sky130_/iu.test(line)) return true;
    if (/^[mdqj][a-z0-9_$.:-]*\s/iu.test(line)) return true;
  }
  return false;
}

/**
 * Whether a prepared deck promises a numeric rawfile.
 *
 * This is an execution expectation, not an attempt to understand SPICE. The
 * harness makes the same observation before collecting output; the Worker
 * uses this copy to decide what result the submitted deck promised. Keeping
 * the expectation beside the result evaluator prevents each consumer from
 * inventing its own meaning for an absent file.
 */
export function deckRequestsRawfile(deck: string): boolean {
  for (const raw of deck.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("*")) continue;
    if (/^\.save\b/iu.test(line)) return true;
    if (/(^|\s|;)write(\s|$)/iu.test(line)) return true;
  }
  return false;
}

/**
 * The deck handed to ngspice: the circuit, then the author's testbench, in
 * that order and with nothing added between them.
 *
 * The model library line is the one thing we contribute, because the author
 * cannot know the container's paths. Everything after it is theirs verbatim.
 */
/**
 * The one Sky130 library this product simulates against, at the path the
 * pinned container image puts it.
 *
 * There is deliberately no search. A machine with a volare or ciel checkout
 * has the BINNED model set, which is a different library: its widest
 * `nfet_01v8` bin stops at 100 um, so the benchmark suite's own reference
 * devices do not resolve at all, and the circuits that do resolve answer
 * differently -- on the five-transistor OTA the unity-gain bandwidth moves
 * 11% (#551). Falling back to whatever a machine happens to have would mean
 * two runs of the same circuit disagreeing with no way to tell which library
 * answered, which is worse than not running.
 *
 * `SKY130_LIB_PATH` overrides it for a host that mounts the same library
 * somewhere else. It is not a way to select a different one.
 */
export const SKY130_LIBRARY_PATH = "/opt/sky130/continuous/sky130.lib.spice";

/** The corner every surface defaults to. */
export const SKY130_LIBRARY_SECTION = "tt";

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

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createSimulationInputMetadata(input: {
  inputRevision?: string;
  netlist: string;
  testbench: string;
  deck: string;
}): Promise<SimulationInputMetadata> {
  const [netlistSha256, testbenchSha256, deckSha256] = await Promise.all([
    sha256Hex(input.netlist),
    sha256Hex(input.testbench),
    sha256Hex(input.deck),
  ]);
  return {
    inputRevision: input.inputRevision ?? null,
    netlistSha256,
    testbenchSha256,
    deckSha256,
  };
}

function canonicalEnvironmentFacts(facts: SimulationEnvironmentFacts): string {
  return JSON.stringify({
    executor: facts.executor,
    reproducibility: facts.reproducibility,
    profileId: facts.profileId,
    platform: facts.platform,
    simulator: {
      name: facts.simulator.name,
      version: facts.simulator.version,
      binarySha256: facts.simulator.binarySha256,
    },
    models: facts.models
      ? { id: facts.models.id, contentSha256: facts.models.contentSha256 }
      : null,
    startupSha256: facts.startupSha256,
  });
}

export async function createSimulationEnvironmentMetadata(
  facts: SimulationEnvironmentFacts,
): Promise<SimulationEnvironmentMetadata> {
  return {
    ...facts,
    fingerprint: await sha256Hex(canonicalEnvironmentFacts(facts)),
  };
}

export function simulationConfigurationMetadata(
  modelLibrary: ModelLibrarySelection | null,
): SimulationConfigurationMetadata {
  return {
    modelLibrary:
      modelLibrary === null
        ? null
        : modelLibrary.directive === "include"
          ? { directive: "include", section: null }
          : { directive: "lib", section: modelLibrary.section },
  };
}

export function isSimulationEnvironmentMetadata(
  value: unknown,
): value is SimulationEnvironmentMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SimulationEnvironmentMetadata>;
  const simulator = candidate.simulator;
  const models = candidate.models;
  return (
    (candidate.executor === "hosted-container" ||
      candidate.executor === "local-host") &&
    (candidate.reproducibility === "observed" ||
      candidate.reproducibility === "pinned") &&
    (candidate.profileId === null ||
      (typeof candidate.profileId === "string" &&
        candidate.profileId.length > 0)) &&
    typeof candidate.platform === "string" &&
    candidate.platform.length > 0 &&
    typeof candidate.fingerprint === "string" &&
    SHA256_PATTERN.test(candidate.fingerprint) &&
    !!simulator &&
    simulator.name === "ngspice" &&
    typeof simulator.version === "string" &&
    simulator.version.length > 0 &&
    (simulator.binarySha256 === null ||
      (typeof simulator.binarySha256 === "string" &&
        SHA256_PATTERN.test(simulator.binarySha256))) &&
    (models === null ||
      (!!models &&
        typeof models.id === "string" &&
        models.id.length > 0 &&
        typeof models.contentSha256 === "string" &&
        SHA256_PATTERN.test(models.contentSha256))) &&
    (candidate.startupSha256 === null ||
      (typeof candidate.startupSha256 === "string" &&
        SHA256_PATTERN.test(candidate.startupSha256))) &&
    (candidate.reproducibility !== "pinned" ||
      (candidate.profileId !== null && candidate.startupSha256 !== null))
  );
}

export async function verifySimulationEnvironmentMetadata(
  value: unknown,
): Promise<SimulationEnvironmentMetadata | null> {
  if (!isSimulationEnvironmentMetadata(value)) return null;
  const { fingerprint, ...facts } = value;
  const expected = await createSimulationEnvironmentMetadata(facts);
  return fingerprint === expected.fingerprint ? value : null;
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
