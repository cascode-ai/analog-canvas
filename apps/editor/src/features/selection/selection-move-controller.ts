import {
  planDirectEndpointConnection,
  proposeEndpointsRouteAttachment,
  planRoutingTransform,
  type EndpointRouteAttachmentRequest,
  type RoutingOperationIntent,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import {
  deriveNetConnectivity,
  findRouteSegmentsAtPoint,
  isMosBulkTerminal,
  isVisibleEndpoint,
  resolveDocumentRoutingGeometry,
  resolveElectricalContactTargets,
  resolveEndpointConnection,
  type RoutedComponent,
  deriveNetConnectivityContext,
} from "@icm/derived";
import {
  routeEndpoints,
  snapGridPoint,
  type DerivedPoint,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { closestPointOnSegment } from "../../canvas/canvas-geometry";
import {
  buildInstanceAnchors,
  buildSceneSnapTargets,
  sceneSnapTargetsExcluding,
  type SceneSnapTargetIndex,
} from "../../snap/candidates";
import {
  resolveTranslationSnap,
  SNAP_PROFILES,
  type SnapAnchor,
  type SnapResult,
} from "../../snap/engine";
import {
  draftingDragOrigin,
  translateDraftingObject,
} from "../drafting/drafting-manipulation";
import {
  endpointNetId,
  type RouteGeometryRecord,
} from "../wiring/route-interaction-geometry";
import type {
  InstanceMovePreview,
  ProjectedInstanceMove,
} from "./use-selection-interaction";
import type { SelectionMovePlan } from "./selection-move-plan";

type TransactionResult = { ok: boolean };

/**
 * The pins the snapped move actually lands on the matched conductor.
 *
 * The snap match names one moving pin, but the drop-a-device-into-a-wire
 * gesture lands every series pin of the device on the same Route; the
 * explicit snap intent covers the whole device, so every visible pin of the
 * matched instance whose contact lies on that Route attaches. Other selected
 * instances and other conductors are untouched — a plain transform still
 * never bonds. Falls back to the single matched endpoint when nothing beyond
 * it qualifies, so degenerate matches keep their previous behavior.
 */
function routeAttachRequestsForMovedPins(
  projected: SchematicDocument,
  resolver: SymbolResolver,
  moving: { endpoint: RouteEndpoint; netId: string | null },
  target: { routeId: string; segmentIndex: number },
): EndpointRouteAttachmentRequest[] {
  const fallback = (): EndpointRouteAttachmentRequest[] => {
    const connection = resolveEndpointConnection(
      projected,
      resolver,
      moving.endpoint,
    );
    return connection
      ? [
          {
            endpoint: moving.endpoint,
            endpointNetId: moving.netId,
            point: connection.contactPoint,
            segmentIndex: target.segmentIndex,
          },
        ]
      : [];
  };
  if (moving.endpoint.kind !== "terminal") return fallback();
  const movingInstanceId = moving.endpoint.instanceId;
  const instance = projected.instances.find(
    (candidate) => candidate.id === movingInstanceId,
  );
  const resolved = instance
    ? resolver.resolve(instance.symbolId, instance.symbolVariantId)
    : null;
  if (!instance || !resolved) return fallback();
  const geometry = resolveDocumentRoutingGeometry(projected, resolver);
  const requests: EndpointRouteAttachmentRequest[] = [];
  for (const pin of resolved.definition.pins) {
    if (resolved.variant?.hiddenPinNames.includes(pin.name)) continue;
    if (pin.presentation.visibility === "implicit") continue;
    const endpoint: RouteEndpoint = {
      kind: "terminal",
      instanceId: instance.id,
      pinName: pin.name,
    };
    // A pin that already terminates a Route is attached; splitting at a
    // Route end would only create degenerate geometry.
    const alreadyAttached = projected.routes.some((route) =>
      routeEndpoints(route).some(
        (candidate) =>
          candidate.kind === "terminal" &&
          candidate.instanceId === instance.id &&
          candidate.pinName === pin.name,
      ),
    );
    if (alreadyAttached) continue;
    const connection = resolveEndpointConnection(projected, resolver, endpoint);
    if (!connection) continue;
    const address = findRouteSegmentsAtPoint(
      geometry,
      connection.contactPoint,
    ).find((candidate) => candidate.routeId === target.routeId);
    if (!address) continue;
    const netId =
      projected.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === instance.id &&
            terminal.pinName === pin.name,
        ),
      )?.id ?? null;
    requests.push({
      endpoint,
      endpointNetId: netId,
      point: connection.contactPoint,
      segmentIndex: address.segmentIndex,
    });
  }
  return requests.length > 0 ? requests : fallback();
}

export function createSelectionMoveController({
  document,
  resolver,
  visibleEndpoints,
  routeGeometryRecords,
  contactComponents,
  sceneSnapTargetIndex,
  transactConnectivity,
  setStatus,
  nextRoutingSuffix,
}: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  visibleEndpoints: readonly WireSource[];
  routeGeometryRecords: readonly RouteGeometryRecord[];
  contactComponents: readonly RoutedComponent[];
  sceneSnapTargetIndex?: SceneSnapTargetIndex;
  transactConnectivity: (
    intent: RoutingOperationIntent,
    edits: readonly SchematicEdit[],
  ) => TransactionResult | null;
  setStatus: (status: string) => void;
  nextRoutingSuffix: () => number;
}) {
  const visualMoveEdits = (
    movePlan: SelectionMovePlan,
    delta: Point,
    sourceDocument: SchematicDocument = document,
  ): SchematicEdit[] => [
    ...movePlan.freeAnnotationIds.flatMap((annotationId) => {
      const annotation = sourceDocument.annotations.find(
        (candidate) => candidate.id === annotationId,
      );
      if (!annotation || annotation.anchor.kind !== "free") return [];
      return [
        {
          kind: "upsert_schematic_annotation" as const,
          annotation: {
            ...annotation,
            anchor: {
              kind: "free" as const,
              // Translation preserves the annotation's fine placement: the
              // grid discipline rides on the delta, and the annotation pitch
              // can be finer than the Document grid (drafting contract).
              position: snapGridPoint(
                {
                  x: annotation.anchor.position.x + delta.x,
                  y: annotation.anchor.position.y + delta.y,
                },
                1,
              ),
            },
          },
        },
      ];
    }),
    ...movePlan.draftingIds.flatMap((draftingId) => {
      const object = sourceDocument.drafting?.objects.find(
        (candidate) => candidate.id === draftingId,
      );
      return object
        ? [
            {
              kind: "upsert_drafting_object" as const,
              object: translateDraftingObject(
                object,
                delta,
                sourceDocument.presentation.grid,
              ),
            },
          ]
        : [];
    }),
  ];

  const completeVisualSelectionMove = (
    movePlan: SelectionMovePlan,
    delta: Point,
  ): void => {
    if (delta.x === 0 && delta.y === 0) return;
    const routingPlan = planRoutingTransform(
      document,
      resolver,
      {
        instanceIds: movePlan.instanceIds,
        routeIds: movePlan.translatedRouteIds,
        junctionIds: movePlan.translatedJunctionIds,
      },
      { kind: "translate", delta },
    );
    const blocking = routingPlan.diagnostics.find(
      (item) => item.severity === "error",
    );
    if (blocking) {
      setStatus(blocking.message);
      return;
    }
    const result = transactConnectivity("transform", [
      ...routingPlan.edits,
      ...visualMoveEdits(movePlan, delta),
    ]);
    if (result?.ok && movePlan.fixedObjectIds.length > 0) {
      setStatus(
        `Moved selection; ${movePlan.fixedObjectIds.length} attached object(s) remained fixed`,
      );
    }
  };

  const visualMoveOrigin = (movePlan: SelectionMovePlan): Point => {
    const freeAnnotation = movePlan.freeAnnotationIds
      .map((id) =>
        document.annotations.find((annotation) => annotation.id === id),
      )
      .find((annotation) => annotation?.anchor.kind === "free");
    return (
      movePlan.draftingIds
        .flatMap((id) => {
          const object = document.drafting?.objects.find(
            (candidate) => candidate.id === id,
          );
          const origin = object ? draftingDragOrigin(object) : null;
          return origin ? [origin] : [];
        })
        .find((point): point is Point => point !== null) ??
      (freeAnnotation?.anchor.kind === "free"
        ? freeAnnotation.anchor.position
        : undefined) ??
      movePlan.looseRouteIds
        .map(
          (id) =>
            routeGeometryRecords.find((record) => record.route.id === id)
              ?.geometry.centerline[0],
        )
        .find((point): point is Point => point !== undefined) ?? { x: 0, y: 0 }
    );
  };

  const resolveInstanceMove = (
    preview: InstanceMovePreview,
    position: DerivedPoint,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
    projectedDocument?: SchematicDocument,
  ) => {
    const sourceDocument = projectedDocument ?? document;
    const sourceVisibleEndpoints: WireSource[] = projectedDocument
      ? [
          ...sourceDocument.instances.flatMap((instance) => {
            if (!instance.placement) return [];
            const resolved = resolver.resolve(
              instance.symbolId,
              instance.symbolVariantId,
            );
            if (!resolved) return [];
            return resolved.definition.pins
              .filter((pin) =>
                isVisibleEndpoint(sourceDocument, resolver, {
                  kind: "terminal",
                  instanceId: instance.id,
                  pinName: pin.name,
                }),
              )
              .flatMap((pin): WireSource[] => {
                const endpoint: RouteEndpoint = {
                  kind: "terminal",
                  instanceId: instance.id,
                  pinName: pin.name,
                };
                const connection = resolveEndpointConnection(
                  sourceDocument,
                  resolver,
                  endpoint,
                );
                return connection
                  ? [
                      {
                        endpoint,
                        connection,
                        netId: endpointNetId(sourceDocument, endpoint),
                        preludeEdits: [],
                        ...(isMosBulkTerminal(sourceDocument, endpoint)
                          ? { routePresentation: "bulk-dashed" as const }
                          : {}),
                      },
                    ]
                  : [];
              });
          }),
          ...sourceDocument.junctions
            .filter((junction) => {
              const role = junction.role ?? "branch";
              return role === "branch" || role === "route-anchor";
            })
            .flatMap((junction): WireSource[] => {
              const endpoint: RouteEndpoint = {
                kind: "junction",
                junctionId: junction.id,
              };
              const connection = resolveEndpointConnection(
                sourceDocument,
                resolver,
                endpoint,
              );
              return connection
                ? [
                    {
                      endpoint,
                      connection,
                      netId: junction.netId,
                      preludeEdits: [],
                    },
                  ]
                : [];
            }),
        ]
      : [...visibleEndpoints];
    const sourceRouteGeometryRecords = projectedDocument
      ? (() => {
          const routingGeometry = resolveDocumentRoutingGeometry(
            sourceDocument,
            resolver,
          );
          return sourceDocument.routes.flatMap((route) => {
            const geometry = routingGeometry.routes.get(route.id);
            return geometry ? [{ route, geometry }] : [];
          });
        })()
      : routeGeometryRecords;
    const sourceContactComponents = projectedDocument
      ? (() => {
          // One shared geometry+contacts pass; deriving them per net made
          // every keyboard-Move pointer event quadratic in net count.
          const connectivityContext = deriveNetConnectivityContext(
            sourceDocument,
            resolver,
          );
          return sourceDocument.nets.flatMap(
            (net) =>
              deriveNetConnectivity(
                sourceDocument,
                resolver,
                net,
                connectivityContext,
              ).components,
          );
        })()
      : contactComponents;
    const rawDelta = {
      x: position.x - preview.pointerStart.x,
      y: position.y - preview.pointerStart.y,
    };
    const movingIds = new Set(preview.instanceIds);
    const movingAnchors = buildInstanceAnchors(
      sourceDocument,
      resolver,
      sourceVisibleEndpoints,
      movingIds,
    );
    const routeTargets: SnapAnchor[] = suppressSnap
      ? []
      : movingAnchors.flatMap((moving): SnapAnchor[] => {
          if (moving.electrical?.kind !== "endpoint") return [];
          const movedPoint = {
            x: moving.point.x + rawDelta.x,
            y: moving.point.y + rawDelta.y,
          };
          return sourceRouteGeometryRecords.flatMap(({ route, geometry }) => {
            const belongsToMovingInstance = routeEndpoints(route).some(
              (endpoint) =>
                endpoint.kind === "terminal" &&
                movingIds.has(endpoint.instanceId),
            );
            if (belongsToMovingInstance) return [];
            return geometry.centerline
              .slice(0, -1)
              .flatMap((from, segmentIndex) => {
                const point = closestPointOnSegment(
                  movedPoint,
                  from,
                  geometry.centerline[segmentIndex + 1]!,
                );
                if (
                  Math.hypot(point.x - movedPoint.x, point.y - movedPoint.y) >
                  tolerance
                ) {
                  return [];
                }
                return [
                  {
                    id: `move-route:${moving.id}:${route.id}:${segmentIndex}`,
                    point,
                    kind: "route" as const,
                    acceptsMovingAnchorId: moving.id,
                    electrical: {
                      kind: "route" as const,
                      routeId: route.id,
                      segmentIndex,
                      netId: route.netId,
                    },
                  },
                ];
              });
          });
        });
    const staticTargets =
      !projectedDocument && sceneSnapTargetIndex
        ? sceneSnapTargetsExcluding(sceneSnapTargetIndex, movingIds)
        : buildSceneSnapTargets(
            sourceDocument,
            resolver,
            sourceVisibleEndpoints,
            movingIds,
          );
    let snap: SnapResult = suppressSnap
      ? { delta: rawDelta, guides: [] }
      : resolveTranslationSnap(
          {
            rawDelta,
            movingAnchors,
            targetAnchors: [...staticTargets, ...routeTargets],
            primaryAnchorId: `instance:${preview.primaryInstanceId}:origin`,
            grid: sourceDocument.presentation.grid,
            tolerance,
            profile: SNAP_PROFILES.instanceMove,
          },
          previous,
        );
    if (snap.electricalMatch?.target.electrical?.kind === "route") {
      const point = snap.electricalMatch.target.point;
      const coincidentRoutes = routeTargets.filter(
        (target) =>
          target.electrical?.kind === "route" &&
          target.point.x === point.x &&
          target.point.y === point.y,
      );
      const conductors = resolveElectricalContactTargets(
        sourceDocument,
        resolver,
        coincidentRoutes.flatMap((target) =>
          target.electrical?.kind === "route"
            ? [
                {
                  kind: "route" as const,
                  id: target.id,
                  point: target.point,
                  netId: target.electrical.netId,
                  routeId: target.electrical.routeId,
                  segmentIndex: target.electrical.segmentIndex,
                },
              ]
            : [],
        ),
        sourceContactComponents,
      );
      if (conductors.length > 1) {
        snap = resolveTranslationSnap(
          {
            rawDelta,
            movingAnchors,
            targetAnchors: staticTargets,
            primaryAnchorId: `instance:${preview.primaryInstanceId}:origin`,
            grid: sourceDocument.presentation.grid,
            tolerance,
            profile: SNAP_PROFILES.instanceMove,
          },
          previous,
        );
      }
    }
    const moves = preview.instanceIds.map((instanceId) => {
      const original = preview.originalPositions[instanceId]!;
      return {
        instanceId,
        position: snapGridPoint(
          {
            x: original.x + snap.delta.x,
            y: original.y + snap.delta.y,
          },
          sourceDocument.presentation.grid,
        ),
      };
    });
    return { snap, moves };
  };

  const completeInstanceMove = (
    preview: InstanceMovePreview,
    position: DerivedPoint,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
    projection?: ProjectedInstanceMove,
  ): void => {
    const sourceDocument = projection?.document ?? document;
    const prefixEdits = [...(projection?.prefixEdits ?? [])];
    const { snap: resolvedSnap, moves } =
      projection?.resolvedMove ??
      resolveInstanceMove(
        preview,
        position,
        tolerance,
        suppressSnap,
        previous,
        projection?.document,
      );
    const electricalMatch = resolvedSnap.electricalMatch;
    const delta = {
      x:
        moves[0]!.position.x -
        preview.originalPositions[moves[0]!.instanceId]!.x,
      y:
        moves[0]!.position.y -
        preview.originalPositions[moves[0]!.instanceId]!.y,
    };
    if (delta.x === 0 && delta.y === 0 && prefixEdits.length === 0) return;
    try {
      const groupMove = planRoutingTransform(
        sourceDocument,
        resolver,
        {
          instanceIds: preview.movePlan.instanceIds,
          routeIds: preview.movePlan.translatedRouteIds,
          junctionIds: preview.movePlan.translatedJunctionIds,
        },
        { kind: "translate", delta },
      );
      const blocking = groupMove.diagnostics.find(
        (item) => item.severity === "error",
      );
      if (blocking) throw new Error(blocking.message);
      const movingElectrical = electricalMatch?.moving.electrical;
      const targetElectrical = electricalMatch?.target.electrical;
      const projected = structuredClone(sourceDocument);
      for (const move of moves) {
        const instance = projected.instances.find(
          (candidate) => candidate.id === move.instanceId,
        );
        if (instance?.placement) instance.placement.position = move.position;
      }
      // The snap target point is a float projection and can carry dust
      // (29.999999999999996) that the integer Point schema rejects, killing
      // the whole move at release. Each endpoint's own resolved contact point
      // in the projected document is grid-exact by construction — attach
      // there, exactly like placement does.
      const attachRequests: readonly EndpointRouteAttachmentRequest[] =
        movingElectrical?.kind === "endpoint" &&
        targetElectrical?.kind === "route"
          ? routeAttachRequestsForMovedPins(
              projected,
              resolver,
              movingElectrical,
              targetElectrical,
            )
          : [];
      const contactEdits: readonly SchematicEdit[] =
        targetElectrical?.kind === "route" && attachRequests.length > 0
          ? proposeEndpointsRouteAttachment(
              projected,
              resolver,
              targetElectrical.routeId,
              attachRequests,
              `move-${nextRoutingSuffix()}`,
            ).edits
          : [];
      // A pin dropped exactly on a foreign pin (or junction) is the same
      // explicit gesture as placing a component against one: bond the two
      // endpoints through the direct-contact planner. Incompatible nets
      // (conflicting names or power domains) fall back to a plain move.
      let directContactRejection: string | null = null;
      const directEdits: readonly SchematicEdit[] = (() => {
        if (
          movingElectrical?.kind !== "endpoint" ||
          targetElectrical?.kind !== "endpoint"
        ) {
          return [];
        }
        const plan = planDirectEndpointConnection(projected, {
          from: movingElectrical.endpoint,
          to: targetElectrical.endpoint,
          newNetId: `net-move-${nextRoutingSuffix()}`,
        });
        if (!plan.ok) {
          directContactRejection = plan.message;
          return [];
        }
        return plan.edits;
      })();
      const result = transactConnectivity(
        targetElectrical?.kind === "route"
          ? "attach-to-route"
          : targetElectrical?.kind === "endpoint"
            ? "connect"
            : "transform",
        [
          ...prefixEdits,
          ...groupMove.edits,
          ...visualMoveEdits(preview.movePlan, delta, sourceDocument),
          ...contactEdits,
          ...directEdits,
        ],
      );
      if (result?.ok && (contactEdits.length > 0 || directEdits.length > 0)) {
        setStatus("Snapped pin endpoints and connected them without a wire");
      } else if (result?.ok && directContactRejection) {
        setStatus(`Moved without connecting: ${directContactRejection}`);
      } else if (result?.ok && prefixEdits.length > 0) {
        setStatus("Moved and transformed selection");
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Local stretch failed",
      );
    }
  };

  return {
    completeVisualSelectionMove,
    visualMoveOrigin,
    resolveInstanceMove,
    completeInstanceMove,
  };
}
