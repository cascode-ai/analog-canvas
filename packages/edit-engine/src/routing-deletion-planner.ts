import {
  derivePowerRailComponent,
  deriveRoutingAffectedClosure,
  type RoutingSelectionSeed,
} from "@icm/derived";
import { routeEnd, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  instanceOwnedAnnotationIds,
  planInstanceDeletion,
} from "./instance-lifecycle.js";
import {
  createRoutingOperationPlan,
  type RoutingOperationPlan,
} from "./routing-operation-plan.js";
import { proposeVisualRouteDeletion } from "./visual-route-deletion.js";
import type { SchematicEdit } from "./edit-schema.js";

export interface RoutingDeletionSeed extends RoutingSelectionSeed {
  readonly draftingIds?: readonly string[];
  readonly noConnectIds?: readonly string[];
}

/** A selected rail label owns the same deletion component as its rail. */
function expandSelectedPowerRailLabels(
  document: SchematicDocument,
  seed: RoutingDeletionSeed,
): RoutingDeletionSeed {
  const routeIds = new Set(seed.routeIds);
  for (const annotationId of seed.annotationIds ?? []) {
    const annotation = document.annotations.find(
      (candidate) =>
        candidate.id === annotationId && candidate.kind === "power-label",
    );
    if (!annotation) continue;
    const anchor = annotation.anchor;
    const seedRoute = document.routes.find((route) => {
      if (
        route.presentation !== "power-rail" ||
        route.netId !== annotation.netId
      ) {
        return false;
      }
      if (anchor.kind === "route") {
        return anchor.routeId === route.id;
      }
      return (
        anchor.kind === "object" &&
        [route.start, routeEnd(route)].some(
          (endpoint) =>
            endpoint.kind === "junction" &&
            endpoint.junctionId === anchor.objectId,
        )
      );
    });
    if (!seedRoute) continue;
    for (const routeId of derivePowerRailComponent(document, seedRoute.id)
      ?.routeIds ?? []) {
      routeIds.add(routeId);
    }
  }
  return routeIds.size === seed.routeIds.length
    ? seed
    : { ...seed, routeIds: [...routeIds] };
}

/**
 * A wire that only tapped a deleted part into other wiring goes with it.
 *
 * From each deleted pin the walk follows the wire through bends that join
 * nothing else. It takes the whole run when the run ends where other wires
 * meet, at another deleted pin, or in the open: nothing else is left for it to
 * connect. A run that reaches another part's pin stays, with an open end at
 * the former pin, where a replacement part set down reconnects. So does a run
 * that carries a label or reaches a labelled point, and a Power Rail. Wires
 * that still join two remaining endpoints are never touched.
 */
function withWiresLeftDangling(
  document: SchematicDocument,
  seed: RoutingDeletionSeed,
): RoutingDeletionSeed {
  const deleted = new Set(seed.instanceIds);
  if (deleted.size === 0) return seed;
  const labelled = new Set<string>();
  for (const annotation of document.annotations) {
    if (annotation.anchor.kind === "object")
      labelled.add(annotation.anchor.objectId);
    if (annotation.anchor.kind === "route")
      labelled.add(annotation.anchor.routeId);
  }
  for (const evidence of document.connectivityEvidence)
    if (
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker"
    )
      labelled.add(evidence.owner.objectId);
  type Route = SchematicDocument["routes"][number];
  type End = Route["start"];
  const same = (left: End, right: End) =>
    left.kind === "terminal"
      ? right.kind === "terminal" &&
        left.instanceId === right.instanceId &&
        left.pinName === right.pinName
      : right.kind === "junction" && left.junctionId === right.junctionId;
  const farEnd = (route: Route, near: End): End =>
    same(route.start, near) ? routeEnd(route) : route.start;
  const meeting = (junctionId: string) =>
    document.routes.filter((route) =>
      [route.start, routeEnd(route)].some(
        (end) => end.kind === "junction" && end.junctionId === junctionId,
      ),
    );
  const kept = (route: Route) =>
    labelled.has(route.id) || route.presentation === "power-rail";
  // The run from a deleted pin, or null when it stays.
  const tap = (first: Route, pin: End): Route[] | null => {
    const run: Route[] = [];
    let route = first;
    let near = pin;
    for (;;) {
      if (kept(route) || run.includes(route)) return null;
      run.push(route);
      const far = farEnd(route, near);
      if (far.kind === "terminal")
        return deleted.has(far.instanceId) ? run : null;
      if (labelled.has(far.junctionId)) return null;
      const others = meeting(far.junctionId).filter(
        (other) => !run.includes(other),
      );
      // In the open, or where other wires meet: the run only tapped the part.
      if (others.length !== 1) return run;
      route = others[0]!;
      near = far;
    }
  };
  const removed = new Set(seed.routeIds);
  for (const route of document.routes)
    for (const end of [route.start, routeEnd(route)])
      if (end.kind === "terminal" && deleted.has(end.instanceId))
        for (const taken of tap(route, end) ?? []) removed.add(taken.id);
  return removed.size === seed.routeIds.length
    ? seed
    : { ...seed, routeIds: [...removed] };
}

/**
 * Plan one graph deletion. Route selection dominates incidental marquee
 * Junction dots; Junction-only selection owns its incident arms. Instance,
 * Route, attachment, layout-reference and drafting cleanup are committed as
 * one atomic operation without a second orphan-cleanup gesture.
 */
export function planRoutingDeletion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingDeletionSeed,
  sequence: number,
): RoutingOperationPlan {
  const expandedSeed = withWiresLeftDangling(
    document,
    expandSelectedPowerRailLabels(document, seed),
  );
  const affected = deriveRoutingAffectedClosure(document, expandedSeed);
  const selectedInstances = new Set(affected.instances);
  const routeDeletion = proposeVisualRouteDeletion(
    document,
    expandedSeed.routeIds,
    expandedSeed.routeIds.length > 0 ? [] : expandedSeed.junctionIds,
    { instanceIdsScheduledForDeletion: affected.instances },
  );
  const instanceEdits =
    affected.instances.length > 0
      ? planInstanceDeletion(document, resolver, affected.instances, sequence)
      : [];
  const removedNoConnects = new Set(
    instanceEdits.flatMap((edit) =>
      edit.kind === "remove_no_connect" ? [edit.noConnectId] : [],
    ),
  );
  const explicitNoConnects = [...new Set(seed.noConnectIds ?? [])].filter(
    (id) => {
      if (!document.noConnects.some((item) => item.id === id))
        throw new Error(`NoConnect not found: ${id}`);
      return !removedNoConnects.has(id);
    },
  );
  const removedWithInstances = instanceOwnedAnnotationIds(
    document,
    selectedInstances,
  );
  const routeAnnotationIds = new Set(routeDeletion.annotationIds);
  const explicitAnnotationIds = [
    ...new Set(expandedSeed.annotationIds ?? []),
  ].filter(
    (annotationId) =>
      document.annotations.some(
        (annotation) => annotation.id === annotationId,
      ) &&
      !removedWithInstances.has(annotationId) &&
      !routeAnnotationIds.has(annotationId),
  );
  const draftingIds = [...new Set(expandedSeed.draftingIds ?? [])].filter(
    (objectId) =>
      document.drafting?.objects.some((object) => object.id === objectId),
  );
  const edits: SchematicEdit[] = [
    ...instanceEdits,
    ...routeDeletion.edits,
    ...explicitNoConnects.map((noConnectId): SchematicEdit => ({
      kind: "remove_no_connect",
      noConnectId,
    })),
    ...explicitAnnotationIds.map((annotationId): SchematicEdit => ({
      kind: "remove_schematic_annotation",
      annotationId,
    })),
    ...draftingIds.map((objectId): SchematicEdit => ({
      kind: "remove_drafting_object",
      objectId,
    })),
  ];
  const sourceBaseNetIds = [
    ...new Set(
      routeDeletion.routeIds.flatMap((routeId) => {
        const route = document.routes.find((item) => item.id === routeId);
        return route ? [route.netId] : [];
      }),
    ),
  ].sort((left, right) => left.localeCompare(right, "en"));

  return createRoutingOperationPlan(document, {
    intent: "delete",
    affected,
    ...(affected.instances.length === 0 && routeDeletion.routeIds.length > 0
      ? {
          expectedElectricalEffect: {
            kind: "partition" as const,
            sourceBaseNetIds,
            cutRouteIds: routeDeletion.routeIds,
          },
        }
      : {}),
    edits,
    diagnostics:
      edits.length > 0
        ? []
        : [
            {
              code: "ROUTING_DELETE_EMPTY",
              severity: "error",
              message: "The selection contains no deletable schematic objects",
            },
          ],
  });
}
