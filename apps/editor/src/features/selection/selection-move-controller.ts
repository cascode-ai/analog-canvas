import {
  prepareInstanceContactTransform,
  projectRoutingTransformGeometry,
  canProjectRoutingEditGeometry,
  gateRoutingOperationPlan,
  transformMaySeparateDirectContact,
  type RoutingOperationPlan,
  type ExpectedElectricalEffect,
  type RoutingOperationIntent,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import {
  deriveNetConnectivity,
  endpointKey,
  isMosBulkTerminal,
  isVisibleEndpoint,
  resolveDocumentRoutingGeometry,
  resolveElectricalContactTargets,
  resolveEndpointConnection,
  type RoutedComponent,
  type DocumentContactEvidence,
  type ResolvedDocumentRoutingGeometry,
  deriveNetConnectivityContext,
} from "@icm/derived";
import {
  routeEndpoints,
  snapGridPoint,
  type DerivedPoint,
  type Point,
  type RouteEndpoint,
  type VisualAnchor,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { closestPointOnSegment } from "../../canvas/canvas-geometry";
import {
  buildInstanceAnchors,
  buildDraftingAnchors,
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
  draftingMoveOrigin,
  translateDraftingMove,
} from "../drafting/drafting-move";
import {
  annotationDragPosition,
  draggedAnnotationAtPosition,
} from "../text-editing/annotation-drag-model";
import {
  endpointNetId,
  type RouteGeometryRecord,
} from "../wiring/route-interaction-geometry";
import {
  selectionMovePitch,
  type SelectionMovePlan,
} from "./selection-move-plan";

type TransactionResult = { ok: boolean };

/** Frozen source membership and pointer origin for one editor gesture. */
export interface SelectionMovePreview {
  instanceIds: string[];
  primaryInstanceId: string | null;
  originalPositions: Record<string, Point>;
  pointerStart: Point;
  movePlan: SelectionMovePlan;
}

export interface ResolvedSelectionMove {
  snap: SnapResult;
  moves: { instanceId: string; position: Point }[];
  prepared?: PreparedSelectionMove;
  preparationError?: string;
}

export interface ProjectedSelectionMove {
  document: SchematicDocument;
  prefixEdits: readonly SchematicEdit[];
  resolvedMove?: ResolvedSelectionMove;
}

export interface PreparedSelectionMove {
  plan: RoutingOperationPlan;
  /** Transient geometry, never a replacement for the committed Document. */
  previewDocument: SchematicDocument;
  /** Reuse existing SVG nodes while topology is unchanged. */
  visualRoutePoints?: ReadonlyMap<string, readonly Point[]>;
}

interface GestureSourceFacts {
  source: SchematicDocument;
  preview: SelectionMovePreview;
  endpoints: readonly WireSource[];
  routes: readonly RouteGeometryRecord[];
  contacts: readonly RoutedComponent[];
  movingIds: ReadonlySet<string>;
  movingObjectIds: ReadonlySet<string>;
  carriedRouteIds: ReadonlySet<string>;
  movingAnchors: readonly SnapAnchor[];
  staticTargets: readonly SnapAnchor[];
  routingGeometry: ResolvedDocumentRoutingGeometry;
  planTransform: ReturnType<typeof prepareInstanceContactTransform>;
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
  contactEvidence,
  annotationGrid = document.presentation.grid,
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
  annotationGrid?: number;
  /**
   * This Document's contact evidence, as the editor's connectivity index
   * already derived it. A contact-changing preview gate runs a transaction
   * over that same Document, and contact reconciliation would otherwise
   * re-derive the whole Document's evidence on every pointer frame.
   */
  contactEvidence?: DocumentContactEvidence;
}) {
  const visualMoveEdits = (
    movePlan: SelectionMovePlan,
    delta: Point,
    sourceDocument: SchematicDocument = document,
  ): SchematicEdit[] => {
    const annotationRouteGeometryRecords =
      gestureFacts?.source === sourceDocument
        ? gestureFacts.routes
        : sourceDocument === document
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
          ...(gestureFacts?.source === sourceDocument
            ? { routingGeometry: gestureFacts.routingGeometry }
            : {}),
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
        // Like the labels above: the delta is already on its grid, and
        // re-snapping each object would pull one set on the finer label
        // grid out of place.
        return object
          ? [
              {
                kind: "upsert_drafting_object" as const,
                object: translateDraftingMove(
                  sourceDocument,
                  resolver,
                  object,
                  delta,
                ),
              },
            ]
          : [];
      }),
    ];
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
          const origin = object
            ? draftingMoveOrigin(document, resolver, object)
            : null;
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

  const resolveSelectionMove = (
    preview: SelectionMovePreview,
    position: DerivedPoint,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
    projectedDocument?: SchematicDocument,
  ) => {
    const sourceDocument = projectedDocument ?? document;
    const cachedFacts =
      gestureFacts?.source === sourceDocument &&
      gestureFacts.preview === preview
        ? gestureFacts
        : undefined;
    const sourceVisibleEndpoints =
      cachedFacts?.endpoints ??
      (projectedDocument
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
        : visibleEndpoints);
    const sourceRouteGeometryRecords =
      cachedFacts?.routes ??
      (projectedDocument
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
        : routeGeometryRecords);
    const sourceContactComponents =
      cachedFacts?.contacts ??
      (projectedDocument
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
        : contactComponents);
    const rawDelta = {
      x: position.x - preview.pointerStart.x,
      y: position.y - preview.pointerStart.y,
    };
    const movingIds = cachedFacts?.movingIds ?? new Set(preview.instanceIds);
    const movingObjectIds =
      cachedFacts?.movingObjectIds ??
      new Set(preview.movePlan.previewObjectIds);
    const carriedRouteIds =
      cachedFacts?.carriedRouteIds ??
      new Set(preview.movePlan.translatedRouteIds);
    const movingAnchors =
      cachedFacts?.movingAnchors ??
      (preview.primaryInstanceId
        ? buildInstanceAnchors(
            sourceDocument,
            resolver,
            sourceVisibleEndpoints,
            movingIds,
          )
        : [
            {
              id: "selection:origin",
              point: { x: 0, y: 0 },
              kind: "grid" as const,
              axes: [],
            },
            {
              id: "selection:visual",
              point: visualMoveOrigin(preview.movePlan),
              kind: "drafting" as const,
            },
            ...buildDraftingAnchors(
              sourceDocument,
              resolver,
              new Set(preview.movePlan.draftingIds),
            ),
          ]);
    const pitch = selectionMovePitch(
      preview.movePlan,
      sourceDocument.presentation.grid,
      annotationGrid,
    );
    const primaryAnchorId = preview.primaryInstanceId
      ? `instance:${preview.primaryInstanceId}:origin`
      : "selection:origin";
    const profile = preview.primaryInstanceId
      ? SNAP_PROFILES.instanceMove
      : {
          ...SNAP_PROFILES.draftingMove,
          gridAlignedTranslation: true,
          captureWithinGridStep: true,
        };
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
            if (belongsToMovingInstance || carriedRouteIds.has(route.id))
              return [];
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
      cachedFacts?.staticTargets ??
      (!projectedDocument && sceneSnapTargetIndex
        ? sceneSnapTargetsExcluding(sceneSnapTargetIndex, movingObjectIds)
        : buildSceneSnapTargets(
            sourceDocument,
            resolver,
            sourceVisibleEndpoints,
            movingObjectIds,
          ));
    gestureFacts = cachedFacts ?? {
      source: sourceDocument,
      preview,
      endpoints: sourceVisibleEndpoints,
      routes: sourceRouteGeometryRecords,
      contacts: sourceContactComponents,
      movingIds,
      movingObjectIds,
      carriedRouteIds,
      movingAnchors,
      staticTargets,
      routingGeometry: {
        documentId: sourceDocument.id,
        documentRevision: sourceDocument.revision,
        routes: new Map(
          sourceRouteGeometryRecords.map((record) => [
            record.route.id,
            record.geometry,
          ]),
        ),
        endpointJoins: [],
      },
      planTransform: prepareInstanceContactTransform(sourceDocument, resolver, {
        instanceIds: preview.movePlan.instanceIds,
        routeIds: preview.movePlan.translatedRouteIds,
        junctionIds: preview.movePlan.translatedJunctionIds,
      }),
    };
    let snap: SnapResult = suppressSnap
      ? { delta: rawDelta, guides: [] }
      : resolveTranslationSnap(
          {
            rawDelta,
            movingAnchors,
            targetAnchors: [...staticTargets, ...routeTargets],
            primaryAnchorId,
            grid: pitch,
            tolerance,
            profile,
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
            primaryAnchorId,
            grid: pitch,
            tolerance,
            profile,
          },
          previous,
        );
      }
    }
    const primaryOriginal = preview.primaryInstanceId
      ? preview.originalPositions[preview.primaryInstanceId]
      : null;
    const landing = primaryOriginal
      ? snapGridPoint(
          {
            x: primaryOriginal.x + snap.delta.x,
            y: primaryOriginal.y + snap.delta.y,
          },
          pitch,
        )
      : snapGridPoint(snap.delta, pitch);
    const delta = primaryOriginal
      ? { x: landing.x - primaryOriginal.x, y: landing.y - primaryOriginal.y }
      : landing;
    snap = { ...snap, delta };
    const moves = preview.instanceIds.map((instanceId) => {
      const original = preview.originalPositions[instanceId]!;
      return {
        instanceId,
        position: { x: original.x + delta.x, y: original.y + delta.y },
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

  let gestureFacts: GestureSourceFacts | undefined;
  let preparedCache:
    | {
        source: SchematicDocument;
        preview: SelectionMovePreview;
        delta: Point;
        contact: boolean;
        value: PreparedSelectionMove;
      }
    | undefined;
  let contactBoundaryCache:
    | {
        source: SchematicDocument;
        preview: SelectionMovePreview;
        separates: boolean;
      }
    | undefined;
  const dispose = (): void => {
    gestureFacts = undefined;
    preparedCache = undefined;
    contactBoundaryCache = undefined;
  };
  const prepareResolvedMove = (
    preview: SelectionMovePreview,
    resolved: {
      snap: SnapResult;
      moves: { instanceId: string; position: Point }[];
    },
    sourceDocument: SchematicDocument,
  ): PreparedSelectionMove => {
    const delta = resolved.snap.delta;
    const contact = Boolean(resolved.snap.electricalMatch);
    if (
      preparedCache?.source === sourceDocument &&
      preparedCache.preview === preview &&
      preparedCache.delta.x === delta.x &&
      preparedCache.delta.y === delta.y &&
      preparedCache.contact === contact
    )
      return preparedCache.value;
    const planTransform =
      gestureFacts?.source === sourceDocument &&
      gestureFacts.preview === preview
        ? gestureFacts.planTransform
        : prepareInstanceContactTransform(sourceDocument, resolver, {
            instanceIds: preview.movePlan.instanceIds,
            routeIds: preview.movePlan.translatedRouteIds,
            junctionIds: preview.movePlan.translatedJunctionIds,
          });
    const routingPlan = planTransform(delta, contact);
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
      const value: PreparedSelectionMove = {
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
      preparedCache = {
        source: sourceDocument,
        preview,
        delta,
        contact,
        value,
      };
      return value;
    }
    const blocking = plan.diagnostics.find((d) => d.severity === "error");
    if (blocking) throw new Error(blocking.message);
    if (
      contactBoundaryCache?.source !== sourceDocument ||
      contactBoundaryCache.preview !== preview
    ) {
      const movingInstances = new Set(plan.affected.instances);
      const movingJunctions = new Set(plan.affected.internalJunctions);
      contactBoundaryCache = {
        source: sourceDocument,
        preview,
        separates: transformMaySeparateDirectContact(
          sourceDocument,
          resolver,
          movingInstances,
          movingJunctions,
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
      plan.edits.every((edit) =>
        canProjectRoutingEditGeometry(sourceDocument, edit),
      );
    let finalDocument: SchematicDocument;
    if (geometryOnly)
      finalDocument = projectRoutingTransformGeometry(sourceDocument, plan);
    else {
      const gate = gateRoutingOperationPlan(sourceDocument, plan, {
        symbolResolver: resolver,
        // Only for the Document the hint describes. The engine checks the same
        // identity again, so a stale hint can never answer for another
        // revision.
        ...(contactEvidence && sourceDocument === document
          ? {
              beforeContactEvidence: {
                document: sourceDocument,
                evidence: contactEvidence,
              },
            }
          : {}),
      });
      if (!gate.ok) throw new Error(gate.message);
      finalDocument = gate.evaluated.finalDocument;
    }
    const sameIds = (
      before: readonly { id: string }[],
      after: readonly { id: string }[],
    ) => {
      const ids = new Set(before.map((item) => item.id));
      return (
        before.length === after.length &&
        after.every((item) => ids.has(item.id))
      );
    };
    const value: PreparedSelectionMove = {
      plan,
      previewDocument: finalDocument,
    };
    const movingObjects = new Set(preview.movePlan.previewObjectIds);
    const movingRoutes = new Set([
      ...plan.affected.internalRoutes,
      ...plan.affected.boundaryRoutes,
    ]);
    const translatedRoutes = new Set(preview.movePlan.translatedRouteIds);
    const anchorMoves = (anchor: VisualAnchor) =>
      anchor.kind === "object"
        ? movingObjects.has(anchor.objectId)
        : anchor.kind === "route" && movingRoutes.has(anchor.routeId);
    // A boundary-wire text/marker or attached arrow/Leader/Callout can move
    // separately from its body. Paint these non-rigid cases from the same
    // coordinate projection instead of translating an entire SVG group.
    const nonRigid =
      sourceDocument.annotations.some(
        (annotation) =>
          (annotation.kind === "route-marker" &&
            preview.movePlan.independentAnnotationIds.includes(annotation.id) &&
            annotation.anchor.kind === "route") ||
          (annotation.anchor.kind === "route" &&
            movingRoutes.has(annotation.anchor.routeId) &&
            !translatedRoutes.has(annotation.anchor.routeId)),
      ) ||
      (sourceDocument.drafting?.objects.some(
        (object) =>
          ((object.kind === "leader" || object.kind === "callout") &&
            (movingObjects.has(object.id) || anchorMoves(object.target))) ||
          (object.kind === "text" &&
            object.anchor.kind === "route" &&
            movingRoutes.has(object.anchor.routeId) &&
            !translatedRoutes.has(object.anchor.routeId)) ||
          (object.kind === "arrow" &&
            (movingObjects.has(object.id) ||
              anchorMoves(object.from) ||
              anchorMoves(object.to))),
      ) ??
        false);
    if (
      !nonRigid &&
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
    preparedCache = { source: sourceDocument, preview, delta, contact, value };
    return value;
  };

  const completeSelectionMove = (
    preview: SelectionMovePreview,
    position: DerivedPoint,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
    projection?: ProjectedSelectionMove,
  ): void => {
    const sourceDocument = projection?.document ?? document;
    const prefixEdits = [...(projection?.prefixEdits ?? [])];
    try {
      const resolved =
        projection?.resolvedMove ??
        resolveSelectionMove(
          preview,
          position,
          tolerance,
          suppressSnap,
          previous,
          projection?.document,
        );
      if (resolved.preparationError) throw new Error(resolved.preparationError);
      if (
        resolved.snap.delta.x === 0 &&
        resolved.snap.delta.y === 0 &&
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
        setStatus(
          "Moved selection without its wires; original endpoints are open",
        );
      else if (prefixEdits.length) setStatus("Moved and transformed selection");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Move failed");
    } finally {
      dispose();
    }
  };

  return {
    visualMoveOrigin,
    resolveSelectionMove,
    completeSelectionMove,
    dispose,
  };
}
