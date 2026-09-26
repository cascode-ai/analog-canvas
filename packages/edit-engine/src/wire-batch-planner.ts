import { pointOnSegment, resolveRouteGeometry } from "@icm/derived";
import { routeEnd, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { executeTransaction, type SchematicEdit } from "./transaction.js";
import { proposeWireIntent } from "./routing-planner.js";

/** Plan on private evolving state, then dispatch the combined edits once. */
export function planWireBatch(
  document: SchematicDocument,
  resolver: SymbolResolver,
  input:
    | Parameters<typeof proposeWireIntent>[2]
    | Parameters<typeof proposeWireIntent>[2][],
  limit: number,
): { edits: SchematicEdit[] } | string {
  if (!Array.isArray(input))
    return proposeWireIntent(document, resolver, input);
  let working = document;
  const edits: SchematicEdit[] = [];
  const descendants = new Map(
    document.routes.map((route) => [route.id, new Set([route.id])]),
  );
  const rebaseAnchor = (
    anchor: Parameters<typeof proposeWireIntent>[2]["from"],
  ): typeof anchor | string => {
    if (
      anchor.kind !== "route-segment" ||
      working.routes.some((route) => route.id === anchor.routeId)
    )
      return anchor;
    const original = document.routes.find(
      (route) => route.id === anchor.routeId,
    );
    if (!original || !original.legs.some((leg) => leg.id === anchor.legId))
      return `Wire route or leg does not exist: ${anchor.routeId}/${anchor.legId}`;
    const originalSegment = resolveRouteGeometry(
      document,
      resolver,
      original,
    )?.segments.find((segment) => segment.address.legId === anchor.legId);
    if (
      !originalSegment ||
      !pointOnSegment(anchor.point, originalSegment.from, originalSegment.to)
    )
      return `Wire route point is not on the original leg: ${anchor.routeId}/${anchor.legId}`;
    const candidates = [...(descendants.get(anchor.routeId) ?? [])].flatMap(
      (routeId) => {
        const route = working.routes.find((entry) => entry.id === routeId);
        if (!route) return [];
        const geometry = resolveRouteGeometry(working, resolver, route);
        if (!geometry) return [];
        return geometry.segments
          .filter((segment) =>
            pointOnSegment(anchor.point, segment.from, segment.to),
          )
          .map((segment) => ({ route, segment, geometry }));
      },
    );
    const junction = candidates.flatMap(({ route, geometry }) => {
      const endpoints = [
        { endpoint: route.start, point: geometry.centerline[0] },
        { endpoint: routeEnd(route), point: geometry.centerline.at(-1) },
      ];
      return endpoints
        .filter(
          ({ endpoint, point }) =>
            endpoint.kind === "junction" &&
            point?.x === anchor.point.x &&
            point.y === anchor.point.y,
        )
        .map(({ endpoint }) => endpoint);
    })[0];
    if (junction) return { kind: "endpoint", endpoint: junction };
    if (candidates.length !== 1)
      return `Wire route segment has ${candidates.length} descendants at the requested point: ${anchor.routeId}/${anchor.legId}`;
    const match = candidates[0]!;
    return {
      ...anchor,
      routeId: match.route.id,
      legId: match.segment.address.legId,
    };
  };
  for (const [index, intent] of input.entries()) {
    const from = rebaseAnchor(intent.from);
    if (typeof from === "string") return `Wire ${index + 1}: ${from}`;
    const to = rebaseAnchor(intent.to);
    if (typeof to === "string") return `Wire ${index + 1}: ${to}`;
    const planned = proposeWireIntent(working, resolver, {
      ...intent,
      from,
      to,
    });
    if (typeof planned === "string") return `Wire ${index + 1}: ${planned}`;
    // Each preview finalizes route-derived Nets, while the final transaction
    // does so once. Let a later Junction materialize its new conductor's Net
    // using the existing createNet contract. Empty pre-reserved Nets would
    // occupy the route hint and change identity during physical rebuilding.
    const materialized = planned.edits.map((edit): SchematicEdit =>
      edit.kind === "add_junction" &&
      !document.nets.some((net) => net.id === edit.netId)
        ? { ...edit, createNet: true }
        : edit,
    );
    edits.push(...materialized);
    if (edits.length > limit)
      return `Wire ${index + 1}: batch requires ${edits.length} edits, exceeding the ${limit}-edit transaction limit`;
    const preview = executeTransaction(
      working,
      {
        transactionId: `wire-batch-preview-${index}`,
        documentId: working.id,
        expectedRevision: working.revision,
        actor: { kind: "agent", id: "wire-planner" },
        dryRun: true,
        edits: materialized,
      },
      { symbolResolver: resolver },
    );
    if (!preview.ok) return `Wire ${index + 1}: ${preview.error.message}`;
    working = preview.document;
    for (const edit of planned.edits) {
      if (edit.kind !== "add_junction" || !edit.split) continue;
      for (const lineage of descendants.values()) {
        if (!lineage.delete(edit.split.routeId)) continue;
        lineage.add(edit.split.firstRouteId);
        lineage.add(edit.split.secondRouteId);
      }
    }
  }
  return { edits };
}
