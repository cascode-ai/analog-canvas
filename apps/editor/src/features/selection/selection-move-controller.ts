import {
  planInstanceContactTransform,
  projectRoutingTransformGeometry,
  gateRoutingOperationPlan,
  planRoutingTransform,
  type RoutingOperationPlan,
  type ExpectedElectricalEffect,
  type RoutingOperationIntent,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import {
  deriveNetConnectivity,
  deriveDocumentContactEvidence,
  endpointKey,
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
  annotationDragPosition,
  draggedAnnotationAtPosition,
} from "../text-editing/annotation-drag-model";
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

export interface PreparedInstanceMove {
  plan: RoutingOperationPlan;
  /** Transient geometry, never a replacement for the committed Document. */
  previewDocument: SchematicDocument;
  /** Reuse existing SVG nodes while topology is unchanged. */
  visualRoutePoints?: ReadonlyMap<string, readonly Point[]>;
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
    options?: { expectedElectricalEffect?: ExpectedElectricalEffect },
  ) => TransactionResult | null;
  setStatus: (status: string) => void;
  nextRoutingSuffix: () => number;
}) {
  const visualMoveEdits = (
    movePlan: SelectionMovePlan,
    delta: Point,
    sourceDocument: SchematicDocument = document,
  ): SchematicEdit[] => {
    const annotationRouteGeometryRecords =
      sourceDocument === document
        ? routeGeometryRecords
        : (() => {
            const resolved = resolveDocumentRoutingGeometry(
              sourceDocument,
              resolver,
            );
            return sourceDocument.routes.flatMap((route) => {
              const geometry = resolved.routes.get(route.id);
              return geometry ? [{ route, geometry }] : [];
            });
          })();
    return [
      ...movePlan.independentAnnotationIds.flatMap((annotationId) => {
        const annotation = sourceDocument.annotations.find(
          (candidate) => candidate.id === annotationId,
        );
        if (!annotation || annotation.locked) return [];
        const geometryContext = {
          document: sourceDocument,
          // A group translation preserves every member's fine offset. The
          // already grid-disciplined delta moves the group; re-snapping each
          // label to the current annotation grid would deform it internally.
          annotationGrid: 1,
          resolver,
          routeGeometryRecords: annotationRouteGeometryRecords,
        };
        const position = annotationDragPosition(geometryContext, annotation);
        return [
          {
            kind: "upsert_schematic_annotation" as const,
            annotation: draggedAnnotationAtPosition(
              geometryContext,
              annotation,
              snapGridPoint(
                { x: position.x + delta.x, y: position.y + delta.y },
                1,
              ),
            ),
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
  };

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
    const independentAnnotation = movePlan.independentAnnotationIds
      .map((id) => document.annotations.find((item) => item.id === id))
      .find((annotation) => annotation !== undefined);
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
      (independentAnnotation
        ? annotationDragPosition(
            {
              document,
              annotationGrid: 1,
              resolver,
              routeGeometryRecords,
            },
            independentAnnotation,
          )
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
    try {
      return {
        snap,
        moves,
        prepared: prepareResolvedMove(preview, { snap, moves }, sourceDocument),
      };
    } catch (error) {
      return {
        snap,
        moves,
        preparationError:
          error instanceof Error ? error.message : "Move failed",
      };
    }
  };

  let preparedCache:
    | { source: SchematicDocument; key: string; value: PreparedInstanceMove }
    | undefined;
  let contactBoundaryCache:
    { source: SchematicDocument; key: string; separates: boolean } | undefined;
  const prepareResolvedMove = (
    preview: InstanceMovePreview,
    resolved: {
      snap: SnapResult;
      moves: { instanceId: string; position: Point }[];
    },
    sourceDocument: SchematicDocument,
  ): PreparedInstanceMove => {
    const first = resolved.moves[0]!;
    const original = preview.originalPositions[first.instanceId]!;
    const delta = {
      x: first.position.x - original.x,
      y: first.position.y - original.y,
    };
    const key = JSON.stringify([
      preview.movePlan,
      delta,
      Boolean(resolved.snap.electricalMatch),
    ]);
    if (preparedCache?.source === sourceDocument && preparedCache.key === key)
      return preparedCache.value;
    const routingPlan = planInstanceContactTransform(
      sourceDocument,
      resolver,
      {
        instanceIds: preview.movePlan.instanceIds,
        routeIds: preview.movePlan.translatedRouteIds,
        junctionIds: preview.movePlan.translatedJunctionIds,
      },
      delta,
      Boolean(resolved.snap.electricalMatch),
    );
    const plan = {
      ...routingPlan,
      edits: [
        ...routingPlan.edits,
        ...visualMoveEdits(preview.movePlan, delta, sourceDocument),
      ],
    };
    // Passing back over the drag origin is a valid no-op preview. There is
    // nothing to transact, so do not send it to the nonempty-operation gate.
    if (
      (plan.edits.length === 0 || (delta.x === 0 && delta.y === 0)) &&
      !plan.diagnostics.some((d) => d.severity === "error")
    ) {
      const geometry = resolveDocumentRoutingGeometry(sourceDocument, resolver);
      const value: PreparedInstanceMove = {
        plan,
        previewDocument: sourceDocument,
        visualRoutePoints: new Map(
          [
            ...plan.affected.internalRoutes,
            ...plan.affected.boundaryRoutes,
          ].flatMap((id) => {
            const route = geometry.routes.get(id);
            return route ? [[id, route.centerline] as const] : [];
          }),
        ),
      };
      preparedCache = { source: sourceDocument, key, value };
      return value;
    }
    const blocking = plan.diagnostics.find((d) => d.severity === "error");
    if (blocking) throw new Error(blocking.message);
    const boundaryKey = JSON.stringify([
      plan.affected.instances,
      plan.affected.internalJunctions,
    ]);
    if (
      contactBoundaryCache?.source !== sourceDocument ||
      contactBoundaryCache.key !== boundaryKey
    ) {
      const movingInstances = new Set(plan.affected.instances);
      const movingJunctions = new Set(plan.affected.internalJunctions);
      const inside = (endpoint: RouteEndpoint) =>
        endpoint.kind === "terminal"
          ? movingInstances.has(endpoint.instanceId)
          : movingJunctions.has(endpoint.junctionId);
      contactBoundaryCache = {
        source: sourceDocument,
        key: boundaryKey,
        separates: deriveDocumentContactEvidence(
          sourceDocument,
          resolver,
        ).contacts.some(
          (contact) =>
            contact.endpoints.some(inside) &&
            contact.endpoints.some((endpoint) => !inside(endpoint)),
        ),
      };
    }
    // Most pointer frames only deform existing conductors. Apply the same
    // geometry edits without full-Document validation on every frame. Real
    // contact changes (including a direct bond separating) use the complete
    // transaction preview; every release still uses the strict commit gate.
    const geometryOnly =
      plan.intent === "transform" &&
      !contactBoundaryCache.separates &&
      plan.edits.every(
        (edit) =>
          edit.kind === "move_instance" ||
          edit.kind === "move_junction" ||
          edit.kind === "set_route_path",
      );
    let finalDocument: SchematicDocument;
    if (geometryOnly)
      finalDocument = projectRoutingTransformGeometry(sourceDocument, plan);
    else {
      const gate = gateRoutingOperationPlan(sourceDocument, plan, {
        symbolResolver: resolver,
      });
      if (!gate.ok) throw new Error(gate.message);
      finalDocument = gate.evaluated.finalDocument;
    }
    const sameIds = (
      before: readonly { id: string }[],
      after: readonly { id: string }[],
    ) =>
      before.length === after.length &&
      after.every((item) => before.some((old) => old.id === item.id));
    const value: PreparedInstanceMove = {
      plan,
      previewDocument: finalDocument,
    };
    if (
      plan.intent === "transform" &&
      sameIds(sourceDocument.routes, finalDocument.routes) &&
      sameIds(sourceDocument.junctions, finalDocument.junctions)
    ) {
      const geometry = resolveDocumentRoutingGeometry(finalDocument, resolver);
      value.visualRoutePoints = new Map(
        [
          ...plan.affected.internalRoutes,
          ...plan.affected.boundaryRoutes,
        ].flatMap((id) => {
          const route = geometry.routes.get(id);
          return route ? [[id, route.centerline] as const] : [];
        }),
      );
    }
    preparedCache = { source: sourceDocument, key, value };
    return value;
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
    try {
      const resolved =
        projection?.resolvedMove ??
        resolveInstanceMove(
          preview,
          position,
          tolerance,
          suppressSnap,
          previous,
          projection?.document,
        );
      if (resolved.preparationError) throw new Error(resolved.preparationError);
      if (
        resolved.moves.every((move) => {
          const original = preview.originalPositions[move.instanceId]!;
          return (
            original.x === move.position.x && original.y === move.position.y
          );
        }) &&
        prefixEdits.length === 0
      )
        return;
      const prepared =
        resolved.prepared ??
        prepareResolvedMove(preview, resolved, sourceDocument);
      if (
        prepared.plan.source.revision !== sourceDocument.revision ||
        prepared.plan.source.documentId !== sourceDocument.id
      ) {
        throw new Error("Move cancelled because the document changed");
      }
      const disconnectedEndpointKeys = prefixEdits.flatMap((edit) =>
        edit.kind === "disconnect_endpoint" ? [endpointKey(edit.endpoint)] : [],
      );
      const expectedElectricalEffect: ExpectedElectricalEffect =
        disconnectedEndpointKeys.length > 0 &&
        prepared.plan.intent === "transform"
          ? { kind: "remove", removedEndpointKeys: disconnectedEndpointKeys }
          : prepared.plan.expectedElectricalEffect;
      const result = transactConnectivity(
        prepared.plan.intent,
        [...prefixEdits, ...prepared.plan.edits],
        { expectedElectricalEffect },
      );
      if (!result?.ok) return;
      const warning = prepared.plan.diagnostics.find(
        (d) => d.severity === "warning",
      );
      if (warning) setStatus(`Moved without connecting: ${warning.message}`);
      else if (prepared.plan.expectedElectricalEffect.kind === "partition")
        setStatus("Inserted the moved component in series into the wire");
      else if (prepared.plan.intent !== "transform")
        setStatus("Snapped pin endpoints and connected them without a wire");
      else if (disconnectedEndpointKeys.length)
        setStatus("Moved selection without wires; original endpoints are open");
      else if (prefixEdits.length) setStatus("Moved and transformed selection");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Move failed");
    }
  };

  return {
    completeVisualSelectionMove,
    visualMoveOrigin,
    resolveInstanceMove,
    completeInstanceMove,
  };
}
