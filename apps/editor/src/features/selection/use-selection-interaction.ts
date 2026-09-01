import {
  useRef,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  clipboardPlacementAnchor,
  orientClipboard,
  copySelection,
  proposePaste,
} from "../clipboard/clipboard";
import type { SchematicClipboard } from "../clipboard/clipboard";
import { endpointKey, resolveDocumentRoutingGeometry } from "@icm/derived";
import {
  createRoutingOperationPlan,
  executeTransaction,
  gateRoutingOperationPlan,
  planRoutingDeletion,
  planRoutingTransform,
  type RoutingOperationIntent,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SnapGuideLine, SnapResult } from "../../snap/engine";

import type { InteractionState } from "../../interaction/interaction-state";
import {
  startCanvasDragSession,
  type CanvasDragSession,
} from "../../canvas/canvas-drag-session";
import { startCanvasDragVisual } from "../../canvas/canvas-drag-visual";
import type { ScreenFlip } from "../../interaction/shortcut-orientation";
import { planDetachedMove } from "./detached-move";
import type { VisualSelection } from "./visual-selection";
import {
  planSelectionMove,
  type SelectionMovePlan,
} from "./selection-move-plan";

type TransactionResult = { ok: boolean; revision: number };

interface ResolvedInstanceMove {
  snap: SnapResult;
  moves: { instanceId: string; position: Point }[];
}

interface MoveProjectionInput {
  screenPoint: Point;
  suppressSnap: boolean;
  tolerance: number;
  sourceRevision: number;
  resolved: ResolvedInstanceMove;
}

interface MoveProjectionCache extends MoveProjectionInput {
  document: SchematicDocument;
}

interface VisualMoveProjectionCache extends MoveProjectionInput {
  routePoints: ReadonlyMap<string, readonly Point[]>;
}

export interface InstanceMovePreview {
  instanceIds: string[];
  primaryInstanceId: string;
  originalPositions: Record<string, Point>;
  pointerStart: Point;
  movePlan: SelectionMovePlan;
}

interface CommandMoveSession {
  documentId: string;
  baseRevision: number;
  movePlan: SelectionMovePlan;
  instancePreview: InstanceMovePreview | null;
  pointerOrigin: Point;
  visual: ReturnType<typeof startCanvasDragVisual> | null;
  routeVisual: ReturnType<typeof startCanvasDragVisual> | null;
  projectedDocument: SchematicDocument;
  prefixEdits: SchematicEdit[];
  latestPoint: Point | null;
  latestScreenPoint: Point | null;
  svg: SVGSVGElement | null;
  lastProjection: MoveProjectionCache | VisualMoveProjectionCache | null;
  lastSnap?: SnapResult;
  lastDelta: Point;
}

export interface ProjectedInstanceMove {
  document: SchematicDocument;
  prefixEdits: readonly SchematicEdit[];
  resolvedMove?: ResolvedInstanceMove;
}

const isSameMoveProjectionInput = <T extends MoveProjectionInput>(
  cached: T | null,
  screenPoint: Point,
  suppressSnap: boolean,
  tolerance: number,
  sourceRevision: number,
): cached is T =>
  cached !== null &&
  // PointerEvent keeps sub-pixel coordinates while its following MouseEvent
  // rounds them to integers. Treat that browser precision loss as the same
  // physical input, but never reuse a projection for a genuinely new click.
  Math.abs(cached.screenPoint.x - screenPoint.x) < 1 &&
  Math.abs(cached.screenPoint.y - screenPoint.y) < 1 &&
  cached.suppressSnap === suppressSnap &&
  cached.tolerance === tolerance &&
  cached.sourceRevision === sourceRevision;

export interface UseSelectionInteractionOptions {
  document: SchematicDocument;
  resolver: SymbolResolver;
  visualSelection: VisualSelection;
  selectedIds: readonly string[];
  selectedRouteId: string | null;
  selectedAnnotationId: string | null;
  selectedDraftingId: string | null;
  selectedEndpoint: WireSource | null;
  selectedNoConnect: SchematicDocument["noConnects"][number] | undefined;
  selectedEndpointNetId: string | null;
  getInteractionState: () => InteractionState<SchematicClipboard>;
  transact: (
    edits: SchematicEdit[],
    options?: { preserveInteraction?: boolean },
  ) => TransactionResult;
  transactProjectDocument: (
    transactionId: string,
    edits: readonly SchematicEdit[],
  ) => TransactionResult;
  commitCellTerminalSelection: (
    terminalIds: readonly string[],
    documentEdits: readonly SchematicEdit[],
  ) => boolean;
  setStatus: (status: string) => void;
  setSelectedEndpoint: (endpoint: WireSource | null) => void;
  resetSelection: () => void;
  replaceSelectionKind: (
    kind: "instance" | "drafting",
    ids: readonly string[],
  ) => void;
  selectOnly: (kind: "instance", ids: readonly string[]) => void;
  deleteSelectedRouteConnection: () => void;
  deleteSelectedAnnotation: () => void;
  clearTransientCanvasState: () => void;
  cancelAllTransientInteraction: () => void;
  cancelInteraction: () => void;
  cancelCanvasDrag: () => void;
  paintSnapGuides: (guides: []) => void;
  beginCopyPlacementInteraction: (
    clipboard: SchematicClipboard,
    anchor: Point,
  ) => void;
  setCopyPreviewPoint: (point: Point) => void;
  advanceCopyPlacement: () => void;
  nextUniqueSuffix: () => number;
  endpointTestId: (endpoint: WireSource["endpoint"]) => string;
  tool: string;
  canvasDragSessionRef: MutableRefObject<CanvasDragSession | null>;
  pointFromClient: (
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    snapToGrid: false,
  ) => Point;
  completeVisualSelectionMove: (
    movePlan: SelectionMovePlan,
    delta: Point,
  ) => void;
  snapCoordinate: (value: number, grid: number) => number;
  updateInstanceSelection: (instanceId: string, additive: boolean) => void;
  suppressInstanceClickRef: MutableRefObject<boolean>;
  resolveInstanceMove: (
    preview: InstanceMovePreview,
    position: Point,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
    projectedDocument?: SchematicDocument,
  ) => { snap: SnapResult; moves: { instanceId: string; position: Point }[] };
  completeInstanceMove: (
    preview: InstanceMovePreview,
    position: Point,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
    projection?: ProjectedInstanceMove,
  ) => void;
  logicalRadiusForPixels: (svg: SVGSVGElement, pixels: number) => number;
  snapGuides: (guides: SnapGuideLine[]) => void;
  setProjectedMovePreview: (document: SchematicDocument | null) => void;
  beginSelectionMoveInteraction: () => void;
  visualMoveOrigin: (movePlan: SelectionMovePlan) => Point;
}

/**
 * Owns commands whose meaning is the current visual selection. Pointer move
 * orchestration is added here separately so the existing selection reducer
 * remains the sole source of selected object identities.
 */
export function useSelectionInteraction(
  options: UseSelectionInteractionOptions,
) {
  const commandMoveSessionRef = useRef<CommandMoveSession | null>(null);
  /** Uniquifies Junction ids minted by successive Ctrl+drag detach moves. */
  const detachSequenceRef = useRef(0);
  const transactConnectivity = (
    intent: RoutingOperationIntent,
    edits: readonly SchematicEdit[],
    options_: { preserveInteraction?: boolean } = {},
  ): TransactionResult => {
    const gate = gateRoutingOperationPlan(
      options.document,
      createRoutingOperationPlan(options.document, {
        intent,
        diagnostics: [],
        edits,
      }),
      { symbolResolver: options.resolver },
    );
    if (!gate.ok) {
      options.setStatus(gate.message);
      return { ok: false, revision: options.document.revision };
    }
    return options.transact([...gate.edits], options_);
  };

  /**
   * One validated prefix shared by Shift+M and Ctrl/Cmd-drag. The gate both
   * rejects protected interface terminals before a preview starts and gives
   * the renderer the exact post-disconnect Document the final move uses.
   */
  const prepareDetachedMove = (
    instanceIds: ReadonlySet<string>,
  ): { document: SchematicDocument; edits: SchematicEdit[] } => {
    detachSequenceRef.current += 1;
    const planned = planDetachedMove(
      options.document,
      options.resolver,
      instanceIds,
      detachSequenceRef.current,
    );
    if (planned.edits.length === 0) {
      return { document: options.document, edits: [] };
    }
    const gate = gateRoutingOperationPlan(
      options.document,
      createRoutingOperationPlan(options.document, {
        intent: "transform",
        diagnostics: [],
        edits: planned.edits,
        expectedElectricalEffect: {
          kind: "remove",
          removedEndpointKeys: planned.disconnectedEndpointKeys,
        },
      }),
      { symbolResolver: options.resolver },
    );
    if (!gate.ok) throw new Error(gate.message);
    return {
      document: gate.evaluated.finalDocument,
      edits: [...gate.edits],
    };
  };

  const projectedInstancePreview = (
    session: CommandMoveSession,
  ): InstanceMovePreview | null => {
    const primaryInstanceId = session.instancePreview?.primaryInstanceId;
    if (!primaryInstanceId) return null;
    const primary = session.projectedDocument.instances.find(
      (instance) => instance.id === primaryInstanceId,
    );
    if (!primary?.placement) return null;
    return {
      instanceIds: session.movePlan.instanceIds,
      primaryInstanceId,
      originalPositions: Object.fromEntries(
        session.movePlan.instanceIds.flatMap((instanceId) => {
          const placement = session.projectedDocument.instances.find(
            (instance) => instance.id === instanceId,
          )?.placement;
          return placement
            ? [[instanceId, { ...placement.position }] as const]
            : [];
        }),
      ),
      pointerStart: { ...primary.placement.position },
      movePlan: session.movePlan,
    };
  };

  const commandMoveTransformReason = (): string | null => {
    const session = commandMoveSessionRef.current;
    if (!session) return "Move is not active";
    if (
      session.documentId !== options.document.id ||
      session.baseRevision !== options.document.revision
    ) {
      return "The document changed; restart Move before transforming";
    }
    if (!session.instancePreview) {
      return "Rotate and mirror during Move require a component selection";
    }
    if (
      session.movePlan.looseRouteIds.length > 0 ||
      session.movePlan.freeAnnotationIds.length > 0 ||
      session.movePlan.draftingIds.length > 0
    ) {
      return "Rotate and mirror during Move require a component-and-wire closure";
    }
    return null;
  };

  const clearCommandMoveSession = (): void => {
    commandMoveSessionRef.current?.visual?.restore();
    commandMoveSessionRef.current?.routeVisual?.restore();
    commandMoveSessionRef.current = null;
    options.setProjectedMovePreview(null);
  };

  /**
   * The formal renderer is the sole semantic preview authority for Instance
   * movement. A dry-run applies exactly the same typed edits as commit, so
   * upright labels, Route markers, miter bridges, pin names and NoConnects are
   * all derived from one projected Document instead of ad-hoc DOM transforms.
   */
  const projectInstanceMove = (
    sourceDocument: SchematicDocument,
    moves: readonly { instanceId: string; position: Point }[],
    movePlan?: SelectionMovePlan,
  ): SchematicDocument => {
    const first = moves[0];
    const original = first
      ? sourceDocument.instances.find((item) => item.id === first.instanceId)
          ?.placement?.position
      : undefined;
    const delta =
      first && original
        ? { x: first.position.x - original.x, y: first.position.y - original.y }
        : { x: 0, y: 0 };
    const plan = planRoutingTransform(
      sourceDocument,
      options.resolver,
      {
        instanceIds:
          movePlan?.instanceIds ?? moves.map((move) => move.instanceId),
        routeIds: movePlan?.translatedRouteIds ?? [],
        junctionIds: movePlan?.translatedJunctionIds ?? [],
      },
      { kind: "translate", delta },
    );
    const blocking = plan.diagnostics.find((item) => item.severity === "error");
    if (blocking) throw new Error(blocking.message);
    const result = executeTransaction(
      sourceDocument,
      {
        transactionId: "selection-move-semantic-preview",
        documentId: sourceDocument.id,
        expectedRevision: sourceDocument.revision,
        actor: { kind: "human", id: "selection-move-preview" },
        dryRun: true,
        edits: [...plan.edits],
      },
      { symbolResolver: options.resolver },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.document;
  };

  /**
   * Lightweight geometry for the live pointer path. The routing planner stays
   * authoritative, but applying its three translation edit kinds to a shallow
   * projection avoids a full schema transaction and formal SVG render on every
   * animation frame. Commit still runs the normal typed transaction.
   */
  const projectInstanceMoveVisual = (
    sourceDocument: SchematicDocument,
    moves: readonly { instanceId: string; position: Point }[],
    movePlan: SelectionMovePlan,
  ): ReadonlyMap<string, readonly Point[]> => {
    const first = moves[0];
    const original = first
      ? sourceDocument.instances.find((item) => item.id === first.instanceId)
          ?.placement?.position
      : undefined;
    const delta =
      first && original
        ? { x: first.position.x - original.x, y: first.position.y - original.y }
        : { x: 0, y: 0 };
    const plan = planRoutingTransform(
      sourceDocument,
      options.resolver,
      {
        instanceIds: movePlan.instanceIds,
        routeIds: movePlan.translatedRouteIds,
        junctionIds: movePlan.translatedJunctionIds,
      },
      { kind: "translate", delta },
    );
    const blocking = plan.diagnostics.find((item) => item.severity === "error");
    if (blocking) throw new Error(blocking.message);

    const movedInstances = new Map(
      plan.edits.flatMap((edit) =>
        edit.kind === "move_instance"
          ? [[edit.instanceId, edit.position] as const]
          : [],
      ),
    );
    const movedJunctions = new Map(
      plan.edits.flatMap((edit) =>
        edit.kind === "move_junction"
          ? [[edit.junctionId, edit.position] as const]
          : [],
      ),
    );
    const changedRoutes = new Map(
      plan.edits.flatMap((edit) =>
        edit.kind === "set_route_path"
          ? [[edit.route.id, edit.route] as const]
          : [],
      ),
    );
    const projected: SchematicDocument = {
      ...sourceDocument,
      instances: sourceDocument.instances.map((instance) => {
        const position = movedInstances.get(instance.id);
        return position && instance.placement
          ? {
              ...instance,
              placement: { ...instance.placement, position },
            }
          : instance;
      }),
      junctions: sourceDocument.junctions.map((junction) => {
        const position = movedJunctions.get(junction.id);
        return position ? { ...junction, position } : junction;
      }),
      routes: sourceDocument.routes.map(
        (route) => changedRoutes.get(route.id) ?? route,
      ),
    };
    const geometry = resolveDocumentRoutingGeometry(
      projected,
      options.resolver,
    );
    return new Map(
      [
        ...plan.affected.internalRoutes,
        ...plan.affected.boundaryRoutes,
      ].flatMap((routeId) => {
        const route = geometry.routes.get(routeId);
        return route ? [[routeId, route.centerline] as const] : [];
      }),
    );
  };

  const beginKeyboardSelectionMove = (
    explicitSelection?: VisualSelection,
    moveOptions?: { detach?: boolean },
  ): void => {
    if (commandMoveSessionRef.current) {
      options.setStatus(
        "Move is already active · click to place · Esc cancels",
      );
      return;
    }
    const detach = moveOptions?.detach === true;
    // An explicit selection serves the armed Move verb: the pointed-at part
    // is picked up directly, independent of the live selection state.
    const selection = explicitSelection ?? options.visualSelection;
    // Shift+M cuts the parts loose before anything moves, so the move plans
    // against the topology the detach creates. Planning first and detaching
    // after would stretch the very wires the detach is meant to leave alone.
    let detachEdits: SchematicEdit[] = [];
    let baseDocument = options.document;
    if (detach) {
      const detaching = planSelectionMove(options.document, selection);
      if (detaching.instanceIds.length === 0) {
        options.setStatus("Select a part to move without its wires");
        return;
      }
      try {
        const prepared = prepareDetachedMove(new Set(detaching.instanceIds));
        detachEdits = prepared.edits;
        baseDocument = prepared.document;
      } catch (error) {
        options.setStatus(
          error instanceof Error ? error.message : "Detach move failed",
        );
        return;
      }
    }
    const movePlan = planSelectionMove(baseDocument, selection);
    if (movePlan.previewObjectIds.length === 0) {
      options.setStatus(
        "Selected objects are attached or locked and cannot move",
      );
      return;
    }
    const primaryInstanceId = explicitSelection
      ? (explicitSelection.instanceIds.at(-1) ??
        movePlan.instanceIds.at(0) ??
        null)
      : (options.selectedIds.at(-1) ?? movePlan.instanceIds.at(0) ?? null);
    const primary = primaryInstanceId
      ? baseDocument.instances.find((item) => item.id === primaryInstanceId)
      : undefined;
    const instancePreview = primary?.placement
      ? {
          instanceIds: movePlan.instanceIds,
          primaryInstanceId: primaryInstanceId!,
          originalPositions: Object.fromEntries(
            movePlan.instanceIds.flatMap((id) => {
              const item = baseDocument.instances.find(
                (candidate) => candidate.id === id,
              );
              return item?.placement
                ? [[id, { ...item.placement.position }] as const]
                : [];
            }),
          ),
          pointerStart: { ...primary.placement.position },
          movePlan,
        }
      : null;
    commandMoveSessionRef.current = {
      documentId: options.document.id,
      baseRevision: options.document.revision,
      movePlan,
      instancePreview,
      pointerOrigin: instancePreview
        ? instancePreview.pointerStart
        : options.visualMoveOrigin(movePlan),
      visual: null,
      routeVisual: null,
      projectedDocument: baseDocument,
      prefixEdits: detachEdits,
      latestPoint: null,
      latestScreenPoint: null,
      svg: null,
      lastProjection: null,
      lastDelta: { x: 0, y: 0 },
    };
    options.setProjectedMovePreview(null);
    options.beginSelectionMoveInteraction();
    options.setStatus(
      detach
        ? "Move without wires: move the pointer, then click to place (Esc to cancel)"
        : "Move: move the pointer, then click to place (Esc to cancel)",
    );
  };

  const updateCommandMovePreview = (
    point: Point,
    screenPoint: Point,
    svg: SVGSVGElement,
    suppressSnap: boolean,
  ): boolean => {
    const session = commandMoveSessionRef.current;
    if (!session || session.documentId !== options.document.id) return false;
    if (session.baseRevision !== options.document.revision) {
      clearCommandMoveSession();
      options.snapGuides([]);
      options.cancelInteraction();
      options.setStatus("Move cancelled because the document changed");
      return false;
    }
    session.latestPoint = point;
    session.latestScreenPoint = screenPoint;
    session.svg = svg;
    if (session.instancePreview) {
      const tolerance = options.logicalRadiusForPixels(svg, 7);
      const cached = isSameMoveProjectionInput(
        session.lastProjection,
        screenPoint,
        suppressSnap,
        tolerance,
        session.projectedDocument.revision,
      )
        ? session.lastProjection
        : null;
      const resolved =
        cached?.resolved ??
        options.resolveInstanceMove(
          session.instancePreview,
          point,
          tolerance,
          suppressSnap,
          session.lastSnap,
          session.projectedDocument === options.document
            ? undefined
            : session.projectedDocument,
        );
      session.lastSnap = resolved.snap;
      const primary = resolved.moves.find(
        (move) =>
          move.instanceId === session.instancePreview!.primaryInstanceId,
      );
      const original =
        session.instancePreview.originalPositions[
          session.instancePreview.primaryInstanceId
        ];
      if (!primary || !original) return false;
      session.lastDelta = {
        x: primary.position.x - original.x,
        y: primary.position.y - original.y,
      };
      options.snapGuides(resolved.snap.guides);
      try {
        if (session.projectedDocument !== options.document) {
          const projectedDocument =
            cached && "document" in cached
              ? cached.document
              : projectInstanceMove(
                  session.projectedDocument,
                  resolved.moves,
                  session.movePlan,
                );
          session.lastProjection = {
            screenPoint: { ...screenPoint },
            suppressSnap,
            tolerance,
            sourceRevision: session.projectedDocument.revision,
            resolved,
            document: projectedDocument,
          };
          options.setProjectedMovePreview(projectedDocument);
          return true;
        }
        const routePoints =
          cached && "routePoints" in cached
            ? cached.routePoints
            : projectInstanceMoveVisual(
                session.projectedDocument,
                resolved.moves,
                session.movePlan,
              );
        session.lastProjection = {
          screenPoint: { ...screenPoint },
          suppressSnap,
          tolerance,
          sourceRevision: session.projectedDocument.revision,
          resolved,
          routePoints,
        };
        session.visual ??= startCanvasDragVisual(
          svg,
          session.movePlan.previewObjectIds.filter(
            (objectId) =>
              !session.movePlan.translatedRouteIds.includes(objectId),
          ),
        );
        session.routeVisual ??= startCanvasDragVisual(svg, [
          ...routePoints.keys(),
        ]);
        session.visual.translate(session.lastDelta);
        for (const [routeId, points] of routePoints) {
          session.routeVisual.setObjectPolyline(routeId, points);
        }
        options.setProjectedMovePreview(session.projectedDocument);
      } catch (error) {
        session.lastProjection = null;
        options.setProjectedMovePreview(null);
        options.setStatus(
          error instanceof Error ? error.message : "Move preview failed",
        );
        return false;
      }
      return true;
    }

    session.lastDelta = {
      x: options.snapCoordinate(
        point.x - session.pointerOrigin.x,
        options.document.presentation.grid,
      ),
      y: options.snapCoordinate(
        point.y - session.pointerOrigin.y,
        options.document.presentation.grid,
      ),
    };
    options.setProjectedMovePreview(null);
    options.snapGuides([]);
    session.visual ??= startCanvasDragVisual(
      svg,
      session.movePlan.previewObjectIds,
    );
    session.visual.translate(session.lastDelta);
    return true;
  };

  const transformCommandMove = (
    transform:
      | { kind: "rotate"; deltaDegrees: 90 | -90 }
      | { kind: "mirror"; direction: ScreenFlip },
  ): boolean => {
    const reason = commandMoveTransformReason();
    if (reason) {
      options.setStatus(reason);
      return false;
    }
    const session = commandMoveSessionRef.current!;
    try {
      session.visual?.restore();
      session.routeVisual?.restore();
      session.visual = null;
      session.routeVisual = null;
      const plan = planRoutingTransform(
        session.projectedDocument,
        options.resolver,
        {
          instanceIds: session.movePlan.instanceIds,
          routeIds: session.movePlan.translatedRouteIds,
          junctionIds: session.movePlan.translatedJunctionIds,
        },
        transform.kind === "rotate"
          ? {
              kind: "rotate",
              degrees: transform.deltaDegrees === -90 ? 270 : 90,
            }
          : {
              kind: "mirror",
              axis: transform.direction === "left-right" ? "y" : "x",
            },
      );
      const blocking = plan.diagnostics.find(
        (item) => item.severity === "error",
      );
      if (blocking) throw new Error(blocking.message);
      const result = executeTransaction(
        session.projectedDocument,
        {
          transactionId: "selection-move-orientation-preview",
          documentId: session.projectedDocument.id,
          expectedRevision: session.projectedDocument.revision,
          actor: { kind: "human", id: "selection-move-preview" },
          dryRun: true,
          edits: plan.edits,
        },
        { symbolResolver: options.resolver },
      );
      if (!result.ok) {
        options.setStatus(
          result.diagnostics[0]?.message ?? "Move transform was rejected",
        );
        return false;
      }
      session.projectedDocument = result.document;
      session.prefixEdits.push(...plan.edits);
      session.instancePreview = projectedInstancePreview(session);
      session.lastProjection = null;
      delete session.lastSnap;
      if (session.latestPoint && session.latestScreenPoint && session.svg) {
        if (
          !updateCommandMovePreview(
            session.latestPoint,
            session.latestScreenPoint,
            session.svg,
            false,
          )
        ) {
          return false;
        }
      } else {
        options.setProjectedMovePreview(session.projectedDocument);
      }
      options.setStatus(
        transform.kind === "rotate"
          ? "Move preview rotated · click to place · Esc cancels"
          : `Move preview mirrored ${
              transform.direction === "left-right" ? "left/right" : "top/bottom"
            } · click to place · Esc cancels`,
      );
      return true;
    } catch (error) {
      options.setStatus(
        error instanceof Error ? error.message : "Move transform failed",
      );
      return false;
    }
  };

  const commitCommandMove = (
    point: Point,
    screenPoint: Point,
    svg: SVGSVGElement,
  ): void => {
    if (!commandMoveSessionRef.current) return;
    // Click intent is authoritative. Re-resolve a genuinely new click against
    // the projected orientation Document; only the same physical pointer spot
    // may reuse preview because click events discard pointer sub-pixels.
    if (!updateCommandMovePreview(point, screenPoint, svg, false)) return;
    const session = commandMoveSessionRef.current!;
    session.visual?.restore();
    session.routeVisual?.restore();
    commandMoveSessionRef.current = null;
    options.setProjectedMovePreview(null);
    if (session.instancePreview) {
      const resolvedMove = session.lastProjection?.resolved;
      if (!resolvedMove) {
        options.setStatus("Move could not resolve the clicked position");
        options.snapGuides([]);
        options.cancelInteraction();
        return;
      }
      options.completeInstanceMove(
        session.instancePreview,
        point,
        options.logicalRadiusForPixels(svg, 7),
        false,
        session.lastSnap,
        {
          document: session.projectedDocument,
          prefixEdits: session.prefixEdits,
          resolvedMove,
        },
      );
    } else {
      options.completeVisualSelectionMove(session.movePlan, session.lastDelta);
    }
    options.snapGuides([]);
    options.cancelInteraction();
  };

  const selectInstance = (instanceId: string, additive: boolean): void => {
    options.setSelectedEndpoint(null);
    options.updateInstanceSelection(instanceId, additive);
  };

  /**
   * Shift-drag duplicates, the way Virtuoso does. The copy rides the existing
   * copy-placement preview so it snaps and renders like any other paste, and
   * the release commits it; the original is never touched.
   *
   * A stationary Shift-press is not a duplicate, it is this editor's
   * add-to-selection click, so the copy only starts once the drag threshold is
   * crossed and a press-release without movement falls through to the toggle.
   */
  const beginCopyDrag = (
    event: ReactPointerEvent<SVGElement>,
    instanceId: string,
    hitTarget: SVGElement,
  ): void => {
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    // Duplicate what a plain drag would have carried: the live selection when
    // the pressed part belongs to it, otherwise just that part.
    const copiedIds = options.selectedIds.includes(instanceId)
      ? options.selectedIds
      : [instanceId];
    let started = false;
    options.canvasDragSessionRef.current?.cancel();
    options.canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: 4,
      onPreview: (client) => {
        const point = options.pointFromClient(client.x, client.y, svg, false);
        if (!started) {
          beginCopyPlacement(copiedIds);
          if (options.getInteractionState().kind !== "copy-placement") {
            options.canvasDragSessionRef.current?.cancel();
            return;
          }
          started = true;
        }
        options.setCopyPreviewPoint({
          x: options.snapCoordinate(
            point.x,
            options.document.presentation.grid,
          ),
          y: options.snapCoordinate(
            point.y,
            options.document.presentation.grid,
          ),
        });
      },
      onFinish: ({ client, dragged }) => {
        options.canvasDragSessionRef.current = null;
        if (!dragged || !started) {
          // A modifier-click that never moved keeps its toggle meaning.
          selectInstance(instanceId, true);
          options.setStatus(`Selected ${instanceId}`);
          return;
        }
        commitCopyPlacement(
          options.pointFromClient(client.x, client.y, svg, false),
        );
      },
      onCancel: () => {
        options.canvasDragSessionRef.current = null;
        if (started) options.cancelInteraction();
      },
    });
  };

  const beginMove = (
    event: ReactPointerEvent<SVGElement>,
    instanceId: string,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    if (options.tool !== "pointer" || event.button !== 0) return;
    if (options.getInteractionState().kind === "moving-selection") {
      options.cancelInteraction();
    }
    event.stopPropagation();
    const instance = options.document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance?.placement) return;
    options.suppressInstanceClickRef.current =
      hitTarget.getAttribute("data-canvas-hit-kind") === "instance";
    // The two modified drags follow Virtuoso, where they mean different
    // things. Ctrl/Cmd-drag moves a part off its wires, leaving them exactly
    // where they are on open Junction stubs with the old terminal memberships
    // disconnected. Shift-drag duplicates instead: the original never moves
    // and a copy lands where the pointer is released.
    //
    // Cmd stands in for Ctrl because macOS browsers convert Ctrl+left-press
    // into a right-button press before the page ever sees it.
    //
    // Either modifier pressed and released without moving keeps its
    // toggle-selection meaning; the drag threshold decides which happened, so
    // nothing is committed on a stationary click.
    const detachDrag = (event.ctrlKey || event.metaKey) && !event.shiftKey;
    const copyDrag = event.shiftKey && !(event.ctrlKey || event.metaKey);
    if (copyDrag) {
      beginCopyDrag(event, instanceId, hitTarget);
      return;
    }
    const movingSelection: VisualSelection =
      !detachDrag && options.selectedIds.includes(instanceId)
        ? options.visualSelection
        : {
            instanceIds: [instanceId],
            routeIds: [],
            junctionIds: [],
            annotationIds: [],
            draftingIds: [],
          };
    let detachEdits: SchematicEdit[] = [];
    let previewBaseDocument = options.document;
    if (detachDrag) {
      try {
        const prepared = prepareDetachedMove(new Set([instanceId]));
        detachEdits = prepared.edits;
        previewBaseDocument = prepared.document;
      } catch (error) {
        options.setStatus(
          error instanceof Error ? error.message : "Detach move failed",
        );
        return;
      }
    }
    const movePlan = planSelectionMove(previewBaseDocument, movingSelection);
    const movingIds = movePlan.instanceIds;
    // A detach drag defers selection: a threshold-crossing drag selects the
    // moved part on finish, while a mere modifier-click keeps its
    // toggle-selection meaning (pre-selecting here would make that toggle
    // deselect what it just selected).
    if (!detachDrag && !options.selectedIds.includes(instanceId))
      selectInstance(instanceId, false);
    if (movingIds.length === 0) return;
    options.canvasDragSessionRef.current?.cancel();
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const pointerStart = options.pointFromClient(
      event.clientX,
      event.clientY,
      svg,
      false,
    );
    const preview: InstanceMovePreview = {
      instanceIds: movingIds,
      primaryInstanceId: instanceId,
      originalPositions: Object.fromEntries(
        movingIds.map((id) => {
          const candidate = options.document.instances.find(
            (item) => item.id === id,
          )!;
          return [id, { ...candidate.placement!.position }];
        }),
      ),
      pointerStart,
      movePlan,
    };
    options.setProjectedMovePreview(null);
    const tolerance = options.logicalRadiusForPixels(svg, 7);
    let lastSnap: SnapResult | undefined;
    let lastProjection: MoveProjectionCache | VisualMoveProjectionCache | null =
      null;
    let movingVisual: ReturnType<typeof startCanvasDragVisual> | null = null;
    let boundaryRouteVisual: ReturnType<typeof startCanvasDragVisual> | null =
      null;
    const resolveProjection = (
      point: Point,
      screenPoint: Point,
      suppressSnap: boolean,
    ): MoveProjectionCache | VisualMoveProjectionCache => {
      if (
        isSameMoveProjectionInput(
          lastProjection,
          screenPoint,
          suppressSnap,
          tolerance,
          options.document.revision,
        )
      ) {
        return lastProjection;
      }
      const resolved = options.resolveInstanceMove(
        preview,
        point,
        tolerance,
        suppressSnap,
        lastSnap,
        detachDrag ? previewBaseDocument : undefined,
      );
      lastSnap = resolved.snap;
      const input = {
        screenPoint: { ...screenPoint },
        suppressSnap,
        tolerance,
        sourceRevision: options.document.revision,
        resolved,
      };
      lastProjection = detachDrag
        ? {
            ...input,
            document: projectInstanceMove(
              previewBaseDocument,
              resolved.moves,
              preview.movePlan,
            ),
          }
        : {
            ...input,
            routePoints: projectInstanceMoveVisual(
              options.document,
              resolved.moves,
              preview.movePlan,
            ),
          };
      return lastProjection;
    };
    options.canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: 4,
      onPreview: (client) => {
        try {
          const projection = resolveProjection(
            options.pointFromClient(client.x, client.y, svg, false),
            { x: client.x, y: client.y },
            Boolean(client.altKey),
          );
          options.snapGuides(projection.resolved.snap.guides);
          if ("document" in projection) {
            options.setProjectedMovePreview(projection.document);
          } else {
            movingVisual ??= startCanvasDragVisual(
              svg,
              preview.movePlan.previewObjectIds.filter(
                (objectId) =>
                  !preview.movePlan.translatedRouteIds.includes(objectId),
              ),
            );
            boundaryRouteVisual ??= startCanvasDragVisual(svg, [
              ...projection.routePoints.keys(),
            ]);
            const primary = projection.resolved.moves.find(
              (move) => move.instanceId === preview.primaryInstanceId,
            );
            const original =
              preview.originalPositions[preview.primaryInstanceId];
            if (primary && original) {
              movingVisual.translate({
                x: primary.position.x - original.x,
                y: primary.position.y - original.y,
              });
            }
            for (const [routeId, points] of projection.routePoints) {
              boundaryRouteVisual.setObjectPolyline(routeId, points);
            }
            // Keep the established semantic-preview class without replacing
            // the formal scene: this is the exact same base Document object.
            options.setProjectedMovePreview(options.document);
          }
        } catch (error) {
          lastProjection = null;
          movingVisual?.restore();
          boundaryRouteVisual?.restore();
          options.setProjectedMovePreview(null);
          options.setStatus(
            error instanceof Error ? error.message : "Move preview failed",
          );
        }
      },
      onFinish: ({ client, dragged }) => {
        options.canvasDragSessionRef.current = null;
        options.setProjectedMovePreview(null);
        options.snapGuides([]);
        if (dragged) {
          const point = options.pointFromClient(client.x, client.y, svg, false);
          const suppressSnap = Boolean(client.altKey);
          let projection: MoveProjectionCache | VisualMoveProjectionCache;
          try {
            projection = resolveProjection(
              point,
              { x: client.x, y: client.y },
              suppressSnap,
            );
          } catch (error) {
            options.setStatus(
              error instanceof Error ? error.message : "Move failed",
            );
            return;
          }
          movingVisual?.restore();
          boundaryRouteVisual?.restore();
          options.completeInstanceMove(
            preview,
            point,
            tolerance,
            suppressSnap,
            projection.resolved.snap,
            {
              // The detached projection, so the commit's routing transform
              // plans against the topology the prefix edits will create —
              // otherwise it would re-stretch the wires the detach just
              // anchored in place.
              document: previewBaseDocument,
              prefixEdits: detachEdits,
              resolvedMove: projection.resolved,
            },
          );
          if (detachDrag) {
            selectInstance(instanceId, false);
          }
          if (detachEdits.length > 0) {
            options.setStatus(
              `Moved ${instanceId} without its wires; original wire endpoints remain open`,
            );
          }
        } else if (detachDrag) {
          // The drag never crossed the threshold: keep the plain
          // ctrl-click toggle-selection meaning.
          selectInstance(instanceId, true);
          options.setStatus(`Selected ${instanceId}`);
        }
      },
      onCancel: () => {
        options.canvasDragSessionRef.current = null;
        movingVisual?.restore();
        boundaryRouteVisual?.restore();
        options.setProjectedMovePreview(null);
        options.snapGuides([]);
      },
    });
  };

  const beginVisualSelectionMove = (
    event: ReactPointerEvent<SVGElement>,
    selection: VisualSelection,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    if (options.tool !== "pointer" || event.button !== 0) return;
    const movePlan = planSelectionMove(options.document, selection);
    if (movePlan.previewObjectIds.length === 0) {
      options.cancelInteraction();
      options.setStatus(
        "Selected objects are attached or locked and cannot move",
      );
      return;
    }
    options.cancelInteraction();
    event.preventDefault();
    event.stopPropagation();
    options.canvasDragSessionRef.current?.cancel();
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const start = options.pointFromClient(
      event.clientX,
      event.clientY,
      svg,
      false,
    );
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, movePlan.previewObjectIds));
    const deltaAt = (client: Point): Point => {
      const point = options.pointFromClient(client.x, client.y, svg, false);
      return {
        x: options.snapCoordinate(
          point.x - start.x,
          options.document.presentation.grid,
        ),
        y: options.snapCoordinate(
          point.y - start.y,
          options.document.presentation.grid,
        ),
      };
    };
    options.canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: 4,
      onPreview: (client) => {
        dragVisual().translate(deltaAt(client));
        options.paintSnapGuides([]);
      },
      onFinish: ({ client, dragged }) => {
        options.canvasDragSessionRef.current = null;
        visual?.restore();
        options.paintSnapGuides([]);
        if (dragged) {
          options.completeVisualSelectionMove(movePlan, deltaAt(client));
        }
      },
      onCancel: () => {
        options.canvasDragSessionRef.current = null;
        visual?.restore();
        options.paintSnapGuides([]);
      },
    });
  };

  const deleteSelectedJunction = (): void => {
    if (options.selectedEndpoint?.endpoint.kind !== "junction") return;
    const junctionId = options.selectedEndpoint.endpoint.junctionId;
    const plan = planRoutingDeletion(
      options.document,
      options.resolver,
      { instanceIds: [], routeIds: [], junctionIds: [junctionId] },
      options.nextUniqueSuffix(),
    );
    const gate = gateRoutingOperationPlan(options.document, plan, {
      symbolResolver: options.resolver,
    });
    if (!gate.ok) {
      options.setStatus(gate.message);
      return;
    }
    const result = options.transact([...gate.edits]);
    if (result.ok) {
      options.setSelectedEndpoint(null);
      options.setStatus(
        `Deleted junction and ${plan.affected.boundaryRoutes.length + plan.affected.internalRoutes.length} attached routes`,
      );
    }
  };

  const toggleSelectedNoConnect = (): void => {
    const endpoint = options.selectedEndpoint?.endpoint;
    if (!endpoint || endpoint.kind === "junction") return;
    if (options.selectedNoConnect) {
      const result = options.transact([
        {
          kind: "remove_no_connect",
          noConnectId: options.selectedNoConnect.id,
        },
      ]);
      if (result.ok) {
        options.setStatus(
          `Cleared No Connect on ${options.endpointTestId(endpoint)}`,
        );
      }
      return;
    }
    if (options.selectedEndpointNetId) {
      options.setStatus(
        "Disconnect this endpoint before marking it No Connect",
      );
      return;
    }
    const result = options.transact([
      {
        kind: "add_no_connect",
        noConnect: { id: nextNoConnectId(), endpoint },
      },
    ]);
    if (result.ok) {
      options.setStatus(
        `Marked ${options.endpointTestId(endpoint)} No Connect`,
      );
    }
  };

  const nextNoConnectId = (): string => {
    const occupied = new Set([
      ...options.document.instances.map((instance) => instance.id),
      ...options.document.nets.map((net) => net.id),
      ...options.document.routes.map((route) => route.id),
      ...options.document.junctions.map((junction) => junction.id),
      ...options.document.noConnects.map((noConnect) => noConnect.id),
      ...options.document.annotations.map((annotation) => annotation.id),
      ...options.document.layoutGroups.map((group) => group.id),
      ...options.document.constraints.map((constraint) => constraint.id),
      ...(options.document.drafting?.objects ?? []).map((object) => object.id),
    ]);
    let id: string;
    do {
      id = `no-connect-ui-${options.nextUniqueSuffix()}`;
    } while (occupied.has(id));
    return id;
  };

  const disconnectSelectedEndpoint = (removeRoutes: boolean): void => {
    const endpoint = options.selectedEndpoint?.endpoint;
    if (!endpoint || endpoint.kind === "junction") return;
    const routeEdits = removeRoutes
      ? options.document.routes
          .filter((route) =>
            routeEndpoints(route).some(
              (candidate) => endpointKey(candidate) === endpointKey(endpoint),
            ),
          )
          .map((route): SchematicEdit => ({
            kind: "remove_route_geometry",
            routeId: route.id,
          }))
      : [];
    const result = transactConnectivity("cut", [
      ...routeEdits,
      { kind: "disconnect_endpoint", endpoint },
    ]);
    if (result.ok) {
      options.setSelectedEndpoint(null);
      options.setStatus(
        removeRoutes ? "Deleted endpoint connection" : "Disconnected endpoint",
      );
    }
  };

  const deleteSelection = (
    explicitTarget?: Partial<
      Record<
        | "instanceIds"
        | "routeIds"
        | "junctionIds"
        | "annotationIds"
        | "draftingIds",
        readonly string[]
      >
    >,
  ): void => {
    // An explicit target deletes exactly the pointed-at objects (the armed
    // Delete verb), bypassing whatever the live selection happens to hold.
    const deletionSeed = explicitTarget
      ? {
          instanceIds: [...(explicitTarget.instanceIds ?? [])],
          routeIds: [...(explicitTarget.routeIds ?? [])],
          junctionIds: [...(explicitTarget.junctionIds ?? [])],
          annotationIds: [...(explicitTarget.annotationIds ?? [])],
          draftingIds: [...(explicitTarget.draftingIds ?? [])],
        }
      : {
          instanceIds: [
            ...new Set([
              ...options.visualSelection.instanceIds,
              ...options.selectedIds,
            ]),
          ],
          routeIds: [
            ...new Set([
              ...options.visualSelection.routeIds,
              ...(options.selectedRouteId ? [options.selectedRouteId] : []),
            ]),
          ],
          junctionIds: [
            ...new Set([
              ...options.visualSelection.junctionIds,
              ...(options.selectedEndpoint?.endpoint.kind === "junction"
                ? [options.selectedEndpoint.endpoint.junctionId]
                : []),
            ]),
          ],
          annotationIds: [
            ...new Set([
              ...options.visualSelection.annotationIds,
              ...(options.selectedAnnotationId
                ? [options.selectedAnnotationId]
                : []),
            ]),
          ],
          draftingIds: [
            ...new Set([
              ...options.visualSelection.draftingIds,
              ...(options.selectedDraftingId
                ? [options.selectedDraftingId]
                : []),
            ]),
          ],
        };
    const existingSelectionCounts = {
      instances: deletionSeed.instanceIds.filter((id) =>
        options.document.instances.some((item) => item.id === id),
      ).length,
      routes: deletionSeed.routeIds.filter((id) =>
        options.document.routes.some((item) => item.id === id),
      ),
      junctions: deletionSeed.junctionIds.filter((id) =>
        options.document.junctions.some((item) => item.id === id),
      ).length,
      annotations: deletionSeed.annotationIds.filter((id) =>
        options.document.annotations.some((item) => item.id === id),
      ).length,
      drafting: deletionSeed.draftingIds.filter((id) =>
        options.document.drafting?.objects.some((item) => item.id === id),
      ).length,
    };
    const deletionStatus =
      existingSelectionCounts.routes.length === 1 &&
      existingSelectionCounts.instances === 0 &&
      existingSelectionCounts.junctions === 0 &&
      existingSelectionCounts.annotations === 0 &&
      existingSelectionCounts.drafting === 0
        ? `Deleted wire ${existingSelectionCounts.routes[0]}`
        : existingSelectionCounts.instances > 0 &&
            existingSelectionCounts.routes.length === 0 &&
            existingSelectionCounts.junctions === 0 &&
            existingSelectionCounts.annotations === 0 &&
            existingSelectionCounts.drafting === 0
          ? "Deleted component selection; connected wires remain dangling"
          : "Deleted selected schematic objects";
    let deletionPlan;
    try {
      deletionPlan = planRoutingDeletion(
        options.document,
        options.resolver,
        deletionSeed,
        options.nextUniqueSuffix(),
      );
    } catch (error) {
      options.setStatus(
        error instanceof Error ? error.message : "Delete failed",
      );
      return;
    }
    const formalTerminals = (options.document.netlist?.terminals ?? []).filter(
      (terminal) =>
        terminal.interfaceInstanceIds.some((instanceId) =>
          deletionSeed.instanceIds.includes(instanceId),
        ),
    );
    if (formalTerminals.length > 0) {
      if (
        options.commitCellTerminalSelection(
          formalTerminals.map((terminal) => terminal.id),
          [...deletionPlan.edits],
        )
      ) {
        options.resetSelection();
        options.setSelectedEndpoint(null);
        options.setStatus(deletionStatus);
      }
      return;
    }
    const gate = gateRoutingOperationPlan(options.document, deletionPlan, {
      symbolResolver: options.resolver,
    });
    if (!gate.ok) {
      options.setStatus(gate.message);
      return;
    }
    const result = options.transact([...gate.edits]);
    if (result.ok) {
      options.resetSelection();
      options.setSelectedEndpoint(null);
      options.setStatus(deletionStatus);
    }
  };

  const beginCopyPlacement = (
    explicitInstanceIds?: readonly string[],
  ): void => {
    const interactionKind = options.getInteractionState().kind;
    if (interactionKind === "copy-placement") {
      options.setStatus("Copy placement is already active · Esc cancels");
      return;
    }
    if (interactionKind !== "idle") {
      options.setStatus("Finish or cancel the active tool before copying");
      return;
    }
    // Explicit ids serve the armed Copy verb: the pointed-at part is copied
    // directly, independent of the (possibly stale) live selection state.
    const copied = explicitInstanceIds
      ? copySelection(options.document, explicitInstanceIds, [], {
          routeIds: [],
          junctionIds: [],
          annotationIds: [],
        })
      : copySelection(
          options.document,
          options.selectedIds,
          options.visualSelection.draftingIds,
          {
            routeIds: options.visualSelection.routeIds,
            junctionIds: options.visualSelection.junctionIds,
            annotationIds: options.visualSelection.annotationIds,
          },
        );
    if (!copied) {
      options.setStatus("Select something to copy");
      return;
    }
    const anchor = clipboardPlacementAnchor(copied);
    if (!anchor) {
      options.setStatus("Selected components have no placeable origin");
      return;
    }
    options.cancelCanvasDrag();
    options.clearTransientCanvasState();
    options.paintSnapGuides([]);
    options.beginCopyPlacementInteraction(copied, anchor);
    options.setStatus(
      `Place copy of ${copied.instances.length} components · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels`,
    );
  };

  const commitCopyPlacement = (point: Point): void => {
    const interaction = options.getInteractionState();
    if (interaction.kind !== "copy-placement") return;
    const copyPlacement = interaction.copy;
    // The whole copied subgraph turns/flips as one rigid body about its
    // grab anchor — the same geometry the ghost previews.
    const oriented = orientClipboard(
      copyPlacement.clipboard,
      copyPlacement.orientationOperations,
      copyPlacement.anchor,
    );
    const proposal = proposePaste(
      options.document,
      oriented,
      {
        x: point.x - copyPlacement.anchor.x,
        y: point.y - copyPlacement.anchor.y,
      },
      copyPlacement.sequence,
    );
    if (proposal.errors.length > 0) {
      options.setStatus(proposal.errors[0]!);
      options.cancelAllTransientInteraction();
      return;
    }
    const edits = [...proposal.edits];
    const copyPlan = createRoutingOperationPlan(options.document, {
      intent: "clone",
      affected: proposal.operationPlan.affected,
      expectedElectricalEffect: proposal.operationPlan.expectedElectricalEffect,
      idRemap: proposal.idRemap,
      diagnostics: proposal.operationPlan.diagnostics,
      edits,
    });
    const gate = gateRoutingOperationPlan(options.document, copyPlan, {
      symbolResolver: options.resolver,
    });
    if (!gate.ok) {
      options.setStatus(gate.message);
      return;
    }
    const editsCellInterface = edits.some(
      (edit) =>
        edit.kind === "add_cell_terminal" ||
        edit.kind === "update_cell_terminal",
    );
    let result: TransactionResult;
    if (editsCellInterface) {
      result = options.transactProjectDocument("copy-cell-pin", gate.edits);
    } else {
      result = options.transact([...gate.edits], {
        preserveInteraction: true,
      });
    }
    if (result.ok) {
      options.advanceCopyPlacement();
      options.selectOnly("instance", proposal.instanceIds);
      options.setCopyPreviewPoint(point);
      options.setStatus(
        `Copied ${proposal.instanceIds.length} components · click to place another · Esc exits`,
      );
    }
  };

  return {
    beginCopyPlacement,
    beginKeyboardSelectionMove,
    beginMove,
    beginVisualSelectionMove,
    commitCopyPlacement,
    commitCommandMove,
    clearCommandMoveSession,
    deleteSelectedJunction,
    deleteSelection,
    toggleSelectedNoConnect,
    disconnectSelectedEndpoint,
    updateCommandMovePreview,
    canBeginKeyboardSelectionMove: () =>
      planSelectionMove(options.document, options.visualSelection)
        .previewObjectIds.length > 0,
    canTransformCommandMove: () => commandMoveTransformReason() === null,
    rotateCommandMove: (deltaDegrees: 90 | -90) =>
      transformCommandMove({ kind: "rotate", deltaDegrees }),
    mirrorCommandMove: (direction: ScreenFlip) =>
      transformCommandMove({ kind: "mirror", direction }),
    selectInstance,
  };
}
