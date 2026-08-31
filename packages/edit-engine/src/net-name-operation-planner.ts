import { resolveDocumentLogicalNets } from "@icm/derived";
import { deriveStableId, foldNetName } from "@icm/model";
import type {
  ConnectivityEvidence,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";

import { planEnsurePowerNet } from "./power-net-planner.js";
import {
  createRoutingOperationPlan,
  type RoutingOperationPlan,
} from "./routing-operation-plan.js";
import type { SchematicEdit } from "./edit-schema.js";

export type NetNameOperationResult =
  | { readonly status: "noop" }
  | { readonly status: "rejected"; readonly message: string }
  | {
      readonly status: "ready";
      readonly message: string;
      readonly plan: RoutingOperationPlan;
    };

type NameClaim = Extract<ConnectivityEvidence, { kind: "name-claim" }>;

function markerContract(symbolId: string) {
  return symbolId === "vdd-port"
    ? ({ pinName: "P", domain: "vdd", scope: "global" } as const)
    : symbolId === "ground"
      ? ({ pinName: "0", domain: "ground", scope: "global" } as const)
      : undefined;
}

/** Rename one marker owner; the old Logical Net and its other owners stay put. */
export function planElectricalMarkerRename(
  document: SchematicDocument,
  instanceId: string,
  rawName: string,
): NetNameOperationResult {
  const instance = document.instances.find((item) => item.id === instanceId);
  if (!instance) {
    return { status: "rejected", message: "Electrical marker is unavailable" };
  }
  if (
    document.netlist?.terminals.some((terminal) =>
      terminal.interfaceInstanceIds.includes(instanceId),
    )
  ) {
    return { status: "rejected", message: "Formal Cell Pins use Cell naming" };
  }
  const marker = markerContract(instance.symbolId);
  if (!marker) {
    return {
      status: "rejected",
      message: "Instance is not an electrical marker",
    };
  }
  const endpoint: RouteEndpoint = {
    kind: "terminal",
    instanceId,
    pinName: marker.pinName,
  };
  const oldNet = document.nets.find((net) =>
    net.terminals.some(
      (terminal) =>
        terminal.instanceId === instanceId &&
        terminal.pinName === marker.pinName,
    ),
  );
  if (!oldNet) {
    return { status: "rejected", message: "Electrical marker has no Net" };
  }
  const requestedName = rawName.trim();
  if (!requestedName) {
    return { status: "rejected", message: "An electrical marker needs a name" };
  }
  const currentName = resolveDocumentLogicalNets(document).byBaseNetId.get(
    oldNet.id,
  )?.name;
  if (currentName && foldNetName(currentName) === foldNetName(requestedName)) {
    return { status: "noop" };
  }

  const candidateNetId = deriveStableId(
    "net",
    document.id,
    "power",
    instanceId,
    foldNetName(requestedName),
  );
  const evidenceId = deriveStableId(
    "connectivity-evidence",
    document.id,
    "power-marker",
    instanceId,
    candidateNetId,
  );
  const ensured = planEnsurePowerNet(document, {
    candidateNetId,
    candidateState: "pending-connection",
    domain: marker.domain,
    name: requestedName,
    scope: marker.scope,
    evidenceId,
    owner: { kind: "power-marker", objectId: instanceId },
  });
  if (!ensured.ok) {
    return { status: "rejected", message: ensured.message };
  }
  const staleClaims = document.connectivityEvidence.filter(
    (evidence) =>
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker" &&
      evidence.owner.objectId === instanceId,
  );
  const boundLabels = document.annotations.filter(
    (annotation) =>
      annotation.binding?.kind === "net-name" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instanceId,
  );
  const edits: SchematicEdit[] = [
    { kind: "disconnect_endpoint", endpoint },
    ...staleClaims.map((evidence): SchematicEdit => ({
      kind: "remove_connectivity_evidence",
      evidenceId: evidence.id,
    })),
    {
      kind: "connect_endpoints",
      from: endpoint,
      to: endpoint,
      newNetId: candidateNetId,
    },
    ...ensured.edits,
    ...boundLabels.map((annotation): SchematicEdit => ({
      kind: "upsert_schematic_annotation",
      annotation: {
        ...annotation,
        netId: ensured.netId,
        binding: { kind: "net-name", netId: ensured.netId },
      },
    })),
  ];
  return {
    status: "ready",
    message: `Supply named ${requestedName}`,
    plan: createRoutingOperationPlan(document, {
      intent: "rename-marker",
      expectedElectricalEffect: {
        kind: "rebind-name-owner",
        ownerKey: `power-marker:${instanceId}`,
        fromBaseNetId: oldNet.id,
        requestedName,
        scope: marker.scope,
      },
      edits,
      diagnostics: [],
    }),
  };
}

/** Rename every editable owner claim in one derived Logical Net. */
export function planLogicalNetRename(
  document: SchematicDocument,
  logicalNetId: string,
  rawName: string,
  requestedScope?: "local" | "global",
): NetNameOperationResult {
  const resolved = resolveDocumentLogicalNets(document);
  const group =
    resolved.byId.get(logicalNetId) ?? resolved.byBaseNetId.get(logicalNetId);
  if (!group)
    return { status: "rejected", message: "Logical Net is unavailable" };
  const requestedName = rawName.trim();
  if (!requestedName)
    return { status: "rejected", message: "A Net needs a name" };
  const scope = requestedScope ?? group.scope ?? "local";
  if (
    group.name &&
    foldNetName(group.name) === foldNetName(requestedName) &&
    group.scope === scope
  ) {
    return { status: "noop" };
  }
  const target = resolved.groups.find(
    (candidate) =>
      candidate.id !== group.id &&
      candidate.name !== undefined &&
      foldNetName(candidate.name) === foldNetName(requestedName),
  );
  if (target?.scope && target.scope !== scope) {
    return {
      status: "rejected",
      message: "Cannot merge Net names across scopes",
    };
  }
  if (
    target &&
    target.powerDomain !== "none" &&
    group.powerDomain !== "none" &&
    target.powerDomain !== group.powerDomain
  ) {
    return {
      status: "rejected",
      message: "Cannot merge Net names with incompatible power roles",
    };
  }
  const groupNetIds = new Set(group.baseNetIds);
  const claims = document.connectivityEvidence.filter(
    (evidence): evidence is NameClaim =>
      evidence.kind === "name-claim" &&
      evidence.owner.kind !== "global-declaration" &&
      groupNetIds.has(evidence.netId),
  );
  const edits: SchematicEdit[] = claims.map((evidence): SchematicEdit => ({
    kind: "upsert_connectivity_evidence",
    evidence: { ...evidence, name: requestedName, scope },
  }));
  if (claims.length === 0) {
    return {
      status: "rejected",
      message:
        "This Net has no editable visible name owner; rename its Cell Pin or add a Net Label",
    };
  }
  return {
    status: "ready",
    message: `Net named ${requestedName}`,
    plan: createRoutingOperationPlan(document, {
      intent: "rename-net",
      expectedElectricalEffect: {
        kind: "rename-logical-net",
        logicalNetId: group.baseNetIds[0]!,
        requestedName,
        scope,
      },
      edits,
      diagnostics: [],
    }),
  };
}
