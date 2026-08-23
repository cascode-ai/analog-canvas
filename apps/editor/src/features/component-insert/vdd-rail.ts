import type { SchematicEdit } from "@icm/edit-engine";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { foldNetName, type Point, type SchematicDocument } from "@icm/model";

import { planInitialMosBulkDefault } from "./mos-bulk-defaults";

export interface VddRailConstruction {
  instanceId: string;
  start: Point;
  end: Point;
  netId?: string;
  netName?: string;
  scope?: "local" | "global";
}

export type VddRailPlan =
  | { ok: true; netId: string; edits: readonly SchematicEdit[] }
  | { ok: false; message: string };

/**
 * Constrain a snapped pointer to one straight Power Rail axis. The dominant
 * delta selects the axis and ties retain the established horizontal gesture.
 * Preview and commit must both use this one projection.
 */
export function constrainedPowerRailEndpoint(
  start: Point,
  pointer: Point,
): Point {
  const dx = pointer.x - start.x;
  const dy = pointer.y - start.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: pointer.x, y: start.y }
    : { x: start.x, y: pointer.y };
}

/**
 * Persist the visual VDD rail as an ordinary editable Route rather than as a
 * stretchable Symbol. The explicitly tagged Net is the electrical authority;
 * its route anchors and rail own all visible geometry.
 */
export function constructVddRailEdits({
  instanceId,
  start,
  end,
  netId,
  netName = "VDD",
  scope = "global",
}: VddRailConstruction): SchematicEdit[] {
  const key = instanceId.toLowerCase();
  const targetNetId = netId ?? `net-power-${key}`;
  const startJunctionId = `junction-${key}-start`;
  const endJunctionId = `junction-${key}-end`;
  return [
    {
      kind: "add_power_rail",
      netId: targetNetId,
      routeId: `route-${key}-rail`,
      startJunctionId,
      endJunctionId,
      labelId: `label-${instanceId}`,
      netName,
      scope,
      powerDomain: "vdd",
      start,
      end,
    },
  ];
}

/** Resolve a named supply before constructing its visual rail. */
export function planVddRailEdits(
  document: SchematicDocument,
  construction: VddRailConstruction,
): VddRailPlan {
  const netName = construction.netName?.trim() || "VDD";
  const requested = construction.netId
    ? document.nets.find((net) => net.id === construction.netId)
    : undefined;
  const requestedLogical = requested
    ? resolveDocumentLogicalNets(document).byBaseNetId.get(requested.id)
    : undefined;
  if (
    requestedLogical?.name &&
    foldNetName(requestedLogical.name) !== foldNetName(netName)
  ) {
    return {
      ok: false,
      message: `Power rail target ${requestedLogical.name} does not match ${netName}`,
    };
  }
  const target = requested;
  if (
    target &&
    requestedLogical?.powerDomain !== "none" &&
    requestedLogical?.powerDomain !== "vdd"
  ) {
    return {
      ok: false,
      message: `Power rail target ${netName} has incompatible role ${requestedLogical?.powerDomain}`,
    };
  }
  const netId =
    target?.id ?? `net-power-${construction.instanceId.toLowerCase()}`;
  return {
    ok: true,
    netId,
    edits: [
      ...constructVddRailEdits({
        ...construction,
        netId,
        netName,
        scope: requestedLogical?.scope ?? construction.scope ?? "global",
      }),
      ...planInitialMosBulkDefault(document, "vdd", netId),
    ],
  };
}
