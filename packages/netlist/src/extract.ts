// The design netlist: the options it reads, the Cells a root reaches, and
// the IR assembled from them with the definitions their calls need.
import { deriveStableId, componentInterfaceIssues } from "@icm/model";
import { lowerTerminalCurrentControls } from "./controlled-current.js";
import {
  deriveProjectNetNameProjection,
  portableCellIdentifier,
  findExternalMasterCollisions,
  directObjectLocator,
  drawnMagneticNetwork,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { CircuitProject, SchematicDocument, StableId } from "@icm/model";
import {
  ADDER_TARGET,
  IDEAL_COMPARATOR_BODIES,
  IDEAL_OPAMP_BODIES,
  OPAMP_TARGET,
  adderBodySigns,
  builtInModelContract,
  deviceDescriptor,
  callsIdealComparatorBody,
  callsIdealOpampBody,
  idealComparatorBodyPorts,
  idealComparatorBodyContract,
  idealOpampBodyContract,
  isIdealComparatorBody,
  isIdealOpampBody,
  instanceBuiltInSubcircuit,
  subcircuitDescriptor,
  type BuiltInSubcircuitDescriptor,
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
  projectSubcircuitNames,
} from "./ideal-analog-block-models.js";
import {
  type ResolvedDesignNetlistAnalysisOptions,
  compareText,
  diagnostic,
} from "./extract-common.js";
import { withNetlistPowerMarkerClaims } from "./extract-nets.js";
import { bubblePhasePins } from "./extract-switch.js";
import { magneticSubcircuit } from "./extract-magnetic.js";
import { extractCell } from "./extract-cell.js";
/** A target with a shared generated recipe: logic, multiplier, converters. */
function isBehaviouralTarget(target: string): boolean {
  const family = builtInModelContract(target)?.family;
  return family === "logic" || family === "signal";
}

const MAX_CELLS = 1024;

function attachDiagnosticLocators(
  project: CircuitProject,
  diagnostics: NetlistDiagnostic[],
): void {
  for (const item of diagnostics) {
    const document = project.documents.find(
      (candidate) => candidate.id === item.documentId,
    );
    if (!document) continue;
    const objectId = item.objectIds[0];
    if (!objectId) continue;
    const kind = document.instances.some((item) => item.id === objectId)
      ? "instance"
      : document.nets.some((item) => item.id === objectId)
        ? "net"
        : document.routes.some((item) => item.id === objectId)
          ? "route"
          : document.junctions.some((item) => item.id === objectId)
            ? "junction"
            : document.annotations.some((item) => item.id === objectId)
              ? "annotation"
              : document.noConnects.some((item) => item.id === objectId)
                ? "no-connect"
                : null;
    if (kind) item.primary = directObjectLocator(document.id, kind, objectId);
  }
}

function reachableDocuments(
  project: CircuitProject,
  rootDocumentId: StableId,
  diagnostics: NetlistDiagnostic[],
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
   * node `0`, so its calls tie the two together. `"global"` — the default —
   * leaves SPICE's global node where it was, which is what an imported deck
   * must round-trip to and what a Snapshot reads.
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
}

/** Ground as the Cell's own pin, or as SPICE's global node. */
export type GroundPinPolicy = "pin" | "global";

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
  return analyzeDesign(project, options, false);
}

/** Incomplete authoring projection only. Export and execution keep the strict entry above. */
export function analyzeDesignNetlistForAuthoring(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions = {},
): DesignNetlistAnalysisResult {
  return analyzeDesign(project, options, true);
}

function analyzeDesign(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions,
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
        callerDocument?.id ?? options.rootDocumentId ?? project.topDocumentId,
        "INVALID_COMPONENT_INTERFACE",
        `Component ${definition.symbol.id}: ${issue.message}`,
        callerDocument?.instances
          .filter((instance) => instance.symbolId === definition.symbol.id)
          .map((instance) => instance.id) ?? [],
      );
  }
  if (interfaceDiagnostics.length)
    return { ir: null, diagnostics: interfaceDiagnostics };
  const resolvedOptions: ResolvedDesignNetlistAnalysisOptions = {
    format: options.format ?? "spice",
    namingProfile: options.namingProfile ?? "native",
    rootDocumentId: options.rootDocumentId ?? project.topDocumentId,
    rootAsTopLevel: options.rootAsTopLevel ?? false,
    groundPin: options.groundPin ?? "global",
    deckSources: options.deckSources ?? [],
  };
  const projection = withImplicitMosSupplies(project, resolvedOptions);
  project = projection.project;
  const diagnostics: NetlistDiagnostic[] = [];
  const documents = reachableDocuments(
    project,
    resolvedOptions.rootDocumentId,
    diagnostics,
  );
  const nameProjection = deriveProjectNetNameProjection(
    resolvedOptions.rootDocumentId === project.topDocumentId
      ? project
      : { ...project, topDocumentId: resolvedOptions.rootDocumentId },
  );
  const documentsById = new Map(
    project.documents.map((document) => [document.id, document]),
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
  // The names this export defines itself, which no generated body takes:
  // its Cells and the Project's external definitions.
  const projectNames = projectSubcircuitNames(
    project,
    cellNameByDocumentId.values(),
  );
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
  for (const document of documents) {
    let cell = extractCell(
      project,
      document,
      documentsById,
      cellNameByDocumentId,
      projectNames,
      nameProjection.byDocumentId.get(document.id) ?? new Map(),
      projection.placedBodies.get(document.id),
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
  bubblePhasePins(cells, documentsById, resolvedOptions);
  // Each kind of drawn magnetic device calls one coupled-winding subcircuit,
  // defined once in the file under the library's name. A Cell or external
  // subcircuit already exporting that name would make the call ambiguous.
  const magneticSubcircuits = new Map<
    string,
    DesignNetlistMagneticSubcircuit
  >();
  const externalNames = new Map(
    project.externalSubcircuitDefinitions.map((definition) => [
      definition.name.toLowerCase(),
      definition.name,
    ]),
  );
  for (const document of documents) {
    for (const instance of document.instances) {
      const definition = deviceDescriptor(instance.symbolId, project);
      const network = definition ? drawnMagneticNetwork(definition) : null;
      if (!definition || !network) continue;
      const name = network.subcircuit;
      const cell = cellNames.get(name);
      const external = externalNames.get(name);
      if (cell || external) {
        diagnostic(
          diagnostics,
          document.id,
          "MAGNETIC_SUBCIRCUIT_NAME_COLLISION",
          `${instance.reference ?? instance.id} calls the built-in ${name} subcircuit, but ${cell ? `Cell ${cell.authoredName}` : `external subcircuit ${external}`} also exports as ${name}; rename it`,
          [instance.id],
        );
        continue;
      }
      if (!magneticSubcircuits.has(name))
        magneticSubcircuits.set(name, magneticSubcircuit(network, definition));
    }
  }
  // Each generated comparator or op-amp body reserves its name while such a
  // block is used, whichever body its parameters choose: a Cell or an
  // external subcircuit of that name would shadow it. The op-amp's own name
  // is not one: a Project defining `opamp` replaces every body.
  for (const reserved of [
    {
      names: IDEAL_COMPARATOR_BODIES,
      calls: callsIdealComparatorBody,
      code: "IDEAL_COMPARATOR_NAME_COLLISION",
      block: "Ideal comparator",
    },
    {
      names: IDEAL_OPAMP_BODIES.filter((name) => name !== OPAMP_TARGET),
      calls: (descriptor: BuiltInSubcircuitDescriptor, target: string) =>
        callsIdealOpampBody(descriptor, target) &&
        !projectNames.has(target.toLowerCase()),
      code: "IDEAL_OPAMP_NAME_COLLISION",
      block: "Ideal op-amp",
    },
  ]) {
    const conflicts = reserved.names.flatMap((name) => {
      const cell = cellNames.get(name);
      const external = externalNames.get(name);
      return cell || external
        ? [
            `${cell ? `Cell ${cell.authoredName}` : `external subcircuit ${external}`} named ${name}`,
          ]
        : [];
    });
    if (!conflicts.length) continue;
    for (const document of documents) {
      for (const instance of document.instances) {
        const descriptor = subcircuitDescriptor(instance.symbolId, project);
        if (
          !descriptor ||
          !reserved.calls(
            descriptor,
            builtInBlockCallTarget(instance, descriptor, projectNames),
          )
        )
          continue;
        for (const conflict of conflicts)
          diagnostic(
            diagnostics,
            document.id,
            reserved.code,
            `${reserved.block} ${instance.reference ?? instance.id} conflicts with ${conflict}`,
            [instance.id],
          );
      }
    }
  }
  if (resolvedOptions.groundPin === "pin") {
    // Supply markers share identity inside the drawing. Once that supply is
    // exposed by a module pin, its exported node belongs to that module:
    // callers pass it explicitly instead of also reaching for a global.
    for (const cell of cells) {
      if (
        resolvedOptions.rootAsTopLevel &&
        cell.id === resolvedOptions.rootDocumentId
      )
        continue;
      const logical = resolveDocumentLogicalNets(
        withNetlistPowerMarkerClaims(documentsById.get(cell.id)!),
      );
      const rank = (port: DesignNetlistCell["ports"][number]) => {
        const domain = logical.byBaseNetId.get(port.id)?.powerDomain;
        if (domain === "vdd" || port.name.toUpperCase() === "VDD") return 0;
        if (domain === "ground" || port.name.toUpperCase() === "VSS") return 1;
        return 2;
      };
      for (const port of cell.ports) {
        if (rank(port) === 2) continue;
        const net = cell.nets.find(
          (candidate) => candidate.name === port.netName,
        );
        if (net) net.scope = "local";
      }
      cell.ports.sort((left, right) => rank(left) - rank(right));
    }
    // Port order is positional in both SPICE and Spectre. Reorder internal
    // calls from the final child interface; external PDK pin order is untouched.
    const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
    for (const cell of cells) {
      const document = documentsById.get(cell.id)!;
      const bindings = new Map(
        document.instances.map((instance) => [
          instance.id,
          instance.netlist?.binding,
        ]),
      );
      for (const instance of cell.instances) {
        const binding = bindings.get(instance.id);
        if (binding?.kind !== "subcircuit") continue;
        const child = cellsById.get(binding.childDocumentId);
        if (!child) continue;
        const order = new Map(
          child.ports.map((port, index) => [port.name, index]),
        );
        instance.nodes.sort(
          (left, right) =>
            (order.get(left.pinName) ?? Infinity) -
            (order.get(right.pinName) ?? Infinity),
        );
      }
    }
  }
  // A subcircuit descriptor is only a call contract. Logic symbols and other
  // manually mapped blocks may expose a target without providing any emitted
  // definition. Keep the export truthful: a ready netlist must either reach a
  // Cell, an explicitly declared external master, or one of the generated
  // built-in models below.
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
  ]);
  for (const cell of cells) {
    for (const instance of cell.instances) {
      if (instance.invocationKind !== "subcircuit" || !instance.target)
        continue;
      const sourceInstance = documentsById
        .get(cell.id)
        ?.instances.find((candidate) => candidate.id === instance.id);
      const descriptor = sourceInstance
        ? subcircuitDescriptor(sourceInstance.symbolId, project)
        : undefined;
      const target = instance.target.toLowerCase();
      const emittedPorts = isIdealComparatorBody(target)
        ? idealComparatorBodyContract(target).ports
        : isIdealOpampBody(target)
          ? idealOpampBodyContract(target).ports
          : builtInModelContract(adderBodySigns(target) ? ADDER_TARGET : target)
              ?.ports;
      const callPorts =
        descriptor && callsIdealComparatorBody(descriptor, target)
          ? idealComparatorBodyPorts(target, descriptor.ports)
          : descriptor?.ports;
      // A generated body has a fixed positional interface. A Project-local
      // replacement is valid only against its own declared master, not the
      // unrelated built-in body with the same target spelling.
      if (
        emittedPorts &&
        descriptor &&
        !projectNames.has(target) &&
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
      // and a warning says the reader's libraries must define it.
      if (
        builtInModelContract(instance.target)?.backends[
          resolvedOptions.format
        ] === "external" &&
        !availableSubcircuits.has(target)
      ) {
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
    const target = builtInBlockCallTarget(instance, descriptor, projectNames);
    if (callsIdealComparatorBody(descriptor, target)) continue;
    if (
      callsIdealOpampBody(descriptor, target) &&
      !projectNames.has(target.toLowerCase())
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
  // A default Analog Block call gets one actual idealized E/G-source master.
  // Authored Cells and explicit external master interfaces (projectNames)
  // retain priority; an instance retargeted to another subcircuit never
  // receives this model.
  const idealCells = [
    ...new Set(
      cells.flatMap((cell) =>
        cell.instances
          .filter(
            (instance) =>
              instance.invocationKind === "subcircuit" && instance.target,
          )
          .map((instance) => instance.target!),
      ),
    ),
  ]
    .sort(compareText)
    .flatMap((target) => {
      if (projectNames.has(target.toLowerCase())) return [];
      const model = idealAnalogBlockCell(target, resolvedOptions.format);
      return model ? [model] : [];
    });
  for (const model of idealCells)
    externalMasters.delete(`builtin:${model.name.toLowerCase()}`);
  // Each generated body in use (logic, multiplier, converters) is printed
  // once, unless an authored Cell or a declared external definition already
  // owns its name.
  const behaviouralBodies = [
    ...new Set(
      cells.flatMap((cell) =>
        cell.instances.flatMap((instance) =>
          instance.invocationKind === "subcircuit" &&
          instance.target &&
          isBehaviouralTarget(instance.target) &&
          builtInModelContract(instance.target)?.backends[
            resolvedOptions.format
          ] === "included" &&
          !projectNames.has(instance.target.toLowerCase())
            ? [instance.target]
            : [],
        ),
      ),
    ),
  ].sort(compareText);
  for (const target of behaviouralBodies)
    externalMasters.delete(`builtin:${target.toLowerCase()}`);
  return {
    ir: {
      topCellId: resolvedOptions.rootDocumentId,
      cells: [...idealCells, ...cells],
      generatedDefinitions: [
        ...[...IDEAL_COMPARATOR_BODIES, ...IDEAL_OPAMP_BODIES]
          .filter(
            (name) =>
              !projectNames.has(name.toLowerCase()) &&
              cells.some((cell) =>
                cell.instances.some((instance) => instance.target === name),
              ),
          )
          .map((name) => ({ kind: "behavioral" as const, name })),
        ...behaviouralBodies.map((name) => ({
          kind: "behavioral" as const,
          name,
        })),
        ...[...magneticSubcircuits.values()].sort((left, right) =>
          compareText(left.name, right.name),
        ),
      ],
      globals,
      externalMasters: [...externalMasters.values()].sort((left, right) =>
        compareText(left.name, right.name),
      ),
    },
    diagnostics,
  };
}
