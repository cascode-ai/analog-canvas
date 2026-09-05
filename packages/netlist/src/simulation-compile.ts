/**
 * Compiling a structured `SimulationSetup` into one simulation request.
 *
 * A setup names a Testbench root, the analyses to run, and the probes to
 * record (`docs/specs/simulation.md`, "Inputs and root"). This turns that into
 * the two texts `/api/simulate` already consumes -- the design netlist of
 * everything the root reaches, and the root itself as a top-level deck -- plus
 * the one thing a rawfile reader cannot recover on its own: which ngspice
 * vector name each probe's number will arrive under.
 *
 * That mapping is produced here and nowhere else. The spec is explicit that a
 * probe binding is "produced at compile time and never inferred from result
 * text", because a name matched back out of a rawfile is a guess, and a guess
 * about which node a number belongs to is the most expensive kind of wrong
 * answer this product can give.
 *
 * ## The deck this writes
 *
 * The shapes below were taken from ngspice 46 runs, not from the manual.
 *
 * **Analyses are control-block commands, not deck cards.** A deck carrying
 * both `.op` and `.ac` and a single `run` fails: ngspice 46 answers
 * `doAnalyses: not found` / `run simulation(s) aborted`, exits 1, and leaves
 * only one plot behind. Issuing `op` and `ac ...` as commands inside
 * `.control` runs both and exits 0. This is also the convention the hosted
 * smoke deck already uses (`scripts/preview-simulation-smoke.mjs`).
 *
 * **Each analysis writes, and `set appendwrite` keeps the earlier plot.**
 * `write` saves the current plot only, and truncates the file it writes. Two
 * plain `write` calls therefore leave the second plot alone in the file. With
 * `set appendwrite` the rawfile holds both plots back to back, which is
 * exactly what the rawfile reader already parses. Naming the plot in the
 * vector expression instead (`op1.mid`) does keep both plots in one `write`,
 * but ngspice then records the variable as `v(op1.mid)`, so every probe name
 * would carry a plot ordinal that depends on how many analyses ran. It does
 * not, here: the names stay `v(mid)`.
 *
 * `appendwrite` needs a working directory where `out.raw` does not already
 * exist, which the hosted harness guarantees -- it makes a private directory
 * immediately before each run and removes it whole afterwards. It is emitted
 * only when there is more than one analysis, so a single-analysis deck keeps
 * `write`'s truncating behaviour and cannot append to a stale file at all.
 *
 * ## The vector names this promises
 *
 * All confirmed against ngspice 46 rawfiles:
 *
 * - a Net in the root prints `v(<net>)`, lowercased -- ngspice folds case on
 *   the way into the rawfile, so `V(MidNode)` comes back as `v(midnode)`;
 * - a Net inside a hierarchy occurrence prints `v(<x1>.<x2>.<net>)`, one
 *   lowercased Instance reference per occurrence step;
 * - a voltage source in the root prints `i(<ref>)`, e.g. `i(v1)`;
 * - a voltage source inside an occurrence prints `i(v.<x1>.<x2>.<ref>)`: the
 *   expansion prefixes the device's own type letter before the path, so
 *   `Vsi` under `X1`/`XI1` is `i(v.x1.xi1.vsi)`.
 *
 * An independent current source has no branch-current vector at all -- ngspice
 * builds one for `V` sources and not for `I` sources, and `i(i1)` answers
 * "not available". A `source-current` probe on one is refused here rather than
 * compiled into a name that cannot come back.
 */

import type {
  CircuitProject,
  SchematicDocument,
  SimulationAnalysisSpec,
  SimulationProbeSpec,
  SimulationSetup,
  SimulationStructuredInput,
  StableId,
} from "@icm/model";
import type { HierarchyFrame, ObjectLocator } from "@icm/derived";
import { resolveDocumentLogicalNets } from "@icm/derived";
import type { SimulationAnalysis, SimulationRequest } from "@icm/spice-run";

import { analyzeDesignNetlist } from "./extract.js";
import type { DesignNetlistCell, NetlistDiagnostic } from "./ir.js";
import { printSpiceCellInstances, printSpiceNetlist } from "./printers.js";

/** The rawfile every compiled deck writes; the harness returns the one `.raw`. */
export const SIMULATION_RAWFILE_NAME = "out.raw";

/** One probe's binding to the vector its number will arrive under. */
export interface CompiledSimulationVector {
  readonly probeId: string;
  /** ngspice's own spelling, e.g. `v(mid)`, `v(x1.out)`, `i(v1)`. */
  readonly vector: string;
  readonly quantity: "voltage" | "current";
}

export type CompiledSimulation =
  | {
      readonly ok: true;
      readonly request: SimulationRequest;
      readonly vectors: ReadonlyArray<CompiledSimulationVector>;
      readonly diagnostics: readonly [];
      /**
       * Everything the extraction reported that did not stop the compile --
       * a generated Net name, a normalised spelling. The structural export
       * blocks on these until an author has read them, so they are carried
       * rather than dropped; they are deliberately not in `diagnostics`,
       * which stays empty on a successful compile.
       */
      readonly warnings: readonly NetlistDiagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly NetlistDiagnostic[] };

export interface CompileStructuredSimulationOptions {
  /** Wall-clock ceiling for the simulator process; the runner clamps it. */
  readonly timeoutMs?: number;
}

function diagnostic(
  code: string,
  documentId: StableId,
  message: string,
  primary: ObjectLocator,
  objectIds: StableId[] = [],
): NetlistDiagnostic {
  return { code, severity: "error", documentId, objectIds, primary, message };
}

function locator(
  documentId: StableId,
  hierarchyPath: HierarchyFrame[],
  kind: ObjectLocator["kind"],
  objectId: StableId,
): ObjectLocator {
  return { documentId, hierarchyPath, kind, objectId };
}

/**
 * The shortest decimal that reads back as the same double, as a SPICE token.
 *
 * `String` already gives that; what matters is that it never produces a SPICE
 * scale suffix, so `1e6` cannot be re-read as anything but ten to the sixth.
 * ngspice 46 accepts the signed exponent form (`1e+9`, `1e-1`) verbatim.
 */
function spiceNumber(value: number): string {
  return String(value);
}

function analysisCommand(analysis: SimulationAnalysisSpec): string {
  switch (analysis.kind) {
    case "op":
      return "op";
    case "ac":
      return [
        "ac",
        analysis.sweep,
        String(analysis.points),
        spiceNumber(analysis.startHz),
        spiceNumber(analysis.stopHz),
      ].join(" ");
    case "tran": {
      const values = [
        "tran",
        spiceNumber(analysis.stepSeconds),
        spiceNumber(analysis.stopSeconds),
      ];
      if (
        analysis.startSeconds !== undefined ||
        analysis.maxStepSeconds !== undefined
      ) {
        values.push(spiceNumber(analysis.startSeconds ?? 0));
      }
      if (analysis.maxStepSeconds !== undefined) {
        values.push(spiceNumber(analysis.maxStepSeconds));
      }
      return values.join(" ");
    }
  }
}

/**
 * A stable serialization of the authored setup, field order fixed here rather
 * than inherited from however the object was built, so the digest below is a
 * fact about the setup and not about its construction. Follows the same
 * canonical-then-hash shape `@icm/spice-run` uses for environment facts.
 */
function canonicalSetup(input: SimulationStructuredInput): string {
  return JSON.stringify({
    version: 1,
    kind: input.kind,
    rootDocumentId: input.rootDocumentId,
    analyses: input.analyses.map((analysis) =>
      analysis.kind === "op"
        ? { kind: analysis.kind }
        : analysis.kind === "ac"
          ? {
              kind: analysis.kind,
              sweep: analysis.sweep,
              points: analysis.points,
              startHz: analysis.startHz,
              stopHz: analysis.stopHz,
            }
          : {
              kind: analysis.kind,
              stepSeconds: analysis.stepSeconds,
              stopSeconds: analysis.stopSeconds,
              startSeconds: analysis.startSeconds ?? null,
              maxStepSeconds: analysis.maxStepSeconds ?? null,
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
  });
}

/**
 * SHA-256 over the exact deck texts and the authored setup.
 *
 * Browser-safe by construction: Web Crypto only, which is why this function is
 * async, matching `createSimulationInputMetadata` in `@icm/spice-run`. The
 * result is the request's opaque `inputRevision` -- caller state a runner
 * echoes back so a result computed from an older input reads as stale.
 */
async function inputRevisionOf(
  netlist: string,
  testbench: string,
  input: SimulationStructuredInput,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      [
        "analog-canvas/simulation-compile/1",
        netlist,
        testbench,
        canonicalSetup(input),
      ].join(" "),
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

interface ResolvedOccurrence {
  readonly document: SchematicDocument;
  readonly cell: DesignNetlistCell;
  /** Lowercased Instance references, one per occurrence step. */
  readonly path: readonly string[];
  readonly hierarchyPath: HierarchyFrame[];
}

/**
 * Walk one probe's occurrence from the root, checking every step is a real
 * hierarchy Instance and that the walk lands on the Document the probe claims.
 *
 * The returned `path` is what ngspice prefixes onto a name inside a
 * subcircuit; the `hierarchyPath` is the canonical locator address (ADR 0015)
 * so a diagnostic points at the occurrence, not merely at a Document.
 */
function resolveOccurrence(
  probe: SimulationProbeSpec,
  rootDocumentId: StableId,
  documentsById: ReadonlyMap<string, SchematicDocument>,
  cellsById: ReadonlyMap<string, DesignNetlistCell>,
  diagnostics: NetlistDiagnostic[],
): ResolvedOccurrence | null {
  if (!documentsById.has(probe.documentId)) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNKNOWN_DOCUMENT",
        rootDocumentId,
        `Probe ${probe.id} references unknown Document ${probe.documentId}`,
        locator(rootDocumentId, [], "document", rootDocumentId),
      ),
    );
    return null;
  }
  let document = documentsById.get(rootDocumentId)!;
  const path: string[] = [];
  const hierarchyPath: HierarchyFrame[] = [];
  for (const instanceId of probe.occurrence) {
    const binding = document.instances.find(
      (candidate) => candidate.id === instanceId,
    )?.netlist?.binding;
    const child =
      binding?.kind === "subcircuit"
        ? documentsById.get(binding.childDocumentId)
        : undefined;
    // The reference comes from the extraction rather than the raw Instance:
    // it is the token the printer put on the `X` card, which is the one
    // ngspice prefixes onto every name inside the subcircuit.
    const reference = cellsById
      .get(document.id)
      ?.instances.find((item) => item.id === instanceId)?.reference;
    if (!child || !reference) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_PROBE_INVALID_OCCURRENCE",
          document.id,
          `Probe ${probe.id} occurrence step ${instanceId} is not a hierarchy Instance of Document ${document.id}`,
          locator(document.id, [...hierarchyPath], "instance", instanceId),
          [instanceId],
        ),
      );
      return null;
    }
    path.push(reference.toLowerCase());
    hierarchyPath.push({
      parentDocumentId: document.id,
      instanceId,
      childDocumentId: child.id,
    });
    document = child;
  }
  const cell = cellsById.get(document.id);
  if (document.id !== probe.documentId || !cell) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_OCCURRENCE_DOCUMENT_MISMATCH",
        document.id,
        `Probe ${probe.id} names Document ${probe.documentId} but its occurrence reaches Document ${document.id}`,
        locator(document.id, [...hierarchyPath], "document", document.id),
      ),
    );
    return null;
  }
  return { document, cell, path, hierarchyPath };
}

function netVoltageVector(
  probe: Extract<SimulationProbeSpec, { kind: "net-voltage" }>,
  occurrence: ResolvedOccurrence,
  diagnostics: NetlistDiagnostic[],
): CompiledSimulationVector | null {
  const { document, cell, path, hierarchyPath } = occurrence;
  if (!document.nets.some((net) => net.id === probe.netId)) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNKNOWN_NET",
        document.id,
        `Probe ${probe.id} references unknown Net ${probe.netId} in Document ${document.id}`,
        locator(document.id, hierarchyPath, "net", probe.netId),
        [probe.netId],
      ),
    );
    return null;
  }
  // The Logical Net the printer resolved, then the name it actually printed.
  // Reading the extraction's own output is what keeps a probe name and a node
  // name from being derived twice and disagreeing once.
  const logicalNet = resolveDocumentLogicalNets(document).byBaseNetId.get(
    probe.netId,
  );
  const netName = cell.nets.find(
    (net) => net.id === (logicalNet?.id ?? probe.netId),
  )?.name;
  if (!netName) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_NET_NOT_EXPORTED",
        document.id,
        `Probe ${probe.id} references Net ${probe.netId}, which the netlist does not export under a node name`,
        locator(document.id, hierarchyPath, "net", probe.netId),
        [probe.netId],
      ),
    );
    return null;
  }
  return {
    probeId: probe.id,
    vector: `v(${[...path, netName].join(".").toLowerCase()})`,
    quantity: "voltage",
  };
}

function sourceCurrentVector(
  probe: Extract<SimulationProbeSpec, { kind: "source-current" }>,
  occurrence: ResolvedOccurrence,
  diagnostics: NetlistDiagnostic[],
): CompiledSimulationVector | null {
  const { document, cell, path, hierarchyPath } = occurrence;
  const instance = cell.instances.find((item) => item.id === probe.instanceId);
  if (!instance) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNKNOWN_INSTANCE",
        document.id,
        `Probe ${probe.id} references unknown Instance ${probe.instanceId} in Document ${document.id}`,
        locator(document.id, hierarchyPath, "instance", probe.instanceId),
        [probe.instanceId],
      ),
    );
    return null;
  }
  if (instance.deviceClass === "current-source") {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_SOURCE_HAS_NO_BRANCH_CURRENT",
        document.id,
        `Probe ${probe.id} measures Instance ${instance.reference}, an independent current source; ngspice solves no branch current for one, so probe a series voltage source instead`,
        locator(document.id, hierarchyPath, "instance", probe.instanceId),
        [probe.instanceId],
      ),
    );
    return null;
  }
  if (instance.deviceClass !== "voltage-source") {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_NOT_A_SOURCE",
        document.id,
        `Probe ${probe.id} measures source current on Instance ${instance.reference}, which is a ${instance.deviceClass}`,
        locator(document.id, hierarchyPath, "instance", probe.instanceId),
        [probe.instanceId],
      ),
    );
    return null;
  }
  const reference = instance.reference.toLowerCase();
  // Inside a subcircuit the expanded device carries its own type letter before
  // the occurrence path: `Vsi` under `X1`/`XI1` is `v.x1.xi1.vsi`. At the top
  // level the reference stands alone.
  const name = path.length
    ? [reference.slice(0, 1), ...path, reference].join(".")
    : reference;
  return { probeId: probe.id, vector: `i(${name})`, quantity: "current" };
}

/**
 * Compile one structured setup into the netlist, testbench, analyses, and
 * probe-to-vector bindings a simulation run needs.
 *
 * Deterministic: the same Project and setup produce byte-identical texts, in
 * the extraction's own Cell and Instance order, with probes in the order the
 * author wrote them.
 */
export async function compileStructuredSimulation(
  project: CircuitProject,
  setup: SimulationSetup,
  options: CompileStructuredSimulationOptions = {},
): Promise<CompiledSimulation> {
  if (setup.input.kind !== "structured") {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "SIMULATION_INPUT_MODE_MISMATCH",
          project.id,
          "Structured compilation requires a structured SimulationSetup",
          locator(project.topDocumentId, [], "document", project.topDocumentId),
        ),
      ],
    };
  }
  const input = setup.input;
  const analysis = analyzeDesignNetlist(project, {
    format: "spice",
    rootDocumentId: input.rootDocumentId,
  });
  // A null IR already carries at least one error, `MISSING_ROOT_CELL` among
  // them when the root Document is not in the Project.
  if (!analysis.ir) return { ok: false, diagnostics: analysis.diagnostics };
  const ir = analysis.ir;
  const rootCell = ir.cells.find((cell) => cell.id === ir.topCellId);
  if (!rootCell) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "SIMULATION_ROOT_NOT_EXTRACTED",
          input.rootDocumentId,
          `Simulation root Document ${input.rootDocumentId} produced no Cell`,
          locator(input.rootDocumentId, [], "document", input.rootDocumentId),
        ),
      ],
    };
  }

  const diagnostics: NetlistDiagnostic[] = [];
  const rootCards = printSpiceCellInstances(rootCell);
  // "A deck that only defines `.subckt`s and instantiates nothing is not a
  // run" (docs/specs/simulation.md, "Inputs and root"). Net markers are
  // electrical facts that print no card, so an emptiness test has to be about
  // the cards, not about how many objects the author drew.
  if (rootCards.length === 0) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_ROOT_HAS_NO_INSTANCES",
        rootCell.id,
        `Simulation root Cell ${rootCell.name} instantiates nothing; a deck that only defines subcircuits is not a run`,
        locator(rootCell.id, [], "document", rootCell.id),
      ),
    );
  }

  const analyses: SimulationAnalysis[] = [];
  for (const item of input.analyses) {
    if (item.kind === "op" || item.kind === "ac" || item.kind === "tran") {
      analyses.push(item.kind);
      continue;
    }
    diagnostics.push(
      diagnostic(
        "SIMULATION_UNSUPPORTED_ANALYSIS",
        input.rootDocumentId,
        `Analysis ${(item as { kind: string }).kind} is not one this release compiles`,
        locator(input.rootDocumentId, [], "document", input.rootDocumentId),
      ),
    );
  }

  const documentsById = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const cellsById = new Map(ir.cells.map((cell) => [cell.id, cell]));
  const vectors: CompiledSimulationVector[] = [];
  for (const probe of input.probes) {
    const occurrence = resolveOccurrence(
      probe,
      input.rootDocumentId,
      documentsById,
      cellsById,
      diagnostics,
    );
    if (!occurrence) continue;
    const vector =
      probe.kind === "net-voltage"
        ? netVoltageVector(probe, occurrence, diagnostics)
        : sourceCurrentVector(probe, occurrence, diagnostics);
    if (vector) vectors.push(vector);
  }

  if (diagnostics.length) return { ok: false, diagnostics };

  // Every reached Cell but the root: the root is instantiated below, not
  // defined. `.global` declarations stay with the definitions.
  const netlist = printSpiceNetlist({
    ...ir,
    cells: ir.cells.filter((cell) => cell.id !== ir.topCellId),
  });

  // One `write` per analysis, so each plot reaches the rawfile; see the note
  // at the top of this file for why `run` and a single `write` do not.
  const written = [...new Set(vectors.map((item) => item.vector))];
  const writeCard = [`write ${SIMULATION_RAWFILE_NAME}`, ...written].join(" ");
  const testbench = [
    `* Analog Canvas testbench for ${rootCell.name}`,
    ...rootCards,
    ...(input.environment.temperatureC === undefined
      ? []
      : [`.temp ${spiceNumber(input.environment.temperatureC)}`]),
    ".control",
    "set filetype=ascii",
    ...(analyses.length > 1 ? ["set appendwrite"] : []),
    ...input.analyses.flatMap((item) => [analysisCommand(item), writeCard]),
    ".endc",
    ".end",
  ].join("\n");

  return {
    ok: true,
    request: {
      netlist,
      testbench: `${testbench}\n`,
      analyses,
      inputRevision: await inputRevisionOf(netlist, testbench, input),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    },
    vectors,
    diagnostics: [],
    warnings: analysis.diagnostics,
  };
}
