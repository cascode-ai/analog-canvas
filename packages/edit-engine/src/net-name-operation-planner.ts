import { resolveDocumentLogicalNets } from "@icm/derived";
import { deriveStableId, foldNetName, renamedLabelFormat } from "@icm/model";
import type { RouteEndpoint, SchematicDocument } from "@icm/model";

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
    ...boundLabels.map((annotation): SchematicEdit => {
      // The label keeps showing this marker's name, so its stored format
      // must follow the new spelling rather than keep the old one.
      const { formatOverride: _format, ...rest } = annotation;
      const format = renamedLabelFormat(
        annotation,
        currentName ?? requestedName,
        requestedName,
        document.presentation,
      );
      return {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...rest,
          ...(format ? { formatOverride: format } : {}),
          netId: ensured.netId,
          binding: { kind: "net-name", netId: ensured.netId },
        },
      };
    }),
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
