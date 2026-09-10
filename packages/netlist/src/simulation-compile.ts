/**
 * Compiling a structured `SimulationSetup` into one simulation request.
 *
 * A setup names a Testbench root, the analyses to run, and the outputs to
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
 * - current entering any selected Instance terminal is measured through a
 *   compiler-owned zero-volt source inserted in series with that terminal;
 * - a root sense source prints `i(vicmprb###)`, while one inside an occurrence
 *   prints `i(v.<x1>.<x2>.vicmprb###)`.
 *
 * Instrumentation is applied only to the extracted, ephemeral simulation IR.
 * The authored Project and ordinary structural export are never changed.
 */

import type {
  CircuitProject,
  SchematicDocument,
  SimulationAnalysisSpec,
  SimulationDeviceOperatingPointSpec,
  SimulationExpression,
  SimulationMeasurementSpec,
  SimulationSetup,
  SimulationStructuredInput,
  SimulationVoltageProbe,
  StableId,
} from "@icm/model";
import {
  SIMULATION_NOISE_INPUT_DENSITY_ID,
  SIMULATION_NOISE_OUTPUT_DENSITY_ID,
} from "@icm/model";
import type { HierarchyFrame, ObjectLocator } from "@icm/derived";
import {
  mosBulkKind,
  resolveDocumentLogicalNets,
  resolveMosBulkConnection,
} from "@icm/derived";
import type { SimulationAnalysis, SimulationRequest } from "@icm/spice-run";

import { analyzeDesignNetlist } from "./extract.js";
import type {
  DesignNetlistCell,
  DesignNetlistInstance,
  DesignNetlistIR,
  NetlistDiagnostic,
} from "./ir.js";
import { printSpiceCellInstances, printSpiceNetlist } from "./printers.js";

/** The rawfile every compiled deck writes; the harness returns the one `.raw`. */
export const SIMULATION_RAWFILE_NAME = "out.raw";

/** One probe's binding to the vector its number will arrive under. */
export interface CompiledSimulationVector {
  readonly probeId: string;
  /** ngspice's own spelling, e.g. `v(mid)`, `v(x1.out)`, `i(v1)`. */
  readonly vector: string;
  readonly quantity: "voltage" | "current" | "native";
}

interface ResolvedSimulationProbe {
  readonly binding: CompiledSimulationVector;
  /** Expression passed to ngspice's `write`; it may differ from raw output. */
  readonly writeVector: string;
  /** Ephemeral Cell instrumentation required before printing the netlist. */
  readonly netlistInstrumentation?: TerminalCurrentInstrumentation;
}

export interface TerminalCurrentInstrumentation {
  readonly cellId: StableId;
  readonly instanceId: StableId;
  readonly pinName: string;
  readonly senseReference: string;
  readonly senseNode: string;
}

export type CompiledSimulationExpression =
  | {
      readonly kind: "acquisition";
      readonly acquisitionId: string;
      readonly quantity: "voltage" | "current" | "native";
    }
  | {
      readonly kind: "constant";
      readonly value: number;
      /** Physical unit assigned by compilation; authored constants default to 1. */
      readonly unit?: string | undefined;
    }
  | {
      readonly kind:
        | "negate"
        | "magnitude"
        | "db20"
        | "phase"
        | "real"
        | "imaginary"
        | "absolute";
      readonly operand: CompiledSimulationExpression;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply" | "divide";
      readonly left: CompiledSimulationExpression;
      readonly right: CompiledSimulationExpression;
    };

export interface CompiledSimulationOutput {
  readonly id: string;
  readonly label: string;
  readonly expression: CompiledSimulationExpression;
}

export type SimulationDeviceOperatingPointParameter =
  "vgs" | "vds" | "vbs" | "id";

export interface CompiledSimulationDeviceOperatingPointValue {
  readonly parameter: SimulationDeviceOperatingPointParameter;
  readonly label: "VGS" | "VDS" | "VBS" | "ID";
  readonly unit: "V" | "A";
  readonly expression: CompiledSimulationExpression;
}

/** Compile-time mapping for one authored MOS occurrence, never Project data. */
export interface CompiledSimulationDeviceOperatingPoint {
  readonly id: string;
  readonly documentId: StableId;
  readonly instanceId: StableId;
  readonly occurrence: readonly StableId[];
  readonly reference: string;
  readonly polarity: "nmos" | "pmos";
  readonly values: readonly CompiledSimulationDeviceOperatingPointValue[];
}

export type CompiledSimulation =
  | {
      readonly ok: true;
      readonly request: SimulationRequest;
      readonly vectors: ReadonlyArray<CompiledSimulationVector>;
      readonly outputs: ReadonlyArray<CompiledSimulationOutput>;
      readonly deviceOperatingPoints: ReadonlyArray<CompiledSimulationDeviceOperatingPoint>;
      readonly measurements: ReadonlyArray<SimulationMeasurementSpec>;
      /** Derived ingredients shared by source composition and offline migration. */
      readonly circuit: DesignNetlistIR;
      readonly captureVectors: readonly string[];
      readonly terminalInstrumentations: readonly TerminalCurrentInstrumentation[];
      readonly commands: readonly {
        kind: SimulationAnalysis;
        command: string;
      }[];
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
  /** Native commands remain author-owned; do not reject measurements from an incomplete static analysis list. */
  readonly nativeControl?: boolean;
  /** Shared ephemeral instrumentation when multiple generated bindings reuse Cells. */
  readonly terminalInstrumentations?: readonly TerminalCurrentInstrumentation[];
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

function analysisCommand(
  analysis: SimulationAnalysisSpec,
  dcSourceReference?: string,
): string {
  switch (analysis.kind) {
    case "op":
      return "op";
    case "dc": {
      if (!dcSourceReference)
        throw new Error("DC source must be resolved before writing the deck");
      const direction = analysis.stopValue > analysis.startValue ? 1 : -1;
      return [
        "dc",
        dcSourceReference,
        spiceNumber(analysis.startValue),
        spiceNumber(analysis.stopValue),
        spiceNumber(analysis.stepValue * direction),
      ].join(" ");
    }
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
    case "noise":
      throw new Error("Noise output and input source must be resolved first");
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
        : analysis.kind === "dc"
          ? {
              kind: analysis.kind,
              sourceInstanceId: analysis.sourceInstanceId,
              startValue: analysis.startValue,
              stopValue: analysis.stopValue,
              stepValue: analysis.stepValue,
            }
          : analysis.kind === "ac"
            ? {
                kind: analysis.kind,
                sweep: analysis.sweep,
                points: analysis.points,
                startHz: analysis.startHz,
                stopHz: analysis.stopHz,
              }
            : analysis.kind === "tran"
              ? {
                  kind: analysis.kind,
                  stepSeconds: analysis.stepSeconds,
                  stopSeconds: analysis.stopSeconds,
                  startSeconds: analysis.startSeconds ?? null,
                  maxStepSeconds: analysis.maxStepSeconds ?? null,
                }
              : {
                  kind: analysis.kind,
                  output: analysis.output,
                  inputSourceInstanceId: analysis.inputSourceInstanceId,
                  sweep: analysis.sweep,
                  points: analysis.points,
                  startHz: analysis.startHz,
                  stopHz: analysis.stopHz,
                },
    ),
    outputs: input.outputs,
    deviceOperatingPoints: input.deviceOperatingPoints ?? [],
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

type SimulationOccurrenceTarget = {
  readonly documentId: StableId;
  readonly occurrence: readonly StableId[];
};

/**
 * Walk one probe's occurrence from the root, checking every step is a real
 * hierarchy Instance and that the walk lands on the Document the probe claims.
 *
 * The returned `path` is what ngspice prefixes onto a name inside a
 * subcircuit; the `hierarchyPath` is the canonical locator address (ADR 0015)
 * so a diagnostic points at the occurrence, not merely at a Document.
 */
function resolveOccurrence(
  measurement: SimulationOccurrenceTarget,
  outputId: string,
  rootDocumentId: StableId,
  documentsById: ReadonlyMap<string, SchematicDocument>,
  cellsById: ReadonlyMap<string, DesignNetlistCell>,
  diagnostics: NetlistDiagnostic[],
): ResolvedOccurrence | null {
  if (!documentsById.has(measurement.documentId)) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNKNOWN_DOCUMENT",
        rootDocumentId,
        `Output ${outputId} references unknown Document ${measurement.documentId}`,
        locator(rootDocumentId, [], "document", rootDocumentId),
      ),
    );
    return null;
  }
  let document = documentsById.get(rootDocumentId)!;
  const path: string[] = [];
  const hierarchyPath: HierarchyFrame[] = [];
  for (const instanceId of measurement.occurrence) {
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
          `Output ${outputId} occurrence step ${instanceId} is not a hierarchy Instance of Document ${document.id}`,
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
  if (document.id !== measurement.documentId || !cell) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_OCCURRENCE_DOCUMENT_MISMATCH",
        document.id,
        `Output ${outputId} names Document ${measurement.documentId} but its occurrence reaches Document ${document.id}`,
        locator(document.id, [...hierarchyPath], "document", document.id),
      ),
    );
    return null;
  }
  return { document, cell, path, hierarchyPath };
}

function instrumentationKey(
  instrumentation: Pick<
    TerminalCurrentInstrumentation,
    "cellId" | "instanceId" | "pinName"
  >,
): string {
  return `${instrumentation.cellId}\u0000${instrumentation.instanceId}\u0000${instrumentation.pinName}`;
}

/**
 * Allocate names from the extracted Cell, not from output order. This makes
 * the generated deck deterministic when an author reorders outputs and keeps
 * compiler-owned names away from authored References and node names.
 */
function ensureTerminalCurrentInstrumentation(
  cell: DesignNetlistCell,
  instance: DesignNetlistInstance,
  pinName: string,
  instrumentations: Map<string, TerminalCurrentInstrumentation>,
): TerminalCurrentInstrumentation {
  const key = instrumentationKey({
    cellId: cell.id,
    instanceId: instance.id,
    pinName,
  });
  const existing = instrumentations.get(key);
  if (existing) return existing;

  const references = new Set(
    cell.instances.map((instance) => instance.reference.toLowerCase()),
  );
  const nodes = new Set([
    ...cell.ports.map((port) => port.name.toLowerCase()),
    ...cell.nets.map((net) => net.name.toLowerCase()),
    ...cell.instances.flatMap((instance) =>
      instance.nodes.map((node) => node.netName.toLowerCase()),
    ),
  ]);
  for (const item of instrumentations.values()) {
    if (item.cellId !== cell.id) continue;
    references.add(item.senseReference.toLowerCase());
    nodes.add(item.senseNode.toLowerCase());
  }

  const instanceIndex = cell.instances.findIndex(
    (candidate) => candidate.id === instance.id,
  );
  const pinIndex = instance.nodes.findIndex((node) => node.pinName === pinName);
  let serial =
    cell.instances
      .slice(0, Math.max(0, instanceIndex))
      .reduce((total, candidate) => total + candidate.nodes.length, 0) +
    Math.max(0, pinIndex) +
    1;
  while (true) {
    const suffix = String(serial).padStart(3, "0");
    const senseReference = `VICMPRB${suffix}`;
    const senseNode = `ICMPRB${suffix}`;
    if (
      !references.has(senseReference.toLowerCase()) &&
      !nodes.has(senseNode.toLowerCase())
    ) {
      const instrumentation = {
        cellId: cell.id,
        instanceId: instance.id,
        pinName,
        senseReference,
        senseNode,
      } satisfies TerminalCurrentInstrumentation;
      instrumentations.set(key, instrumentation);
      return instrumentation;
    }
    serial += 1;
  }
}

/**
 * Put a zero-volt source in series with each selected terminal. The source's
 * positive node is the external Net and its negative node is the private sense
 * node, so ngspice's positive branch current is current entering the terminal.
 */
function instrumentTerminalCurrents(
  ir: DesignNetlistIR,
  instrumentations: ReadonlyMap<string, TerminalCurrentInstrumentation>,
): DesignNetlistIR {
  if (instrumentations.size === 0) return ir;
  return {
    ...ir,
    cells: ir.cells.map((cell) => ({
      ...cell,
      instances: cell.instances.flatMap((instance) => {
        const selected = instance.nodes.flatMap((node) => {
          const instrumentation = instrumentations.get(
            instrumentationKey({
              cellId: cell.id,
              instanceId: instance.id,
              pinName: node.pinName,
            }),
          );
          return instrumentation ? [{ node, instrumentation }] : [];
        });
        if (selected.length === 0) return [instance];
        return [
          {
            ...instance,
            nodes: instance.nodes.map((node) => {
              const selectedNode = selected.find(
                (item) => item.node.pinName === node.pinName,
              );
              return selectedNode
                ? { ...node, netName: selectedNode.instrumentation.senseNode }
                : node;
            }),
          },
          ...selected.map(({ node, instrumentation }) => ({
            id: `${instance.id}:simulation-current-sense:${instrumentation.senseReference}`,
            reference: instrumentation.senseReference,
            invocationKind: "primitive" as const,
            deviceClass: "voltage-source" as const,
            target: null,
            nodes: [
              { pinName: "+", netName: node.netName },
              { pinName: "-", netName: instrumentation.senseNode },
            ],
            parameters: [{ name: "dc", rawValue: "0" }],
          })),
        ];
      }),
    })),
  };
}

function netVoltageNode(
  measurement: SimulationVoltageProbe,
  outputId: string,
  occurrence: ResolvedOccurrence,
  cellsById: ReadonlyMap<string, DesignNetlistCell>,
  diagnostics: NetlistDiagnostic[],
): string | null {
  const { document, cell, path, hierarchyPath } = occurrence;
  const anchor = measurement.anchor;
  const netId =
    anchor.kind === "terminal"
      ? document.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === anchor.instanceId &&
              terminal.pinName === anchor.pinName,
          ),
        )?.id
      : anchor.kind === "junction"
        ? document.junctions.find(
            (junction) => junction.id === anchor.junctionId,
          )?.netId
        : anchor.kind === "route"
          ? document.routes.find((route) => route.id === anchor.routeId)?.netId
          : document.nets.find((net) => net.id === anchor.netId)?.id;
  if (!netId) {
    const primary: ObjectLocator =
      anchor.kind === "terminal"
        ? {
            documentId: document.id,
            hierarchyPath,
            kind: "instance",
            objectId: anchor.instanceId,
            endpoint: anchor,
          }
        : anchor.kind === "junction"
          ? locator(document.id, hierarchyPath, "junction", anchor.junctionId)
          : anchor.kind === "route"
            ? locator(document.id, hierarchyPath, "route", anchor.routeId)
            : locator(document.id, hierarchyPath, "net", anchor.netId);
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_ANCHOR_UNAVAILABLE",
        document.id,
        `Output ${outputId} ${anchor.kind} anchor no longer resolves in Document ${document.id}`,
        primary,
        [primary.objectId],
      ),
    );
    return null;
  }
  // The Logical Net the printer resolved, then the name it actually printed.
  // Reading the extraction's own output is what keeps a probe name and a node
  // name from being derived twice and disagreeing once.
  const logicalNet =
    resolveDocumentLogicalNets(document).byBaseNetId.get(netId);
  const netName = cell.nets.find(
    (net) => net.id === (logicalNet?.id ?? netId),
  )?.name;
  if (!netName) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_NET_NOT_EXPORTED",
        document.id,
        `Output ${outputId} anchor resolves to Net ${netId}, which the netlist does not export under a node name`,
        locator(document.id, hierarchyPath, "net", netId),
        [netId],
      ),
    );
    return null;
  }
  let resolvedName = netName;
  let depth = hierarchyPath.length;
  let resolvedCell = cell;
  while (depth > 0) {
    const boundaryPort = resolvedCell.ports.find(
      (port) => port.netName.toLowerCase() === resolvedName.toLowerCase(),
    );
    if (!boundaryPort)
      return [...path.slice(0, depth), resolvedName].join(".").toLowerCase();

    const frame = hierarchyPath[depth - 1]!;
    const parentCell = cellsById.get(frame.parentDocumentId);
    const caller = parentCell?.instances.find(
      (instance) => instance.id === frame.instanceId,
    );
    const callerNode = caller?.nodes.find(
      (node) => node.pinName.toLowerCase() === boundaryPort.name.toLowerCase(),
    )?.netName;
    if (!parentCell || !callerNode) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_PROBE_HIERARCHY_BOUNDARY_UNAVAILABLE",
          occurrence.document.id,
          `Output ${outputId} cannot map formal terminal ${boundaryPort.name} through hierarchy Instance ${frame.instanceId}`,
          locator(
            frame.parentDocumentId,
            hierarchyPath.slice(0, depth - 1),
            "instance",
            frame.instanceId,
          ),
          [frame.instanceId],
        ),
      );
      return null;
    }
    resolvedName = callerNode;
    resolvedCell = parentCell;
    depth -= 1;
  }
  return resolvedName.toLowerCase();
}

function terminalCurrentVector(
  measurement: Extract<SimulationExpression, { kind: "current" }>,
  acquisitionId: string,
  outputId: string,
  occurrence: ResolvedOccurrence,
  diagnostics: NetlistDiagnostic[],
  terminalCurrentInstrumentations: Map<string, TerminalCurrentInstrumentation>,
): ResolvedSimulationProbe | null {
  const { document, cell, path, hierarchyPath } = occurrence;
  const instance = cell.instances.find(
    (item) => item.id === measurement.instanceId,
  );
  if (!instance) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNKNOWN_INSTANCE",
        document.id,
        `Output ${outputId} references unknown Instance ${measurement.instanceId} in Document ${document.id}`,
        locator(document.id, hierarchyPath, "instance", measurement.instanceId),
        [measurement.instanceId],
      ),
    );
    return null;
  }
  const terminal = instance.nodes.find(
    (node) => node.pinName === measurement.pinName,
  );
  if (!terminal) {
    diagnostics.push(
      diagnostic(
        "SIMULATION_PROBE_UNKNOWN_TERMINAL",
        document.id,
        `Output ${outputId} references unknown terminal ${instance.reference}.${measurement.pinName}`,
        {
          ...locator(
            document.id,
            hierarchyPath,
            "instance",
            measurement.instanceId,
          ),
          endpoint: {
            kind: "terminal",
            instanceId: measurement.instanceId,
            pinName: measurement.pinName,
          },
        },
        [measurement.instanceId],
      ),
    );
    return null;
  }
  const instrumentation = ensureTerminalCurrentInstrumentation(
    cell,
    instance,
    terminal.pinName,
    terminalCurrentInstrumentations,
  );
  const name = path.length
    ? ["v", ...path, instrumentation.senseReference.toLowerCase()].join(".")
    : instrumentation.senseReference.toLowerCase();
  const binding: CompiledSimulationVector = {
    probeId: acquisitionId,
    vector: `i(${name})`,
    quantity: "current",
  };
  return {
    binding,
    writeVector: binding.vector,
    netlistInstrumentation: instrumentation,
  };
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
  const compiled = buildSimulationPlan(project, setup, options);
  if (!compiled.ok || setup.input.kind !== "structured") return compiled;
  return {
    ...compiled,
    request: {
      ...compiled.request,
      inputRevision: await inputRevisionOf(
        compiled.request.netlist,
        compiled.request.testbench.trimEnd(),
        setup.input,
      ),
    },
  };
}

/** Pure planning; neither execution nor asynchronous hashing belongs to migration. */
export function buildSimulationPlan(
  project: CircuitProject,
  setup: SimulationSetup,
  options: CompileStructuredSimulationOptions = {},
): CompiledSimulation {
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

  const documentsById = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const cellsById = new Map(ir.cells.map((cell) => [cell.id, cell]));
  const analyses: SimulationAnalysis[] = [];
  const analysisCommands: Array<{
    readonly kind: SimulationAnalysis;
    readonly command: string;
  }> = [];
  for (const item of input.analyses) {
    if (item.kind === "dc") {
      const source = rootCell.instances.find(
        (instance) => instance.id === item.sourceInstanceId,
      );
      if (!source) {
        diagnostics.push(
          diagnostic(
            "SIMULATION_DC_SOURCE_UNAVAILABLE",
            input.rootDocumentId,
            `DC sweep source ${item.sourceInstanceId} is not an Instance in the Testbench root`,
            locator(
              input.rootDocumentId,
              [],
              "instance",
              item.sourceInstanceId,
            ),
            [item.sourceInstanceId],
          ),
        );
        continue;
      }
      if (
        source.deviceClass !== "voltage-source" &&
        source.deviceClass !== "current-source"
      ) {
        diagnostics.push(
          diagnostic(
            "SIMULATION_DC_SOURCE_UNSUPPORTED",
            input.rootDocumentId,
            `DC sweep source ${source.reference} is a ${source.deviceClass}; select an independent voltage or current source`,
            locator(input.rootDocumentId, [], "instance", source.id),
            [source.id],
          ),
        );
        continue;
      }
      analyses.push(item.kind);
      analysisCommands.push({
        kind: item.kind,
        command: analysisCommand(item, source.reference),
      });
      continue;
    }
    if (item.kind === "op" || item.kind === "ac" || item.kind === "tran") {
      analyses.push(item.kind);
      analysisCommands.push({
        kind: item.kind,
        command: analysisCommand(item),
      });
      continue;
    }
    const source = rootCell.instances.find(
      (instance) => instance.id === item.inputSourceInstanceId,
    );
    if (!source) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_NOISE_SOURCE_UNAVAILABLE",
          input.rootDocumentId,
          `Noise input source ${item.inputSourceInstanceId} is not an Instance in the Testbench root`,
          locator(
            input.rootDocumentId,
            [],
            "instance",
            item.inputSourceInstanceId,
          ),
          [item.inputSourceInstanceId],
        ),
      );
      continue;
    }
    if (
      source.deviceClass !== "voltage-source" &&
      source.deviceClass !== "current-source"
    ) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_NOISE_SOURCE_UNSUPPORTED",
          input.rootDocumentId,
          `Noise input source ${source.reference} is a ${source.deviceClass}; select an independent voltage or current source`,
          locator(input.rootDocumentId, [], "instance", source.id),
          [source.id],
        ),
      );
      continue;
    }
    const resolveNoiseNode = (
      probe: SimulationVoltageProbe,
      side: "positive" | "negative",
    ): string | null => {
      const measurement: Extract<SimulationExpression, { kind: "voltage" }> = {
        kind: "voltage",
        ...probe,
      };
      const label = `Noise output ${side}`;
      const occurrence = resolveOccurrence(
        measurement,
        label,
        input.rootDocumentId,
        documentsById,
        cellsById,
        diagnostics,
      );
      return occurrence
        ? netVoltageNode(measurement, label, occurrence, cellsById, diagnostics)
        : null;
    };
    const positive = resolveNoiseNode(item.output.positive, "positive");
    const negative = item.output.negative
      ? resolveNoiseNode(item.output.negative, "negative")
      : null;
    if (!positive || (item.output.negative && !negative)) continue;
    analyses.push(item.kind);
    analysisCommands.push({
      kind: item.kind,
      command: [
        "noise",
        negative ? `v(${positive},${negative})` : `v(${positive})`,
        source.reference,
        item.sweep,
        String(item.points),
        spiceNumber(item.startHz),
        spiceNumber(item.stopHz),
      ].join(" "),
    });
  }
  const vectors: CompiledSimulationVector[] = [];
  const vectorByIdentity = new Map<
    string,
    { vector: CompiledSimulationVector; writeVector: string }
  >();
  const outputs: CompiledSimulationOutput[] = [];
  const deviceOperatingPoints: CompiledSimulationDeviceOperatingPoint[] = [];
  const writeVectors: string[] = [];
  const terminalCurrentInstrumentations = new Map<
    string,
    TerminalCurrentInstrumentation
  >(
    (options.terminalInstrumentations ?? []).map((item) => [
      instrumentationKey(item),
      item,
    ]),
  );
  const compileExpression = (
    ownerId: string,
    topExpression: SimulationExpression,
  ): CompiledSimulationExpression | null => {
    let leafIndex = 0;
    const visit = (
      expression: SimulationExpression,
    ): CompiledSimulationExpression | null => {
      if (expression.kind === "constant") return { ...expression };
      if (expression.kind === "voltage" || expression.kind === "current") {
        const occurrence = resolveOccurrence(
          expression,
          ownerId,
          input.rootDocumentId,
          documentsById,
          cellsById,
          diagnostics,
        );
        if (!occurrence) return null;
        const candidateId =
          expression === topExpression
            ? ownerId
            : `${ownerId}:input:${leafIndex++}`;
        let resolved: ResolvedSimulationProbe | null;
        if (expression.kind === "voltage") {
          const node = netVoltageNode(
            expression,
            ownerId,
            occurrence,
            cellsById,
            diagnostics,
          );
          if (!node) return null;
          // Ground is a SPICE constant, not a writable rawfile vector.
          // Folding it here also keeps every derived expression independent of
          // simulator-specific attempts to expose `v(0)`.
          if (node === "0") return { kind: "constant", value: 0, unit: "V" };
          const binding: CompiledSimulationVector = {
            probeId: candidateId,
            vector: `v(${node})`,
            quantity: "voltage",
          };
          resolved = { binding, writeVector: binding.vector };
        } else {
          resolved = terminalCurrentVector(
            expression,
            candidateId,
            ownerId,
            occurrence,
            diagnostics,
            terminalCurrentInstrumentations,
          );
        }
        if (!resolved) return null;
        const identity = `${resolved.binding.quantity}\u0000${resolved.binding.vector}`;
        const existing = vectorByIdentity.get(identity);
        const acquisition = existing?.vector ?? resolved.binding;
        if (!existing) {
          vectorByIdentity.set(identity, {
            vector: acquisition,
            writeVector: resolved.writeVector,
          });
          vectors.push(acquisition);
          writeVectors.push(resolved.writeVector);
          if (resolved.netlistInstrumentation) {
            const instrumentation = resolved.netlistInstrumentation;
            terminalCurrentInstrumentations.set(
              instrumentationKey(instrumentation),
              instrumentation,
            );
          }
        }
        return {
          kind: "acquisition",
          acquisitionId: acquisition.probeId,
          quantity: acquisition.quantity,
        };
      }
      if (
        expression.kind === "add" ||
        expression.kind === "subtract" ||
        expression.kind === "multiply" ||
        expression.kind === "divide"
      ) {
        const left = visit(expression.left);
        const right = visit(expression.right);
        return left && right ? { kind: expression.kind, left, right } : null;
      }
      if ("operand" in expression) {
        const operand = visit(expression.operand);
        return operand ? { kind: expression.kind, operand } : null;
      }
      return null;
    };
    return visit(topExpression);
  };

  for (const output of input.outputs) {
    const expression = compileExpression(output.id, output.expression);
    if (expression)
      outputs.push({ id: output.id, label: output.label, expression });
  }

  const voltageAt = (
    request: SimulationDeviceOperatingPointSpec,
    pinName: "D" | "G" | "S",
  ): SimulationExpression => ({
    kind: "voltage",
    documentId: request.documentId,
    anchor: {
      kind: "terminal",
      instanceId: request.instanceId,
      pinName,
    },
    occurrence: [...request.occurrence],
  });
  const voltageOnNet = (
    request: SimulationDeviceOperatingPointSpec,
    netId: StableId,
  ): SimulationExpression => ({
    kind: "voltage",
    documentId: request.documentId,
    anchor: { kind: "base-net", netId },
    occurrence: [...request.occurrence],
  });
  const difference = (
    left: SimulationExpression,
    right: SimulationExpression,
  ): SimulationExpression => ({ kind: "subtract", left, right });

  for (const request of input.deviceOperatingPoints ?? []) {
    const occurrence = resolveOccurrence(
      request,
      request.id,
      input.rootDocumentId,
      documentsById,
      cellsById,
      diagnostics,
    );
    if (!occurrence) continue;
    const authoredInstance = occurrence.document.instances.find(
      (instance) => instance.id === request.instanceId,
    );
    const extractedInstance = occurrence.cell.instances.find(
      (instance) => instance.id === request.instanceId,
    );
    const polarity = authoredInstance
      ? mosBulkKind(authoredInstance)
      : undefined;
    if (!authoredInstance || !extractedInstance || !polarity) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_DEVICE_OPERATING_POINT_NOT_MOS",
          request.documentId,
          `Device operating-point target ${request.instanceId} is not a MOS Instance in Document ${request.documentId}`,
          locator(
            request.documentId,
            occurrence.hierarchyPath,
            "instance",
            request.instanceId,
          ),
          [request.instanceId],
        ),
      );
      continue;
    }
    const bulk = resolveMosBulkConnection(
      occurrence.document,
      authoredInstance,
    );
    if (!bulk?.net) {
      diagnostics.push(
        diagnostic(
          "SIMULATION_DEVICE_OPERATING_POINT_BULK_UNAVAILABLE",
          request.documentId,
          `Bulk for ${extractedInstance.reference} is not connected; VBS cannot be derived`,
          {
            ...locator(
              request.documentId,
              occurrence.hierarchyPath,
              "instance",
              request.instanceId,
            ),
            endpoint: {
              kind: "terminal",
              instanceId: request.instanceId,
              pinName: "B",
            },
          },
          [request.instanceId],
        ),
      );
      continue;
    }
    const source = voltageAt(request, "S");
    const authoredValues = [
      {
        parameter: "vgs" as const,
        label: "VGS" as const,
        unit: "V" as const,
        expression: difference(voltageAt(request, "G"), source),
      },
      {
        parameter: "vds" as const,
        label: "VDS" as const,
        unit: "V" as const,
        expression: difference(voltageAt(request, "D"), source),
      },
      {
        parameter: "vbs" as const,
        label: "VBS" as const,
        unit: "V" as const,
        expression: difference(voltageOnNet(request, bulk.net.id), source),
      },
      {
        parameter: "id" as const,
        label: "ID" as const,
        unit: "A" as const,
        expression: {
          kind: "current" as const,
          documentId: request.documentId,
          instanceId: request.instanceId,
          pinName: "D",
          occurrence: [...request.occurrence],
        },
      },
    ];
    const values = authoredValues.flatMap((value) => {
      const expression = compileExpression(
        `${request.id}:${value.parameter}`,
        value.expression,
      );
      return expression ? [{ ...value, expression }] : [];
    });
    if (values.length === authoredValues.length)
      deviceOperatingPoints.push({
        id: request.id,
        documentId: request.documentId,
        instanceId: request.instanceId,
        occurrence: [...request.occurrence],
        reference: extractedInstance.reference,
        polarity,
        values,
      });
  }

  const enabledAnalyses = new Set(input.analyses.map((item) => item.kind));
  const outputIds = new Set(input.outputs.map((output) => output.id));
  if (enabledAnalyses.has("noise") || options.nativeControl) {
    outputIds.add(SIMULATION_NOISE_OUTPUT_DENSITY_ID);
    outputIds.add(SIMULATION_NOISE_INPUT_DENSITY_ID);
  }
  for (const measurement of input.measurements ?? []) {
    if (!options.nativeControl && !enabledAnalyses.has(measurement.analysis))
      diagnostics.push(
        diagnostic(
          "SIMULATION_MEASUREMENT_ANALYSIS_UNAVAILABLE",
          input.rootDocumentId,
          `Measurement ${measurement.label} requires ${measurement.analysis.toUpperCase()}, which this Setup does not run`,
          locator(input.rootDocumentId, [], "document", input.rootDocumentId),
        ),
      );
    if (!outputIds.has(measurement.outputId))
      diagnostics.push(
        diagnostic(
          "SIMULATION_MEASUREMENT_OUTPUT_UNAVAILABLE",
          input.rootDocumentId,
          `Measurement ${measurement.label} references missing Output ${measurement.outputId}`,
          locator(input.rootDocumentId, [], "document", input.rootDocumentId),
          [measurement.outputId],
        ),
      );
  }

  if (diagnostics.length) return { ok: false, diagnostics };

  // Every reached Cell but the root: the root is instantiated below, not
  // defined. `.global` declarations stay with the definitions.
  const instrumentedIr = instrumentTerminalCurrents(
    ir,
    terminalCurrentInstrumentations,
  );
  const instrumentedRoot = instrumentedIr.cells.find(
    (cell) => cell.id === instrumentedIr.topCellId,
  )!;
  const netlist = printSpiceNetlist({
    ...instrumentedIr,
    cells: instrumentedIr.cells.filter(
      (cell) => cell.id !== instrumentedIr.topCellId,
    ),
  });

  // One write step per analysis. Noise is the exception: one command creates
  // `noise1` (density) and `noise2` (integrated), so both plots are named in
  // the same write. The per-plot-type ordinals are stable because the Setup
  // schema admits at most one Noise analysis.
  const written = [...new Set(writeVectors)];
  const writeCard = [`write ${SIMULATION_RAWFILE_NAME}`, ...written].join(" ");
  const testbench = [
    `* Analog Canvas testbench for ${rootCell.name}`,
    ...printSpiceCellInstances(instrumentedRoot),
    ...(input.environment.temperatureC === undefined
      ? []
      : [`.temp ${spiceNumber(input.environment.temperatureC)}`]),
    ".control",
    "set filetype=ascii",
    ...(analyses.length > 1 ? ["set appendwrite"] : []),
    ...analysisCommands.flatMap(({ kind, command }) => [
      command,
      kind === "noise"
        ? `write ${SIMULATION_RAWFILE_NAME} noise1.all noise2.all`
        : writeCard,
    ]),
    ".endc",
    ".end",
  ].join("\n");

  return {
    ok: true,
    request: {
      netlist,
      testbench: `${testbench}\n`,
      analyses,
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    },
    vectors,
    outputs,
    deviceOperatingPoints,
    measurements: structuredClone(input.measurements ?? []),
    circuit: instrumentedIr,
    captureVectors: written,
    terminalInstrumentations: [...terminalCurrentInstrumentations.values()],
    commands: analysisCommands,
    diagnostics: [],
    warnings: analysis.diagnostics,
  };
}
