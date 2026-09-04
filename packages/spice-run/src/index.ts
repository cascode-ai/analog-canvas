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
 * One line about the run. `severity` is our reading of it; `text` is ngspice's
 * own and unedited whenever ngspice said it, because a designer reads the
 * original and a paraphrase would lose the node names and line numbers that
 * make it useful. The harness writes a line itself only to state something
 * ngspice did not: that the process was killed, or that it returned no
 * results at all.
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
  /**
   * ngspice refused the deck, stopped partway, or returned no results. Always
   * accompanied by at least one diagnostic saying which; see readNgspiceRun.
   */
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
    platform: facts.platform,
    simulator: {
      name: facts.simulator.name,
      version: facts.simulator.version,
      binarySha256: facts.simulator.binarySha256,
    },
    models: facts.models
      ? { id: facts.models.id, contentSha256: facts.models.contentSha256 }
      : null,
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
        SHA256_PATTERN.test(models.contentSha256)))
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
 * `name = number`, which is how ngspice reports a scalar the author asked
 * for — `print v(out)` and `meas ac gain_db ...` both land here. The name
 * must be a single token ending at the `=`, which is what separates a
 * requested value from ngspice's own prose: "Doing analysis at TEMP =
 * 27.000000" and "Total DRAM available = 16384.000 MB." have a word boundary
 * before the `=` and never match.
 */
const PRINTED_VALUE_PATTERN = /^\s*([A-Za-z_][^\s=]*)\s*=\s*[+-]?(?:\d|\.\d)/u;

/** ngspice's own count of what an analysis produced, one line per plot. */
const DATA_ROWS_PATTERN = /^\s*no\.\s*of\s*data\s*rows\s*:\s*(\d+)/iu;

/**
 * What a run produced, in ngspice's own report of it.
 *
 * This is evidence that vectors exist, never the numbers themselves: the
 * simulation spec reads results from the ASCII rawfile and never from console
 * text, so only names and counts are collected here.
 */
export interface SimulationRunEvidence {
  /** Names ngspice printed a value for. The value itself is not read. */
  readonly printedValueNames: readonly string[];
  /** Row counts ngspice reported, one entry per analysis that produced data. */
  readonly analysisDataRows: readonly number[];
  /** True when ngspice said at least one analysis produced something. */
  readonly producedResults: boolean;
}

export function readNgspiceRunEvidence(output: string): SimulationRunEvidence {
  const printedValueNames: string[] = [];
  const analysisDataRows: number[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const rows = DATA_ROWS_PATTERN.exec(line);
    if (rows) {
      const count = Number(rows[1]);
      if (count > 0) analysisDataRows.push(count);
      continue;
    }
    const printed = PRINTED_VALUE_PATTERN.exec(line);
    if (printed) printedValueNames.push(printed[1]!);
  }
  return {
    printedValueNames,
    analysisDataRows,
    producedResults:
      printedValueNames.length > 0 || analysisDataRows.length > 0,
  };
}

/**
 * The outcome, from what ngspice said and what it produced.
 *
 * The exit status is not an argument here, and that is the point. ngspice 39
 * ends a batch run over an author's `.control` block by printing
 * `Note: No ".plot", ".print", or ".fourier" lines; no simulations run` and
 * exiting non-zero — after the control block has already run every analysis
 * and printed every value asked for. Failing on that status reported a
 * correct simulation as failed (issue #568), and reading the absence of that
 * note as success would only move the guess to the next simulator's wording.
 * A run succeeded when the measurements came back; the status merely helps
 * explain a run where they did not.
 */
function classifySimulationOutcome(
  diagnostics: readonly SimulationDiagnostic[],
  options: {
    timedOut: boolean;
    timeoutMs: number;
    producedResults: boolean;
  },
): SimulationOutcome {
  if (options.timedOut) {
    return { status: "timed-out", timeoutMs: options.timeoutMs };
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { status: "failed" };
  }
  if (!options.producedResults) {
    return { status: "failed" };
  }
  if (diagnostics.some((diagnostic) => diagnostic.droppedInput)) {
    return { status: "completed-with-dropped-input" };
  }
  return { status: "completed" };
}

/** How the simulator process ended, as the surface running it observed it. */
export interface NgspiceProcessResult {
  /** Everything ngspice wrote, both streams, in the order captured. */
  log: string;
  /** The process exit status, or null when we stopped it ourselves. */
  exitCode: number | null;
  /** The signal that killed it, when one did. */
  signal?: string | null;
  timedOut: boolean;
  timeoutMs: number;
}

/** An outcome and the diagnostics that account for it, read together. */
export interface NgspiceRunReading {
  outcome: SimulationOutcome;
  diagnostics: SimulationDiagnostic[];
}

/**
 * Read one finished ngspice process into an outcome and its diagnostics.
 *
 * Both surfaces go through here so a container run and a local run classify
 * identically, and so one rule holds in one place: **a failed run always
 * carries at least one diagnostic.** `status: "failed"` beside an empty
 * `diagnostics` array leaves the author nothing to act on and the next
 * debugger nothing to pull, which is how issue #568 stayed invisible; when
 * the harness cannot say why a run failed, saying that is the finding.
 */
export function readNgspiceRun(run: NgspiceProcessResult): NgspiceRunReading {
  const diagnostics = readNgspiceDiagnostics(run.log);
  const signal = run.signal ?? null;
  const evidence = readNgspiceRunEvidence(run.log);

  // A signal death is a failure even when values were already printed: the
  // run was cut off, so whatever came back is a fragment of the answer.
  // Measured 2026-09-04, the kernel killing ngspice mid-corner-load on a
  // 1 GiB instance (ADR 0055 amendment, item 10).
  if (!run.timedOut && signal) {
    diagnostics.push({
      severity: "error",
      text: `The simulator was terminated by ${signal} before it finished.`,
    });
  } else if (!run.timedOut && !evidence.producedResults) {
    diagnostics.push({
      severity: "error",
      text:
        run.log.trim().length === 0
          ? "The simulator produced no output, so this run has no result."
          : `The simulator reported no analysis results${
              run.exitCode ? ` and exited with status ${run.exitCode}` : ""
            }, so this run produced no numbers to return.`,
    });
  }

  const outcome = classifySimulationOutcome(diagnostics, {
    timedOut: run.timedOut,
    timeoutMs: run.timeoutMs,
    producedResults: evidence.producedResults,
  });

  // The invariant, enforced rather than assumed. Nothing above should reach
  // this, and if a later change does, the gap reports itself instead of
  // reaching an author as a bare "failed".
  if (outcome.status === "failed" && diagnostics.length === 0) {
    diagnostics.push({
      severity: "error",
      text: `The simulator run was classified as failed, but nothing in its output says why (exit status ${
        run.exitCode === null ? "unreported" : run.exitCode
      }). Please report this run.`,
    });
  }

  return { outcome, diagnostics };
}
