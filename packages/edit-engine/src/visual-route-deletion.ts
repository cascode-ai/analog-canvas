// The closure deleting visible wire geometry removes: Routes, orphaned
// Junctions, their labels, and the MOS bulk binding a dashed wire stood for.
import {
  deriveMosBulkRouteFamily,
  derivePowerRailComponent,
  isMosBulkTerminal,
  mosBulkKind,
  resolveDocumentLogicalNets,
  supplyDefaultMosBulkNet,
} from "@icm/derived";
import type { RouteBranch, RouteEndpoint, SchematicDocument } from "@icm/model";
import { routeEndpoints } from "@icm/model";
import type { SchematicEdit } from "./transaction.js";

export interface VisualRouteDeletion {
  routeIds: string[];
  junctionIds: string[];
  /** Annotations removed as an inseparable part of the selected visual route. */
  annotationIds: string[];
  edits: SchematicEdit[];
}

export interface VisualRouteDeletionContext {
  /**
   * Instance owners removed by the same transaction. Their lifecycle planner
   * already disconnects every terminal, so route deletion must not append a
   * second terminal disconnect or MOS bulk reconciliation after the Instance
   * has gone.
   */
  instanceIdsScheduledForDeletion?: readonly string[];
}

/**
 * Collect the closure for deleting visual route geometry. Ordinary Wire
 * deletion deliberately preserves Net membership. A `bulk-dashed` route is
 * different: it is the visible representation of an explicit MOS B binding,
 * so deleting the terminal-touching route also disconnects B and restores the
 * configured/default bulk policy. Keeping that exception here makes button,
 * keyboard, marquee, and Agent-facing deletion paths share one contract.
 */
export function proposeVisualRouteDeletion(
  document: SchematicDocument,
  routeIds: readonly string[],
  junctionIds: readonly string[],
  context: VisualRouteDeletionContext = {},
): VisualRouteDeletion {
  const instanceIdsScheduledForDeletion = new Set(
    context.instanceIdsScheduledForDeletion ?? [],
  );
  const routesToRemove = new Set<string>();
  const bulkRoutesToRemove = new Set<string>();
  const junctionsToRemove = new Set(junctionIds);
  const removedRailEndpointJunctionIds = new Set<string>();
  const removedRailNetIds = new Set<string>();
  const includeRouteAndOwnedFamily = (route: RouteBranch): boolean => {
    let changed = false;
    if (!routesToRemove.has(route.id)) {
      routesToRemove.add(route.id);
      changed = true;
    }
    const railComponent = derivePowerRailComponent(document, route.id);
    if (railComponent) {
      removedRailNetIds.add(route.netId);
      railComponent.endpointJunctionIds.forEach((junctionId) =>
        removedRailEndpointJunctionIds.add(junctionId),
      );
      for (const routeId of railComponent.routeIds) {
        if (!routesToRemove.has(routeId)) {
          routesToRemove.add(routeId);
          changed = true;
        }
      }
    }
    const family = deriveMosBulkRouteFamily(document, route);
    if (!family) return changed;
    for (const routeId of family.routeIds) {
      bulkRoutesToRemove.add(routeId);
      if (!routesToRemove.has(routeId)) {
        routesToRemove.add(routeId);
        changed = true;
      }
    }
    return changed;
  };
  for (const routeId of routeIds) {
    const route = document.routes.find((candidate) => candidate.id === routeId);
    if (route) includeRouteAndOwnedFamily(route);
    else routesToRemove.add(routeId);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const route of document.routes) {
      const touchesDeletedJunction = routeEndpoints(route).some(
        (endpoint) =>
          endpoint.kind === "junction" &&
          junctionsToRemove.has(endpoint.junctionId),
      );
      if (touchesDeletedJunction && !routesToRemove.has(route.id)) {
        changed = includeRouteAndOwnedFamily(route) || changed;
      }
    }
    for (const junction of document.junctions) {
      if (junctionsToRemove.has(junction.id)) continue;
      const attachedRoutes = document.routes.filter((route) =>
        routeEndpoints(route).some(
          (endpoint) =>
            endpoint.kind === "junction" && endpoint.junctionId === junction.id,
        ),
      );
      if (
        attachedRoutes.length > 0 &&
        attachedRoutes.every((route) => routesToRemove.has(route.id))
      ) {
        junctionsToRemove.add(junction.id);
        changed = true;
      }
    }
  }
  const sortedRouteIds = [...routesToRemove].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const sortedJunctionIds = [...junctionsToRemove].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const removedRouteAnnotationIds = document.annotations
    .filter(
      (annotation) =>
        annotation.anchor.kind === "route" &&
        routesToRemove.has(annotation.anchor.routeId),
    )
    .map((annotation) => annotation.id);
  const removedPowerLabelIds = document.annotations
    .filter(
      (annotation) =>
        annotation.kind === "power-label" &&
        annotation.anchor.kind === "object" &&
        removedRailEndpointJunctionIds.has(annotation.anchor.objectId) &&
        annotation.netId !== undefined &&
        removedRailNetIds.has(annotation.netId),
    )
    .map((annotation) => annotation.id);
  const removedAnnotationIds = [
    ...new Set([...removedRouteAnnotationIds, ...removedPowerLabelIds]),
  ].sort((a, b) => a.localeCompare(b, "en"));
  const removedFormalTerminalIds = (document.netlist?.terminals ?? []).flatMap(
    (terminal) =>
      terminal.interfaceAnnotationId &&
      removedAnnotationIds.includes(terminal.interfaceAnnotationId)
        ? [terminal.id]
        : [],
  );
  // `cut_connection` removes a junction that becomes orphaned. Only a selected
  // junction already detached before this transaction needs an explicit edit;
  // otherwise a second remove would reject the transaction.
  const alreadyOrphanedJunctionIds = sortedJunctionIds.filter(
    (junctionId) =>
      !document.routes.some((route) =>
        routeEndpoints(route).some(
          (endpoint) =>
            endpoint.kind === "junction" && endpoint.junctionId === junctionId,
        ),
      ),
  );
  const disconnectedBulkInstances = [
    ...new Set(
      document.routes
        .filter((route) => bulkRoutesToRemove.has(route.id))
        .flatMap((route) => routeEndpoints(route))
        .filter(
          (
            endpoint,
          ): endpoint is Extract<RouteEndpoint, { kind: "terminal" }> =>
            isMosBulkTerminal(document, endpoint),
        )
        .filter(
          (endpoint) =>
            !instanceIdsScheduledForDeletion.has(endpoint.instanceId),
        )
        .filter(
          (endpoint) =>
            !document.routes.some(
              (route) =>
                !routesToRemove.has(route.id) &&
                routeEndpoints(route).some(
                  (candidate) =>
                    candidate.kind === "terminal" &&
                    candidate.instanceId === endpoint.instanceId &&
                    candidate.pinName === "B",
                ),
            ),
        )
        .map((endpoint) => endpoint.instanceId),
    ),
  ].sort((a, b) => a.localeCompare(b, "en"));
  const logicalNets = disconnectedBulkInstances.length
    ? resolveDocumentLogicalNets(document)
    : null;
  const supplyRestoreEndpoint = new Map<string, RouteEndpoint>();
  for (const instanceId of disconnectedBulkInstances) {
    const instance = document.instances.find((item) => item.id === instanceId);
    const kind = instance && mosBulkKind(instance);
    if (!kind || !logicalNets) continue;
    const configuredId =
      kind === "nmos"
        ? document.mosBulkDefaults?.nmosNetId
        : document.mosBulkDefaults?.pmosNetId;
    if (configuredId) continue; // The Cell-default reconciler owns this case.
    const supply = supplyDefaultMosBulkNet(document, kind, logicalNets);
    if (!supply) continue;
    const supplyNetIds = new Set(
      logicalNets.byBaseNetId.get(supply.id)?.baseNetIds ?? [supply.id],
    );
    const peer = document.nets
      .filter((net) => supplyNetIds.has(net.id))
      .flatMap((net) => net.terminals)
      .find(
        (terminal) =>
          !instanceIdsScheduledForDeletion.has(terminal.instanceId) &&
          !isMosBulkTerminal(document, { kind: "terminal", ...terminal }),
      );
    if (peer) {
      supplyRestoreEndpoint.set(instanceId, { kind: "terminal", ...peer });
      continue;
    }
    const junction = document.junctions.find(
      (item) => supplyNetIds.has(item.netId) && !junctionsToRemove.has(item.id),
    );
    if (junction)
      supplyRestoreEndpoint.set(instanceId, {
        kind: "junction",
        junctionId: junction.id,
      });
  }
  return {
    routeIds: sortedRouteIds,
    junctionIds: sortedJunctionIds,
    annotationIds: removedAnnotationIds,
    edits: [
      ...removedFormalTerminalIds.map((terminalId): SchematicEdit => ({
        kind: "remove_cell_terminal",
        terminalId,
      })),
      ...removedAnnotationIds.map((annotationId): SchematicEdit => ({
        kind: "remove_schematic_annotation",
        annotationId,
      })),
      ...sortedRouteIds.map((routeId): SchematicEdit => ({
        kind: "cut_connection",
        routeId,
      })),
      ...alreadyOrphanedJunctionIds.map((junctionId): SchematicEdit => ({
        kind: "remove_junction",
        junctionId,
      })),
      ...disconnectedBulkInstances.flatMap((instanceId): SchematicEdit[] => {
        const bulk: RouteEndpoint = {
          kind: "terminal",
          instanceId,
          pinName: "B",
        };
        const supply = supplyRestoreEndpoint.get(instanceId);
        return [
          { kind: "disconnect_endpoint", endpoint: bulk },
          ...(supply
            ? [{ kind: "connect_endpoints" as const, from: bulk, to: supply }]
            : []),
          { kind: "reconcile_mos_bulk", instanceIds: [instanceId] },
        ];
      }),
    ],
  };
}
