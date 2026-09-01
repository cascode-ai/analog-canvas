import { foldNetName, projectCellInterface, routeEndpoints } from "@icm/model";
import {
  deriveProjectNetNameProjection,
  directObjectLocator,
  resolveDocumentLogicalNets,
  type ProjectedNetName,
  type ResolvedLogicalNet,
} from "@icm/derived";
import type {
  RouteEndpoint,
  CircuitProject,
  ExternalSubcircuitDefinition,
  Instance,
  SchematicDocument,
  StableId,
} from "@icm/model";
import {
  createReferenceIndex,
  deviceDescriptor,
  requiredParameterNames,
} from "@icm/devices";

import type {
  DesignNetlistCell,
  DesignNetlistAnalysisResult,
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
): void {
  diagnostics.push({
    code,
    severity,
    documentId,
    objectIds,
    primary: directObjectLocator(documentId, "document", documentId),
    message,
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
  diagnostics: NetlistDiagnostic[],
): SchematicDocument[] {
  const byId = new Map(
    project.documents.map((document) => [document.id, document]),
  );
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
        parentId ?? project.topDocumentId,
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

  visit(project.topDocumentId);
  if (ordered.length > MAX_CELLS) {
    diagnostic(
      diagnostics,
      project.topDocumentId,
      "CELL_LIMIT_EXCEEDED",
      `Reachable hierarchy has ${ordered.length} cells; maximum is ${MAX_CELLS}`,
    );
  }
  return ordered;
}

interface CellNetContext {
  nameByNetId: Map<string, string>;
  netByTerminal: Map<string, ResolvedLogicalNet>;
  noConnectNameByTerminal: Map<string, string>;
  nets: DesignNetlistCell["nets"];
}

export interface DesignNetlistAnalysisOptions {
  format?: NetlistFormat;
  namingProfile?: NetlistNamingProfile;
}

type ResolvedDesignNetlistAnalysisOptions =
  Required<DesignNetlistAnalysisOptions>;

function encodeCandidate(
  name: string,
  scope: "local" | "global",
  options: ResolvedDesignNetlistAnalysisOptions,
): EncodedNetName {
  return encodeNetName(name, scope, options.format, options.namingProfile);
}

function buildNetContext(
  document: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  projectedNames: ReadonlyMap<string, ProjectedNetName>,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): CellNetContext {
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
  let generatedIndex = 1;
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
        name = `N${String(generatedIndex).padStart(4, "0")}`;
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
        const allowedPins = child?.netlist
          ? projectCellInterface(child.netlist).ports.map((port) => port.name)
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
    netByTerminal,
    noConnectNameByTerminal,
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
  const net = context.netByTerminal.get(`${instance.id}\u0000${pinName}`);
  const name = net ? context.nameByNetId.get(net.id) : undefined;
  const noConnectName = context.noConnectNameByTerminal.get(
    `${instance.id}\u0000${pinName}`,
  );
  if (noConnectName) return noConnectName;
  if (!name) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_PIN_NET",
      `Required pin ${instance.reference ?? instance.id}.${pinName} is not connected to an exportable Net`,
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
  context: CellNetContext,
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
  const nodes = projectCellInterface(child.netlist).ports.flatMap((port) => {
    const netName = terminalNetName(
      document,
      instance,
      port.name,
      context,
      diagnostics,
    );
    return netName ? [{ pinName: port.name, netName }] : [];
  });
  return {
    id: instance.id,
    reference: instance.reference!,
    deviceClass: "hierarchical",
    target: child.netlist.name,
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
  const allowedPins = new Set(
    definition.terminals.map((terminal) => terminal.name.toLowerCase()),
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
  const nodes = definition.terminals.flatMap((terminal) => {
    const netName = terminalNetName(
      document,
      instance,
      terminal.name,
      context,
      diagnostics,
    );
    return netName ? [{ pinName: terminal.name, netName }] : [];
  });
  return {
    id: instance.id,
    reference: instance.reference!,
    deviceClass: "hierarchical",
    target: definition.name,
    nodes,
    parameters: Object.entries(netlist.parameters)
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
        `Net marker ${instance.id} must connect to an explicitly named Net`,
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
  const netlist = instance.netlist;
  if (!netlist) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_INSTANCE_NETLIST",
      `Instance ${instance.id} has no netlist data`,
      [instance.id],
    );
    return null;
  }
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
    (netlist.binding?.kind !== "primitive" ||
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
    return netName ? [{ pinName, netName }] : [];
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
  return {
    id: instance.id,
    reference: instance.reference!,
    deviceClass: definition.deviceClass,
    target,
    nodes,
    parameters: Object.entries(netlist.parameters)
      .sort(([a], [b]) => compareText(a, b))
      .map(([name, rawValue]) => ({ name, rawValue })),
  };
}

function extractCell(
  project: CircuitProject,
  document: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
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
  if (!isIdentifier(document.netlist.name)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_CELL_NAME",
      `Cell name is outside the portable identifier subset: ${document.netlist.name}`,
    );
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
    projectedNames,
    options,
    diagnostics,
  );
  const interfaceProjection = projectCellInterface(document.netlist);
  const ports = interfaceProjection.ports.flatMap((port) => {
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
  });

  const referenceIndex = createReferenceIndex(document);
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
  for (const instance of [...document.instances].sort((a, b) => {
    const left = a.reference ?? a.id;
    const right = b.reference ?? b.id;
    return compareText(left, right) || a.id.localeCompare(b.id);
  })) {
    if (cellPinInstanceIds.has(instance.id)) continue;
    const binding = instance.netlist?.binding;
    const extracted =
      binding?.kind === "subcircuit"
        ? extractHierarchyInstance(
            document,
            instance,
            documentsById,
            context,
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
    name: document.netlist.name,
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
  const resolvedOptions: ResolvedDesignNetlistAnalysisOptions = {
    format: options.format ?? "spice",
    namingProfile: options.namingProfile ?? "native",
  };
  const diagnostics: NetlistDiagnostic[] = [];
  const documents = reachableDocuments(project, diagnostics);
  const nameProjection = deriveProjectNetNameProjection(project);
  const documentsById = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const cellNames = new Map<string, string>();
  const cells: DesignNetlistCell[] = [];
  for (const document of documents) {
    const name = document.netlist?.name;
    if (name) {
      const folded = name.toLowerCase();
      const prior = cellNames.get(folded);
      if (prior) {
        diagnostic(
          diagnostics,
          document.id,
          "DUPLICATE_CELL_NAME",
          `Cell name ${name} duplicates Document ${prior} under case folding`,
          [prior, document.id],
        );
      } else {
        cellNames.set(folded, document.id);
      }
    }
    const cell = extractCell(
      project,
      document,
      documentsById,
      nameProjection.byDocumentId.get(document.id) ?? new Map(),
      resolvedOptions,
      diagnostics,
    );
    if (cell) cells.push(cell);
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
  if (diagnostics.some((item) => item.severity === "error")) {
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
  return {
    ir: {
      topCellId: project.topDocumentId,
      cells,
      globals,
      externalMasters: [
        ...new Map(
          documents
            .flatMap((document) => document.instances)
            .flatMap((instance) => {
              const binding = instance.netlist?.binding;
              if (binding?.kind !== "external-subcircuit") return [];
              const definition = project.externalSubcircuitDefinitions.find(
                (item) => item.id === binding.definitionId,
              );
              return definition ? [[definition.id, definition] as const] : [];
            }),
        ).values(),
      ]
        .sort((left, right) => compareText(left.name, right.name))
        .map((definition) => ({
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
        })),
    },
    diagnostics,
  };
}
