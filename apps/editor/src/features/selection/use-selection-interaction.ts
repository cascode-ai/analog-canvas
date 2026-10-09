import {
  useRef,
  useEffect,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  clipboardPlacementAnchor,
  orientClipboard,
} from "../clipboard/copy-placement";
import type { SchematicClipboard } from "../clipboard/clipboard";
import type { NetLabelPlacementTarget } from "../wiring/route-interaction-geometry";
import {
  captureProjectCopy,
  prepareProjectCopy,
  planProjectCopyPlacement,
} from "../clipboard/project-copy";
import { endpointKey } from "@icm/derived";
import {
  createRoutingOperationPlan,
  executeTransaction,
  gateRoutingOperationPlan,
  planCellSelectionDeletion,
  planRoutingDeletion,
  planRoutingTransform,
  type RoutingOperationIntent,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import {
  routeEndpoints,
  type CircuitProject,
  type Point,
  type SchematicDocument,
} from "@icm/model";
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
import type {
  createSelectionMoveController,
  SelectionMovePreview,
  ResolvedSelectionMove,
} from "./selection-move-controller";

type TransactionResult = { ok: boolean; revision: number };

interface MoveProjectionInput {
  screenPoint: Point;
  camera: string | null;
  suppressSnap: boolean;
  tolerance: number;
  source: SchematicDocument;
  resolved: ResolvedSelectionMove;
}

interface MoveProjectionCache extends MoveProjectionInput {
  document: SchematicDocument;
}

interface VisualMoveProjectionCache extends MoveProjectionInput {
  routePoints: ReadonlyMap<string, readonly Point[]>;
}

interface MoveGestureSession {
  controller: ReturnType<typeof createSelectionMoveController>;
  semanticPreview?: boolean;
  source: SchematicDocument;
  movePlan: SelectionMovePlan;
  selectionPreview: SelectionMovePreview;
  visual: ReturnType<typeof startCanvasDragVisual> | null;
  routeVisual: ReturnType<typeof startCanvasDragVisual> | null;
  projectedDocument: SchematicDocument;
  prefixEdits: SchematicEdit[];
  latestPoint: Point | null;
  latestScreenPoint: Point | null;
  svg: SVGSVGElement | null;
  lastProjection: MoveProjectionCache | VisualMoveProjectionCache | null;
  lastSnap?: SnapResult;
}

const isSameMoveProjectionInput = <T extends MoveProjectionInput>(
  cached: T | null,
  screenPoint: Point,
  suppressSnap: boolean,
  tolerance: number,
  source: SchematicDocument,
  camera: string | null,
  allowRoundedClick = false,
): cached is T =>
  cached !== null &&
  // PointerEvent keeps sub-pixel coordinates while its following MouseEvent
  // rounds them to integers. Treat that browser precision loss as the same
  // physical input, but never reuse a projection for a genuinely new click.
  (allowRoundedClick
    ? Math.abs(cached.screenPoint.x - screenPoint.x) < 1 &&
      Math.abs(cached.screenPoint.y - screenPoint.y) < 1
    : cached.screenPoint.x === screenPoint.x &&
      cached.screenPoint.y === screenPoint.y) &&
  cached.suppressSnap === suppressSnap &&
  cached.tolerance === tolerance &&
  cached.source === source &&
  cached.camera === camera;

export interface UseSelectionInteractionOptions {
  project: CircuitProject;
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
  transactCopy: (
    plan: ReturnType<typeof planProjectCopyPlacement>,
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
  moveController: ReturnType<typeof createSelectionMoveController>;
  snapCoordinate: (value: number, grid: number) => number;
  updateInstanceSelection: (instanceId: string, additive: boolean) => void;
  suppressInstanceClickRef: MutableRefObject<boolean>;
  logicalRadiusForPixels: (svg: SVGSVGElement, pixels: number) => number;
  snapGuides: (guides: SnapGuideLine[]) => void;
  setProjectedMovePreview: (document: SchematicDocument | null) => void;
  beginSelectionMoveInteraction: () => void;
}

/**
 * Owns commands whose meaning is the current visual selection. Pointer move
 * orchestration is added here separately so the existing selection reducer
 * remains the sole source of selected object identities.
 */
export function useSelectionInteraction(
  options: UseSelectionInteractionOptions,
) {
  const commandMoveSessionRef = useRef<MoveGestureSession | null>(null);
  const pointerMoveSessionRef = useRef<{
    source: SchematicDocument;
    cancel: () => void;
  } | null>(null);
  useEffect(() => {
    if (
      commandMoveSessionRef.current?.source !== options.document &&
      commandMoveSessionRef.current
    ) {
      clearCommandMoveSession();
      options.snapGuides([]);
      options.cancelInteraction();
    }
    if (pointerMoveSessionRef.current?.source !== options.document)
      pointerMoveSessionRef.current?.cancel();
  }, [options.document]);
  useEffect(
    () => () => {
      commandMoveSessionRef.current?.controller.dispose();
      pointerMoveSessionRef.current?.cancel();
    },
    [],
  );
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
    session: MoveGestureSession,
  ): SelectionMovePreview | null => {
    const primaryInstanceId = session.selectionPreview?.primaryInstanceId;
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
    if (session.source !== options.document) {
      return "The document changed; restart Move before transforming";
    }
    if (!session.selectionPreview.primaryInstanceId) {
      return "Rotate and mirror during Move require a component selection";
    }
    if (
      session.movePlan.looseRouteIds.length > 0 ||
      session.movePlan.independentAnnotationIds.length > 0 ||
      session.movePlan.draftingIds.length > 0
    ) {
      return "Rotate and mirror during Move require a component-and-wire closure";
    }
    return null;
  };

  const clearCommandMoveSession = (): void => {
    commandMoveSessionRef.current?.visual?.restore();
    commandMoveSessionRef.current?.routeVisual?.restore();
    commandMoveSessionRef.current?.controller.dispose();
    commandMoveSessionRef.current = null;
    options.setProjectedMovePreview(null);
  };

  /** One frame solver and painter for pointer, M, and visual-only movement. */
  const paintMoveFrame = (
    session: MoveGestureSession,
    point: Point,
    screenPoint: Point,
    svg: SVGSVGElement,
    suppressSnap: boolean,
    allowRoundedClick = false,
  ): boolean => {
    session.latestPoint = point;
    session.latestScreenPoint = screenPoint;
    session.svg = svg;
    const tolerance = options.logicalRadiusForPixels(svg, 7);
    const matrix = svg.getScreenCTM();
    const camera = matrix
      ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(",")
      : null;
    try {
      const cached = isSameMoveProjectionInput(
        session.lastProjection,
        screenPoint,
        suppressSnap,
        tolerance,
        session.projectedDocument,
        camera,
        allowRoundedClick,
      )
        ? session.lastProjection
        : null;
      // Never slide the cache key along with an unevaluated sub-pixel input.
      // Otherwise a stream of small pointer steps can retain its first frame.
      if (cached) return true;
      const resolved = session.controller.resolveSelectionMove(
        session.selectionPreview,
        point,
        tolerance,
        suppressSnap,
        session.lastSnap,
        session.projectedDocument === session.source
          ? undefined
          : session.projectedDocument,
      );
      if (resolved.preparationError) throw new Error(resolved.preparationError);
      const prepared = resolved.prepared;
      if (!prepared)
        throw new Error("Move could not prepare the pointer position");
      session.lastSnap = resolved.snap;
      options.snapGuides(resolved.snap.guides);
      // A topology/pose preview replaces SVG nodes. Stay on the formal path
      // for the rest of that gesture; imperative handles then refer to old ink.
      session.semanticPreview ||=
        !prepared.visualRoutePoints || session.prefixEdits.length > 0;
      const input = {
        screenPoint: { ...screenPoint },
        camera,
        suppressSnap,
        tolerance,
        source: session.projectedDocument,
        resolved,
      };
      if (session.semanticPreview) {
        session.visual?.restore();
        session.routeVisual?.restore();
        session.lastProjection = {
          ...input,
          document: prepared.previewDocument,
        };
        options.setProjectedMovePreview(prepared.previewDocument);
      } else {
        const routePoints = prepared.visualRoutePoints!;
        session.lastProjection = { ...input, routePoints };
        session.visual ??= startCanvasDragVisual(
          svg,
          session.movePlan.previewObjectIds.filter(
            (id) => !session.movePlan.translatedRouteIds.includes(id),
          ),
        );
        session.routeVisual ??= startCanvasDragVisual(svg, [
          ...routePoints.keys(),
        ]);
        session.visual.translate(resolved.snap.delta);
        for (const [id, points] of routePoints)
          session.routeVisual.setObjectPolyline(id, points);
        options.setProjectedMovePreview(session.projectedDocument);
      }
      return true;
    } catch (error) {
      session.lastProjection = null;
      session.visual?.restore();
      session.routeVisual?.restore();
      options.setProjectedMovePreview(null);
      options.setStatus(
        error instanceof Error ? error.message : "Move preview failed",
      );
      return false;
    }
  };

  const createMoveSession = (
    preview: SelectionMovePreview,
    source: SchematicDocument,
    prefixEdits: SchematicEdit[],
  ): MoveGestureSession => ({
    controller: options.moveController,
    source: options.document,
    movePlan: preview.movePlan,
    selectionPreview: preview,
    projectedDocument: source,
    prefixEdits,
    visual: null,
    routeVisual: null,
    latestPoint: null,
    latestScreenPoint: null,
    svg: null,
    lastProjection: null,
  });

  const startPointerSelectionMove = (
    event: ReactPointerEvent<SVGElement>,
    hitTarget: SVGElement,
    preview: SelectionMovePreview,
    source: SchematicDocument,
    prefixEdits: SchematicEdit[],
    onFinish?: (dragged: boolean) => void,
  ): void => {
    options.canvasDragSessionRef.current?.cancel();
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const session = createMoveSession(preview, source, prefixEdits);
    const restore = () => {
      session.visual?.restore();
      session.routeVisual?.restore();
      session.controller.dispose();
      options.setProjectedMovePreview(null);
      options.snapGuides([]);
    };
    options.canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: 4,
      onPreview: (client) => {
        paintMoveFrame(
          session,
          options.pointFromClient(client.x, client.y, svg, false),
          { x: client.x, y: client.y },
          svg,
          Boolean(client.altKey),
        );
      },
      onFinish: ({ client, dragged }) => {
        pointerMoveSessionRef.current = null;
        options.canvasDragSessionRef.current = null;
        try {
          if (dragged) {
            const point = options.pointFromClient(
              client.x,
              client.y,
              svg,
              false,
            );
            const suppressSnap = Boolean(client.altKey);
            if (
              !paintMoveFrame(
                session,
                point,
                { x: client.x, y: client.y },
                svg,
                suppressSnap,
              )
            )
              return;
            // Release consumes this exact frame proposal. The controller then
            // applies the strict connectivity gate in one undoable transaction.
            session.visual?.restore();
            session.routeVisual?.restore();
            session.controller.completeSelectionMove(
              preview,
              point,
              options.logicalRadiusForPixels(svg, 7),
              suppressSnap,
              session.lastSnap,
              {
                document: source,
                prefixEdits,
                resolvedMove: session.lastProjection!.resolved,
              },
            );
          }
          onFinish?.(dragged);
        } finally {
          restore();
        }
      },
      onCancel: () => {
        pointerMoveSessionRef.current = null;
        options.canvasDragSessionRef.current = null;
        restore();
      },
    });
    pointerMoveSessionRef.current = {
      source: options.document,
      cancel: () => options.canvasDragSessionRef.current?.cancel(),
    };
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
    const selectionPreview = primary?.placement
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
      : {
          instanceIds: [],
          primaryInstanceId: null,
          originalPositions: {},
          pointerStart: options.moveController.visualMoveOrigin(movePlan),
          movePlan,
        };
    commandMoveSessionRef.current = createMoveSession(
      selectionPreview,
      baseDocument,
      detachEdits,
    );
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
    allowRoundedClick = false,
  ): boolean => {
    const session = commandMoveSessionRef.current;
    if (!session) return false;
    if (session.source !== options.document) {
      clearCommandMoveSession();
      options.snapGuides([]);
      options.cancelInteraction();
      options.setStatus("Move cancelled because the document changed");
      return false;
    }
    return paintMoveFrame(
      session,
      point,
      screenPoint,
      svg,
      suppressSnap,
      allowRoundedClick,
    );
  };

  const transformCommandMove = (
    transform:
      | { kind: "rotate"; deltaDegrees: 45 | -45 | 90 | -90 }
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
              degrees:
                transform.deltaDegrees === -45
                  ? 315
                  : transform.deltaDegrees === -90
                    ? 270
                    : transform.deltaDegrees,
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
      const preview = projectedInstancePreview(session);
      if (!preview)
        throw new Error("Move transform lost the selected component");
      session.selectionPreview = preview;
      session.controller.dispose();
      const suppressSnap = session.lastProjection?.suppressSnap ?? false;
      session.lastProjection = null;
      delete session.lastSnap;
      if (session.latestPoint && session.latestScreenPoint && session.svg) {
        if (
          !updateCommandMovePreview(
            session.latestPoint,
            session.latestScreenPoint,
            session.svg,
            suppressSnap,
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
    suppressSnap: boolean,
  ): void => {
    if (!commandMoveSessionRef.current) return;
    // Click intent is authoritative. Re-resolve a genuinely new click against
    // the projected orientation Document; only the same physical pointer spot
    // may reuse preview because click events discard pointer sub-pixels.
    if (!updateCommandMovePreview(point, screenPoint, svg, suppressSnap, true))
      return;
    const session = commandMoveSessionRef.current!;
    session.visual?.restore();
    session.routeVisual?.restore();
    commandMoveSessionRef.current = null;
    options.setProjectedMovePreview(null);
    if (session.selectionPreview) {
      const resolvedMove = session.lastProjection?.resolved;
      if (!resolvedMove) {
        options.setStatus("Move could not resolve the clicked position");
        options.snapGuides([]);
        options.cancelInteraction();
        return;
      }
      session.controller.completeSelectionMove(
        session.selectionPreview,
        point,
        options.logicalRadiusForPixels(svg, 7),
        suppressSnap,
        session.lastSnap,
        {
          document: session.projectedDocument,
          prefixEdits: session.prefixEdits,
          resolvedMove,
        },
      );
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
    const preview: SelectionMovePreview = {
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
    startPointerSelectionMove(
      event,
      hitTarget,
      preview,
      previewBaseDocument,
      detachEdits,
      (dragged) => {
        if (dragged && detachDrag) selectInstance(instanceId, false);
        else if (!dragged && detachDrag) {
          selectInstance(instanceId, true);
          options.setStatus(`Selected ${instanceId}`);
        }
      },
    );
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
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const preview: SelectionMovePreview = {
      instanceIds: [],
      primaryInstanceId: null,
      originalPositions: {},
      pointerStart: options.pointFromClient(
        event.clientX,
        event.clientY,
        svg,
        false,
      ),
      movePlan,
    };
    startPointerSelectionMove(event, hitTarget, preview, options.document, []);
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
    let terminalIds: string[];
    try {
      const selectionPlan = planCellSelectionDeletion(
        options.document,
        options.resolver,
        deletionSeed,
        options.nextUniqueSuffix(),
      );
      deletionPlan = selectionPlan.routing;
      terminalIds = selectionPlan.terminalIds;
    } catch (error) {
      options.setStatus(
        error instanceof Error ? error.message : "Delete failed",
      );
      return;
    }
    if (terminalIds.length > 0) {
      if (
        options.commitCellTerminalSelection(terminalIds, [
          ...deletionPlan.edits,
        ])
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
    let copied: SchematicClipboard | null;
    try {
      copied = captureProjectCopy(options.project, options.document, {
        instanceIds: explicitInstanceIds ?? options.selectedIds,
        draftingIds: explicitInstanceIds
          ? []
          : options.visualSelection.draftingIds,
        routeIds: explicitInstanceIds ? [] : options.visualSelection.routeIds,
        junctionIds: explicitInstanceIds
          ? []
          : options.visualSelection.junctionIds,
        annotationIds: explicitInstanceIds
          ? []
          : options.visualSelection.annotationIds,
      });
      if (copied) prepareProjectCopy(options.project, options.document, copied);
    } catch (error) {
      options.setStatus(error instanceof Error ? error.message : String(error));
      return;
    }
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

  const commitCopyPlacement = (
    point: Point,
    netLabelTarget?: NetLabelPlacementTarget,
  ): void => {
    const interaction = options.getInteractionState();
    if (interaction.kind !== "copy-placement") return;
    const copyPlacement = interaction.copy;
    let proposal: ReturnType<typeof planProjectCopyPlacement>;
    let result: TransactionResult;
    try {
      // The whole copied subgraph turns/flips as one rigid body about its
      // grab anchor, and each part's labels follow its turn — the same
      // geometry the ghost previews, from the same resolved Symbols.
      const oriented = orientClipboard(
        copyPlacement.clipboard,
        copyPlacement.orientationOperations,
        copyPlacement.anchor,
        {
          resolver: prepareProjectCopy(
            options.project,
            options.document,
            copyPlacement.clipboard,
          ).resolver,
          presentation: options.document.presentation,
        },
      );
      proposal = planProjectCopyPlacement(
        options.project,
        options.document,
        oriented,
        {
          x: point.x - copyPlacement.anchor.x,
          y: point.y - copyPlacement.anchor.y,
        },
        copyPlacement.sequence,
        netLabelTarget,
      );
      result = options.transactCopy(proposal);
    } catch (error) {
      options.setStatus(error instanceof Error ? error.message : String(error));
      return;
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
    rotateCommandMove: (deltaDegrees: 45 | -45 | 90 | -90) =>
      transformCommandMove({ kind: "rotate", deltaDegrees }),
    mirrorCommandMove: (direction: ScreenFlip) =>
      transformCommandMove({ kind: "mirror", direction }),
    selectInstance,
  };
}
