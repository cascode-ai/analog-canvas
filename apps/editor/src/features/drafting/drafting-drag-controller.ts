import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { SchematicEdit } from "@icm/edit-engine";
import { resolveDraftingObjectGeometry } from "@icm/derived";
import type {
  DerivedPoint,
  DraftingObject,
  Point,
  SchematicDocument,
} from "@icm/model";
import { snapGridPoint } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  startCanvasDragSession,
  type CanvasDragSession,
} from "../../canvas/canvas-drag-session";
import { startCanvasDragVisual } from "../../canvas/canvas-drag-visual";
import {
  buildDraftingAnchors,
  buildSceneSnapTargets,
} from "../../snap/candidates";
import {
  resolveTranslationSnap,
  SNAP_PROFILES,
  type SnapGuideLine,
  type SnapResult,
} from "../../snap/engine";
import {
  applyDraftingHandle,
  type DraftingHandle,
} from "./drafting-manipulation";
import { draftingMoveOrigin, translateDraftingMove } from "./drafting-move";
import { draftingPlacementGrid } from "./placement-grid";
import { planSelectionMove } from "../selection/selection-move-plan";
import { EMPTY_VISUAL_SELECTION } from "../selection/visual-selection";

export interface DraftingHandlePreview {
  objectId: string;
  object: DraftingObject;
}

type TransactionResult = { ok: boolean };

export function createDraftingDragController({
  getDocument,
  annotationGrid,
  resolver,
  visibleEndpoints,
  dragSessionRef,
  dragThresholdPx,
  snapCaptureRadiusPx,
  pointFromClient,
  logicalRadiusForPixels,
  paintSnapGuides,
  snapDraftingPoint,
  onCompositeMove,
  selectDraftingObject,
  setInspectorSegment,
  setHandlePreview,
  transact,
  setStatus,
}: {
  /** Read the live committed Document so same-tick commits (e.g. text-edit blur) are never overwritten by a stale closure. */
  getDocument: () => SchematicDocument;
  /** Rounding pitch for dragged drafting objects. */
  annotationGrid: number;
  resolver: SymbolResolver;
  visibleEndpoints: readonly import("@icm/edit-engine").WireSource[];
  dragSessionRef: MutableRefObject<CanvasDragSession | null>;
  dragThresholdPx: number;
  snapCaptureRadiusPx: number;
  pointFromClient: (
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    snapToGrid: boolean,
  ) => DerivedPoint;
  logicalRadiusForPixels: (svg: SVGSVGElement, pixels: number) => number;
  paintSnapGuides: (guides: readonly SnapGuideLine[]) => void;
  snapDraftingPoint: (
    point: DerivedPoint,
    altKey: boolean,
    shiftKey: boolean,
    origin?: Point,
    tolerance?: number,
  ) => { point: Point; guides: SnapGuideLine[] };
  onCompositeMove: (
    event: ReactPointerEvent<SVGElement>,
    hitTarget: SVGElement,
  ) => boolean;
  selectDraftingObject: (id: string, additive?: boolean) => void;
  setInspectorSegment: (segment: { objectId: string; index: number }) => void;
  setHandlePreview: (preview: DraftingHandlePreview | null) => void;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
}) {
  const beginDrag = (
    event: ReactPointerEvent<SVGElement>,
    object: DraftingObject,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    const startDocument = getDocument();
    const liveObject = startDocument.drafting?.objects.find(
      (item) => item.id === object.id,
    );
    if (event.button !== 0 || !liveObject || liveObject.locked) return;
    if (onCompositeMove(event, hitTarget)) return;
    const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
    const origin = draftingMoveOrigin(startDocument, resolver, liveObject);
    if (!origin) {
      selectDraftingObject(liveObject.id, additiveSelection);
      setStatus("This anchored drawing moves with its attachment");
      return;
    }
    event.stopPropagation();
    if (additiveSelection) {
      selectDraftingObject(liveObject.id, true);
      setStatus(`Selected drawing ${liveObject.id}`);
      return;
    }
    dragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const start = pointFromClient(event.clientX, event.clientY, svg, false);
    const original = { ...origin };
    const movePlan = planSelectionMove(startDocument, {
      ...EMPTY_VISUAL_SELECTION,
      draftingIds: [liveObject.id],
    });
    selectDraftingObject(liveObject.id);
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, movePlan.previewObjectIds));
    const tolerance = logicalRadiusForPixels(svg, snapCaptureRadiusPx);
    const movingAnchors = [
      {
        id: `drafting:${liveObject.id}:origin`,
        point: original,
        kind: "drafting" as const,
      },
      ...buildDraftingAnchors(
        startDocument,
        resolver,
        new Set([liveObject.id]),
      ),
    ];
    const targetAnchors = buildSceneSnapTargets(
      startDocument,
      resolver,
      visibleEndpoints,
      new Set(movePlan.previewObjectIds),
    );
    let lastSnap: SnapResult | undefined;
    const positionAt = (
      clientX: number,
      clientY: number,
      suppressSnap: boolean,
      previous?: SnapResult,
    ): { position: Point; snap: SnapResult } => {
      const point = pointFromClient(clientX, clientY, svg, false);
      const rawDelta = { x: point.x - start.x, y: point.y - start.y };
      const resolved: SnapResult = suppressSnap
        ? { delta: rawDelta, guides: [] }
        : resolveTranslationSnap(
            {
              rawDelta,
              movingAnchors,
              targetAnchors,
              primaryAnchorId: `drafting:${liveObject.id}:origin`,
              grid: draftingPlacementGrid(
                liveObject.kind,
                annotationGrid,
                startDocument.presentation.grid,
              ),
              tolerance,
              profile: SNAP_PROFILES.draftingMove,
            },
            previous,
          );
      return {
        position: snapGridPoint(
          {
            x: original.x + resolved.delta.x,
            y: original.y + resolved.delta.y,
          },
          1,
        ),
        snap: resolved,
      };
    };
    dragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: dragThresholdPx,
      onPreview: (client) => {
        const resolved = positionAt(
          client.x,
          client.y,
          Boolean(client.altKey),
          lastSnap,
        );
        lastSnap = resolved.snap;
        paintSnapGuides(resolved.snap.guides);
        dragVisual().translate({
          x: resolved.position.x - original.x,
          y: resolved.position.y - original.y,
        });
      },
      onFinish: ({ client, dragged }) => {
        dragSessionRef.current = null;
        visual?.restore();
        paintSnapGuides([]);
        if (!dragged) return;
        const position = positionAt(
          client.x,
          client.y,
          Boolean(client.altKey),
          lastSnap,
        ).position;
        const liveDocument = getDocument();
        const latest = liveDocument.drafting?.objects.find(
          (item) => item.id === liveObject.id,
        );
        if (
          latest &&
          !latest.locked &&
          (position.x !== original.x || position.y !== original.y)
        ) {
          transact([
            {
              kind: "upsert_drafting_object",
              object: translateDraftingMove(liveDocument, resolver, latest, {
                x: position.x - original.x,
                y: position.y - original.y,
              }),
            },
          ]);
        }
      },
      onCancel: () => {
        dragSessionRef.current = null;
        visual?.restore();
        paintSnapGuides([]);
      },
    });
  };

  const beginHandleDrag = (
    event: ReactPointerEvent<SVGElement>,
    object: DraftingObject,
    handle: DraftingHandle,
  ): void => {
    const startDocument = getDocument();
    const liveObject = startDocument.drafting?.objects.find(
      (item) => item.id === object.id,
    );
    if (event.button !== 0 || !liveObject || liveObject.locked) return;
    event.stopPropagation();
    dragSessionRef.current?.cancel();
    const hitTarget = event.currentTarget;
    const svg = hitTarget.ownerSVGElement!;
    const originalGeometry = resolveDraftingObjectGeometry(
      startDocument,
      resolver,
      liveObject,
    );
    if (handle.kind === "curve") {
      setInspectorSegment({ objectId: liveObject.id, index: handle.index });
    }
    selectDraftingObject(liveObject.id);

    const pointAt = (clientX: number, clientY: number, altKey: boolean) =>
      snapDraftingPoint(
        pointFromClient(clientX, clientY, svg, true),
        altKey,
        event.shiftKey,
        undefined,
        logicalRadiusForPixels(svg, snapCaptureRadiusPx),
      );
    dragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: dragThresholdPx,
      onPreview: (client) => {
        const snapped = pointAt(client.x, client.y, Boolean(client.altKey));
        paintSnapGuides(snapped.guides);
        setHandlePreview({
          objectId: liveObject.id,
          object: applyDraftingHandle(
            liveObject,
            handle,
            snapped.point,
            originalGeometry,
            draftingPlacementGrid(
              liveObject.kind,
              annotationGrid,
              startDocument.presentation.grid,
            ),
          ),
        });
      },
      onFinish: ({ client, dragged }) => {
        dragSessionRef.current = null;
        paintSnapGuides([]);
        if (dragged) {
          const point = pointAt(
            client.x,
            client.y,
            Boolean(client.altKey),
          ).point;
          const liveDocument = getDocument();
          const latest = liveDocument.drafting?.objects.find(
            (item) => item.id === liveObject.id,
          );
          if (latest && !latest.locked) {
            const next = applyDraftingHandle(
              latest,
              handle,
              point,
              originalGeometry,
              draftingPlacementGrid(
                latest.kind,
                annotationGrid,
                liveDocument.presentation.grid,
              ),
            );
            if (next !== latest) {
              transact([{ kind: "upsert_drafting_object", object: next }]);
            }
          }
        }
        setHandlePreview(null);
      },
      onCancel: () => {
        dragSessionRef.current = null;
        setHandlePreview(null);
        paintSnapGuides([]);
      },
    });
  };

  return { beginDrag, beginHandleDrag };
}
