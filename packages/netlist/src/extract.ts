import {
  deriveStableId,
  foldNetName,
  projectCellInterface,
  routeEndpoints,
  spellGreekLetters,
} from "@icm/model";
import { lowerTerminalCurrentControls } from "./controlled-current.js";
import {
  deriveProjectNetNameProjection,
  portableCellIdentifier,
  findExternalMasterCollisions,
  directObjectLocator,
  drawnMagneticNetwork,
  drawnMagneticParameters,
  drawnSupplyNet,
  drawnSwitchControl,
  drawnSwitchPhase,
  mosBodiesOffSourceSupply,
  mosBulkKind,
  resolveMosBulkConnection,
  resolveDocumentLogicalNets,
  type DrawnMagneticNetwork,
  type PlacedMosBodies,
  type ProjectedNetName,
  type ResolvedDocumentLogicalNets,
  type ResolvedLogicalNet,
} from "@icm/derived";
import type {
  CircuitProject,
  ConnectivityEvidence,
  ExternalSubcircuitDefinition,
  Instance,
  SchematicDocument,
  StableId,
} from "@icm/model";
import {
  ADDER_SIGNED_INPUTS,
  ADDER_TARGET,
  IDEAL_COMPARATOR_TARGET,
  adderInputSigns,
  builtInModelContract,
  createReferenceIndex,
  deviceDescriptor,
  instanceBuiltInSubcircuit,
  nextReference,
  projectLengthToSky130Micrometres,
  requiredParameterNames,
  resolveReviewedExternalBinding,
  reviewedExternalBindingForMaster,
  subcircuitDescriptor,
  type BuiltInSubcircuitDescriptor,
  type DeviceDescriptor,
} from "@icm/devices";
import { parseSpiceNumber } from "@icm/spice";

import type {
  DesignNetlistCell,
  DesignNetlistAnalysisResult,
  DesignNetlistExternalMaster,
  DesignNetlistInstance,
  DesignNetlistMagneticSubcircuit,
  DesignNetlistModel,
  NetlistDiagnostic,
} from "./ir.js";
import {
  encodedNetNameCollisionKey,
  encodeNetName,
  type EncodedNetName,
  type NetlistFormat,
  type NetlistNamingProfile,
} from "./net-name-codec.js";
import { normalizeIndependentSource } from "./source-waveform.js";
import {
  bodyIgnoresSupplies,
  implicitSupplyNetId,
  withImplicitMosSupplies,
} from "./implicit-mos-supplies.js";
import {
  builtInBlockCallTarget,
  idealAnalogBlockCell,
  projectSubcircuitNames,
} from "./ideal-analog-block-models.js";
import { IDEAL_SWITCH_MODEL } from "./ideal-switch-model.js";
export { IDEAL_SWITCH_MODEL } from "./ideal-switch-model.js";

/** A target with a shared generated recipe: logic, multiplier, converters. */
function isBehaviouralTarget(target: string): boolean {
  const family = builtInModelContract(target)?.family;
  return family === "logic" || family === "signal";
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_CELLS = 1024;
const MAX_INSTANCES_PER_CELL = 100_000;
const MAX_NETS_PER_CELL = 100_000;

function builtInZenerModelName(reference: string): string {
  return `icm_zener_${reference}`;
}

function zenerParameter(
  instance: Instance,
  name: "bv" | "ibv",
): string | undefined {
  return Object.entries(instance.netlist?.parameters ?? {}).find(
    ([candidate]) => candidate.toLowerCase() === name,
  )?.[1];
}

function isIdentifier(value: string, allowGround = false): boolean {
  return (allowGround && value === "0") || IDENTIFIER.test(value);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function diagnostic(
  diagnostics: NetlistDiagnostic[],
  documentId: StableId,
  code: string,
  message: string,
  objectIds: StableId[] = [],
  severity: NetlistDiagnostic["severity"] = "error",
  parameter?: string,
): void {
  diagnostics.push({
    code,
    severity,
    documentId,
    objectIds,
    primary: directObjectLocator(documentId, "document", documentId),
    message,
    ...(parameter === undefined ? {} : { parameter }),
  });
}

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

interface CellNetContext {
  nameByNetId: Map<string, string>;
  /** A Net the drawing names, under a name this format cannot write. */
  unwritableNameByNetId: Map<string, string>;
  nameByAuthoredName: Map<string, string>;
  netByTerminal: Map<string, ResolvedLogicalNet>;
  noConnectNameByTerminal: Map<string, string>;
  nets: DesignNetlistCell["nets"];
  /**
   * This Cell's resolved Logical Nets. A body with no explicit wiring asks the
   * bulk policy per pin, and that policy resolves the whole Document when it
   * is not handed this — once per terminal of every MOS.
   */
  logicalNets: ResolvedDocumentLogicalNets;
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

/** The formal pin name a Cell's ground takes, matching the Block libraries. */
export const GROUND_PORT_NAME = "VSS";

type ResolvedDesignNetlistAnalysisOptions =
  Required<DesignNetlistAnalysisOptions>;

function encodeCandidate(
  name: string,
  scope: "local" | "global",
  options: ResolvedDesignNetlistAnalysisOptions,
): EncodedNetName {
  return encodeNetName(name, scope, options.format, options.namingProfile);
}

/**
 * A visible Ground or VDD marker is already an explicit electrical statement.
 * Older drawings and copied markers can predate the persisted name-claim
 * ownership record, so recover that statement in the read-only export view.
 * Ordinary unnamed Nets still receive deterministic net0-style names below.
 */
function withNetlistPowerMarkerClaims(
  document: SchematicDocument,
  project?: CircuitProject,
): SchematicDocument {
  const logicalNets = resolveDocumentLogicalNets(document);
  const claimedMarkers = new Set(
    document.connectivityEvidence.flatMap((evidence) =>
      evidence.kind === "name-claim" && evidence.owner.kind === "power-marker"
        ? [evidence.owner.objectId]
        : [],
    ),
  );
  const additions: ConnectivityEvidence[] = [];
  for (const instance of document.instances) {
    const ground = instance.symbolId === "ground";
    if (
      (!ground && instance.symbolId !== "vdd-port") ||
      claimedMarkers.has(instance.id)
    )
      continue;
    const pinName = deviceDescriptor(instance.symbolId, project)?.pinOrder[0];
    if (!pinName) continue;
    const nets = document.nets.filter((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instance.id && terminal.pinName === pinName,
      ),
    );
    if (nets.length !== 1) continue;
    const logicalNet = logicalNets.byBaseNetId.get(nets[0]!.id);
    if (
      !logicalNet ||
      logicalNet.name ||
      logicalNet.powerDomain !== "none" ||
      logicalNet.conflicts.length > 0
    )
      continue;
    additions.push({
      id: deriveStableId(
        "connectivity-evidence",
        "netlist-power-marker",
        document.id,
        instance.id,
      ),
      kind: "name-claim",
      netId: nets[0]!.id,
      name: ground ? "0" : "VDD",
      scope: "global",
      powerDomain: ground ? "ground" : "vdd",
      owner: { kind: "power-marker", objectId: instance.id },
    });
  }
  return additions.length === 0
    ? document
    : {
        ...document,
        connectivityEvidence: [...document.connectivityEvidence, ...additions],
      };
}

function buildNetContext(
  project: CircuitProject,
  sourceDocument: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  externalDefinitionsById: ReadonlyMap<string, ExternalSubcircuitDefinition>,
  projectedNames: ReadonlyMap<string, ProjectedNetName>,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): CellNetContext {
  const document = withNetlistPowerMarkerClaims(sourceDocument, project);
  if (document.nets.length > MAX_NETS_PER_CELL) {
    diagnostic(
      diagnostics,
      document.id,
      "NET_LIMIT_EXCEEDED",
      `Cell has ${document.nets.length} Nets; maximum is ${MAX_NETS_PER_CELL}`,
    );
  }
  const explicitNames = new Map<string, string>();
  const occupiedNames = new Map<string, string>();
  const logicalNets = resolveDocumentLogicalNets(document);
  for (const logicalNet of logicalNets.groups) {
    if (logicalNet.conflicts.includes("name-conflict")) {
      diagnostic(
        diagnostics,
        document.id,
        "CONFLICTING_LOGICAL_NET_NAME",
        `Logical Net ${logicalNet.id} has conflicting name claims`,
        [...logicalNet.baseNetIds, ...logicalNet.evidenceIds],
      );
    }
    if (logicalNet.conflicts.includes("scope-conflict")) {
      diagnostic(
        diagnostics,
        document.id,
        "CONFLICTING_LOGICAL_NET_SCOPE",
        `Logical Net ${logicalNet.id} has conflicting scope claims`,
        [...logicalNet.baseNetIds, ...logicalNet.evidenceIds],
      );
    }
    if (logicalNet.conflicts.includes("power-domain-conflict")) {
      diagnostic(
        diagnostics,
        document.id,
        "CONFLICTING_LOGICAL_NET_POWER_DOMAIN",
        `Logical Net ${logicalNet.id} connects incompatible power markers`,
        [...logicalNet.baseNetIds, ...logicalNet.evidenceIds],
      );
    }
    if (logicalNet.conflicts.includes("formal-global-conflict")) {
      diagnostic(
        diagnostics,
        document.id,
        "FORMAL_PORT_GLOBAL_NET_CONFLICT",
        `Logical Net ${logicalNet.id} is both a formal Cell Pin and a Global Net`,
        [
          ...logicalNet.baseNetIds,
          ...logicalNet.formalTerminalIds,
          ...logicalNet.evidenceIds,
        ],
      );
    }
    const projectedName = projectedNames.get(logicalNet.id);
    const explicitName = logicalNet.name
      ? (projectedName?.preferredSpelling ?? logicalNet.name)
      : undefined;
    if (!explicitName) continue;
    const folded = foldNetName(explicitName);
    if (!explicitNames.has(folded)) {
      explicitNames.set(folded, logicalNet.id);
    }
    if ((projectedName?.spellings.length ?? 0) > 1) {
      diagnostic(
        diagnostics,
        document.id,
        logicalNet.scope === "global"
          ? "GLOBAL_NAME_SPELLING_NORMALIZED"
          : "NET_NAME_SPELLING_NORMALIZED",
        `${logicalNet.scope ?? "local"} Net spellings [${projectedName!.spellings.join(", ")}] export as ${explicitName}`,
        [...logicalNet.baseNetIds, ...logicalNet.evidenceIds],
        "warning",
      );
    }
  }

  const formalTerminalByLogicalId = new Map<string, string>();
  for (const port of projectCellInterface(document.netlist).ports) {
    for (const netId of port.netIds) {
      const logicalNet = logicalNets.byBaseNetId.get(netId);
      const logicalId = logicalNet?.id ?? netId;
      const prior = formalTerminalByLogicalId.get(logicalId);
      if (prior && foldNetName(prior) !== port.key) {
        diagnostic(
          diagnostics,
          document.id,
          "MULTIPLE_PORTS_SHARE_NET",
          `Formal terminals ${prior} and ${port.name} map to the same logical Net ${logicalId}`,
          [...(logicalNet?.baseNetIds ?? [netId])],
        );
        continue;
      }
      const explicitOwner = explicitNames.get(port.key);
      if (explicitOwner && explicitOwner !== logicalId) {
        diagnostic(
          diagnostics,
          document.id,
          "PORT_NET_NAME_COLLISION",
          `Formal terminal ${port.name} collides with a different explicit Net`,
          [logicalId, explicitOwner],
        );
      }
      formalTerminalByLogicalId.set(logicalId, port.name);
    }
  }

  // Authoritative authored/interface names reserve their dialect tokens before
  // source hints are considered. A copied import hint may be suffixed; a
  // current Label, marker, Cell Pin, or declaration may not.
  for (const logicalNet of logicalNets.groups) {
    const projectedName = projectedNames.get(logicalNet.id);
    const authoritativeName =
      logicalNet.scope === "global"
        ? (projectedName?.preferredSpelling ?? logicalNet.name)
        : (formalTerminalByLogicalId.get(logicalNet.id) ??
          (logicalNet.name
            ? (projectedName?.preferredSpelling ?? logicalNet.name)
            : undefined));
    if (!authoritativeName) continue;
    const encoded = encodeCandidate(
      authoritativeName,
      logicalNet.scope ?? "local",
      options,
    );
    if (encoded.ok && !occupiedNames.has(encoded.collisionKey)) {
      occupiedNames.set(encoded.collisionKey, logicalNet.id);
    }
  }

  const nameByNetId = new Map<string, string>();
  const unwritableNameByNetId = new Map<string, string>();
  let generatedIndex = 0;
  for (const logicalNet of logicalNets.groups) {
    const projectedName = projectedNames.get(logicalNet.id);
    let name =
      logicalNet.scope === "global"
        ? (projectedName?.preferredSpelling ?? logicalNet.name)
        : (formalTerminalByLogicalId.get(logicalNet.id) ??
          (logicalNet.name
            ? (projectedName?.preferredSpelling ?? logicalNet.name)
            : undefined));
    if (!name) {
      const memberNetIds = new Set(logicalNet.baseNetIds);
      const hints = document.connectivityEvidence.filter(
        (
          evidence,
        ): evidence is Extract<
          SchematicDocument["connectivityEvidence"][number],
          { kind: "net-name-hint" }
        > =>
          evidence.kind === "net-name-hint" && memberNetIds.has(evidence.netId),
      );
      const namesByFolded = new Map<string, string>();
      for (const hint of hints) {
        const folded = foldNetName(hint.sourceName);
        if (!namesByFolded.has(folded)) {
          namesByFolded.set(folded, hint.sourceName);
        }
      }
      if (namesByFolded.size === 1) {
        const preferredName = [...namesByFolded.values()][0]!;
        const encodedHint = encodeCandidate(
          preferredName,
          logicalNet.scope ?? "local",
          options,
        );
        if (encodedHint.ok) {
          name = preferredName;
          let encodedName = encodedHint;
          let suffix = 2;
          while (occupiedNames.has(encodedName.collisionKey)) {
            name = `${preferredName}__${suffix}`;
            suffix += 1;
            const encodedSuffix = encodeCandidate(
              name,
              logicalNet.scope ?? "local",
              options,
            );
            if (!encodedSuffix.ok) break;
            encodedName = encodedSuffix;
          }
          if (name !== preferredName) {
            diagnostic(
              diagnostics,
              document.id,
              "DISAMBIGUATED_SOURCE_NET_NAME",
              `Source node ${preferredName} exports as ${name} because its spelling is already in use`,
              [...logicalNet.baseNetIds, ...hints.map((hint) => hint.id)],
              "warning",
            );
          }
        } else {
          diagnostic(
            diagnostics,
            document.id,
            "UNREPRESENTABLE_SOURCE_NET_NAME",
            `Source node ${preferredName} cannot be encoded for ${options.format}: ${encodedHint.message}`,
            [...logicalNet.baseNetIds, ...hints.map((hint) => hint.id)],
            "warning",
          );
        }
      } else if (namesByFolded.size > 1) {
        diagnostic(
          diagnostics,
          document.id,
          "AMBIGUOUS_SOURCE_NET_NAME",
          `Logical Net ${logicalNet.id} contains multiple source node spellings and requires a generated current name`,
          [...logicalNet.baseNetIds, ...hints.map((hint) => hint.id)],
          "warning",
        );
      }
    }
    if (!name && logicalNet.scope !== "global") {
      let encodedGenerated: EncodedNetName;
      do {
        name = `net${generatedIndex}`;
        generatedIndex += 1;
        encodedGenerated = encodeCandidate(name, "local", options);
      } while (
        encodedGenerated.ok &&
        occupiedNames.has(encodedGenerated.collisionKey)
      );
      // An unnamed internal Net is valid; its exported name is information.
      // As a warning, a two-stage op amp's four internal nodes outnumbered
      // its real findings, and simulation preparation already drops it.
      diagnostic(
        diagnostics,
        document.id,
        "GENERATED_NET_NAME",
        `Unnamed logical Net ${logicalNet.id} exports as ${name}`,
        [...logicalNet.baseNetIds],
        "info",
      );
    }
    if (!name) continue;
    const encoded = encodeCandidate(name, logicalNet.scope ?? "local", options);
    if (!encoded.ok) {
      diagnostic(diagnostics, document.id, encoded.code, encoded.message, [
        ...logicalNet.baseNetIds,
        ...logicalNet.evidenceIds,
      ]);
      for (const netId of logicalNet.baseNetIds)
        unwritableNameByNetId.set(netId, name);
      continue;
    }
    const priorLogicalId = occupiedNames.get(encoded.collisionKey);
    if (priorLogicalId && priorLogicalId !== logicalNet.id) {
      const priorNet = logicalNets.byId.get(priorLogicalId);
      diagnostic(
        diagnostics,
        document.id,
        "DIALECT_NAME_COLLISION",
        `${logicalNet.scope ?? "local"} Net ${name} and ${priorNet?.scope ?? "local"} Net ${priorNet?.name ?? priorLogicalId} encode to ${encoded.token} for ${options.format}`,
        [
          ...(priorNet?.baseNetIds ?? [priorLogicalId]),
          ...logicalNet.baseNetIds,
        ],
      );
    } else {
      occupiedNames.set(encoded.collisionKey, logicalNet.id);
    }
    for (const netId of logicalNet.baseNetIds) {
      nameByNetId.set(netId, encoded.token);
    }
  }
  const netByTerminal = new Map<string, ResolvedLogicalNet>();
  const instanceById = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      const instance = instanceById.get(terminal.instanceId);
      if (!instance) {
        diagnostic(
          diagnostics,
          document.id,
          "UNKNOWN_TERMINAL_INSTANCE",
          `Net ${net.id} references unknown instance ${terminal.instanceId}`,
          [net.id, terminal.instanceId],
        );
      } else {
        const binding = instance.netlist?.binding;
        const child =
          binding?.kind === "subcircuit"
            ? documentsById.get(binding.childDocumentId)
            : undefined;
        const externalDefinition =
          binding?.kind === "external-subcircuit"
            ? externalDefinitionsById.get(binding.definitionId)
            : undefined;
        const reviewed = externalDefinition
          ? resolveReviewedExternalBinding(
              externalDefinition.name,
              externalDefinition.terminals.map((terminal) => terminal.name),
            )
          : undefined;
        const allowedPins = child?.netlist
          ? projectCellInterface(child.netlist).ports.map((port) => port.name)
          : reviewed
            ? reviewed.terminals.map((terminal) => terminal.pinName)
            : externalDefinition
              ? externalDefinition.terminals.map((terminal) => terminal.name)
              : deviceDescriptor(instance.symbolId, project)?.pinOrder;
        if (allowedPins && !allowedPins.includes(terminal.pinName)) {
          diagnostic(
            diagnostics,
            document.id,
            "UNKNOWN_TERMINAL_PIN",
            `Net ${net.id} references unknown pin ${terminal.instanceId}.${terminal.pinName}`,
            [net.id, terminal.instanceId],
          );
        }
      }
      const key = `${terminal.instanceId}\u0000${terminal.pinName}`;
      const prior = netByTerminal.get(key);
      if (prior) {
        diagnostic(
          diagnostics,
          document.id,
          "MULTIPLY_ASSIGNED_TERMINAL",
          `Terminal ${terminal.instanceId}.${terminal.pinName} belongs to multiple Nets`,
          [prior.id, net.id, terminal.instanceId],
        );
      } else {
        netByTerminal.set(key, logicalNets.byBaseNetId.get(net.id)!);
      }
    }
  }

  const noConnectNameByTerminal = new Map<string, string>();
  const noConnectNets: DesignNetlistCell["nets"] = [];
  let noConnectIndex = 1;
  for (const noConnect of [...document.noConnects].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    let generated = "";
    let encodedGenerated: EncodedNetName;
    do {
      generated = `NC${String(noConnectIndex).padStart(4, "0")}`;
      noConnectIndex += 1;
      encodedGenerated = encodeCandidate(generated, "local", options);
    } while (
      encodedGenerated.ok &&
      occupiedNames.has(encodedGenerated.collisionKey)
    );
    if (encodedGenerated.ok) {
      occupiedNames.set(encodedGenerated.collisionKey, noConnect.id);
      generated = encodedGenerated.token;
    }
    const key = `${noConnect.endpoint.instanceId}\u0000${noConnect.endpoint.pinName}`;
    noConnectNameByTerminal.set(key, generated);
    noConnectNets.push({ id: noConnect.id, name: generated, scope: "local" });
    // The author marked this pin unused; its node name is information, not
    // a problem. As a warning, a PFD's two unused QBAR marks buried the rest.
    diagnostic(
      diagnostics,
      document.id,
      "GENERATED_NO_CONNECT_NODE",
      `Explicit NoConnect ${noConnect.id} exports as floating node ${generated}`,
      [noConnect.id, noConnect.endpoint.instanceId],
      "info",
    );
  }

  const emittedNetNames = new Set<string>();
  return {
    nameByNetId,
    unwritableNameByNetId,
    nameByAuthoredName: new Map(
      logicalNets.groups.flatMap((net) => {
        const name = nameByNetId.get(net.baseNetIds[0]!);
        return net.name && name ? [[foldNetName(net.name), name] as const] : [];
      }),
    ),
    netByTerminal,
    noConnectNameByTerminal,
    logicalNets,
    nets: [
      ...logicalNets.groups.flatMap((logicalNet) => {
        const name = nameByNetId.get(logicalNet.baseNetIds[0]!);
        if (!name) return [];
        const collisionKey = encodedNetNameCollisionKey(name, options.format);
        if (emittedNetNames.has(collisionKey)) return [];
        emittedNetNames.add(collisionKey);
        return [
          {
            id: logicalNet.id,
            name,
            scope: logicalNet.scope ?? "local",
          },
        ];
      }),
      ...noConnectNets,
    ],
  };
}

function terminalNetName(
  document: SchematicDocument,
  instance: Instance,
  pinName: string,
  context: CellNetContext,
  diagnostics: NetlistDiagnostic[],
): string | null {
  // A MOS body has one authority, and membership is not always it: a body
  // left alone on the Net its own policy binding named is residue from a
  // paste or a deleted marker, and writing that node would strand the body
  // where nothing else reaches it. Ask the authority first; for an explicitly
  // wired body it answers the same Net membership does.
  const bodyNet =
    pinName === "B" && mosBulkKind(instance)
      ? resolveMosBulkConnection(document, instance, context.logicalNets)?.net
      : undefined;
  const net =
    bodyNet ?? context.netByTerminal.get(`${instance.id}\u0000${pinName}`);
  const name = net ? context.nameByNetId.get(net.id) : undefined;
  const noConnectName = context.noConnectNameByTerminal.get(
    `${instance.id}\u0000${pinName}`,
  );
  if (noConnectName) return noConnectName;
  if (name) return name;
  // A pin on a Net named in a spelling the format cannot write is connected;
  // saying otherwise sends the author looking for a wire that is there.
  const unwritable = net
    ? context.unwritableNameByNetId.get(net.id)
    : undefined;
  if (unwritable) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_PIN_NET",
      `Pin ${instance.reference ?? instance.id}.${pinName} is on Net ${unwritable}, a name the netlist cannot write; rename that Net`,
      [instance.id],
    );
    return null;
  }
  // Missing connectivity is an error, not permission to infer a supply from
  // device polarity or a matching Net name elsewhere in the Cell.
  const body = pinName === "B" && mosBulkKind(instance);
  diagnostic(
    diagnostics,
    document.id,
    "MISSING_PIN_NET",
    body
      ? // The fourth node has two authored answers; name both so the
        // report is actionable instead of only true.
        `Required pin ${instance.reference ?? instance.id}.B has no body Net: connect B, or set this Cell's MOS body default`
      : `Required pin ${instance.reference ?? instance.id}.${pinName} is not connected to an exportable Net: connect it, or mark it No Connect if it is unused`,
    [instance.id],
  );
  return null;
}

function extractHierarchyInstance(
  document: SchematicDocument,
  instance: Instance,
  documentsById: Map<string, SchematicDocument>,
  cellNameByDocumentId: ReadonlyMap<string, string>,
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const netlist = instance.netlist;
  const binding = netlist?.binding;
  if (!netlist || binding?.kind !== "subcircuit") return null;
  if (!isIdentifier(instance.reference!)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_INSTANCE_REFERENCE",
      `Instance reference is outside the portable identifier subset: ${instance.reference!}`,
      [instance.id],
    );
  }
  for (const parameter of Object.keys(netlist.parameters)) {
    if (!isIdentifier(parameter)) {
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_PARAMETER_NAME",
        `Parameter name is outside the portable identifier subset: ${parameter}`,
        [instance.id],
      );
    }
  }
  const child = documentsById.get(binding.childDocumentId);
  if (!child?.netlist) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_CHILD_INTERFACE",
      `Hierarchy instance ${instance.reference!} has no resolved child netlist interface`,
      [instance.id, binding.childDocumentId],
    );
    return null;
  }
  validateFormalParameterOverrides(
    document,
    instance,
    child.netlist.formalParameters,
    diagnostics,
  );
  // Callers and definitions share the authored interface, including its order.
  const childPorts = projectCellInterface(child.netlist).ports;
  const nodes = childPorts.map((port) => {
    const netName = terminalNetName(
      document,
      instance,
      port.name,
      context,
      diagnostics,
    );
    // Strict extraction rejects the accompanying error. Authoring keeps an
    // explicit non-executable slot rather than shifting positional arguments.
    return {
      pinName: port.name,
      netName: netName ?? `<unconnected:${port.name}>`,
    };
  });
  // The child's ground pin is not in its authored interface; both sides
  // derive it from the Documents, so the call carries this Cell's own ground
  // node at the position the child's definition puts it.
  if (options.groundPin === "pin" && cellReachesGround(child, documentsById)) {
    const callerGround = context.nameByAuthoredName.get(foldNetName("0"));
    if (callerGround) {
      nodes.splice(
        groundPortIndex(
          child,
          childPorts.map((port) => ({ id: port.netIds[0]!, name: port.name })),
        ),
        0,
        { pinName: GROUND_PORT_NAME, netName: callerGround },
      );
    }
  }
  return {
    id: instance.id,
    reference: instance.reference!,
    invocationKind: "subcircuit",
    deviceClass: "hierarchical",
    target: cellNameByDocumentId.get(child.id) ?? child.netlist.name,
    nodes,
    parameters: Object.entries(netlist.parameters)
      .sort(([a], [b]) => compareText(a, b))
      .map(([name, rawValue]) => ({ name, rawValue })),
  };
}

function validateFormalParameterOverrides(
  document: SchematicDocument,
  instance: Instance,
  formalParameters: readonly {
    name: string;
    defaultValue?: string | undefined;
  }[],
  diagnostics: NetlistDiagnostic[],
  options: { allowAdditional?: boolean } = {},
): void {
  const parameters = instance.netlist?.parameters ?? {};
  const formalByFoldedName = new Map(
    formalParameters.map((parameter) => [
      parameter.name.toLowerCase(),
      parameter,
    ]),
  );
  for (const name of Object.keys(parameters)) {
    if (options.allowAdditional || formalByFoldedName.has(name.toLowerCase()))
      continue;
    diagnostic(
      diagnostics,
      document.id,
      "UNKNOWN_SUBCIRCUIT_PARAMETER",
      `Instance ${instance.reference ?? instance.id} sets unknown formal parameter ${name}`,
      [instance.id],
    );
  }
  for (const formal of formalParameters) {
    if (
      formal.defaultValue !== undefined ||
      Object.keys(parameters).some(
        (name) => name.toLowerCase() === formal.name.toLowerCase(),
      )
    ) {
      continue;
    }
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_REQUIRED_SUBCIRCUIT_PARAMETER",
      `Instance ${instance.reference ?? instance.id} must override formal parameter ${formal.name}`,
      [instance.id],
    );
  }
}

function extractExternalSubcircuitInstance(
  document: SchematicDocument,
  instance: Instance,
  definition: ExternalSubcircuitDefinition | undefined,
  context: CellNetContext,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const netlist = instance.netlist;
  if (!netlist || netlist.binding?.kind !== "external-subcircuit") return null;
  if (!definition) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_EXTERNAL_SUBCIRCUIT_INTERFACE",
      `External subcircuit definition ${netlist.binding.definitionId} is unavailable`,
      [instance.id, netlist.binding.definitionId],
    );
    return null;
  }
  if (!isIdentifier(instance.reference!) || !isIdentifier(definition.name)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_SUBCIRCUIT_IDENTIFIER",
      `External subcircuit ${instance.reference!} or target ${definition.name} is outside the portable identifier subset`,
      [instance.id, definition.id],
    );
  }
  validateFormalParameterOverrides(
    document,
    instance,
    definition.formalParameters,
    diagnostics,
    { allowAdditional: true },
  );
  const reviewed = resolveReviewedExternalBinding(
    definition.name,
    definition.terminals.map((terminal) => terminal.name),
  );
  const terminalBindings = reviewed
    ? reviewed.terminals
    : definition.terminals.map((terminal) => ({
        targetName: terminal.name,
        pinName: terminal.name,
        interaction: "canvas" as const,
      }));
  const allowedPins = new Set(
    terminalBindings.map((terminal) => terminal.pinName.toLowerCase()),
  );
  const referencedPins = new Set<string>();
  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      if (terminal.instanceId === instance.id)
        referencedPins.add(terminal.pinName);
    }
  }
  for (const route of document.routes) {
    for (const endpoint of routeEndpoints(route)) {
      if (endpoint.kind === "terminal" && endpoint.instanceId === instance.id) {
        referencedPins.add(endpoint.pinName);
        const propertyTerminal = terminalBindings.find(
          (terminal) =>
            terminal.pinName === endpoint.pinName &&
            terminal.interaction === "property",
        );
        if (propertyTerminal) {
          diagnostic(
            diagnostics,
            document.id,
            "PROPERTY_TERMINAL_ON_CANVAS",
            `Property-only terminal ${instance.reference!}.${endpoint.pinName} cannot be a Route endpoint`,
            [instance.id, route.id],
          );
        }
      }
    }
  }
  for (const pinName of referencedPins) {
    if (allowedPins.has(pinName.toLowerCase())) continue;
    diagnostic(
      diagnostics,
      document.id,
      "UNKNOWN_EXTERNAL_SUBCIRCUIT_PIN",
      `External subcircuit ${instance.reference!} references unknown formal terminal ${pinName}`,
      [instance.id, definition.id],
    );
  }
  for (const noConnect of document.noConnects) {
    if (noConnect.endpoint.instanceId !== instance.id) continue;
    const propertyTerminal = terminalBindings.find(
      (terminal) =>
        terminal.pinName === noConnect.endpoint.pinName &&
        terminal.interaction === "property",
    );
    if (propertyTerminal) {
      diagnostic(
        diagnostics,
        document.id,
        "PROPERTY_TERMINAL_NO_CONNECT",
        `Property-only terminal ${instance.reference!}.${noConnect.endpoint.pinName} requires an existing Net selection`,
        [instance.id, noConnect.id],
      );
    }
  }
  const nodes = terminalBindings.map((terminal) => {
    const netName = terminalNetName(
      document,
      instance,
      terminal.pinName,
      context,
      diagnostics,
    );
    return {
      pinName: terminal.targetName,
      ...(terminal.targetName !== terminal.pinName
        ? { canvasPinName: terminal.pinName }
        : {}),
      netName: netName ?? `<unconnected:${terminal.targetName}>`,
    };
  });
  const parameters = Object.entries(netlist.parameters);
  const projectedParameters = reviewed
    ? [
        ...reviewed.parameters
          .toSorted((left, right) => left.spiceOrder - right.spiceOrder)
          .flatMap((parameter) => {
            const entry = parameters.find(
              ([name]) => name.toLowerCase() === parameter.name.toLowerCase(),
            );
            if (!entry) return [];
            let rawValue = entry[1];
            if (parameter.targetUnit === "micrometre") {
              try {
                rawValue = projectLengthToSky130Micrometres(rawValue);
              } catch (error) {
                diagnostic(
                  diagnostics,
                  document.id,
                  "INVALID_REVIEWED_GEOMETRY",
                  error instanceof Error ? error.message : String(error),
                  [instance.id],
                );
                return [];
              }
            }
            return [{ name: parameter.name, rawValue }];
          }),
        ...parameters
          .filter(
            ([name]) =>
              !reviewed.parameters.some(
                (parameter) =>
                  parameter.name.toLowerCase() === name.toLowerCase(),
              ),
          )
          .sort(([a], [b]) => compareText(a, b))
          .map(([name, rawValue]) => ({ name, rawValue })),
      ]
    : parameters
        .sort(([a], [b]) => compareText(a, b))
        .map(([name, rawValue]) => ({ name, rawValue }));
  return {
    id: instance.id,
    reference: instance.reference!,
    invocationKind: "subcircuit",
    ...(reviewed ? { reviewedExternalBindingId: reviewed.id } : {}),
    deviceClass: "hierarchical",
    target: definition.name,
    nodes,
    parameters: projectedParameters,
  };
}

function extractBuiltInSubcircuitInstance(
  document: SchematicDocument,
  instance: Instance,
  definition: BuiltInSubcircuitDescriptor,
  reference: string,
  context: CellNetContext,
  _options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
  /** The Project's own subcircuit names; see projectSubcircuitNames. */
  projectNames: ReadonlySet<string>,
  /** The body never reads VDD/VSS, so an undrawn supply is tied to ground. */
  supplyFree = false,
): DesignNetlistInstance | null {
  const netlist = instance.netlist;
  const binding = netlist?.binding;
  if (binding && binding.kind !== "unresolved-subcircuit") {
    diagnostic(
      diagnostics,
      document.id,
      "BUILTIN_SUBCIRCUIT_BINDING_MISMATCH",
      `Analog Block ${reference} requires a black-box subcircuit target`,
      [instance.id],
    );
    return null;
  }
  const target = builtInBlockCallTarget(instance, definition, projectNames);
  if (!isIdentifier(reference) || !isIdentifier(target)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_SUBCIRCUIT_IDENTIFIER",
      `Analog Block ${reference} or target ${target} is outside the portable identifier subset`,
      [instance.id],
    );
  }
  // An adder's input signs chose its body above; they are not SPICE
  // parameters, so the call carries none of them.
  const adderSigns =
    definition.target === ADDER_TARGET
      ? adderInputSigns(netlist?.parameters)
      : [];
  const signNames = new Set(
    ADDER_SIGNED_INPUTS.map((input) => input.parameter.toLowerCase()),
  );
  for (const input of adderSigns) {
    if (input.sign === null)
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_ADDER_SIGN",
        `Adder ${reference}'s ${input.parameter} must be + or -; received ${netlist?.parameters[input.parameter]}`,
        [instance.id],
        "error",
        input.parameter,
      );
  }
  // The signs choose among the generated adder bodies only. A call that
  // reaches anything else must subtract as drawn: a subcircuit the adder
  // was retargeted to, or the Project's own definition of the name.
  const retargeted =
    binding?.kind === "unresolved-subcircuit" &&
    binding.name.toLowerCase() !== definition.target;
  const ownDefinition = projectNames.has(target.toLowerCase());
  if (
    adderSigns.some((input) => input.sign === "-") &&
    (retargeted || ownDefinition)
  )
    diagnostic(
      diagnostics,
      document.id,
      "ADDER_SIGN_NOT_EXPORTED",
      `Adder ${reference} subtracts ${adderSigns
        .filter((input) => input.sign === "-")
        .map((input) => input.pinName)
        .join(" and ")}, but calls ${target}${
        ownDefinition ? ", which this Project defines" : ""
      }: the signs choose only among the built-in adder bodies, so ${target} must subtract as drawn`,
      [instance.id],
      "warning",
    );
  const parameters = Object.entries(netlist?.parameters ?? {}).filter(
    ([name]) => !adderSigns.length || !signNames.has(name.toLowerCase()),
  );
  for (const [name] of parameters) {
    if (isIdentifier(name)) continue;
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_PARAMETER_NAME",
      `Parameter name is outside the portable identifier subset: ${name}`,
      [instance.id],
    );
  }
  if (
    definition.target === "comparator" &&
    target === IDEAL_COMPARATOR_TARGET
  ) {
    const seenParameters = new Set<string>();
    for (const [name, rawValue] of parameters) {
      const folded = name.toLowerCase();
      if (seenParameters.has(folded)) {
        diagnostic(
          diagnostics,
          document.id,
          "DUPLICATE_PARAMETER_NAME",
          `Ideal comparator ${reference} repeats parameter ${name} under case folding`,
          [instance.id],
          "error",
          name,
        );
      }
      seenParameters.add(folded);
      if (!["vhigh", "vlow", "vtransition"].includes(folded)) {
        diagnostic(
          diagnostics,
          document.id,
          "UNKNOWN_IDEAL_COMPARATOR_PARAMETER",
          `Ideal comparator ${reference} accepts only vhigh, vlow, and vtransition`,
          [instance.id],
          "error",
          name,
        );
        continue;
      }
      const parsed = parseSpiceNumber(rawValue.trim());
      if (
        parsed &&
        Number.isFinite(parsed.value) &&
        (folded !== "vtransition" || parsed.value > 0)
      )
        continue;
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_IDEAL_COMPARATOR_PARAMETER",
        `Ideal comparator ${reference} requires numeric ${name}${folded === "vtransition" ? " > 0" : ""}`,
        [instance.id],
        "error",
        name,
      );
    }
    const nodes = definition.ports
      .filter((port) => !port.supply)
      .map((port) => ({
        pinName: port.name,
        netName:
          terminalNetName(
            document,
            instance,
            port.pinName,
            context,
            diagnostics,
          ) ?? `<unconnected:${port.name}>`,
      }));
    return {
      id: instance.id,
      reference,
      invocationKind: "subcircuit",
      deviceClass: "hierarchical",
      target,
      nodes,
      parameters: parameters.map(([name, rawValue]) => ({ name, rawValue })),
    };
  }
  const nodes = definition.ports.flatMap((port) => {
    if (port.supply) {
      // A property-only terminal is an explicit electrical binding even
      // though the Symbol exposes no canvas pin. Its identity wins over any
      // spelling or inferred power domain, including alternate supply rails.
      const explicit = context.netByTerminal.get(
        `${instance.id}\u0000${port.supply}`,
      );
      const explicitName = explicit
        ? context.nameByNetId.get(explicit.id)
        : undefined;
      if (explicitName) return [{ pinName: port.name, netName: explicitName }];
      if (explicit) {
        diagnostic(
          diagnostics,
          document.id,
          "MISSING_BLOCK_SUPPLY",
          `Analog Block ${reference} binds ${port.supply} to a Net that cannot be exported; select another Net in Properties`,
          [instance.id],
        );
        return [{ pinName: port.name, netName: `<unconnected:${port.name}>` }];
      }
      // Auto is safe only when the Cell has one unambiguous drawn supply of
      // this domain. A similarly named signal is not a supply declaration.
      const drawn = drawnSupplyNet(
        document,
        port.supply === "VDD" ? "vdd" : "ground",
      );
      const drawnName = drawn ? context.nameByNetId.get(drawn.id) : undefined;
      if (drawnName) return [{ pinName: port.name, netName: drawnName }];
      // An ideal op-amp in a figure without supplies, such as a textbook
      // switched-capacitor integrator: the port is in the call but unused.
      if (supplyFree) return [{ pinName: port.name, netName: "0" }];
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_BLOCK_SUPPLY",
        `Analog Block ${reference} has no unambiguous ${port.supply} Net; select one in Properties or draw a unique ${port.supply === "VDD" ? "positive supply" : "ground"}`,
        [instance.id],
      );
      return [{ pinName: port.name, netName: `<unconnected:${port.name}>` }];
    }
    const netName = terminalNetName(
      document,
      instance,
      port.pinName,
      context,
      diagnostics,
    );
    return [
      { pinName: port.name, netName: netName ?? `<unconnected:${port.name}>` },
    ];
  });
  return {
    id: instance.id,
    reference,
    invocationKind: "subcircuit",
    deviceClass: "hierarchical",
    target,
    nodes,
    parameters: parameters
      .sort(([a], [b]) => compareText(a, b))
      .map(([name, rawValue]) => ({ name, rawValue })),
  };
}

/**
 * The model a diode takes in a Process with no diode of its own (#1310):
 * Abstract, SKY130, IHP SG13G2 and Custom bind each diode placed from the
 * library to `DIODE`, a name no library defines, so every run of that
 * netlist failed on the missing model while the export said ready. Like the
 * ideal switch, each Cell using the name carries this card in its own body:
 * SPICE's default junction, with its saturation current and emission
 * coefficient stated. It is a stand-in, reported as information, and a model
 * of the same name that the Project defines itself replaces it.
 */
export const GENERIC_DIODE_MODEL: DesignNetlistModel = {
  name: "DIODE",
  type: "D",
  parameters: [
    { name: "IS", rawValue: "1e-14" },
    { name: "N", rawValue: "1" },
  ],
  authoredName: true,
};

/** `.model DIODE …` in SPICE, or `model DIODE …` in VACASK and Spectre. */
const GENERIC_DIODE_DEFINITION = new RegExp(
  String.raw`^[ \t]*\.?model[ \t]+${GENERIC_DIODE_MODEL.name}(?=[\s(]|$)`,
  "imu",
);

/**
 * Whether the Project's own text defines the generic diode's name: a source
 * file in one of its simulation folders, or the SPICE it was imported from.
 * That model is the author's. The card inside a Cell would shadow it there,
 * so no Cell carries one.
 */
function projectDefinesGenericDiode(project: CircuitProject): boolean {
  const texts = [
    ...(project.simulationFolders ?? []).flatMap((folder) =>
      folder.input.files.map((file) => file.text),
    ),
    ...(project.source?.files ?? []).flatMap((file) => [
      file.content?.text,
      file.originalContent?.text,
    ]),
  ];
  return texts.some(
    (text) => text !== undefined && GENERIC_DIODE_DEFINITION.test(text),
  );
}

/** Phase nodes no drawn Net supplies, per Cell: each switch on one is told. */
const undrivenPhaseNodes = new WeakMap<CellNetContext, Set<string>>();

/** Whether a Symbol is a drawn switch, whose control is read against ground. */
function isDrawnSwitch(symbolId: string, project?: CircuitProject): boolean {
  const definition = deviceDescriptor(symbolId, project);
  return definition ? drawnSwitchControl(definition) !== null : false;
}

/**
 * A drawn switch as the SPICE `S` card it means: its two switched nodes, then
 * its control against the Cell's ground, closing through the ideal switch.
 * A phase names its node the way a Net Label would, so the switch meets the
 * clock drawn on a Net of that name, or a Cell Pin of that name.
 */
function extractDrawnSwitch(
  document: SchematicDocument,
  instance: Instance,
  definition: DeviceDescriptor,
  control: "phase" | "pin",
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const reference = instance.reference!;
  let controlNode: string | null;
  if (control === "phase") {
    // A switch whose label still shows its own name is clocked by a phase of
    // that name, so a freshly placed switch netlists at once. Writing Φ1 on
    // the label moves it onto a shared clock.
    const drawnPhase = drawnSwitchPhase(document, instance);
    const phase = drawnPhase ?? reference;
    const encoded = encodeCandidate(phase, "local", options);
    if (!encoded.ok) {
      diagnostic(
        diagnostics,
        document.id,
        "SWITCH_PHASE_UNREADABLE",
        `Switch ${reference}'s label ${phase} cannot name a netlist node; write a phase such as Φ1`,
        [instance.id],
      );
      return null;
    }
    const token = encoded.token;
    const added = undrivenPhaseNodes.get(context) ?? new Set<string>();
    undrivenPhaseNodes.set(context, added);
    controlNode =
      context.nameByAuthoredName.get(foldNetName(phase)) ??
      context.nets.find((net) => net.name.toLowerCase() === token.toLowerCase())
        ?.name ??
      null;
    if (!controlNode) {
      controlNode = token;
      added.add(token);
      context.nets.push({
        id: deriveStableId("netlist", "switch-phase", document.id, token),
        name: token,
        scope: "local",
      });
    }
    if (added.has(controlNode))
      diagnostic(
        diagnostics,
        document.id,
        "SWITCH_PHASE_NOT_DRIVEN",
        // Clocked by its own name, a switch shares no clock: say how to give
        // it one before asking for a Net named after the switch.
        drawnPhase === null
          ? `No Net named ${phase} in this Cell drives switch ${reference}, which is clocked by its own name: write its phase on its label (a display alias such as Φ1) to share one clock, and draw that clock on a Net or Cell Pin of the same name`
          : `No Net named ${phase} in this Cell drives switch ${reference}: name the clock's Net ${phase}, or add a Cell Pin ${phase}`,
        [instance.id],
        "warning",
      );
  } else {
    controlNode = terminalNetName(
      document,
      instance,
      "CTRL",
      context,
      diagnostics,
    );
    if (!controlNode) return null;
  }
  const switched = definition.pinOrder.filter((pinName) => pinName !== "CTRL");
  const nodes = switched.map((pinName) => ({
    pinName,
    netName:
      terminalNetName(document, instance, pinName, context, diagnostics) ??
      `<unconnected:${pinName}>`,
  }));
  return {
    id: instance.id,
    reference,
    invocationKind: "primitive",
    deviceClass: "switch",
    target: IDEAL_SWITCH_MODEL.name,
    nodes: [
      ...nodes,
      { pinName: control === "pin" ? "CTRL" : "CP", netName: controlNode },
      {
        pinName: "CN",
        netName: context.nameByAuthoredName.get(foldNetName("0")) ?? "0",
      },
    ],
    parameters: [],
  };
}

/**
 * A drawn T-coil or transformer as the call it means: an `X` card on the
 * library's coupled-winding subcircuit, its pins in the Symbol's pin order,
 * passing the Instance's own inductances, coupling and bridge capacitance.
 * The subcircuit declares exactly those parameters, so a value it cannot
 * take is refused here rather than by the simulator.
 */
function extractDrawnMagnetic(
  document: SchematicDocument,
  instance: Instance,
  definition: DeviceDescriptor,
  network: DrawnMagneticNetwork,
  context: CellNetContext,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const reference = instance.reference!;
  if (!isIdentifier(reference)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_INSTANCE_REFERENCE",
      `Instance reference is outside the portable identifier subset: ${reference}`,
      [instance.id],
    );
  }
  const accepted = drawnMagneticParameters(network);
  const authored = new Map<string, { name: string; rawValue: string }>();
  for (const [name, rawValue] of Object.entries(
    instance.netlist?.parameters ?? {},
  )) {
    const folded = name.toLowerCase();
    const prior = authored.get(folded);
    if (prior) {
      diagnostic(
        diagnostics,
        document.id,
        "DUPLICATE_PARAMETER_NAME",
        `Parameter ${name} duplicates parameter ${prior.name} under case folding`,
        [instance.id],
      );
      continue;
    }
    authored.set(folded, { name, rawValue });
    if (!accepted.includes(folded)) {
      diagnostic(
        diagnostics,
        document.id,
        "MAGNETIC_PARAMETER_NOT_ACCEPTED",
        `${reference} takes only ${accepted.join(", ")}; remove parameter ${name}`,
        [instance.id],
        "error",
        name,
      );
    }
  }
  const parameters = accepted.flatMap((name) => {
    const value = authored.get(name);
    if (!value?.rawValue.trim()) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_REQUIRED_PARAMETER",
        `Instance ${reference} requires parameter ${name}`,
        [instance.id],
        "error",
        name,
      );
      return [];
    }
    return [{ name, rawValue: value.rawValue }];
  });
  const coupling = authored.get(network.coupling.parameter);
  const k = coupling ? parseSpiceNumber(coupling.rawValue.trim()) : null;
  if (k && Math.abs(k.value) > 1) {
    diagnostic(
      diagnostics,
      document.id,
      "MAGNETIC_COUPLING_OUT_OF_RANGE",
      `${reference}'s coupling ${coupling!.name}=${coupling!.rawValue} lies outside -1 to 1`,
      [instance.id],
      "error",
      coupling!.name,
    );
  }
  return {
    id: instance.id,
    reference,
    invocationKind: "subcircuit",
    deviceClass: "hierarchical",
    target: network.subcircuit,
    nodes: definition.pinOrder.map((pinName) => ({
      pinName,
      netName:
        terminalNetName(document, instance, pinName, context, diagnostics) ??
        `<unconnected:${pinName}>`,
    })),
    parameters,
  };
}

/**
 * The coupled-winding subcircuit a drawn magnetic device calls, written from
 * its network with the library's own values as defaults.
 */
function magneticSubcircuit(
  network: DrawnMagneticNetwork,
  definition: DeviceDescriptor,
): DesignNetlistMagneticSubcircuit {
  return {
    kind: "magnetic",
    name: network.subcircuit,
    ports: network.ports.map((port) => port.port),
    formalParameters: drawnMagneticParameters(network).map((name) => ({
      name,
      defaultValue:
        definition.parameters.find(
          (parameter) => parameter.name.toLowerCase() === name,
        )?.defaultValue ?? "0",
    })),
    inductors: network.windings.map((winding) => ({
      name: winding.element,
      nodes: [winding.dotted, winding.undotted],
      parameter: winding.parameter,
    })),
    coupling: {
      name: network.coupling.element,
      inductors: [network.windings[0].element, network.windings[1].element],
      parameter: network.coupling.parameter,
    },
    capacitors: network.capacitors.map((capacitor) => ({
      name: capacitor.element,
      nodes: [capacitor.from, capacitor.to],
      parameter: capacitor.parameter,
    })),
  };
}

function extractDeviceInstance(
  project: CircuitProject,
  document: SchematicDocument,
  instance: Instance,
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const definition = deviceDescriptor(instance.symbolId, project);
  if (!definition) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_DEVICE_DEFINITION",
      `Symbol ${instance.symbolId} has no reviewed netlist definition`,
      [instance.id],
    );
    return null;
  }
  if (definition.deviceClass === "net-marker") {
    const markerNet = context.netByTerminal.get(
      `${instance.id}\u0000${definition.pinOrder[0]}`,
    );
    if (!markerNet || !markerNet.name) {
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_NET_MARKER",
        `Net marker ${instance.id} must connect to one valid Net`,
        [instance.id],
      );
    } else if (
      instance.symbolId === "ground" &&
      (markerNet.scope !== "global" || markerNet.name !== "0")
    ) {
      diagnostic(
        diagnostics,
        document.id,
        "GROUND_NAME_MISMATCH",
        `Ground marker must connect to global Net 0, not ${markerNet.scope} Net ${markerNet.name}`,
        [instance.id, markerNet.id],
      );
    } else if (
      instance.symbolId === "vdd-port" &&
      markerNet.powerDomain !== "vdd"
    ) {
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_NET_MARKER",
        `VDD Port ${instance.id} must connect to an explicitly classified VDD Net`,
        [instance.id, markerNet.id],
      );
    }
    return null;
  }
  const switchControl = drawnSwitchControl(definition);
  if (switchControl)
    return extractDrawnSwitch(
      document,
      instance,
      definition,
      switchControl,
      context,
      options,
      diagnostics,
    );
  const magnetic = drawnMagneticNetwork(definition);
  if (magnetic)
    return extractDrawnMagnetic(
      document,
      instance,
      definition,
      magnetic,
      context,
      diagnostics,
    );
  // A device the registry designates but gives no netlist target is drawing
  // only, such as a single-pole double-throw selector, which SPICE has no
  // primitive for. Say so and emit nothing. Falling through would reach the
  // printer with a null target where the model name belongs, and it throws
  // there.
  if (definition.targetPolicy === "none") {
    diagnostic(
      diagnostics,
      document.id,
      "NON_NETLISTABLE_DEVICE",
      `Symbol ${instance.symbolId} is drawing-only and has no netlist form`,
      [instance.id],
    );
    return null;
  }
  // A device whose authoring data was never written binds nothing and sets no
  // parameter — which is what an empty record says. Older Projects, imports
  // and Agent-authored instances reach here without one. Reading that state as
  // empty lets extraction report the specific missing model and parameters.
  const netlist = instance.netlist ?? { parameters: {} };
  if (!isIdentifier(instance.reference!)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_INSTANCE_REFERENCE",
      `Instance reference is outside the portable identifier subset: ${instance.reference!}`,
      [instance.id],
    );
  }
  if (definition.targetPolicy === "required-model") {
    const hasBuiltInZener =
      definition.symbolId === "zener-diode" &&
      netlist.binding === undefined &&
      Boolean(zenerParameter(instance, "bv")?.trim());
    if (netlist.binding?.kind !== "model" && !hasBuiltInZener) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_MODEL_TARGET",
        definition.symbolId === "zener-diode"
          ? `Instance ${instance.reference!} requires an external model or a positive BV for a built-in Zener model`
          : `Instance ${instance.reference!} requires an explicit model target`,
        [instance.id],
      );
    } else if (
      netlist.binding?.kind === "model" &&
      netlist.binding.deviceClass !== definition.deviceClass
    ) {
      diagnostic(
        diagnostics,
        document.id,
        "DEVICE_CLASS_MISMATCH",
        `Binding class ${netlist.binding.deviceClass} does not match ${definition.deviceClass}`,
        [instance.id],
      );
    } else if (
      netlist.binding?.kind === "model" &&
      reviewedExternalBindingForMaster(netlist.binding.name)
    ) {
      // SKY130's devices are subcircuits called on X lines. A model card of
      // that name, which older placements and imports wrote, is one the
      // SKY130 simulation profile cannot run (#1249).
      const name = netlist.binding.name;
      diagnostic(
        diagnostics,
        document.id,
        "REVIEWED_DEVICE_AS_MODEL_CARD",
        `${instance.reference!} names ${name} as a model card, but ${name} is a subcircuit in its process library, so the SKY130 simulation cannot run this line. Choose the model again in Properties, or Apply process, to call it as X${instance.reference!}.`,
        [instance.id],
        "warning",
      );
    }
  } else if (
    definition.targetPolicy === "builtin" &&
    netlist.binding !== undefined &&
    (netlist.binding.kind !== "primitive" ||
      netlist.binding.deviceClass !== definition.deviceClass)
  ) {
    diagnostic(
      diagnostics,
      document.id,
      "DEVICE_CLASS_MISMATCH",
      `Instance ${instance.reference!} requires primitive class ${definition.deviceClass}`,
      [instance.id],
    );
  }
  const parameterByFoldedName = new Map<
    string,
    { name: string; rawValue: string }
  >();
  for (const [parameter, rawValue] of Object.entries(netlist.parameters)) {
    const folded = parameter.toLowerCase();
    const prior = parameterByFoldedName.get(folded);
    if (prior) {
      diagnostic(
        diagnostics,
        document.id,
        "DUPLICATE_PARAMETER_NAME",
        `Parameter ${parameter} duplicates parameter ${prior.name} under case folding`,
        [instance.id],
      );
    } else {
      parameterByFoldedName.set(folded, { name: parameter, rawValue });
    }
  }
  for (const parameter of requiredParameterNames(definition)) {
    if (!parameterByFoldedName.get(parameter.toLowerCase())?.rawValue.trim()) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_REQUIRED_PARAMETER",
        `Instance ${instance.reference!} requires parameter ${parameter}`,
        [instance.id],
        "error",
        parameter,
      );
    }
  }
  for (const parameter of Object.keys(netlist.parameters)) {
    if (!isIdentifier(parameter)) {
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_PARAMETER_NAME",
        `Parameter name is outside the portable identifier subset: ${parameter}`,
        [instance.id],
      );
    }
  }
  const nodes = definition.pinOrder.flatMap((pinName) => {
    const netName = terminalNetName(
      document,
      instance,
      pinName,
      context,
      diagnostics,
    );
    return [{ pinName, netName: netName ?? `<unconnected:${pinName}>` }];
  });
  const controlled = definition.deviceClass;
  let controlSourceInstanceId: StableId | undefined;
  let controlTerminal: DesignNetlistInstance["controlTerminal"];
  if (controlled === "vcvs" || controlled === "vccs") {
    const control = netlist.control;
    if (
      control?.kind !== "voltage" ||
      !control.positiveNetId ||
      !control.negativeNetId
    ) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_CONTROL_NET",
        `Instance ${instance.reference!} requires two selected control Nets`,
        [instance.id],
      );
    } else {
      for (const [pinName, netId] of [
        ["CTRL+", control.positiveNetId],
        ["CTRL-", control.negativeNetId],
      ] as const) {
        const netName = context.nameByNetId.get(netId);
        if (!netName)
          diagnostic(
            diagnostics,
            document.id,
            "INVALID_CONTROL_NET",
            `Control Net ${netId} is not in this Cell`,
            [instance.id, netId],
          );
        nodes.push({ pinName, netName: netName ?? `<unconnected:${pinName}>` });
      }
    }
  } else if (controlled === "cccs" || controlled === "ccvs") {
    const control = netlist.control;
    if (control?.kind === "terminal-current") {
      if (!control.instanceId || !control.pinName) {
        diagnostic(
          diagnostics,
          document.id,
          "MISSING_CONTROL_TERMINAL",
          `Instance ${instance.reference!} requires a selected device terminal`,
          [instance.id],
        );
      } else {
        controlTerminal = {
          instanceId: control.instanceId,
          pinName: control.pinName,
          direction: control.direction,
        };
      }
    } else if (control?.kind !== "current" || !control.sensorInstanceId) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_CONTROL_SENSOR",
        `Instance ${instance.reference!} requires a selected voltage-source current sensor`,
        [instance.id],
      );
    } else {
      const sensor = document.instances.find(
        (candidate) => candidate.id === control.sensorInstanceId,
      );
      if (
        !sensor ||
        deviceDescriptor(sensor.symbolId, project)?.deviceClass !==
          "voltage-source"
      )
        diagnostic(
          diagnostics,
          document.id,
          "INVALID_CONTROL_SENSOR",
          `Control sensor ${control.sensorInstanceId} must be a voltage source in this Cell`,
          [instance.id, control.sensorInstanceId],
        );
      else controlSourceInstanceId = sensor.id;
    }
  }
  const target =
    netlist.binding?.kind === "model"
      ? netlist.binding.name
      : definition.symbolId === "zener-diode" &&
          netlist.binding === undefined &&
          zenerParameter(instance, "bv")?.trim()
        ? builtInZenerModelName(instance.reference!)
        : null;
  if (target && !isIdentifier(target)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_TARGET_NAME",
      `Model target is outside the portable identifier subset: ${target}`,
      [instance.id],
    );
  }
  const authoredParameters = Object.entries(netlist.parameters)
    .sort(([a], [b]) => compareText(a, b))
    .map(([name, rawValue]) => ({ name, rawValue }));
  if (definition.symbolId === "zener-diode") {
    const modelParameters = authoredParameters.filter((parameter) =>
      ["bv", "ibv"].includes(parameter.name.toLowerCase()),
    );
    if (netlist.binding?.kind === "model" && modelParameters.length) {
      diagnostic(
        diagnostics,
        document.id,
        "ZENER_MODEL_PARAMETER_CONFLICT",
        `Instance ${instance.reference!} cannot set BV or IBV alongside an external model; put those values in that model instead`,
        [instance.id],
      );
    }
    if (netlist.binding?.kind !== "model") {
      if (target && options.format !== "spice") {
        diagnostic(
          diagnostics,
          document.id,
          "ZENER_BUILTIN_SPICE_ONLY",
          `Instance ${instance.reference!} uses a generated ngspice Zener model; select SPICE or bind a Spectre model explicitly`,
          [instance.id],
        );
      }
      for (const parameter of modelParameters) {
        const parsed = parseSpiceNumber(parameter.rawValue.trim());
        if (
          parsed !== null &&
          Number.isFinite(parsed.value) &&
          parsed.value > 0
        )
          continue;
        diagnostic(
          diagnostics,
          document.id,
          "INVALID_ZENER_MODEL_PARAMETER",
          `Instance ${instance.reference!} requires positive numeric ${parameter.name.toUpperCase()}`,
          [instance.id],
          "error",
          parameter.name,
        );
      }
    }
  }
  const projectedParameters =
    definition.deviceClass === "voltage-source" ||
    definition.deviceClass === "current-source"
      ? normalizeIndependentSource(
          authoredParameters,
          definition.sourceWaveformDefault ?? "dc",
        )
      : null;
  for (const issue of projectedParameters?.issues ?? []) {
    diagnostic(
      diagnostics,
      document.id,
      issue.code,
      `Instance ${instance.reference!}: ${issue.message}`,
      [instance.id],
    );
  }
  return {
    id: instance.id,
    reference: instance.reference!,
    invocationKind: "primitive",
    deviceClass: definition.deviceClass,
    target,
    nodes,
    parameters: projectedParameters
      ? [...projectedParameters.parameters]
      : definition.symbolId === "zener-diode"
        ? authoredParameters.filter(
            (parameter) =>
              !["bv", "ibv"].includes(parameter.name.toLowerCase()),
          )
        : authoredParameters,
    ...(controlSourceInstanceId ? { controlSourceInstanceId } : {}),
    ...(controlTerminal ? { controlTerminal } : {}),
  };
}

/**
 * Whether a Cell meets ground at all — its own node `0`, or any Cell it
 * instantiates that does.
 *
 * The answer has to be the same on both sides of a hierarchy call, and both
 * sides compute it from the Documents alone rather than from whichever cell
 * happened to be extracted first. A Cell that only passes ground through to a
 * child still needs the pin: otherwise the child's reference would have
 * nowhere to come from.
 */
function cellReachesGround(
  document: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  seen: Set<string> = new Set(),
): boolean {
  if (seen.has(document.id)) return false;
  seen.add(document.id);
  // Read the same Document the node names come from: a drawn Ground marker
  // that predates the persisted claim record is recovered by the export view,
  // and most drawings are exactly that. Asking the unrecovered Document would
  // answer "no ground" for a Cell whose nodes are about to be named `0`.
  const groundOfItsOwn = resolveDocumentLogicalNets(
    withNetlistPowerMarkerClaims(document),
  ).groups.some((group) => group.powerDomain === "ground");
  if (groundOfItsOwn) return true;
  // A drawn switch reads its control against ground, so its Cell needs one.
  if (document.instances.some((instance) => isDrawnSwitch(instance.symbolId)))
    return true;
  return document.instances.some((instance) => {
    const binding = instance.netlist?.binding;
    if (binding?.kind !== "subcircuit") return false;
    const child = documentsById.get(binding.childDocumentId);
    return child ? cellReachesGround(child, documentsById, seen) : false;
  });
}

/**
 * Where the ground pin sits in a Cell's interface: after the supplies the
 * author declared, so every Cell reads `VDD VSS …` the way the Block library
 * already writes it, and before the first signal.
 */
function groundPortIndex(
  document: SchematicDocument,
  ports: readonly { id: string; name?: string }[],
): number {
  const logicalNets = resolveDocumentLogicalNets(document);
  let index = 0;
  for (const [position, port] of ports.entries()) {
    const domain = logicalNets.byBaseNetId.get(port.id)?.powerDomain;
    if (domain === "vdd" || port.name?.toUpperCase() === "VDD")
      index = position + 1;
  }
  return index;
}

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

/** `M1`, `M1 and M2`, `M1, M2 and M3`; a long list ends in a count. */
function partList(names: readonly string[]): string {
  const shown =
    names.length > 8
      ? [...names.slice(0, 7), `${names.length - 7} more`]
      : names;
  return shown.length === 1
    ? shown[0]!
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)!}`;
}

/**
 * Which MOS bodies took a supply this export added to the Cell, and which pin
 * that supply became (#1302). A body with no Net takes the conventional VDD or
 * ground, and a Cell that draws neither gets it as a new Cell Pin, VDD and
 * VSS together. That is the documented default, yet it added a fourth
 * terminal nobody drew without a word: an LDO's pass device got a VDD pin
 * where its body was meant to be the input. Information, as a generated Net
 * name is: the netlist and every gate stay as they were.
 */
function reportDefaultBodySupplies(
  document: SchematicDocument,
  context: CellNetContext,
  ports: DesignNetlistCell["ports"],
  diagnostics: NetlistDiagnostic[],
): void {
  const added = (["VDD", "0"] as const).flatMap((supply) => {
    const net = document.nets.find(
      (candidate) => candidate.id === implicitSupplyNetId(document.id, supply),
    );
    const group = net ? context.logicalNets.byBaseNetId.get(net.id) : undefined;
    // A Net the author drew joined it: the Cell had this supply already.
    if (!net || group?.baseNetIds.length !== 1) return [];
    const pin = ports.find(
      (port) => context.logicalNets.byBaseNetId.get(port.id)?.id === group.id,
    );
    if (!pin) return [];
    const bodies = net.terminals.flatMap((terminal) => {
      if (terminal.pinName !== "B") return [];
      const instance = document.instances.find(
        (candidate) => candidate.id === terminal.instanceId,
      );
      return instance && mosBulkKind(instance)
        ? [{ id: instance.id, name: instance.reference ?? instance.id }]
        : [];
    });
    bodies.sort((left, right) =>
      left.name.localeCompare(right.name, "en", { numeric: true }),
    );
    return [{ supply, pin: pin.name, bodies }];
  });
  for (const { supply, pin, bodies } of added) {
    if (!bodies.length) continue;
    // VDD and ground come as a pair; say so when the other one has no body.
    const companion = added.find(
      (other) => other.supply !== supply && !other.bodies.length,
    );
    const one = bodies.length === 1;
    const subject = one
      ? `${bodies[0]!.name}'s body has no Net and takes`
      : `The bodies of ${partList(bodies.map((body) => body.name))} have no Net and take`;
    const taken =
      supply === "VDD"
        ? `the conventional ${pin}, added to this Cell's pins${companion ? ` with ${companion.pin}` : ""}`
        : `the conventional ground, added to this Cell's pins as ${pin}${companion ? `, with ${companion.pin}` : ""}`;
    diagnostic(
      diagnostics,
      document.id,
      "MOS_BODY_DEFAULT_SUPPLY",
      `${subject} ${taken}; connect ${one ? "its B pin" : "a B pin"} to choose another body`,
      bodies.map((body) => body.id),
      "info",
    );
  }
}

/**
 * Which diodes run on the generic card (#1310). Information, as a default
 * body supply is: the netlist now runs, but on a stand-in junction, not on a
 * device anyone chose.
 */
function reportGenericDiodes(
  document: SchematicDocument,
  diodes: readonly DesignNetlistInstance[],
  diagnostics: NetlistDiagnostic[],
): void {
  const parts = diodes
    .map((card) => {
      const instance = document.instances.find((item) => item.id === card.id);
      return {
        id: card.id,
        name: instance?.reference ?? card.reference,
        zener: instance?.symbolId === "zener-diode",
      };
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, "en", { numeric: true }),
    );
  const values = GENERIC_DIODE_MODEL.parameters
    .map((parameter) => `${parameter.name}=${parameter.rawValue}`)
    .join(", ");
  // A Zener on it runs, but never breaks down: say so rather than let a
  // regulator simulate as a plain diode unnoticed.
  const zeners = parts.filter((part) => part.zener).map((part) => part.name);
  diagnostic(
    diagnostics,
    document.id,
    "GENERIC_DIODE_MODEL",
    `${partList(parts.map((part) => part.name))} ${parts.length === 1 ? "uses" : "use"} the generic diode model ${GENERIC_DIODE_MODEL.name} (${values}); set a model for a real device${
      zeners.length
        ? `. It has no breakdown, so ${partList(zeners)} ${zeners.length === 1 ? "does" : "do"} not act as a Zener until given a Zener model`
        : ""
    }`,
    parts.map((part) => part.id),
    "info",
  );
}

/**
 * A MOS whose body follows a default onto one supply while its source is on
 * another supply of the same domain (#1336): a level shifter's VDDH PMOS with
 * its body on the Cell's PMOS default VDDL, forward-biased when VDDH is the
 * higher supply. The drawing holds no voltages, and most such bodies sit on
 * the higher supply on purpose, so this is a question, not a warning; a body
 * wired explicitly is the answer and is never asked about. A body with no Net
 * is asked about the same way: a Cell with two supplies has no default to
 * give it, and the conventional VDD or ground it takes then need not be its
 * source's.
 */
function reportBodiesOffSourceSupply(
  document: SchematicDocument,
  context: CellNetContext,
  placedBodies: PlacedMosBodies | undefined,
  diagnostics: NetlistDiagnostic[],
): void {
  // Node 0 reads as ground.
  const spoken = (node: string) => (node === "0" ? "ground" : node);
  for (const item of mosBodiesOffSourceSupply(
    document,
    context.logicalNets,
    placedBodies,
  )) {
    const bodyNode = context.nameByNetId.get(item.bodyNet.id);
    const sourceNode = context.nameByNetId.get(item.sourceNet.id);
    if (!bodyNode || !sourceNode || bodyNode === sourceNode) continue;
    const body = spoken(bodyNode);
    const source = spoken(sourceNode);
    const kind = mosBulkKind(item.instance)!.toUpperCase();
    const follows =
      item.status === "conventional"
        ? `has no Net and takes the conventional ${body}`
        : item.status === "instance-override"
          ? `keeps the ${kind} default it was copied with, ${body}`
          : `follows the Cell's ${kind} default ${body}`;
    diagnostic(
      diagnostics,
      document.id,
      "MOS_BODY_OTHER_SUPPLY",
      `${item.instance.reference ?? item.instance.id}'s body ${follows}; its source is on ${source}. Connect its B pin to ${source} if that is the body you mean`,
      [item.instance.id],
      "info",
    );
  }
}

function extractCell(
  project: CircuitProject,
  document: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  cellNameByDocumentId: ReadonlyMap<string, string>,
  /** The Project's own subcircuit names; see projectSubcircuitNames. */
  projectNames: ReadonlySet<string>,
  projectedNames: ReadonlyMap<string, ProjectedNetName>,
  placedBodies: PlacedMosBodies | undefined,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistCell | null {
  if (!document.netlist) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_CELL_INTERFACE",
      `Document ${document.id} has no netlist interface`,
    );
    return null;
  }
  for (const formal of document.netlist.formalParameters) {
    if (formal.defaultValue !== undefined) continue;
    diagnostic(
      diagnostics,
      document.id,
      "UNREPRESENTABLE_REQUIRED_FORMAL_PARAMETER",
      `Formal parameter ${formal.name} has no portable SPICE/Spectre default`,
    );
  }
  if (document.instances.length > MAX_INSTANCES_PER_CELL) {
    diagnostic(
      diagnostics,
      document.id,
      "INSTANCE_LIMIT_EXCEEDED",
      `Cell has ${document.instances.length} instances; maximum is ${MAX_INSTANCES_PER_CELL}`,
    );
  }
  const context = buildNetContext(
    project,
    document,
    documentsById,
    new Map(
      project.externalSubcircuitDefinitions.map((definition) => [
        definition.id,
        definition,
      ]),
    ),
    projectedNames,
    options,
    diagnostics,
  );
  const interfaceProjection = projectCellInterface(document.netlist);
  for (const issue of interfaceProjection.issues) {
    diagnostic(
      diagnostics,
      document.id,
      issue.code,
      `Port ${issue.portName} has conflicting directions: ${issue.directions.join(", ")}`,
      [...issue.terminalIds],
    );
  }
  const ports: DesignNetlistCell["ports"] = interfaceProjection.ports.flatMap(
    (port) => {
      let hasMissingNet = false;
      for (const netId of port.netIds) {
        if (document.nets.some((candidate) => candidate.id === netId)) continue;
        hasMissingNet = true;
        diagnostic(
          diagnostics,
          document.id,
          "MISSING_INTERFACE_NET",
          `Netlist terminal ${port.name} references unknown Net ${netId}`,
          [netId],
        );
      }
      if (hasMissingNet) return [];
      const logicalNet = resolveDocumentLogicalNets(document).byBaseNetId.get(
        port.netIds[0]!,
      );
      const encodedPort = encodeCandidate(
        port.name,
        logicalNet?.scope ?? "local",
        options,
      );
      if (!encodedPort.ok) {
        diagnostic(
          diagnostics,
          document.id,
          encodedPort.code,
          `Port ${port.name} cannot be encoded for ${options.format}: ${encodedPort.message}`,
          [...port.netIds],
        );
        return [];
      }
      const representativeNetId = port.netIds[0]!;
      const netName = context.nameByNetId.get(representativeNetId) ?? port.name;
      return [{ id: representativeNetId, name: encodedPort.token, netName }];
    },
  );
  // Ground becomes this Cell's own pin: the node inside is named for it, and
  // the pin joins the interface beside the supplies. A Cell that only passes
  // ground to a child gets the node anyway, so the child's reference has
  // somewhere to come from.
  const printedAsSubcircuit = !(
    options.rootAsTopLevel && document.id === options.rootDocumentId
  );
  if (
    options.groundPin === "pin" &&
    printedAsSubcircuit &&
    cellReachesGround(document, documentsById)
  ) {
    const encodedGround = encodeCandidate(GROUND_PORT_NAME, "local", options);
    const groundNet = context.nets.find((net) => net.name === "0");
    const groundToken = encodedGround.ok
      ? encodedGround.token
      : GROUND_PORT_NAME;
    // An author who already gave ground a pin of their own keeps it: the
    // policy states a reference, it does not duplicate one. The node then
    // takes that pin's name, so no Cell printed as a subcircuit is left
    // reaching for the global reference under a different name.
    const authoredPin = groundNet
      ? ports.find((port) => port.netName === groundNet.name)
      : undefined;
    if (authoredPin && groundNet) {
      for (const [netId, name] of context.nameByNetId)
        if (name === groundNet.name)
          context.nameByNetId.set(netId, authoredPin.name);
      context.nameByAuthoredName.set(foldNetName("0"), authoredPin.name);
      groundNet.name = authoredPin.name;
      groundNet.scope = "local";
      authoredPin.netName = authoredPin.name;
    } else if (groundNet) {
      for (const [netId, name] of context.nameByNetId)
        if (name === "0") context.nameByNetId.set(netId, groundToken);
      context.nameByAuthoredName.set(foldNetName("0"), groundToken);
      groundNet.name = groundToken;
      groundNet.scope = "local";
      ports.splice(groundPortIndex(document, ports), 0, {
        id: groundNet.id,
        name: groundToken,
        netName: groundToken,
      });
    } else {
      // Nothing in this Cell touches ground; it exists only to carry the
      // reference down to a child that does.
      const passThroughId = deriveStableId(
        "netlist",
        "ground-port",
        document.id,
        GROUND_PORT_NAME,
      );
      context.nets.push({
        id: passThroughId,
        name: groundToken,
        scope: "local",
      });
      context.nameByNetId.set(passThroughId, groundToken);
      context.nameByAuthoredName.set(foldNetName("0"), groundToken);
      ports.splice(groundPortIndex(document, ports), 0, {
        id: passThroughId,
        name: groundToken,
        netName: groundToken,
      });
    }
  }
  // Node names are final here, ground included, so findings use them.
  reportDefaultBodySupplies(document, context, ports, diagnostics);
  reportBodiesOffSourceSupply(document, context, placedBodies, diagnostics);
  const referenceIndex = createReferenceIndex(document, project);
  const syntheticReferences = new Map<string, string>();
  const reservedReferences = new Set(referenceIndex.byReference.keys());
  for (const instance of [...document.instances].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (instance.reference) continue;
    const policy = referenceIndex.policyByInstanceId.get(instance.id);
    if (!policy) continue;
    const reference = nextReference(referenceIndex, policy, {
      reservedReferences,
    });
    if (!reference) continue;
    syntheticReferences.set(instance.id, reference);
    reservedReferences.add(reference.toLowerCase());
  }
  const reportedDuplicateReferences = new Set<string>();
  for (const issue of referenceIndex.issues) {
    if (issue.code === "MISSING_REFERENCE") continue;
    const otherInstanceIds = issue.otherInstanceId
      ? [issue.otherInstanceId, issue.instanceId]
      : [issue.instanceId];
    switch (issue.code) {
      case "WRONG_REFERENCE_PREFIX": {
        const policy = referenceIndex.policyByInstanceId.get(issue.instanceId);
        const free = policy
          ? nextReference(referenceIndex, policy, { reservedReferences })
          : undefined;
        diagnostic(
          diagnostics,
          document.id,
          "WRONG_REFERENCE_PREFIX",
          `Reference ${issue.reference} does not match ${issue.instanceId}'s component prefix ${issue.expectedPrefix}${free ? `; ${free} is free` : ""}`,
          otherInstanceIds,
        );
        break;
      }
      case "DUPLICATE_REFERENCE":
        if (
          !issue.reference ||
          reportedDuplicateReferences.has(issue.reference.toLowerCase())
        ) {
          break;
        }
        reportedDuplicateReferences.add(issue.reference.toLowerCase());
        diagnostic(
          diagnostics,
          document.id,
          "DUPLICATE_INSTANCE_REFERENCE",
          `Reference ${issue.reference} is duplicated under case folding`,
          otherInstanceIds,
        );
        break;
    }
  }
  const instances: DesignNetlistInstance[] = [];
  const cellPinInstanceIds = new Set(
    interfaceProjection.ports.flatMap((port) => port.interfaceInstanceIds),
  );
  const spelledReferences = new Map<
    string,
    { reference: string; id: string }
  >();
  for (const source of [...document.instances].sort((a, b) => {
    const left = a.reference ?? syntheticReferences.get(a.id) ?? a.id;
    const right = b.reference ?? syntheticReferences.get(b.id) ?? b.id;
    return compareText(left, right) || a.id.localeCompare(b.id);
  })) {
    // Older/Agent-authored drawings can omit references on primitive devices
    // too. Allocate only in this read-only projection, before dialect prefixes.
    // A Greek letter is written as its standard name (Mφ is Mphi).
    const authoredReference =
      source.reference ?? syntheticReferences.get(source.id);
    const reference =
      authoredReference === undefined
        ? undefined
        : spellGreekLetters(authoredReference);
    const instance =
      reference !== source.reference ? { ...source, reference } : source;
    if (reference && authoredReference) {
      const folded = reference.toLowerCase();
      const prior = spelledReferences.get(folded);
      if (!prior) {
        spelledReferences.set(folded, {
          reference: authoredReference,
          id: source.id,
        });
      } else if (
        prior.reference.toLowerCase() !== authoredReference.toLowerCase()
      ) {
        diagnostic(
          diagnostics,
          document.id,
          "DUPLICATE_INSTANCE_REFERENCE",
          `References ${prior.reference} and ${authoredReference} both export as ${reference}`,
          [prior.id, source.id],
        );
      }
    }
    if (cellPinInstanceIds.has(instance.id)) continue;
    const binding = instance.netlist?.binding;
    const builtInSubcircuit = instanceBuiltInSubcircuit(project, instance);
    const extracted = builtInSubcircuit
      ? extractBuiltInSubcircuitInstance(
          document,
          instance,
          builtInSubcircuit,
          instance.reference ?? syntheticReferences.get(instance.id)!,
          context,
          options,
          diagnostics,
          projectNames,
          bodyIgnoresSupplies(
            builtInBlockCallTarget(instance, builtInSubcircuit, projectNames),
            projectNames,
            options.format,
          ),
        )
      : binding?.kind === "subcircuit"
        ? extractHierarchyInstance(
            document,
            instance,
            documentsById,
            cellNameByDocumentId,
            context,
            options,
            diagnostics,
          )
        : binding?.kind === "external-subcircuit"
          ? extractExternalSubcircuitInstance(
              document,
              instance,
              project.externalSubcircuitDefinitions.find(
                (definition) => definition.id === binding.definitionId,
              ),
              context,
              diagnostics,
            )
          : extractDeviceInstance(
              project,
              document,
              instance,
              context,
              options,
              diagnostics,
            );
    if (extracted) instances.push(extracted);
  }
  const models: DesignNetlistModel[] = [];
  if (
    instances.some(
      (instance) =>
        instance.deviceClass === "switch" &&
        instance.target === IDEAL_SWITCH_MODEL.name,
    )
  )
    models.push(structuredClone(IDEAL_SWITCH_MODEL));
  // SPICE only (VACASK prints it from the SPICE card). A Spectre export still
  // names DIODE for the reader's libraries to define.
  const genericDiodes =
    options.format === "spice"
      ? instances.filter(
          (instance) =>
            instance.deviceClass === "diode" &&
            instance.target === GENERIC_DIODE_MODEL.name,
        )
      : [];
  if (genericDiodes.length && !projectDefinesGenericDiode(project)) {
    models.push(structuredClone(GENERIC_DIODE_MODEL));
    reportGenericDiodes(document, genericDiodes, diagnostics);
  }
  for (const extracted of instances) {
    const source = document.instances.find(
      (candidate) => candidate.id === extracted.id,
    );
    if (
      source?.symbolId !== "zener-diode" ||
      source.netlist?.binding !== undefined ||
      extracted.target !== builtInZenerModelName(extracted.reference)
    )
      continue;
    const bv = zenerParameter(source, "bv");
    if (!bv?.trim()) continue;
    const ibv = zenerParameter(source, "ibv");
    models.push({
      name: extracted.target,
      type: "D",
      parameters: [
        { name: "BV", rawValue: bv.trim() },
        ...(ibv?.trim() ? [{ name: "IBV", rawValue: ibv.trim() }] : []),
      ],
    });
  }
  return {
    id: document.id,
    name:
      cellNameByDocumentId.get(document.id) ??
      portableCellIdentifier(document.netlist.name, document.id),
    ports,
    nets: context.nets,
    instances,
    ...(models.length ? { models } : {}),
    formalParameters: document.netlist.formalParameters.map((parameter) => ({
      name: parameter.name,
      ...(parameter.defaultValue === undefined
        ? {}
        : { defaultValue: parameter.defaultValue }),
    })),
  };
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
  const resolvedOptions: ResolvedDesignNetlistAnalysisOptions = {
    format: options.format ?? "spice",
    namingProfile: options.namingProfile ?? "native",
    rootDocumentId: options.rootDocumentId ?? project.topDocumentId,
    rootAsTopLevel: options.rootAsTopLevel ?? false,
    groundPin: options.groundPin ?? "global",
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
  const comparatorCell = cellNames.get(IDEAL_COMPARATOR_TARGET);
  const comparatorExternal = externalNames.get(IDEAL_COMPARATOR_TARGET);
  if (comparatorCell || comparatorExternal) {
    for (const document of documents) {
      for (const instance of document.instances) {
        const descriptor = subcircuitDescriptor(instance.symbolId, project);
        if (
          descriptor?.target !== "comparator" ||
          instance.netlist?.binding?.kind !== "unresolved-subcircuit" ||
          instance.netlist.binding.name !== IDEAL_COMPARATOR_TARGET
        )
          continue;
        diagnostic(
          diagnostics,
          document.id,
          "IDEAL_COMPARATOR_NAME_COLLISION",
          `Ideal comparator ${instance.reference ?? instance.id} conflicts with ${comparatorCell ? `Cell ${comparatorCell.authoredName}` : `external subcircuit ${comparatorExternal}`} named ${IDEAL_COMPARATOR_TARGET}`,
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
    // Only icm_ideal_comparator has a generated body. A comparator placed
    // today is bound to it; one with no binding (an older drawing) falls
    // back to the bare target `comparator`, which nothing defines unless
    // the Project declares an external definition of that name.
    IDEAL_COMPARATOR_TARGET,
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
    if (
      descriptor.target === "comparator" &&
      target === IDEAL_COMPARATOR_TARGET
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
        ...(!projectNames.has(IDEAL_COMPARATOR_TARGET.toLowerCase()) &&
        cells.some((cell) =>
          cell.instances.some(
            (instance) => instance.target === IDEAL_COMPARATOR_TARGET,
          ),
        )
          ? [{ kind: "behavioral" as const, name: IDEAL_COMPARATOR_TARGET }]
          : []),
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
