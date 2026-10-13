// Group, Junction and wire-segment moves planned as typed transaction edits.
import {
  endpointKey,
  resolveRouteGeometry,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import {
  proposeGroupMove,
  proposeJunctionGroupTranslation,
  type JunctionMoveProposal,
  type RouteStretchProposal,
  type RoutingTranslationSource,
} from "./route-operations.js";
import {
  proposeGroupReflection,
  proposeGroupRotation,
  type GroupRotationProposal,
} from "./group-rigid-transform.js";
import {
  proposeWireSegmentDragFromSource,
  prepareWireSegmentDragSource,
  type WireSegmentDragSource,
} from "./wire-segment-drag.js";
import type { Point, SchematicDocument, ScreenFlip } from "@icm/model";
import { routeEndpoints, isFrozenSnapshot } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./transaction.js";
import { projectRoutingGeometryRead } from "./routing-geometry-projection.js";
import { newlyTouchedRouteEndpoints } from "./transaction-connectivity-normalizer.js";
import type { ExpectedElectricalEffect } from "./routing-operation-plan.js";
import { routeEdits } from "./route-proposal-edits.js";

/** The exact edit payload and preview produced by one routed interaction. */
export interface RouteEditPlan {
  routeId: string;
  edits: SchematicEdit[];
  expectedElectricalEffect?: ExpectedElectricalEffect;
  /** The edits leave every drawn wire and Junction where it already is. */
  unchanged?: true;
  preview?: {
    routes: readonly RouteStretchProposal[];
    junctions: readonly JunctionMoveProposal[];
  };
}

export interface GroupMoveEditProposal {
  edits: SchematicEdit[];
  preview: {
    routes: readonly RouteStretchProposal[];
    junctions: readonly JunctionMoveProposal[];
  };
}

/** Plan instance-group movement and all internal route/Junction/label follow edits. */
export function proposeGroupMoveEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly { instanceId: string; position: Point }[],
  additionalJunctionIds: readonly string[] = [],
  explicitDelta?: Point,
  source?: RoutingTranslationSource,
): GroupMoveEditProposal {
  const proposal = proposeGroupMove(
    document,
    resolver,
    moves,
    additionalJunctionIds,
    explicitDelta,
    source,
  );
  return {
    preview: {
      routes: proposal.routes,
      junctions: proposal.junctions,
    },
    edits: [
      ...moves.map((move): SchematicEdit => ({
        kind: "move_instance",
        ...move,
      })),
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      // A group plan is the sole geometry authority. Emitting every planned
      // Route prevents move_instance from progressively re-stretching an
      // internal wire once per selected Instance, which otherwise makes a
      // group translation depend on transaction edit order.
      ...routeEdits(document, proposal.routes),
      ...proposal.annotations.flatMap((move): SchematicEdit[] => {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === move.annotationId,
        );
        return annotation
          ? [
              {
                kind: "upsert_schematic_annotation",
                annotation: {
                  ...annotation,
                  anchor: move.anchor,
                  ...(move.alignment ? { alignment: move.alignment } : {}),
                },
              },
            ]
          : [];
      }),
    ],
  };
}

/**
 * Typed edits that turn a selection as one rigid body.
 *
 * Instance rotation and translation travel together: a member both spins in
 * place and orbits the shared pivot, and the plan supplies every affected
 * Route so geometry does not depend on transaction edit order.
 */
/** Typed edits that reflect a selection as one rigid body. */
export function proposeGroupReflectionEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  direction: ScreenFlip,
  center?: Point,
  additionalJunctionIds: readonly string[] = [],
): GroupMoveEditProposal {
  return rigidBodyEdits(
    document,
    proposeGroupReflection(
      document,
      resolver,
      instanceIds,
      direction,
      center,
      additionalJunctionIds,
    ),
  );
}

export function proposeGroupRotationEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  deltaDegrees: 45 | -45 | 90 | -90 | 135 | -135 | 180,
  center?: Point,
  additionalJunctionIds: readonly string[] = [],
): GroupMoveEditProposal {
  return rigidBodyEdits(
    document,
    proposeGroupRotation(
      document,
      resolver,
      instanceIds,
      deltaDegrees,
      center,
      additionalJunctionIds,
    ),
  );
}

/**
 * Typed edits for a rigid-body move of a selection.
 *
 * Orientation and position travel together — a part both turns or flips and
 * carries to its new place — and the plan supplies every affected Route so
 * geometry does not depend on transaction edit order.
 */
function rigidBodyEdits(
  document: SchematicDocument,
  proposal: GroupRotationProposal,
): GroupMoveEditProposal {
  return {
    preview: {
      routes: proposal.routes,
      junctions: proposal.junctions,
    },
    edits: [
      ...proposal.instances.flatMap((moved): SchematicEdit[] => [
        {
          kind: "mirror_instance",
          instanceId: moved.instanceId,
          mirror: moved.mirror,
        },
        {
          kind: "rotate_instance",
          instanceId: moved.instanceId,
          rotation: moved.rotation,
        },
        {
          kind: "move_instance",
          instanceId: moved.instanceId,
          position: moved.position,
        },
      ]),
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
      ...proposal.annotations.flatMap((move): SchematicEdit[] => {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === move.annotationId,
        );
        return annotation
          ? [
              {
                kind: "upsert_schematic_annotation",
                annotation: {
                  ...annotation,
                  anchor: move.anchor,
                  ...(move.alignment ? { alignment: move.alignment } : {}),
                },
              },
            ]
          : [];
      }),
    ],
  };
}

/** Explicit Junction targets and all incident geometry form one transaction. */
export function proposeJunctionMoveEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly JunctionMoveProposal[],
  source?: RoutingTranslationSource,
): GroupMoveEditProposal {
  const proposal = proposeJunctionGroupTranslation(document, resolver, moves, {
    preserveBranchDirections: true,
    ...(source ? { source } : {}),
  });
  return {
    preview: proposal,
    edits: [
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
    ],
  };
}

/**
 * Plan one topology-preserving segment drag as typed transaction edits.
 * `origin` is where the drag began; a 45-degree segment moves along the
 * dominant axis of the travel from it.
 */
export function proposeWireSegmentMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  segmentIndex: number,
  target: Point,
  origin?: Point,
): RouteEditPlan {
  return planWireSegmentMove(
    document,
    resolver,
    routeId,
    segmentIndex,
    target,
    origin,
  );
}

/** Retain source reads while the editor previews one immutable Document.
 * Mutable callers keep the uncached planner, including in-place changes. */
export function prepareWireSegmentMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const references = isFrozenSnapshot(document)
    ? new Map(
        document.instances.map((instance) => [
          JSON.stringify([instance.symbolId, instance.symbolVariantId]),
          [instance.symbolId, instance.symbolVariantId] as const,
        ]),
      )
    : undefined;
  let symbols: string | undefined;
  let source: WireSegmentDragSource | undefined;
  return (
    routeId: string,
    segmentIndex: number,
    target: Point,
    origin?: Point,
  ) => {
    if (!references)
      return proposeWireSegmentMove(
        document,
        resolver,
        routeId,
        segmentIndex,
        target,
        origin,
      );
    // Resolver identity is not a promise of unchanged custom Symbols.
    const currentSymbols = JSON.stringify(
      [...references.values()].map(
        ([id, variant]) => resolver.resolve(id, variant) ?? null,
      ),
    );
    if (!source || symbols !== currentSymbols) {
      source = prepareWireSegmentDragSource(
        document,
        resolveDocumentRoutingGeometry(document, resolver),
      );
      symbols = currentSymbols;
    }
    return planWireSegmentMove(
      document,
      resolver,
      routeId,
      segmentIndex,
      target,
      origin,
      source,
    );
  };
}

function planWireSegmentMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  segmentIndex: number,
  target: Point,
  origin?: Point,
  source?: WireSegmentDragSource,
): RouteEditPlan {
  if (!document.routes.some((route) => route.id === routeId))
    throw new Error(`Route not found: ${routeId}`);
  const read =
    source ??
    prepareWireSegmentDragSource(
      document,
      resolveDocumentRoutingGeometry(document, resolver),
    );
  const beforeGeometry = read.routingGeometry;
  const proposal = proposeWireSegmentDragFromSource(
    document,
    resolver,
    routeId,
    segmentIndex,
    target,
    origin,
    read,
  );
  const edits: SchematicEdit[] = [
    ...proposal.junctions.map((move): SchematicEdit => ({
      kind: "move_junction",
      ...move,
    })),
    ...routeEdits(document, proposal.routes),
  ];
  const projected = projectRoutingGeometryRead(document, edits);
  const movedJunctionIds = new Set(
    proposal.junctions.map((junction) => junction.junctionId),
  );
  const contacts = newlyTouchedRouteEndpoints(
    document,
    projected,
    resolver,
    new Set(proposal.routes.map((route) => route.routeId)),
    { excludeJunctionIds: movedJunctionIds, beforeGeometry },
  );
  const expectedElectricalEffect: ExpectedElectricalEffect | undefined =
    contacts.length > 0
      ? {
          kind: "merge",
          endpointGroups: contacts.map((contact) => {
            const route = document.routes.find(
              (candidate) => candidate.id === contact.routeId,
            );
            if (!route) {
              throw new Error(`Route not found: ${contact.routeId}`);
            }
            return [
              endpointKey(contact.endpoint),
              ...routeEndpoints(route).map((endpoint) => endpointKey(endpoint)),
            ];
          }),
        }
      : undefined;
  // A drag released where it started, or held back from the first step,
  // plans the current geometry again; committing it would only add an empty
  // undo step.
  const samePoint = (left: Point | undefined, right: Point | undefined) =>
    left?.x === right?.x && left?.y === right?.y;
  const drawn = (source: SchematicDocument, id: string) => {
    const route = source.routes.find((candidate) => candidate.id === id);
    return route
      ? resolveRouteGeometry(source, resolver, route)?.centerline
      : [];
  };
  const unchanged =
    proposal.junctions.every((move) =>
      samePoint(
        document.junctions.find((junction) => junction.id === move.junctionId)
          ?.position,
        move.position,
      ),
    ) &&
    proposal.routes.every((item) => {
      if (item.collapsedToContact) return false;
      const before = drawn(document, item.routeId) ?? [];
      const after = drawn(projected, item.routeId) ?? [];
      return (
        before.length === after.length &&
        before.every((point, index) => samePoint(point, after[index]))
      );
    });
  return {
    routeId,
    edits,
    ...(expectedElectricalEffect ? { expectedElectricalEffect } : {}),
    ...(unchanged ? { unchanged: true as const } : {}),
    preview: proposal,
  };
}
