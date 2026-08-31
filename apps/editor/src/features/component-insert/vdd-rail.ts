import type { ExpectedElectricalEffect, SchematicEdit } from "@icm/edit-engine";
import {
  endpointKey,
  findRouteSegmentsAtPoint,
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import {
  foldNetName,
  routeEnd,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

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
  | {
      ok: true;
      netId: string;
      edits: readonly SchematicEdit[];
      /**
       * Present only when an end of the rail lands on an existing conductor,
       * which is the one case where placing a rail joins two Base Nets.
       */
      expectedElectricalEffect?: ExpectedElectricalEffect;
    }
  | { ok: false; message: string };

/**
 * The Net merges a drawn rail performs, declared from geometry.
 *
 * A rail END that lands on an existing conductor connects to it, exactly as a
 * pin dropped on a wire does. A rail that merely CROSSES a wire touches it at
 * an interior point of both and connects nothing — the crossing invariant —
 * so only the two rail ends are considered, and each is paired with the
 * conductor it terminates on. Without this declaration the operation reads as
 * "preserve" and the routing gate refuses the very connection the gesture
 * asked for.
 */
function railEndpointMergeEffect(
  document: SchematicDocument,
  resolver: SymbolResolver,
  construction: { start: Point; end: Point },
  junctionIds: { startJunctionId: string; endJunctionId: string },
): ExpectedElectricalEffect | undefined {
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  const groups = (
    [
      [construction.start, junctionIds.startJunctionId],
      [construction.end, junctionIds.endJunctionId],
    ] as const
  ).flatMap(([point, junctionId]) => {
    const partners = findRouteSegmentsAtPoint(geometry, point).flatMap(
      (address) => {
        const route = document.routes.find(
          (candidate) => candidate.id === address.routeId,
        );
        return route
          ? [endpointKey(route.start), endpointKey(routeEnd(route))]
          : [];
      },
    );
    return partners.length > 0
      ? [[endpointKey({ kind: "junction", junctionId }), ...new Set(partners)]]
      : [];
  });
  return groups.length > 0
    ? { kind: "merge", endpointGroups: groups }
    : undefined;
}

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
  resolver?: SymbolResolver,
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
  const key = construction.instanceId.toLowerCase();
  const mergeEffect = resolver
    ? railEndpointMergeEffect(document, resolver, construction, {
        startJunctionId: `junction-${key}-start`,
        endJunctionId: `junction-${key}-end`,
      })
    : undefined;
  return {
    ok: true,
    netId,
    ...(mergeEffect ? { expectedElectricalEffect: mergeEffect } : {}),
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
