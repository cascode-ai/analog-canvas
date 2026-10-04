import {
  deriveNetConnectivityContext,
  endpointKey,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import { createRoutePath, routeEnd } from "@icm/model";
import type { RouteBranch, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import { createRouteClearance } from "./route-clearance.js";
import { compileWireDraft } from "./routing-planner.js";
import { executeTransaction } from "./transaction.js";

/** Why a wire, as drawn in `document`, reads as a connection it is not. */
function routeConflict(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: RouteBranch,
) {
  const points = resolveRouteGeometry(document, resolver, route)?.centerline;
  if (!points) return null;
  const context = deriveNetConnectivityContext(document, resolver);
  const ends = [route.start, routeEnd(route)] as const;
  const clearance = createRouteClearance(document, resolver, context, {
    logicalIds: new Set([
      context.logicalNetResolution.byBaseNetId.get(route.netId)?.id ??
        route.netId,
    ]),
    endpointKeys: new Set(ends.map(endpointKey)),
  });
  return { clearance, context, ends, reason: clearance.conflict(points, ends) };
}

/**
 * Wires a part's pin change stretches onto what they must not touch are drawn
 * clear of it instead (#1309). Swapping an op-amp's inputs exchanges where its
 * two input pins sit, and the follow stretches each wire straight to its
 * pin's new place: two wires coming down one column then lie on one line, and
 * the drawing shows the inputs shorted. Each such wire takes the cheapest path
 * clear of other Nets' pins and wires and of the parts, the path the Agent's
 * connect takes. A wire that was already in conflict before the change is
 * left as it was drawn, and one with no clear path keeps its stretch, where
 * ERC_OVERLAPPING_NETS still reports it. Returns the set_route_path edits to
 * send in the same transaction as `edits`.
 */
export function planPinChangeRouteClearance(
  document: SchematicDocument,
  resolver: SymbolResolver,
  edits: readonly SchematicEdit[],
): SchematicEdit[] {
  const changed = new Set(
    edits.flatMap((edit) =>
      edit.kind === "set_instance_symbol" ||
      edit.kind === "set_instance_signal_flow_parameters"
        ? [edit.instanceId]
        : [],
    ),
  );
  if (changed.size === 0) return [];
  const authored = new Set(
    edits.flatMap((edit) =>
      edit.kind === "set_route_path" ? [edit.route.id] : [],
    ),
  );
  const preview = (extra: readonly SchematicEdit[]) =>
    executeTransaction(
      document,
      {
        transactionId: "pin-change-route-clearance",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "pin-change-route-clearance" },
        edits: [...edits, ...extra],
      },
      { symbolResolver: resolver },
    );
  let result = preview([]);
  if (!result.ok) return [];
  const extra: SchematicEdit[] = [];
  const candidates = result.document.routes
    .filter(
      (route) =>
        !authored.has(route.id) &&
        [route.start, routeEnd(route)].some(
          (endpoint) =>
            endpoint.kind === "terminal" && changed.has(endpoint.instanceId),
        ),
    )
    .map((route) => route.id)
    .sort((left, right) => left.localeCompare(right, "en"));
  for (const routeId of candidates) {
    const before = document.routes.find((route) => route.id === routeId);
    if (before && routeConflict(document, resolver, before)?.reason) continue;
    const working = result.document;
    const route = working.routes.find((candidate) => candidate.id === routeId);
    if (!route) continue;
    const found = routeConflict(working, resolver, route);
    if (!found?.reason) continue;
    const clear = found.clearance.path(found.ends[0], found.ends[1]);
    if (typeof clear === "string") continue;
    const from = resolveEndpointConnection(
      working,
      resolver,
      found.ends[0],
      found.context,
    );
    const to = resolveEndpointConnection(
      working,
      resolver,
      found.ends[1],
      found.context,
    );
    if (!from || !to) continue;
    const compiled = compileWireDraft(
      { connection: from },
      { connection: to },
      clear.waypoints.map((point) => ({
        point,
        routingMode: "orthogonal" as const,
        cornerOrder: clear.cornerOrder,
      })),
      "orthogonal",
      clear.cornerOrder,
    );
    const edit: SchematicEdit = {
      kind: "set_route_path",
      route: {
        ...route,
        legs: createRoutePath({
          id: route.id,
          netId: route.netId,
          start: route.start,
          end: routeEnd(route),
          bends: compiled.waypoints,
          modes: compiled.segmentModes,
        }).legs,
      },
    };
    const next = preview([...extra, edit]);
    if (!next.ok) continue;
    extra.push(edit);
    result = next;
  }
  return extra;
}
