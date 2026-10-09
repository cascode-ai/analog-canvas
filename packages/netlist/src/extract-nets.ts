// Nets and their names: each Cell's net context, from its logical Nets and
// their spellings to NoConnect nodes, and the node a pin is written on.
import { deriveStableId, foldNetName, projectCellInterface } from "@icm/model";
import {
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
} from "@icm/model";
import { deviceDescriptor, resolveReviewedExternalBinding } from "@icm/devices";
import type { DesignNetlistCell, NetlistDiagnostic } from "./ir.js";
import {
  encodedNetNameCollisionKey,
  encodeNetName,
  type EncodedNetName,
} from "./net-name-codec.js";
import {
  type ResolvedDesignNetlistAnalysisOptions,
  diagnostic,
} from "./extract-common.js";

const MAX_NETS_PER_CELL = 100_000;

export interface CellNetContext {
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

export function encodeCandidate(
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
export function withNetlistPowerMarkerClaims(
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

export function buildNetContext(
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
        const reviewed =
          externalDefinition && !externalDefinition.implementation
            ? resolveReviewedExternalBinding(
                externalDefinition.name,
                externalDefinition.terminals.map((terminal) => terminal.name),
                instance.symbolId,
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

export function terminalNetName(
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
