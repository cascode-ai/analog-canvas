// The design netlist: the options it reads, the Cells a root reaches, and
// the IR assembled from them with the definitions their calls need.
import {
  deriveStableId,
  componentInterfaceIssues,
  freezeSnapshot,
  isFrozenSnapshot,
} from "@icm/model";
import { lowerTerminalCurrentControls } from "./controlled-current.js";
import {
  deriveProjectNetNameProjection,
  portableCellIdentifier,
  findExternalMasterCollisions,
  libraryPartMaster,
  directObjectLocator,
} from "@icm/derived";
import type { CircuitProject, SchematicDocument, StableId } from "@icm/model";
import {
  ADDER_TARGET,
  IDEAL_COMPARATOR_BODIES,
  IDEAL_OPAMP_BODIES,
  OPTIONAL_PORT_BEHAVIORAL_BODIES,
  adderBodySigns,
  builtInModelContract,
  deviceDescriptor,
  hasCanvasGenericModel,
  drawnMagneticNetwork,
  callsIdealComparatorBody,
  callsIdealDifferentialOpampBody,
  callsIdealOpampBody,
  callsOptionalPortBody,
  idealComparatorBodyPorts,
  idealComparatorBodyContract,
  idealOpampBodyContract,
  isIdealComparatorBody,
  isIdealOpampBody,
  isOptionalPortBody,
  optionalPortBodyPorts,
  instanceBuiltInSubcircuit,
  isGenericBlockTarget,
  callOwner,
  subcircuitDescriptor,
} from "@icm/devices";
import type {
  DesignNetlistCell,
  DesignNetlistAnalysisResult,
  DesignNetlistExternalMaster,
  DesignNetlistInstance,
  DesignNetlistMagneticSubcircuit,
  NetlistDiagnostic,
} from "./ir.js";
import type { NetlistFormat, NetlistNamingProfile } from "./net-name-codec.js";
import { withImplicitMosSupplies } from "./implicit-mos-supplies.js";
import {
  builtInBlockCallTarget,
  idealAnalogBlockCell,
} from "./ideal-analog-block-models.js";
import {
  type ResolvedDesignNetlistAnalysisOptions,
  compareText,
  diagnostic,
} from "./extract-common.js";
import {
  analysisPortRows,
  finalizeCellInterfaces,
  prepareCellInterface,
} from "./extract-interface.js";
import { CLOCKED_SWITCH_TARGETS } from "./ideal-switch-model.js";
import { magneticSubcircuit } from "./extract-magnetic.js";
import {
  authorSubcircuitNames,
  libraryCallCollision,
  outputSubcircuitNames,
  withRetargetBindings,
  writtenBodyName,
} from "./library-part-calls.js";
import { extractCell } from "./extract-cell.js";
import { projectCouplingReferences } from "./extract-coupling.js";
import { collectProjectModelSources } from "./project-model-source.js";
/** A target with a shared generated recipe: logic, multiplier, converters, crystal, amplifier variants. */
function isBehaviouralTarget(target: string): boolean {
  const family = builtInModelContract(target)?.family;
  return (
    family === "logic" ||
    family === "signal" ||
    family === "passive" ||
    family === "amplifier"
  );
}

const MAX_CELLS = 1024;

function attachDiagnosticLocators(
  project: CircuitProject,
  diagnostics: NetlistDiagnostic[],
): void {
  const targets = new Map<StableId, Map<StableId, NetlistDiagnostic[]>>();
  for (const item of diagnostics) {
    const objectId = item.objectIds[0];
    if (!objectId) continue;
    let byObject = targets.get(item.documentId);
    if (!byObject) {
      byObject = new Map();
      targets.set(item.documentId, byObject);
    }
    const items = byObject.get(objectId);
    if (items) items.push(item);
    else byObject.set(objectId, [item]);
  }

  for (const document of project.documents) {
    if (!targets.size) break;
    const remaining = targets.get(document.id);
    if (!remaining) continue;
    targets.delete(document.id);
    // The first matching kind owns the locator, including on a cross-kind ID collision.
    for (const [kind, objects] of [
      ["instance", document.instances],
      ["net", document.nets],
      ["route", document.routes],
      ["junction", document.junctions],
      ["annotation", document.annotations],
      ["no-connect", document.noConnects],
    ] as const) {
      if (!remaining.size) break;
      for (const { id } of objects) {
        const items = remaining.get(id);
        if (!items) continue;
        for (const item of items)
          item.primary = directObjectLocator(document.id, kind, id);
        remaining.delete(id);
        if (!remaining.size) break;
      }
    }
  }
}

function reachableDocuments(
  project: CircuitProject,
  rootDocumentId: StableId,
  diagnostics: NetlistDiagnostic[],
  uncalled = false,
  leaveOut: readonly StableId[] = [],
): SchematicDocument[] {
  const byId = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  if (!byId.has(rootDocumentId)) {
    diagnostic(
      diagnostics,
      project.topDocumentId,
      "MISSING_ROOT_CELL",
      `Simulation root references unknown Document ${rootDocumentId}`,
    );
    return [];
  }
  const ordered: SchematicDocument[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(
    documentId: string,
    parentId?: string,
    instanceId?: string,
  ): void {
    if (visiting.has(documentId)) {
      diagnostic(
        diagnostics,
        parentId ?? documentId,
        "HIERARCHY_CYCLE",
        `Hierarchy cycle reaches Document ${documentId}`,
        instanceId ? [instanceId] : [],
      );
      return;
    }
    if (visited.has(documentId)) return;
    const document = byId.get(documentId);
    if (!document) {
      diagnostic(
        diagnostics,
        parentId ?? rootDocumentId,
        "MISSING_CHILD_CELL",
        `Hierarchy binding references unknown Document ${documentId}`,
        instanceId ? [instanceId] : [],
      );
      return;
    }
    visiting.add(documentId);
    const children = document.instances
      .filter((instance) => instance.netlist?.binding?.kind === "subcircuit")
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const instance of children) {
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit") {
        visit(binding.childDocumentId, document.id, instance.id);
      }
    }
    visiting.delete(documentId);
    visited.add(documentId);
    ordered.push(document);
  }

  visit(rootDocumentId);
  // The Cells the root does not reach come after it, each with the Cells it
  // reaches. One that calls the root is the netlist's top in its place; the
  // file names the root as the editor's (the RNL export's `$CANVAS_TOP`).
  if (uncalled)
    for (const document of project.documents)
      if (!visited.has(document.id) && !leaveOut.includes(document.id))
        visit(document.id);
  if (ordered.length > MAX_CELLS) {
    diagnostic(
      diagnostics,
      rootDocumentId,
      "CELL_LIMIT_EXCEEDED",
      `Reachable hierarchy has ${ordered.length} cells; maximum is ${MAX_CELLS}`,
    );
  }
  return ordered;
}

export interface DesignNetlistAnalysisOptions {
  format?: NetlistFormat;
  namingProfile?: NetlistNamingProfile;
  /** Read-only analysis root. Omission preserves structural-export behavior. */
  rootDocumentId?: StableId;
  /**
   * Whether the root Cell is printed as the deck's own top-level cards rather
   * than as a `.subckt`. It decides one thing about ground, and only one: a
   * Cell printed as a subcircuit states its reference as a `VSS` pin, because
   * whoever instantiates it owns that reference; the Cell printed as the deck
   * itself keeps SPICE's node `0`, because there the deck is the outside and
   * a call passing `0` for a child's `VSS` is what ties the two together.
   */
  rootAsTopLevel?: boolean;
  /**
   * Whether a Cell printed as a `.subckt` states its ground as a `VSS` pin.
   *
   * A block handed to somebody else should say where its reference comes
   * from: `"pin"` gives every such Cell that reaches ground a `VSS` pin
   * beside its supplies, and the one Cell printed as the deck itself keeps
   * node `0`, so its calls tie the two together. `"as-read"` is `"pin"`
   * but for a Cell read from a file whose subcircuit met ground as SPICE's
   * global `0` (`readsGlobalGround`), which prints so again, as it was read:
   * the interchange files (`SPICE+RNL`, `Spectre+RNL`) write what they read.
   * `"global"` — the default — leaves SPICE's global node where it was,
   * which is what an imported deck must round-trip to and what a Snapshot
   * reads.
   */
  groundPin?: GroundPinPolicy;
  /**
   * The text of the source files a run puts beside this netlist: its
   * simulation folder's own files. A model they define for a generic name
   * (DIODE, NPN, PNP) is that run's, so its Cells carry no card for it. A
   * design export carries none; it reads only the SPICE the Project was
   * imported from, so another folder's testbench model never leaves it
   * without one.
   */
  deckSources?: readonly string[];
  /**
   * Whether a run's deck carries the MOS stand-ins (`.model NMOS nmos
   * level=54`) a netlist handed out carries: an ngspice run reads them as
   * that netlist does (#2555). A netlist handed out always carries them.
   */
  mosStandIns?: boolean;
  /**
   * Whether the Cells the root does not reach are printed too, after it, so
   * that a file carries every Cell's drawing (the RNL export, which names
   * the root where a Cell printed beside it calls it).
   */
  uncalledCells?: boolean;
  /** Uncalled Cells not to print, such as one the netlist cannot print. */
  leaveOutCells?: readonly StableId[];
}

/** Ground as the Cell's own pin, or as SPICE's global node. */
export type GroundPinPolicy = "pin" | "as-read" | "global";

/**
 * What a deck this editor runs shares with the netlist it hands out: the same
 * subcircuits, each stating ground as a pin, and one flat root whose node `0`
 * is what ties them to the reference.
 */
export const SIMULATION_DECK_GROUND = {
  groundPin: "pin",
  rootAsTopLevel: true,
} as const satisfies DesignNetlistAnalysisOptions;

/** Allocate dialect names without changing authored references. Reserve existing
 * legal names first so M1 and an imported XM1 remain two distinct devices.
 * The shared IR supplies both exported cards and simulator signal paths.
 */
function projectSpiceReferences(cell: DesignNetlistCell): void {
  const prefixes: Record<DesignNetlistInstance["deviceClass"], string> = {
    mos: "M",
    resistor: "R",
    capacitor: "C",
    inductor: "L",
    diode: "D",
    bjt: "Q",
    jfet: "J",
    "voltage-source": "V",
    "current-source": "I",
    vcvs: "E",
    vccs: "G",
    cccs: "F",
    ccvs: "H",
    switch: "S",
    hierarchical: "X",
    "net-marker": "",
  };
  const prefixFor = (instance: DesignNetlistInstance) =>
    instance.invocationKind === "subcircuit"
      ? "X"
      : prefixes[instance.deviceClass];
  const needsPrefix = (instance: DesignNetlistInstance) =>
    !instance.reference.toUpperCase().startsWith(prefixFor(instance));
  const used = new Set(
    cell.instances
      .filter((instance) => !needsPrefix(instance))
      .map((instance) => instance.reference.toLowerCase()),
  );
  for (const instance of cell.instances) {
    if (!needsPrefix(instance)) continue;
    const base = `${prefixFor(instance)}${instance.reference}`;
    let reference = base;
    for (let suffix = 2; used.has(reference.toLowerCase()); suffix++)
      reference = `${base}_${suffix}`;
    used.add(reference.toLowerCase());
    instance.reference = reference;
  }
}

export function analyzeDesignNetlist(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions = {},
): DesignNetlistAnalysisResult {
  return analyzeSnapshot(project, options, false);
}

/** Incomplete authoring projection only. Export and execution keep the strict entry above. */
export function analyzeDesignNetlistForAuthoring(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions = {},
): DesignNetlistAnalysisResult {
  return analyzeSnapshot(project, options, true);
}

const analysisCache = new WeakMap<
  CircuitProject,
  Map<string, DesignNetlistAnalysisResult>
>();

function cloneAnalysisResult(result: DesignNetlistAnalysisResult) {
  const copy = structuredClone(result);
  const rows = analysisPortRows.get(result);
  if (rows) analysisPortRows.set(copy, rows);
  return copy;
}

function analyzeSnapshot(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions,
  authoring: boolean,
): DesignNetlistAnalysisResult {
  const resolvedOptions: ResolvedDesignNetlistAnalysisOptions = {
    format: options.format ?? "spice",
    namingProfile: options.namingProfile ?? "native",
    rootDocumentId: options.rootDocumentId ?? project.topDocumentId,
    rootAsTopLevel: options.rootAsTopLevel ?? false,
    groundPin: options.groundPin ?? "global",
    deckSources: options.deckSources ?? [],
    mosStandIns: options.mosStandIns ?? false,
    uncalledCells: options.uncalledCells ?? false,
    leaveOutCells: options.leaveOutCells ?? [],
    run: options.deckSources !== undefined,
  };
  // Mutable authoring callers may change a model without advancing a revision.
  // Only owned immutable Project snapshots can share their electrical analysis.
  if (!isFrozenSnapshot(project))
    return analyzeDesign(project, resolvedOptions, authoring);
  const key = JSON.stringify([authoring, resolvedOptions]);
  const cache =
    analysisCache.get(project) ??
    new Map<string, DesignNetlistAnalysisResult>();
  analysisCache.set(project, cache);
  const cached = cache.get(key);
  if (cached) return cloneAnalysisResult(cached);
  const result = analyzeDesign(project, resolvedOptions, authoring);
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(key, freezeSnapshot(cloneAnalysisResult(result)));
  return result;
}

function analyzeDesign(
  project: CircuitProject,
  resolvedOptions: ResolvedDesignNetlistAnalysisOptions,
  authoring: boolean,
): DesignNetlistAnalysisResult {
  const interfaceDiagnostics: NetlistDiagnostic[] = [];
  for (const definition of project.componentDefinitions ?? []) {
    const callerDocument = project.documents.find((document) =>
      document.instances.some(
        (instance) => instance.symbolId === definition.symbol.id,
      ),
    );
    for (const issue of componentInterfaceIssues(definition))
      diagnostic(
        interfaceDiagnostics,
        callerDocument?.id ?? resolvedOptions.rootDocumentId,
        "INVALID_COMPONENT_INTERFACE",
        `Component ${definition.symbol.id}: ${issue.message}`,
        callerDocument?.instances
          .filter((instance) => instance.symbolId === definition.symbol.id)
          .map((instance) => instance.id) ?? [],
      );
  }
  if (interfaceDiagnostics.length)
    return { ir: null, diagnostics: interfaceDiagnostics };
  const authoredDocuments = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const projection = withImplicitMosSupplies(
    withRetargetBindings(project),
    resolvedOptions,
  );
  project = projection.project;
  const diagnostics: NetlistDiagnostic[] = [];
  const documents = reachableDocuments(
    project,
    resolvedOptions.rootDocumentId,
    diagnostics,
    resolvedOptions.uncalledCells,
    resolvedOptions.leaveOutCells,
  );
  const nameProjection = deriveProjectNetNameProjection(
    resolvedOptions.rootDocumentId === project.topDocumentId
      ? project
      : { ...project, topDocumentId: resolvedOptions.rootDocumentId },
  );
  const documentsById = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const interfaces = new Map(
    project.documents.map((document) => [
      document.id,
      prepareCellInterface(
        document,
        authoredDocuments.get(document.id) ?? document,
      ),
    ]),
  );
  const cellNameByDocumentId = new Map<string, string>();
  const cellNames = new Map<
    string,
    { documentId: string; authoredName: string }
  >();
  for (const document of documents) {
    const authoredName = document.netlist?.name;
    if (!authoredName) continue;
    const exportName = portableCellIdentifier(authoredName, document.id);
    cellNameByDocumentId.set(document.id, exportName);
    if (exportName !== authoredName) {
      diagnostic(
        diagnostics,
        document.id,
        "CELL_NAME_NORMALIZED",
        `Cell name ${authoredName} exports as ${exportName}`,
        [document.id],
        "warning",
      );
    }
    const folded = exportName.toLowerCase();
    const prior = cellNames.get(folded);
    if (prior) {
      diagnostic(
        diagnostics,
        document.id,
        "DUPLICATE_CELL_NAME",
        `Cell names ${prior.authoredName} and ${authoredName} both export as ${exportName} under case folding`,
        [prior.documentId, document.id],
      );
    } else {
      cellNames.set(folded, { documentId: document.id, authoredName });
    }
  }
  const cells: DesignNetlistCell[] = [];
  for (const collision of findExternalMasterCollisions(project, documents)) {
    diagnostic(
      diagnostics,
      collision.documentId,
      "MASTER_NAME_COLLISION",
      `External master ${collision.masterName} conflicts with local Cell ${collision.localName}; choose distinct exported master names`,
      [collision.instanceId],
    );
  }
  const ownedDeviceModels = new Set<string>();
  if (
    !resolvedOptions.run &&
    project.modelSources?.length &&
    documents.some((document) => document.instances.some(hasCanvasGenericModel))
  ) {
    const definitionIds = new Set<string>();
    for (const document of documents)
      for (const { netlist } of document.instances)
        if (netlist?.binding?.kind === "external-subcircuit")
          definitionIds.add(netlist.binding.definitionId);
    const { globalModelNames } = collectProjectModelSources(project, [
      ...definitionIds,
    ]);
    for (const name of globalModelNames)
      ownedDeviceModels.add(name.toLowerCase().replace(/\.\d+$/u, ""));
  }
  for (const document of documents) {
    let cell = extractCell(
      project,
      document,
      documentsById,
      interfaces,
      cellNameByDocumentId,
      nameProjection.byDocumentId.get(document.id) ?? new Map(),
      projection.placedBodies.get(document.id),
      ownedDeviceModels,
      resolvedOptions,
      diagnostics,
    );
    if (cell) {
      const lowered = lowerTerminalCurrentControls(cell);
      cell = lowered.cell;
      for (const issue of lowered.issues)
        diagnostic(
          diagnostics,
          document.id,
          "INVALID_CONTROL_TERMINAL",
          issue.message,
          [issue.instanceId, issue.targetId],
        );
      if (resolvedOptions.format === "spice") projectSpiceReferences(cell);
      projectCouplingReferences(cell, resolvedOptions.format);
      for (const instance of cell.instances) {
        if (!instance.controlSourceInstanceId) continue;
        const sensor = cell.instances.find(
          (candidate) => candidate.id === instance.controlSourceInstanceId,
        );
        if (sensor) instance.controlSourceReference = sensor.reference;
      }
      cells.push(cell);
    }
  }
  const portRows = finalizeCellInterfaces(
    cells,
    documentsById,
    interfaces,
    resolvedOptions,
  );
  // Each kind of drawn magnetic device calls one coupled-winding subcircuit,
  // defined once in the file under the library's name, which yields to an
  // author's definition of that name like every generated body below. One
  // bound to a Cell or external definition calls that instead (#1928).
  const magneticSubcircuits = new Map<
    string,
    DesignNetlistMagneticSubcircuit
  >();
  for (const document of documents) {
    for (const instance of document.instances) {
      const definition = deviceDescriptor(instance.symbolId, project);
      const network = definition ? drawnMagneticNetwork(definition) : null;
      if (!definition || !network || callOwner(project, instance) === "bound")
        continue;
      if (!magneticSubcircuits.has(network.subcircuit))
        magneticSubcircuits.set(
          network.subcircuit,
          magneticSubcircuit(network, definition),
        );
    }
  }
  // A subcircuit descriptor is only a call contract. Logic symbols and other
  // manually mapped blocks may expose a target without providing any emitted
  // definition. Keep the export truthful: a ready netlist must either reach a
  // Cell, an explicitly declared external master, or one of the generated
  // built-in models below.
  // Whose name each call reaches (callOwner): a Library part's, a magnetic
  // device's, the chopper's or the SPDT's never reaches the author's by name
  // (#1928).
  const sourceOf = (cellId: StableId, instanceId: StableId) =>
    documentsById
      .get(cellId)
      ?.instances.find((candidate) => candidate.id === instanceId);
  const ownerOf = (cellId: StableId, instanceId: StableId) => {
    const source = sourceOf(cellId, instanceId);
    return source ? callOwner(project, source) : "library";
  };
  const libraryCall = (cellId: StableId, instanceId: StableId) =>
    ownerOf(cellId, instanceId) === "library";
  // The author's names across the Project, which generated bodies yield, and
  // in this output, which a call-only name refuses (#1928).
  const owners = authorSubcircuitNames(project);
  const outputOwners = outputSubcircuitNames(project, documents);
  const availableSubcircuits = new Set([
    ...cells.map((cell) => cell.name.toLowerCase()),
    ...project.externalSubcircuitDefinitions.map((definition) =>
      definition.name.toLowerCase(),
    ),
    ...Array.from(magneticSubcircuits.keys(), (name) => name.toLowerCase()),
    // Only the ideal comparator has generated bodies. A comparator placed
    // today is bound to it; one with no binding (an older drawing) falls
    // back to the bare target `comparator`, which nothing defines unless
    // the Project declares an external definition of that name.
    ...IDEAL_COMPARATOR_BODIES,
    ...IDEAL_OPAMP_BODIES,
    ...OPTIONAL_PORT_BEHAVIORAL_BODIES,
  ]);
  for (const cell of cells) {
    for (const instance of cell.instances) {
      if (
        instance.invocationKind !== "subcircuit" ||
        !instance.target ||
        ownerOf(cell.id, instance.id) === "bound"
      )
        continue;
      const generated = libraryCall(cell.id, instance.id);
      const sourceInstance = sourceOf(cell.id, instance.id);
      const descriptor = sourceInstance
        ? subcircuitDescriptor(sourceInstance.symbolId, project)
        : undefined;
      const target = instance.target.toLowerCase();
      const emittedPorts = isIdealComparatorBody(target)
        ? idealComparatorBodyContract(target).ports
        : isIdealOpampBody(target)
          ? idealOpampBodyContract(target).ports
          : isOptionalPortBody(target)
            ? optionalPortBodyPorts(target)
            : builtInModelContract(
                adderBodySigns(target) ? ADDER_TARGET : target,
              )?.ports;
      // An optional port is in the call only while its pin has a Net.
      const callPorts = (
        descriptor && callsIdealComparatorBody(descriptor, target)
          ? idealComparatorBodyPorts(target, descriptor.ports)
          : descriptor?.ports
      )?.filter(
        (port) =>
          !port.optional ||
          instance.nodes.some((node) => node.pinName === port.name),
      );
      // A generated body has a fixed positional interface. A User
      // Component's own subcircuit answers only to its own declared master,
      // not to the unrelated built-in body with the same target spelling.
      if (
        emittedPorts &&
        descriptor &&
        generated &&
        (instance.nodes.length !== emittedPorts.length ||
          instance.nodes.some(
            (node, index) => node.pinName !== emittedPorts[index]?.name,
          ) ||
          callPorts?.some(
            (port, index) =>
              port.pinName !== emittedPorts[index]?.pinName ||
              port.supply !== emittedPorts[index]?.supply,
          ))
      )
        diagnostic(
          diagnostics,
          cell.id,
          "COMPONENT_MODEL_INTERFACE_MISMATCH",
          `${instance.reference} calls built-in ${instance.target} with a different ordered interface; restore its interface or declare a custom target`,
          [instance.id],
        );
      // A backend's call-only contract still exports: the call is written,
      // and a warning says the reader's libraries must define it. Such a
      // name, and a master a part was retargeted to that only a model source
      // defines, is the reader's interface and cannot move: where the
      // author's definition has it, the part refuses rather than reach that
      // definition by position (#1928).
      const callOnly =
        builtInModelContract(instance.target)?.backends[
          resolvedOptions.format
        ] === "external";
      const collision =
        generated && sourceInstance
          ? callOnly
            ? libraryCallCollision(
                { reference: instance.reference, target: instance.target },
                outputOwners.get(target),
                "call-only",
                resolvedOptions.format,
              )
            : libraryPartMaster(project, sourceInstance)
              ? libraryCallCollision(
                  { reference: instance.reference, target: instance.target },
                  owners.get(target),
                  "undeclared",
                  resolvedOptions.format,
                )
              : undefined
          : undefined;
      if (collision) {
        diagnostic(
          diagnostics,
          cell.id,
          "LIBRARY_PART_NAME_COLLISION",
          collision,
          [instance.id],
        );
        continue;
      }
      // A Library part's call-only name that no definition in this output
      // has is always left to the reader's libraries.
      if (callOnly && (generated || !availableSubcircuits.has(target))) {
        // A generic block has no body in any netlist (#2445).
        if (isGenericBlockTarget(instance.target))
          diagnostic(
            diagnostics,
            cell.id,
            "GENERIC_BLOCK_UNDEFINED",
            `${instance.reference} calls ${instance.target}, a generic block no netlist here defines: name the subcircuit it stands for with set-model, or bind it to a Cell`,
            [instance.id],
            "warning",
          );
        else
          diagnostic(
            diagnostics,
            cell.id,
            "SPECTRE_MODEL_NOT_INCLUDED",
            `${instance.reference} calls ${instance.target}, which this Spectre export does not define: bind it to a cell from your libraries, a PDK standard cell or a Verilog-A model for example. A SPICE export includes an ideal ${instance.target}`,
            [instance.id],
            "warning",
          );
        continue;
      }
      // An explicitly retargeted unresolved subcircuit is an intentional
      // external contract. Diagnose only the descriptor's default target,
      // where the registry promises a built-in model that must be emitted.
      if (
        !descriptor ||
        descriptor.target.toLowerCase() !== instance.target.toLowerCase()
      )
        continue;
      if (availableSubcircuits.has(target)) continue;
      if (idealAnalogBlockCell(instance.target, resolvedOptions.format)) {
        availableSubcircuits.add(target);
        continue;
      }
      // A placed logic gate, flip-flop, multiplier or converter gets a
      // generated ideal body.
      if (
        isBehaviouralTarget(instance.target) &&
        builtInModelContract(instance.target)?.backends[
          resolvedOptions.format
        ] === "included"
      ) {
        availableSubcircuits.add(target);
        continue;
      }
      diagnostic(
        diagnostics,
        cell.id,
        "UNDEFINED_SUBCIRCUIT_TARGET",
        target === "comparator"
          ? `Comparator ${instance.reference} has no model: nothing defines the subcircuit comparator. Replace it from the Library (a placed comparator uses the built-in ideal comparator) or add an external definition named comparator before exporting`
          : `Subcircuit target ${instance.target} used by ${instance.reference} has no emitted definition or external model; bind one before exporting`,
        [instance.id],
      );
    }
  }
  // Each generated body in use is printed once, under its own name or, where
  // one of the author's definitions takes that, the reserved one (#1928).
  const generatedTargets = new Set(
    cells.flatMap((cell) =>
      cell.instances.flatMap((call) =>
        call.invocationKind === "subcircuit" &&
        call.target &&
        libraryCall(cell.id, call.id)
          ? [call.target]
          : [],
      ),
    ),
  );
  const idealCells = [...generatedTargets]
    .sort(compareText)
    .flatMap((target) => {
      const model = idealAnalogBlockCell(target, resolvedOptions.format);
      return model ? [model] : [];
    });
  const behaviouralBodies = [...generatedTargets]
    .filter(
      (target) =>
        isBehaviouralTarget(target) &&
        builtInModelContract(target)?.backends[resolvedOptions.format] ===
          "included",
    )
    .sort(compareText);
  const ownBodies = [
    ...IDEAL_COMPARATOR_BODIES,
    ...IDEAL_OPAMP_BODIES,
    ...OPTIONAL_PORT_BEHAVIORAL_BODIES,
    ...CLOCKED_SWITCH_TARGETS,
  ].filter((name) => generatedTargets.has(name));
  const writtenNames = new Map<string, string>();
  for (const body of [
    ...idealCells.map((model) => model.name),
    ...ownBodies,
    ...behaviouralBodies,
    ...magneticSubcircuits.keys(),
  ]) {
    const written = writtenBodyName(body, owners);
    if (written.ok) {
      if (written.name !== body) writtenNames.set(body, written.name);
      continue;
    }
    for (const cell of cells)
      for (const call of cell.instances)
        if (call.target === body && libraryCall(cell.id, call.id))
          diagnostic(
            diagnostics,
            cell.id,
            "LIBRARY_PART_NAME_COLLISION",
            `${call.reference}'s ${written.message}`,
            [call.id],
          );
  }
  diagnostics.sort(
    (left, right) =>
      left.documentId.localeCompare(right.documentId) ||
      left.code.localeCompare(right.code) ||
      left.objectIds
        .join("\u0000")
        .localeCompare(right.objectIds.join("\u0000")),
  );
  attachDiagnosticLocators(project, diagnostics);
  if (!authoring && diagnostics.some((item) => item.severity === "error")) {
    return { ir: null, diagnostics };
  }
  const globals = [
    ...new Set(
      cells.flatMap((cell) =>
        cell.nets
          .filter((net) => net.scope === "global")
          .map((net) => net.name),
      ),
    ),
  ].sort(compareText);
  const externalMasters = new Map<string, DesignNetlistExternalMaster>();
  for (const instance of documents.flatMap((document) => document.instances)) {
    const binding = instance.netlist?.binding;
    if (binding?.kind === "external-subcircuit") {
      const definition = project.externalSubcircuitDefinitions.find(
        (item) => item.id === binding.definitionId,
      );
      if (definition) {
        externalMasters.set(`external:${definition.id}`, {
          id: definition.id,
          ...(definition.implementation
            ? { implementationKind: definition.implementation.kind }
            : {}),
          name: definition.name,
          terminals: definition.terminals.map((terminal) => ({
            id: terminal.id,
            name: terminal.name,
            direction: terminal.direction,
          })),
          formalParameters: definition.formalParameters.map((parameter) => ({
            name: parameter.name,
            ...(parameter.defaultValue === undefined
              ? {}
              : { defaultValue: parameter.defaultValue }),
          })),
        });
      }
    }
    const descriptor = instanceBuiltInSubcircuit(project, instance);
    if (!descriptor) continue;
    const target = builtInBlockCallTarget(instance, descriptor);
    if (callsIdealComparatorBody(descriptor, target)) continue;
    // A Library part's generated body is printed below, not called as an
    // external master; a User Component's own subcircuit is one.
    if (
      callOwner(project, instance) === "library" &&
      (callsIdealOpampBody(descriptor, target) ||
        callsIdealDifferentialOpampBody(descriptor, target) ||
        callsOptionalPortBody(descriptor, target) ||
        idealCells.some((model) => model.name === target) ||
        behaviouralBodies.includes(target))
    )
      continue;
    externalMasters.set(`builtin:${target.toLowerCase()}`, {
      id: descriptor.id,
      name: target,
      terminals: descriptor.ports.map((port, index) => ({
        id: deriveStableId(
          "built-in-subcircuit-port",
          descriptor.id,
          String(index),
        ),
        name: port.name,
        direction: port.direction,
      })),
      formalParameters: [],
    });
  }
  // Generated bodies and their calls take the names chosen above.
  const written = (name: string) => writtenNames.get(name);
  for (const cell of cells)
    for (const call of cell.instances) {
      const name = call.target && written(call.target);
      if (name && libraryCall(cell.id, call.id)) call.target = name;
    }
  const behavioral = (name: string) => {
    const as = written(name);
    return as
      ? { kind: "behavioral" as const, name: as, body: name }
      : { kind: "behavioral" as const, name };
  };
  const result: DesignNetlistAnalysisResult = {
    ir: {
      topCellId: resolvedOptions.rootDocumentId,
      cells: [
        ...idealCells.map((model) => {
          const as = written(model.name);
          return as ? { ...model, name: as, body: model.name } : model;
        }),
        ...cells,
      ],
      generatedDefinitions: [
        ...ownBodies.map(behavioral),
        ...behaviouralBodies.map(behavioral),
        ...[...magneticSubcircuits.values()]
          .sort((left, right) => compareText(left.name, right.name))
          .map((network) => ({
            ...network,
            name: written(network.name) ?? network.name,
          })),
      ],
      globals,
      externalMasters: [...externalMasters.values()].sort((left, right) =>
        compareText(left.name, right.name),
      ),
    },
    diagnostics,
  };
  analysisPortRows.set(result, portRows);
  return result;
}
