import type { SchematicEdit, WireSource } from "@icm/edit-engine";
import {
  snapGridPoint,
  type DerivedPoint,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { closestPointOnSegment } from "../../canvas/canvas-geometry";
import type { EditorTool } from "../../interaction/interaction-state";
import { buildSceneSnapTargets } from "../../snap/candidates";
import {
  resolvePointSnap,
  SNAP_PROFILES,
  type SnapGuideLine,
} from "../../snap/engine";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import {
  applyArrowPreset,
  DEFAULT_ARROW_PRESET,
  outlinePlacement,
  type ArrowPreset,
} from "./arrow-presets";
import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  startCanvasDragSession,
  type CanvasDragSession,
} from "../../canvas/canvas-drag-session";

type TransactionResult = { ok: boolean };
type DraftingTool = Extract<
  EditorTool,
  "arrow" | "construction-line" | "rectangle" | "circle"
>;

export type DrawAngleMode = "free" | "45" | "orthogonal";

export function constrainDraftingAngle(
  origin: Point,
  target: DerivedPoint,
  step: number = Math.PI / 4,
): DerivedPoint {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const angle = Math.atan2(dy, dx);
  const locked = Math.round(angle / step) * step;
  const length = Math.hypot(dx, dy);
  return {
    x: Math.round(origin.x + Math.cos(locked) * length),
    y: Math.round(origin.y + Math.sin(locked) * length),
  };
}

export function createDraftingCreateController({
  document,
  annotationGrid,
  angleMode,
  resolver,
  visibleEndpoints,
  routeGeometryRecords,
  tool,
  arrowPreset = DEFAULT_ARROW_PRESET,
  pointer,
  source,
  hover,
  waypoints,
  setSource,
  setHover,
  setWaypoints,
  setSnapPoint,
  clear,
  setTool,
  transact,
  setStatus,
  nextId,
}: {
  document: SchematicDocument;
  /** Rounding pitch for drawn objects; the Document grid stays electrical. */
  annotationGrid: number;
  /** Persistent draw-angle lock for arrows and lines; Shift still forces the 45-degree family. */
  angleMode: DrawAngleMode;
  resolver: SymbolResolver;
  visibleEndpoints: readonly WireSource[];
  routeGeometryRecords: readonly RouteGeometryRecord[];
  tool: EditorTool;
  arrowPreset?: ArrowPreset;
  pointer?: {
    dragSessionRef: MutableRefObject<CanvasDragSession | null>;
    pointFromClient: (x: number, y: number, svg: SVGSVGElement) => Point;
  };
  source: Point | null;
  hover: Point | null;
  waypoints: Point[];
  setSource: (point: Point | null) => void;
  setHover: (point: Point | null) => void;
  setWaypoints: (points: Point[] | ((current: Point[]) => Point[])) => void;
  setSnapPoint: (point: Point | null) => void;
  clear: () => void;
  setTool: (tool: EditorTool) => void;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
  nextId: (prefix: string) => string;
}) {
  const activeTool = (): DraftingTool | null =>
    tool === "arrow" ||
    tool === "construction-line" ||
    tool === "rectangle" ||
    tool === "circle"
      ? tool
      : null;

  const snapPoint = (
    point: DerivedPoint,
    altKey: boolean,
    shiftKey: boolean,
    origin?: Point,
    tolerance = document.presentation.grid,
  ): { point: Point; snap: Point | null; guides: SnapGuideLine[] } => {
    const angleStep = shiftKey
      ? Math.PI / 4
      : angleMode === "orthogonal"
        ? Math.PI / 2
        : angleMode === "45"
          ? Math.PI / 4
          : null;
    if (altKey) {
      const constrained =
        angleStep && origin
          ? constrainDraftingAngle(origin, point, angleStep)
          : point;
      return {
        point: snapGridPoint(constrained, annotationGrid),
        snap: null,
        guides: [],
      };
    }
    const routeTargets = routeGeometryRecords.flatMap(({ route, geometry }) =>
      geometry.centerline.slice(0, -1).map((from, segmentIndex) => ({
        id: `route:${route.id}:${segmentIndex}`,
        point: closestPointOnSegment(
          point,
          from,
          geometry.centerline[segmentIndex + 1]!,
        ),
        kind: "route" as const,
      })),
    );
    const resolved = resolvePointSnap(
      point,
      [
        ...buildSceneSnapTargets(document, resolver, visibleEndpoints),
        ...routeTargets,
      ],
      {
        grid: annotationGrid,
        tolerance,
        profile: SNAP_PROFILES.draftingHandle,
      },
    );
    let snapped: DerivedPoint = {
      x: point.x + resolved.delta.x,
      y: point.y + resolved.delta.y,
    };
    const hasObjectSnap =
      (resolved.xMatch && resolved.xMatch.targetKind !== "grid") ||
      (resolved.yMatch && resolved.yMatch.targetKind !== "grid");
    if (angleStep && origin)
      snapped = constrainDraftingAngle(origin, snapped, angleStep);
    const gridPoint = snapGridPoint(snapped, annotationGrid);
    return {
      point: gridPoint,
      snap: hasObjectSnap ? gridPoint : null,
      guides: resolved.guides,
    };
  };

  const commitVertices = (points: Point[]): void => {
    if (points.length < 2) return;
    const id = nextId("construction");
    const snappedPoints = points.map((point) =>
      snapGridPoint(point, annotationGrid),
    );
    if (
      transact([
        {
          kind: "upsert_drafting_object",
          object: {
            id,
            kind: "construction-line",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: snappedPoints[0]! },
            points: snappedPoints,
            lineStyle: "dashed",
          },
        },
      ]).ok
    ) {
      setStatus(`Added construction line ${id}`);
      setTool("pointer");
    }
  };

  const commit = (active: DraftingTool, start: Point, end: Point): void => {
    const id = nextId(active === "construction-line" ? "construction" : active);
    const snappedStart = snapGridPoint(start, annotationGrid);
    const snappedEnd = snapGridPoint(end, annotationGrid);
    if (active === "circle") {
      const radius = Math.round(
        Math.hypot(
          snappedEnd.x - snappedStart.x,
          snappedEnd.y - snappedStart.y,
        ),
      );
      if (radius < 1) {
        setStatus("Circle needs a non-zero radius");
        return;
      }
      if (
        transact([
          {
            kind: "upsert_drafting_object",
            object: {
              id,
              kind: "circle",
              locked: false,
              zIndex: 0,
              anchor: { kind: "free", position: snappedStart },
              center: snappedStart,
              radius,
              lineStyle: "solid",
            },
          },
        ]).ok
      ) {
        setStatus(`Added circle ${id}`);
      }
    } else if (active === "rectangle") {
      const width = Math.round(Math.abs(snappedEnd.x - snappedStart.x));
      const height = Math.round(Math.abs(snappedEnd.y - snappedStart.y));
      if (width < 1 || height < 1) {
        setStatus("Rectangle needs non-zero width and height");
        return;
      }
      const center = snapGridPoint(
        {
          x: Math.round((snappedStart.x + snappedEnd.x) / 2),
          y: Math.round((snappedStart.y + snappedEnd.y) / 2),
        },
        annotationGrid,
      );
      if (
        transact([
          {
            kind: "upsert_drafting_object",
            object: {
              id,
              kind: "rectangle",
              locked: false,
              zIndex: 0,
              anchor: { kind: "free", position: center },
              center,
              width,
              height,
              rotation: 0,
              lineStyle: "solid",
            },
          },
        ]).ok
      ) {
        setStatus(`Added rectangle ${id}`);
      }
    } else if (active === "arrow") {
      if (
        transact([
          {
            kind: "upsert_drafting_object",
            object: applyArrowPreset(
              {
                id,
                kind: "arrow",
                locked: false,
                zIndex: 0,
                anchor: { kind: "free", position: snappedStart },
                from: { kind: "free", position: snappedStart },
                to: { kind: "free", position: snappedEnd },
              },
              arrowPreset,
            )!,
          },
        ]).ok
      ) {
        setStatus(`Added free arrow ${id}`);
      }
    } else if (
      transact([
        {
          kind: "upsert_drafting_object",
          object: {
            id,
            kind: "construction-line",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: snappedStart },
            points: [snappedStart, snappedEnd],
            lineStyle: "dashed",
          },
        },
      ]).ok
    ) {
      setStatus(`Added construction line ${id}`);
    }
    setTool("pointer");
  };

  const handleCanvasClick = (
    rawPoint: Point,
    altKey: boolean,
    shiftKey: boolean,
    tolerance: number,
  ): void => {
    const active = activeTool();
    if (!active) return;
    if (active === "arrow" && arrowPreset.family === "outline") return;
    const resolved = snapPoint(
      rawPoint,
      altKey,
      shiftKey,
      source ?? undefined,
      tolerance,
    );
    if (source === null) {
      setSource(resolved.point);
      setHover(resolved.point);
      setSnapPoint(resolved.snap);
      setWaypoints([]);
      setStatus(
        active === "arrow"
          ? "Arrow: click the end point (Enter to finish, Esc to cancel)"
          : active === "rectangle"
            ? "Rectangle: click the opposite corner (Esc to cancel)"
            : active === "circle"
              ? "Circle: click the radius point (Esc to cancel)"
              : "Construction line: click next vertex (Enter to finish, Esc to cancel)",
      );
    } else if (
      active === "arrow" ||
      active === "rectangle" ||
      active === "circle"
    ) {
      commit(active, source, resolved.point);
      clear();
    } else {
      setWaypoints((current) => [...current, resolved.point]);
      setHover(resolved.point);
      setSnapPoint(resolved.snap);
      setStatus(`Construction line: ${waypoints.length + 1} bend(s)`);
    }
  };

  const finish = (): void => {
    const active = activeTool();
    if (!active || source === null) return;
    if (active === "arrow" && arrowPreset.family === "outline") return;
    const end = hover ?? source;
    if (active === "arrow" || active === "rectangle" || active === "circle") {
      if (source.x !== end.x || source.y !== end.y) commit(active, source, end);
    } else {
      const points = [source, ...waypoints];
      if (
        end.x !== points[points.length - 1]!.x ||
        end.y !== points[points.length - 1]!.y
      ) {
        points.push(end);
      }
      commitVertices(points);
    }
    clear();
  };

  const beginPointer = (event: ReactPointerEvent<SVGSVGElement>): boolean => {
    if (
      tool !== "arrow" ||
      arrowPreset.family !== "outline" ||
      !pointer ||
      event.button !== 0
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget;
    const pointAt = (x: number, y: number) =>
      snapGridPoint(pointer.pointFromClient(x, y, svg), annotationGrid);
    const start = pointAt(event.clientX, event.clientY);
    pointer.dragSessionRef.current?.cancel();
    setSource(null);
    setHover(start);
    pointer.dragSessionRef.current = startCanvasDragSession({
      target: svg,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: 4,
      onPreview: (client) => {
        setSource(start);
        setHover(pointAt(client.x, client.y));
      },
      onFinish: ({ client, dragged }) => {
        const placement = outlinePlacement(
          dragged ? start : null,
          pointAt(client.x, client.y),
        );
        const id = nextId("arrow");
        const object = applyArrowPreset(
          {
            id,
            kind: "arrow",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: placement.from },
            from: { kind: "free", position: placement.from },
            to: { kind: "free", position: placement.to },
            outline: { width: placement.width },
          },
          arrowPreset,
        )!;
        if (transact([{ kind: "upsert_drafting_object", object }]).ok) {
          setStatus(`Added ${arrowPreset.label}`);
          setTool("pointer");
        }
        clear();
        pointer.dragSessionRef.current = null;
      },
      onCancel: () => {
        clear();
        pointer.dragSessionRef.current = null;
      },
    });
    return true;
  };

  return { snapPoint, handleCanvasClick, finish, beginPointer };
}
