/**
 * Compiling a structured `SimulationSetup` into the request a runner executes.
 *
 * `docs/specs/simulation.md` ("Inputs and root") settles what a structured run
 * is: the design netlist of everything the Testbench root reaches, one
 * instantiation of that root, the analyses, the saves, and `.end`. This module
 * is that compilation, and nothing else — it selects no model library, starts
 * no process, and reads no result. The environment owns its library paths and
 * the runner owns the deck's final bytes.
 *
 * Two things make it worth its own module rather than a caller's string
 * concatenation.
 *
 * **The probe-to-vector mapping is produced here or nowhere.** A rawfile comes
 * back naming `v(x1.mid)`, not a Net id. Recovering the Net from that text
 * afterwards means re-deriving hierarchy and net naming from a string the
 * simulator wrote, which is exactly the guess this product refuses elsewhere.
 * So every probe is bound to its ngspice vector name at compile time, and the
 * caller checks the names it asked for against the names it got.
 *
 * **The deck's shape is measured, not assumed.** Every naming rule below was
 * taken from decks ngspice 46 actually ran; the notes on each say which
 * behavior forced the choice.
 */

import { directObjectLocator, resolveDocumentLogicalNets } from "@icm/derived";
import type { HierarchyFrame, ObjectLocator } from "@icm/derived";
import type {
  CircuitProject,
  SchematicDocument,
  SimulationAnalysisSpec,
  SimulationProbeSpec,
  SimulationSetup,
  StableId,
} from "@icm/model";
import type { SimulationAnalysis, SimulationRequest } from "@icm/spice-run";

import { analyzeDesignNetlist } from "./extract.js";
import type {
  DesignNetlistCell,
  DesignNetlistInstance,
  NetlistDiagnostic,
} from "./ir.js";
import { printSpiceInstanceCards, printSpiceNetlist } from "./printers.js";

/** One probe bound to the vector name ngspice will write for it. */
export interface CompiledSimulationVector {
  readonly probeId: string;
  /** ngspice's own spelling, lowercase: `v(mid)`, `v(x1.mid)`, `i(v.x1.v2)`. */
  readonly vector: string;
  readonly quantity: "voltage" | "current";
}

export type CompiledSimulation =
  | {
      readonly ok: true;
      readonly request: SimulationRequest;
      readonly vectors: readonly CompiledSimulationVector[];
      /** A compiled setup carries no findings; a refused one carries them all. */
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: false;
      /** Never empty: a refusal always says what to go look at. */
      readonly diagnostics: readonly NetlistDiagnostic[];
    };

export interface CompileStructuredSimulationOptions {
  /** Wall-clock ceiling passed through to the runner, in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * The rawfile the deck writes.
 *
 * A relative name on purpose: the run directory is the simulator's working
 * directory, and an absolute path would put a host directory in the log an
 * author reads.
 */
const RAWFILE_NAME = "out.raw";

/** Compiler identity carried by `inputRevision`, so a change invalidates results. */
const COMPILER_REVISION_PREFIX = "structured-1";

function locator(
  documentId: StableId,
  kind: "document" | "instance" | "net",
  objectId: StableId,
  hierarchyPath: readonly HierarchyFrame[] = [],
): ObjectLocator {
  return hierarchyPath.length === 0
    ? directObjectLocator(documentId, kind, objectId)
    : { documentId, hierarchyPath: [...hierarchyPath], kind, objectId };
}

function diagnostic(
  code: string,
  documentId: StableId,
  message: string,
  objectIds: StableId[] = [],
  primary: ObjectLocator = directObjectLocator(
    documentId,
    "document",
    documentId,
  ),
): NetlistDiagnostic {
  return { code, severity: "error", documentId, objectIds, primary, message };
}

/**
 * A number as one SPICE token.
 *
 * `String(1e21)` is `"1e+21"`, and the `+` buys nothing while giving a dialect
 * one more thing to disagree about. Everything else is JavaScript's own
 * shortest round-tripping spelling, so the deck carries the author's value and
 * not a rounded copy of it.
 */
function spiceNumber(value: number): string {
  return String(value).replace("e+", "e");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The setup, in one spelling that does not depend on key insertion order.
 *
 * The deck bytes already cover the circuit and the analyses. The environment
 * selection is the part that changes the run without changing a single
 * character of the deck, which is exactly why it belongs in the identity.
 */
function canonicalSetup(setup: SimulationSetup): string {
  const input = setup.input;
  return JSON.stringify({
    version: setup.version,
    input: {
      kind: input.kind,
      rootDocumentId: input.rootDocumentId,
      analyses: input.analyses.map((analysis) =>
        analysis.kind === "op"
          ? { kind: analysis.kind }
          : {
              kind: analysis.kind,
              sweep: analysis.sweep,
              points: analysis.points,
              startHz: analysis.startHz,
              stopHz: analysis.stopHz,
            },
      ),
      probes: input.probes.map((probe) =>
        probe.kind === "net-voltage"
          ? {
              id: probe.id,
              kind: probe.kind,
              documentId: probe.documentId,
              netId: probe.netId,
              occurrence: [...probe.occurrence],
            }
          : {
              id: probe.id,
              kind: probe.kind,
              documentId: probe.documentId,
              instanceId: probe.instanceId,
              occurrence: [...probe.occurrence],
            },
      ),
      environment: {
        profileId: input.environment.profileId,
        corner: input.environment.corner ?? null,
        temperatureC: input.environment.temperatureC ?? null,
      },
    },
  });
}

/** The `.control` command that runs one analysis, in ngspice's own words. */
function analysisCommand(analysis: SimulationAnalysisSpec): string {
  return analysis.kind === "op"
    ? "op"
    : `ac ${analysis.sweep} ${String(analysis.points)} ${spiceNumber(
        analysis.startHz,
      )} ${spiceNumber(analysis.stopHz)}`;
}

function analysisTag(analysis: SimulationAnalysisSpec): SimulationAnalysis {
  return analysis.kind;
}

interface ResolvedOccurrence {
  /** Instance references from the root down, lowercase, as ngspice spells them. */
  readonly path: readonly string[];
  readonly documentId: StableId;
  readonly hierarchyPath: readonly HierarchyFrame[];
}

/**
 * Walk a probe's occurrence from the root and report where it lands.
 *
 * The occurrence is the list of hierarchy Instance ids from the root down.
 * Every step has to be an Instance in the Document the previous step reached,
 * and it has to be bound as a subcircuit: a path that merely names existing
 * ids is not a path through the hierarchy, and the node prefix it would build
 * would name a subcircuit call that is not in the deck.
 */
function resolveOccurrence(
  probe: SimulationProbeSpec,
  rootDocumentId: StableId,
  documentsById: ReadonlyMap<string, SchematicDocument>,
  diagnostics: NetlistDiagnostic[],
): ResolvedOccurrence | null {
  const path: string[] = [];
  const hierarchyPath: HierarchyFrame[] = [];
  let documentId = rootDocumentId;
  for (const instanceId of probe.occurrence) {
    const document = documentsById.get(documentId);
    const instance = document?.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    const binding = instance?.netlist?.binding;
    if (!document || !instance || binding?.kind !== "subcircuit") {
      diagnostics.push(
        diagnostic(
          "SIMULATION_PROBE_OCCURRENCE_INVALID",
          documentId,
          `Probe ${probe.id} names ${instanceId} in its occurrence, which is not a hierarchy Instance of Document ${documentId}`,
          [instanceId],
        ),
      );
      return null;
    }
    if (!instance.reference) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_PROBE_OCCURRENCE_INVALID",
          documentId,
          `Hierarchy Instance ${instanceId} has no Reference designator, so it names no subcircuit call in the deck`,
          [instanceId],
        ),
      );
      return null;
    }
    path.push(instance.reference.toLowerCase());
    hierarchyPath.push({
      parentDocumentId: documentId,
      instanceId,
      childDocumentId: binding.childDocumentId,
    });
    documentId = binding.childDocumentId;
  }
  if (documentId !== probe.documentId) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_OCCURRENCE_INVALID",
        documentId,
        `Probe ${probe.id} names Document ${probe.documentId}, but its occurrence reaches Document ${documentId}`,
        [],
        locator(documentId, "document", documentId, hierarchyPath),
      ),
    );
    return null;
  }
  return { path, documentId, hierarchyPath };
}

/**
 * The node name ngspice gives a Net inside an occurrence.
 *
 * Measured on ngspice 46: a Net inside subcircuit call `X1` is written
 * `v(x1.mid)`, and two levels down `v(x1.x2.mid)`. The rawfile spells every
 * variable in lower case whatever the deck said, so the name emitted here is
 * lowercased to be the name that comes back.
 */
function netVoltageVector(
  occurrencePath: readonly string[],
  netName: string,
): string {
  return `v(${[...occurrencePath, netName].join(".").toLowerCase()})`;
}

/**
 * The branch-current name ngspice gives a source inside an occurrence.
 *
 * Measured on ngspice 46: a top-level source is `i(v1)`, but a source inside a
 * subcircuit call is NOT `i(x1.v2)` — that spelling is refused outright, and
 * one refused vector aborts the whole `write`. ngspice expands a device inside
 * a call to `<type letter>.<call path>.<device>`, so the branch is
 * `v.x1.v2#branch` and its function form is `i(v.x1.v2)`. Writing either
 * spelling puts `i(v.x1.v2)` in the rawfile.
 */
function sourceCurrentVector(
  occurrencePath: readonly string[],
  reference: string,
): string {
  const typeLetter = reference.slice(0, 1);
  const device =
    occurrencePath.length === 0
      ? reference
      : [typeLetter, ...occurrencePath, reference].join(".");
  return `i(${device.toLowerCase()})`;
}

function cellNetName(
  cell: DesignNetlistCell,
  document: SchematicDocument,
  netId: StableId,
): string | undefined {
  const logicalNet =
    resolveDocumentLogicalNets(document).byBaseNetId.get(netId);
  if (!logicalNet) return undefined;
  return cell.nets.find((net) => net.id === logicalNet.id)?.name;
}

function compileProbe(
  probe: SimulationProbeSpec,
  rootDocumentId: StableId,
  documentsById: ReadonlyMap<string, SchematicDocument>,
  cellsById: ReadonlyMap<string, DesignNetlistCell>,
  diagnostics: NetlistDiagnostic[],
): CompiledSimulationVector | null {
  if (!documentsById.has(probe.documentId)) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNKNOWN_DOCUMENT",
        rootDocumentId,
        `Probe ${probe.id} references unknown Document ${probe.documentId}`,
      ),
    );
    return null;
  }
  const occurrence = resolveOccurrence(
    probe,
    rootDocumentId,
    documentsById,
    diagnostics,
  );
  if (!occurrence) return null;
  const document = documentsById.get(occurrence.documentId)!;
  const cell = cellsById.get(occurrence.documentId);
  if (!cell) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNREACHED_DOCUMENT",
        occurrence.documentId,
        `Probe ${probe.id} reads Document ${occurrence.documentId}, which the simulation root does not reach`,
      ),
    );
    return null;
  }

  if (probe.kind === "net-voltage") {
    const netExists = document.nets.some((net) => net.id === probe.netId);
    if (!netExists) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_PROBE_UNKNOWN_NET",
          occurrence.documentId,
          `Probe ${probe.id} references unknown Net ${probe.netId} in Document ${occurrence.documentId}`,
          [probe.netId],
        ),
      );
      return null;
    }
    const netName = cellNetName(cell, document, probe.netId);
    if (!netName) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_PROBE_NET_NOT_EXPORTED",
          occurrence.documentId,
          `Probe ${probe.id} reads Net ${probe.netId}, which the netlist does not print as a node`,
          [probe.netId],
          locator(
            occurrence.documentId,
            "net",
            probe.netId,
            occurrence.hierarchyPath,
          ),
        ),
      );
      return null;
    }
    return {
      probeId: probe.id,
      vector: netVoltageVector(occurrence.path, netName),
      quantity: "voltage",
    };
  }

  const instance = document.instances.find(
    (candidate) => candidate.id === probe.instanceId,
  );
  if (!instance) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNKNOWN_INSTANCE",
        occurrence.documentId,
        `Probe ${probe.id} references unknown Instance ${probe.instanceId} in Document ${occurrence.documentId}`,
        [probe.instanceId],
      ),
    );
    return null;
  }
  const probeLocator = locator(
    occurrence.documentId,
    "instance",
    probe.instanceId,
    occurrence.hierarchyPath,
  );
  const printed: DesignNetlistInstance | undefined = cell.instances.find(
    (candidate) => candidate.id === probe.instanceId,
  );
  if (printed?.deviceClass === "current-source") {
    // ngspice 46 keeps no branch vector for an independent current source: its
    // current is an input, not a solved unknown, and `i(i1)` is refused. One
    // refused vector aborts the whole `write`, so this has to be caught here
    // rather than discovered as an empty rawfile.
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_SOURCE_HAS_NO_BRANCH_CURRENT",
        occurrence.documentId,
        `Probe ${probe.id} reads the current of current source ${instance.reference ?? probe.instanceId}, which ngspice solves for no branch current; probe a series voltage source instead`,
        [probe.instanceId],
        probeLocator,
      ),
    );
    return null;
  }
  if (printed?.deviceClass !== "voltage-source" || !printed.reference) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_NOT_A_SOURCE",
        occurrence.documentId,
        `Probe ${probe.id} reads the current of Instance ${instance.reference ?? probe.instanceId}, which is not a voltage source`,
        [probe.instanceId],
        probeLocator,
      ),
    );
    return null;
  }
  return {
    probeId: probe.id,
    vector: sourceCurrentVector(occurrence.path, printed.reference),
    quantity: "current",
  };
}

/**
 * The testbench: the root Cell as top-level cards, then one `.control` block.
 *
 * Three measured facts shape the block, all from ngspice 46.
 *
 * A deck carrying `.op`/`.ac` cards *and* a `.control` block runs the deck's
 * own analyses again after the block and reports
 * `Error: no data saved for A.C. Small signal analysis`, which the runner
 * classifies as a failed run. So the analyses are `.control` commands and
 * there are no analysis cards, which is also the convention the hosted smoke
 * has been running.
 *
 * `write` truncates by default, so a second analysis would silently replace
 * the first one's plot. `set appendwrite` makes the file hold every plot back
 * to back, which is the shape the rawfile reader already reads.
 *
 * `set filetype=ascii` is set by the hosted container's `.spiceinit` too, but
 * a deck that only works inside that container is not a deck this module can
 * test against a local simulator.
 */
function testbenchText(
  rootCell: DesignNetlistCell,
  cards: readonly string[],
  analyses: readonly SimulationAnalysisSpec[],
  vectors: readonly string[],
): string {
  const save = [`write ${RAWFILE_NAME}`, ...vectors].join(" ");
  const lines = [
    `* Analog Canvas testbench ${rootCell.name}`,
    ...cards,
    ".control",
    "set filetype=ascii",
    "set appendwrite",
  ];
  for (const analysis of analyses) {
    lines.push(analysisCommand(analysis), save);
  }
  lines.push(".endc", ".end");
  return `${lines.join("\n")}\n`;
}

/**
 * Compile a structured setup into one runner request and its probe bindings.
 *
 * Pure and deterministic: the same Project and setup produce byte-identical
 * text, in the printer's own ordering. Nothing is thrown — a setup that cannot
 * be compiled comes back as diagnostics naming the objects to go look at.
 */
export async function compileStructuredSimulation(
  project: CircuitProject,
  setup: SimulationSetup,
  options: CompileStructuredSimulationOptions = {},
): Promise<CompiledSimulation> {
  const input = setup.input;
  const rootDocumentId = input.rootDocumentId;
  const diagnostics: NetlistDiagnostic[] = [];

  const seenKinds = new Set<string>();
  for (const analysis of input.analyses) {
    if (seenKinds.has(analysis.kind)) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_DUPLICATE_ANALYSIS",
          rootDocumentId,
          `Simulation setup requests the ${analysis.kind} analysis more than once`,
        ),
      );
    }
    seenKinds.add(analysis.kind);
  }
  if (input.analyses.length === 0) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_NO_ANALYSIS",
        rootDocumentId,
        "Simulation setup requests no analysis, so there is nothing to run",
      ),
    );
  }
  if (input.probes.length === 0) {
    // A run records what it was asked to record. `write` with no vectors saves
    // the whole plot under names nothing here can bind back to a Net, which
    // reaches the author as numbers with no circuit attached.
    diagnostics.push(
      diagnostic(
        "SIMULATION_NO_PROBE",
        rootDocumentId,
        "Simulation setup names no probe, so the run would record no vector to read back",
      ),
    );
  }

  const analysis = analyzeDesignNetlist(project, { rootDocumentId });
  const ir = analysis.ir;
  if (!ir) {
    return {
      ok: false,
      diagnostics: [
        ...analysis.diagnostics.filter((item) => item.severity === "error"),
        ...diagnostics,
      ],
    };
  }

  const documentsById = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const cellsById = new Map(ir.cells.map((cell) => [cell.id, cell]));
  const rootCell = cellsById.get(rootDocumentId);
  if (!rootCell) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        diagnostic(
          "SIMULATION_ROOT_NOT_EXPORTED",
          rootDocumentId,
          `Simulation root Document ${rootDocumentId} produced no Cell to instantiate`,
        ),
      ],
    };
  }

  const cards = printSpiceInstanceCards(rootCell);
  if (cards.length === 0) {
    // ADR 0055 and the spec both say it: a deck that only defines `.subckt`s
    // and instantiates nothing is not a run.
    diagnostics.push(
      diagnostic(
        "SIMULATION_ROOT_HAS_NO_INSTANCES",
        rootDocumentId,
        `Simulation root Cell ${rootCell.name} instantiates nothing, so the deck defines subcircuits and simulates none of them`,
      ),
    );
  }

  const vectors: CompiledSimulationVector[] = [];
  for (const probe of input.probes) {
    const compiled = compileProbe(
      probe,
      rootDocumentId,
      documentsById,
      cellsById,
      diagnostics,
    );
    if (compiled) vectors.push(compiled);
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const netlist = printSpiceNetlist({
    ...ir,
    cells: ir.cells.filter((cell) => cell.id !== rootDocumentId),
  });
  // Two probes may share one node — a Net probed twice, or two Base Nets of one
  // Logical Net. The deck saves each vector once; the bindings keep both.
  const savedVectors = [...new Set(vectors.map((vector) => vector.vector))];
  const testbench = testbenchText(
    rootCell,
    cards,
    input.analyses,
    savedVectors,
  );
  // NUL between the three parts, not a newline or a space: a separator that
  // can occur inside a part lets one part's tail read as the next part's
  // head, and two different inputs then hash to the same revision.
  const inputRevision = `${COMPILER_REVISION_PREFIX}-${await sha256Hex(
    `${netlist}\u0000${testbench}\u0000${canonicalSetup(setup)}`,
  )}`;

  return {
    ok: true,
    request: {
      netlist,
      testbench,
      analyses: input.analyses.map(analysisTag),
      inputRevision,
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    },
    vectors,
    diagnostics: [],
  };
}
