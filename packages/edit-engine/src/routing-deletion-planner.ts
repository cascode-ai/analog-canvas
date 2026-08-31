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
import { proposeVisualRouteDeletion } from "./routing-planner.js";
import type { SchematicEdit } from "./edit-schema.js";

export interface RoutingDeletionSeed extends RoutingSelectionSeed {
  readonly draftingIds?: readonly string[];
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
  const expandedSeed = expandSelectedPowerRailLabels(document, seed);
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
