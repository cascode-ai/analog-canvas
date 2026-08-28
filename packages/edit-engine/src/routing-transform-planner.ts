import {
  deriveRoutingAffectedClosure,
  type RoutingSelectionSeed,
} from "@icm/derived";
import type { Point, SchematicDocument, ScreenFlip } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  createRoutingOperationPlan,
  type RoutingOperationPlan,
} from "./routing-operation-plan.js";
import {
  proposeGroupMoveEdits,
  proposeGroupReflectionEdits,
  proposeGroupRotationEdits,
} from "./routing-planner.js";
import type { SchematicEdit } from "./edit-schema.js";

export type TransformOperation =
  | { readonly kind: "translate"; readonly delta: Point }
  | {
      readonly kind: "rotate";
      readonly center?: Point;
      readonly degrees: 90 | 180 | 270;
    }
  | {
      readonly kind: "mirror";
      readonly center?: Point;
      readonly axis: "x" | "y";
    };

function stable(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

/**
 * Plan one topology-preserving transform from a stable selection seed.
 * Internal conductors move rigidly, boundary conductors are locally stretched
 * by the existing geometry planner, and external conductors remain untouched.
 */
export function planRoutingTransform(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingSelectionSeed,
  operation: TransformOperation,
): RoutingOperationPlan {
  const affected = deriveRoutingAffectedClosure(document, seed);
  const affectedIds = new Set([
    ...affected.instances,
    ...affected.internalRoutes,
    ...affected.boundaryRoutes,
    ...affected.internalJunctions,
    ...affected.electricalAnnotationIds,
  ]);
  const protectedIds = affected.protectedObjectIds.filter((id) =>
    affectedIds.has(id),
  );
  if (protectedIds.length > 0) {
    return createRoutingOperationPlan(document, {
      intent: "transform",
      affected,
      edits: [],
      diagnostics: [
        {
          code: "ROUTING_TRANSFORM_PROTECTED",
          severity: "error",
          message: "The transform includes locked or protected routing objects",
          objectIds: protectedIds,
        },
      ],
    });
  }

  let edits: readonly SchematicEdit[];
  if (operation.kind === "translate") {
    const moves = affected.instances.flatMap((instanceId) => {
      const instance = document.instances.find(
        (item) => item.id === instanceId,
      );
      return instance?.placement
        ? [
            {
              instanceId,
              position: {
                x: instance.placement.position.x + operation.delta.x,
                y: instance.placement.position.y + operation.delta.y,
              },
            },
          ]
        : [];
    });
    edits = proposeGroupMoveEdits(
      document,
      resolver,
      moves,
      affected.internalJunctions,
      operation.delta,
    ).edits;
  } else if (operation.kind === "rotate") {
    const delta = operation.degrees === 270 ? -90 : operation.degrees;
    edits = proposeGroupRotationEdits(
      document,
      resolver,
      affected.instances,
      delta,
      operation.center,
      affected.internalJunctions,
    ).edits;
  } else {
    const direction: ScreenFlip =
      operation.axis === "y" ? "left-right" : "top-bottom";
    edits = proposeGroupReflectionEdits(
      document,
      resolver,
      affected.instances,
      direction,
      operation.center,
      affected.internalJunctions,
    ).edits;
  }

  return createRoutingOperationPlan(document, {
    intent: "transform",
    affected,
    edits: [...edits],
    diagnostics: [],
  });
}

export function routingTransformChangedObjectIds(
  plan: RoutingOperationPlan,
): readonly string[] {
  return stable([
    ...plan.affected.instances,
    ...plan.affected.internalRoutes,
    ...plan.affected.boundaryRoutes,
    ...plan.affected.internalJunctions,
    ...plan.affected.electricalAnnotationIds,
  ]);
}
