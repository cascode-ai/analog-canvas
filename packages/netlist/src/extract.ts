import {
  deriveStableId,
  foldNetName,
  projectCellInterface,
  routeEndpoints,
} from "@icm/model";
import {
  deriveProjectNetNameProjection,
  portableCellIdentifier,
  findExternalMasterCollisions,
  directObjectLocator,
  drawnSupplyNet,
  mosBulkKind,
  resolveMosBulkConnection,
  resolveDocumentLogicalNets,
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
  createReferenceIndex,
  deviceDescriptor,
  nextReference,
  projectLengthToSky130Micrometres,
  requiredParameterNames,
  resolveReviewedExternalBinding,
  subcircuitDescriptor,
  type BuiltInSubcircuitDescriptor,
} from "@icm/devices";

import type {
  DesignNetlistCell,
  DesignNetlistAnalysisResult,
  DesignNetlistExternalMaster,
  DesignNetlistInstance,
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
import { withImplicitMosSupplies } from "./implicit-mos-supplies.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_CELLS = 1024;
const MAX_INSTANCES_PER_CELL = 100_000;
const MAX_NETS_PER_CELL = 100_000;

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
  severity: "error" | "warning" = "error",
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
    const pinName = deviceDescriptor(instance.symbolId)?.pinOrder[0];
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
  sourceDocument: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  externalDefinitionsById: ReadonlyMap<string, ExternalSubcircuitDefinition>,
  projectedNames: ReadonlyMap<string, ProjectedNetName>,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): CellNetContext {
  const document = withNetlistPowerMarkerClaims(sourceDocument);
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
      diagnostic(
        diagnostics,
        document.id,
        "GENERATED_NET_NAME",
        `Unnamed logical Net ${logicalNet.id} exports as ${name}`,
        [...logicalNet.baseNetIds],
        "warning",
      );
    }
    if (!name) continue;
    const encoded = encodeCandidate(name, logicalNet.scope ?? "local", options);
    if (!encoded.ok) {
      diagnostic(diagnostics, document.id, encoded.code, encoded.message, [
        ...logicalNet.baseNetIds,
        ...logicalNet.evidenceIds,
      ]);
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
              : deviceDescriptor(instance.symbolId)?.pinOrder;
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
    diagnostic(
      diagnostics,
      document.id,
      "GENERATED_NO_CONNECT_NODE",
      `Explicit NoConnect ${noConnect.id} exports as floating node ${generated}`,
      [noConnect.id, noConnect.endpoint.instanceId],
      "warning",
    );
  }

  const emittedNetNames = new Set<string>();
  return {
    nameByNetId,
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

/**
 * The node a built-in Block's declared supply exports to when the Cell drew
 * no supply of that domain at all — a Block used at the abstract level with
 * nothing above it yet.
 *
 * The Block's library interface states that it needs this node; declaring it
 * as a global of the same name says exactly that and nothing more. It adds no
 * Cell port, claims no Net in the Document, and changes no membership: the
 * drawing is unchanged and a warning records what the netlist declared. When
 * the Cell already spells that name for a local Net, the declaration would be
 * two different nodes under one token, so the supply stays missing instead.
 */
function declaredBlockSupplyName(
  document: SchematicDocument,
  instance: Instance,
  supply: "VDD" | "VSS",
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): string | undefined {
  const encoded = encodeCandidate(supply, "global", options);
  if (!encoded.ok) return undefined;
  const taken = context.nets.find(
    (net) =>
      encodedNetNameCollisionKey(net.name, options.format) ===
      encoded.collisionKey,
  );
  if (taken && taken.scope !== "global") return undefined;
  if (!taken) {
    context.nets.push({
      id: deriveStableId("netlist", "block-supply", document.id, supply),
      name: encoded.token,
      scope: "global",
    });
  }
  diagnostic(
    diagnostics,
    document.id,
    "DECLARED_BLOCK_SUPPLY",
    `Analog Block ${instance.reference ?? instance.id} has no ${supply} Net in this Cell; its declared supply exports as global node ${encoded.token}`,
    [instance.id],
    "warning",
  );
  return encoded.token;
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
  // Missing connectivity is an error, not permission to infer a supply from
  // device polarity or a matching Net name elsewhere in the Cell.
  if (!name) {
    const body = pinName === "B" && mosBulkKind(instance);
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_PIN_NET",
      body
        ? // The fourth node has two authored answers; name both so the
          // report is actionable instead of only true.
          `Required pin ${instance.reference ?? instance.id}.B has no body Net: connect B, or set this Cell's MOS body default`
        : `Required pin ${instance.reference ?? instance.id}.${pinName} is not connected to an exportable Net`,
      [instance.id],
    );
    return null;
  }
  return name;
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
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
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
  const target =
    binding?.kind === "unresolved-subcircuit"
      ? binding.name
      : definition.target;
  if (!isIdentifier(reference) || !isIdentifier(target)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_SUBCIRCUIT_IDENTIFIER",
      `Analog Block ${reference} or target ${target} is outside the portable identifier subset`,
      [instance.id],
    );
  }
  const parameters = Object.entries(netlist?.parameters ?? {});
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
  const nodes = definition.ports.flatMap((port) => {
    if (port.supply) {
      // The library declares a fixed named supply, not permission to invent
      // a Net or a Cell interface. Resolve authored identity before encoding.
      const netName = context.nameByAuthoredName.get(foldNetName(port.supply));
      if (netName) return [{ pinName: port.name, netName }];
      // Failing that, the supply the author drew: a Block's VSS sits on the
      // Cell's ground and its VDD on the Cell's positive supply, the same
      // reading a MOS body uses for its fourth node. Nobody names a Net
      // "VSS" when they have drawn a ground symbol, and the Block asking for
      // one by spelling was never an electrical requirement.
      const drawn = drawnSupplyNet(
        document,
        port.supply === "VDD" ? "vdd" : "ground",
      );
      const drawnName = drawn ? context.nameByNetId.get(drawn.id) : undefined;
      if (drawnName) return [{ pinName: port.name, netName: drawnName }];
      // Nothing of that domain is drawn: declare the node the Block's own
      // interface asks for, as a global, and say so.
      const declared = declaredBlockSupplyName(
        document,
        instance,
        port.supply,
        context,
        options,
        diagnostics,
      );
      if (declared) return [{ pinName: port.name, netName: declared }];
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_BLOCK_SUPPLY",
        `Analog Block ${reference} requires a ${port.supply} Net; the Cell already spells ${port.supply} for a local Net, so draw the ${port.supply === "VDD" ? "positive supply" : "ground"} or rename that Net`,
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

function extractDeviceInstance(
  document: SchematicDocument,
  instance: Instance,
  context: CellNetContext,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const definition = deviceDescriptor(instance.symbolId);
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
  // A device the registry designates but gives no netlist target is drawing
  // only: the two-terminal Razavi switches are drawn, numbered, and read, but
  // SPICE's `S` wants four nodes and a model card they cannot supply. Say so
  // and emit nothing. Falling through would reach the printer with a null
  // target where the model name belongs, and it throws there.
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
  // and Agent-authored instances reach here without one, and refusing the
  // whole netlist over an absent object would report the drawing as broken
  // when what is missing is a model target the export already writes as TODO.
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
    if (netlist.binding?.kind !== "model") {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_MODEL_TARGET",
        `Instance ${instance.reference!} requires an explicit model target`,
        [instance.id],
      );
    } else if (netlist.binding.deviceClass !== definition.deviceClass) {
      diagnostic(
        diagnostics,
        document.id,
        "DEVICE_CLASS_MISMATCH",
        `Binding class ${netlist.binding.deviceClass} does not match ${definition.deviceClass}`,
        [instance.id],
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
  const target =
    netlist.binding?.kind === "model" ? netlist.binding.name : null;
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
      : authoredParameters,
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

function extractCell(
  project: CircuitProject,
  document: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  cellNameByDocumentId: ReadonlyMap<string, string>,
  projectedNames: ReadonlyMap<string, ProjectedNetName>,
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
  const referenceIndex = createReferenceIndex(document);
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
      case "WRONG_REFERENCE_PREFIX":
        diagnostic(
          diagnostics,
          document.id,
          "WRONG_REFERENCE_PREFIX",
          `Reference ${issue.reference} does not match ${issue.instanceId}'s component prefix`,
          otherInstanceIds,
        );
        break;
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
  for (const source of [...document.instances].sort((a, b) => {
    const left = a.reference ?? syntheticReferences.get(a.id) ?? a.id;
    const right = b.reference ?? syntheticReferences.get(b.id) ?? b.id;
    return compareText(left, right) || a.id.localeCompare(b.id);
  })) {
    // Older/Agent-authored drawings can omit references on primitive devices
    // too. Allocate only in this read-only projection, before dialect prefixes.
    const generatedReference = syntheticReferences.get(source.id);
    const instance = generatedReference
      ? { ...source, reference: generatedReference }
      : source;
    if (cellPinInstanceIds.has(instance.id)) continue;
    const binding = instance.netlist?.binding;
    const builtInSubcircuit = subcircuitDescriptor(instance.symbolId);
    const extracted = builtInSubcircuit
      ? extractBuiltInSubcircuitInstance(
          document,
          instance,
          builtInSubcircuit,
          instance.reference ?? syntheticReferences.get(instance.id)!,
          context,
          options,
          diagnostics,
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
          : extractDeviceInstance(document, instance, context, diagnostics);
    if (extracted) instances.push(extracted);
  }
  return {
    id: document.id,
    name:
      cellNameByDocumentId.get(document.id) ??
      portableCellIdentifier(document.netlist.name, document.id),
    ports,
    nets: context.nets,
    instances,
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
  project = withImplicitMosSupplies(project, resolvedOptions);
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
    const cell = extractCell(
      project,
      document,
      documentsById,
      cellNameByDocumentId,
      nameProjection.byDocumentId.get(document.id) ?? new Map(),
      resolvedOptions,
      diagnostics,
    );
    if (cell) {
      if (resolvedOptions.format === "spice") projectSpiceReferences(cell);
      cells.push(cell);
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
    const descriptor = subcircuitDescriptor(instance.symbolId);
    if (!descriptor) continue;
    const target =
      binding?.kind === "unresolved-subcircuit"
        ? binding.name
        : descriptor.target;
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
  return {
    ir: {
      topCellId: resolvedOptions.rootDocumentId,
      cells,
      globals,
      externalMasters: [...externalMasters.values()].sort((left, right) =>
        compareText(left.name, right.name),
      ),
    },
    diagnostics,
  };
}
