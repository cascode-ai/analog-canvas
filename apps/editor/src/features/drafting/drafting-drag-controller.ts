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
  draftingDragOrigin,
  translateDraftingObject,
  type DraftingHandle,
} from "./drafting-manipulation";

export interface DraftingHandlePreview {
  objectId: string;
  object: DraftingObject;
}

type TransactionResult = { ok: boolean };

export function createDraftingDragController({
  document,
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
  clearTangentInput,
  setHandlePreview,
  transact,
  setStatus,
}: {
  document: SchematicDocument;
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
  selectDraftingObject: (id: string) => void;
  setInspectorSegment: (segment: { objectId: string; index: number }) => void;
  clearTangentInput: () => void;
  setHandlePreview: (preview: DraftingHandlePreview | null) => void;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
}) {
  const beginDrag = (
    event: ReactPointerEvent<SVGElement>,
    object: DraftingObject,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    if (event.button !== 0 || object.locked) return;
    if (onCompositeMove(event, hitTarget)) return;
    const origin = draftingDragOrigin(object);
    if (!origin) {
      selectDraftingObject(object.id);
      setStatus("This anchored drawing moves with its attachment");
      return;
    }
    event.stopPropagation();
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      selectDraftingObject(object.id);
      setStatus(`Selected drawing ${object.id}`);
      return;
    }
    dragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const start = pointFromClient(event.clientX, event.clientY, svg, false);
    const original = { ...origin };
    selectDraftingObject(object.id);
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, [object.id]));
    const tolerance = logicalRadiusForPixels(svg, snapCaptureRadiusPx);
    const movingAnchors = [
      {
        id: `drafting:${object.id}:origin`,
        point: original,
        kind: "drafting" as const,
      },
      ...buildDraftingAnchors(document, resolver, new Set([object.id])),
    ];
    const targetAnchors = buildSceneSnapTargets(
      document,
      resolver,
      visibleEndpoints,
      new Set(),
      new Set([object.id]),
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
              primaryAnchorId: `drafting:${object.id}:origin`,
              grid: annotationGrid,
              tolerance,
              profile: SNAP_PROFILES.draftingMove,
            },
            previous,
          );
      return {
        position: {
          x: original.x + resolved.delta.x,
          y: original.y + resolved.delta.y,
        },
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
        const latest = document.drafting?.objects.find(
          (item) => item.id === object.id,
        );
        if (
          latest &&
          (position.x !== original.x || position.y !== original.y)
        ) {
          transact([
            {
              kind: "upsert_drafting_object",
              object: translateDraftingObject(
                latest,
                { x: position.x - original.x, y: position.y - original.y },
                annotationGrid,
              ),
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
    if (event.button !== 0 || object.locked) return;
    event.stopPropagation();
    dragSessionRef.current?.cancel();
    const hitTarget = event.currentTarget;
    const svg = hitTarget.ownerSVGElement!;
    const originalGeometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      object,
    );
    if (handle.kind === "curve") {
      setInspectorSegment({ objectId: object.id, index: handle.index });
      clearTangentInput();
    }
    selectDraftingObject(object.id);

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
          objectId: object.id,
          object: applyDraftingHandle(
            object,
            handle,
            snapped.point,
            originalGeometry,
            annotationGrid,
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
          const latest = document.drafting?.objects.find(
            (item) => item.id === object.id,
          );
          if (latest) {
            const next = applyDraftingHandle(
              latest,
              handle,
              point,
              originalGeometry,
              annotationGrid,
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
