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
import {
  buildDraftingProjectionSnapTargets,
  buildSceneSnapTargets,
} from "../../snap/candidates";
import {
  resolvePointSnap,
  SNAP_PROFILES,
  type SnapGuideLine,
} from "../../snap/engine";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import { draftingPlacementGrid } from "./placement-grid";
import { rectangleGridGeometry } from "./rectangle-grid-geometry";
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
  "arrow" | "polyline" | "construction-line" | "rectangle" | "circle"
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
    tool === "polyline" ||
    tool === "construction-line" ||
    tool === "rectangle" ||
    tool === "circle"
      ? tool
      : null;

  // A rectangle places on the electrical grid; every other drawn object keeps
  // the finer annotation pitch.
  const placementGrid = draftingPlacementGrid(
    tool,
    annotationGrid,
    document.presentation.grid,
  );

  const snapPoint = (
    point: DerivedPoint,
    altKey: boolean,
    shiftKey: boolean,
    origin?: Point,
    tolerance = document.presentation.grid,
  ): { point: Point; snap: Point | null; guides: SnapGuideLine[] } => {
    // Every new leg is constrained from its previous vertex, in both hover
    // and commit. The gesture caller may still supply the original source.
    if (tool === "arrow" || tool === "polyline" || tool === "construction-line")
      origin = waypoints.at(-1) ?? origin;
    const rectanglePoint = (point: Point): Point =>
      tool !== "rectangle"
        ? point
        : origin
          ? rectangleGridGeometry(origin, point, placementGrid).end
          : snapGridPoint(point, placementGrid);
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
        point: rectanglePoint(snapGridPoint(constrained, placementGrid)),
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
    const constrained =
      angleStep && origin
        ? constrainDraftingAngle(origin, point, angleStep)
        : point;
    const resolved = resolvePointSnap(
      constrained,
      [
        ...buildSceneSnapTargets(document, resolver, visibleEndpoints),
        ...buildDraftingProjectionSnapTargets(document, resolver, constrained),
        ...routeTargets,
      ],
      {
        grid: placementGrid,
        tolerance,
        profile: SNAP_PROFILES.draftingHandle,
      },
    );
    let snapped: DerivedPoint = resolved.pointMatch?.point ?? {
      x: constrained.x + resolved.delta.x,
      y: constrained.y + resolved.delta.y,
    };
    const finalPoint = rectanglePoint(
      resolved.pointMatch
        ? snapGridPoint(snapped, 1)
        : snapGridPoint(snapped, placementGrid),
    );
    // Rectangle spans may need one more grid cell to keep an integer center.
    // Only show object captures and guides still met by that final corner.
    const retainedPointMatch =
      tool !== "rectangle" ||
      !resolved.pointMatch ||
      (Math.abs(finalPoint.x - resolved.pointMatch.point.x) < 1e-8 &&
        Math.abs(finalPoint.y - resolved.pointMatch.point.y) < 1e-8);
    const hasObjectSnap =
      retainedPointMatch &&
      [resolved.xMatch, resolved.yMatch].some(
        (match) =>
          match &&
          match.targetKind !== "grid" &&
          (tool !== "rectangle" ||
            Math.abs(finalPoint[match.axis] - match.coordinate) < 1e-8),
      );
    return {
      point: finalPoint,
      snap: hasObjectSnap ? finalPoint : null,
      guides:
        tool === "rectangle"
          ? resolved.guides.filter(
              (guide) =>
                Math.abs(finalPoint[guide.axis] - guide.coordinate) < 1e-8,
            )
          : resolved.guides,
    };
  };

  const commitVertices = (points: Point[]): void => {
    if (points.length < 2) return;
    const id = nextId("construction");
    // snapPoint already applies either an exact visual capture (one logical
    // unit precision) or the Annotation Grid. Do not erase edge captures here.
    const snappedPoints = points.map((point) => ({ ...point }));
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

  const commitArrow = (points: Point[]): void => {
    if (points.length < 2) return;
    const id = nextId("arrow");
    const snappedPoints = points.map((point) => ({ ...point }));
    const from = snappedPoints[0]!;
    const to = snappedPoints.at(-1)!;
    const object = applyArrowPreset(
      {
        id,
        kind: "arrow",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: from },
        from: { kind: "free", position: from },
        to: { kind: "free", position: to },
        ...(snappedPoints.length > 2
          ? { waypoints: snappedPoints.slice(1, -1) }
          : {}),
      },
      tool === "polyline"
        ? { ...DEFAULT_ARROW_PRESET, head: "none" }
        : arrowPreset,
    );
    if (object && transact([{ kind: "upsert_drafting_object", object }]).ok) {
      setStatus(
        tool === "polyline" ? `Added polyline ${id}` : `Added free arrow ${id}`,
      );
      setTool("pointer");
    }
  };

  const commit = (
    active: Exclude<DraftingTool, "arrow" | "polyline">,
    start: Point,
    end: Point,
  ): void => {
    const id = nextId(active === "construction-line" ? "construction" : active);
    // The committed pitch follows the object being made, not whichever tool
    // happens to be selected when the commit runs.
    const commitGrid = draftingPlacementGrid(
      active,
      annotationGrid,
      document.presentation.grid,
    );
    const snappedStart = snapGridPoint(start, commitGrid);
    const snappedEnd = snapGridPoint(end, commitGrid);
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
      const { center, width, height } = rectangleGridGeometry(
        snappedStart,
        snappedEnd,
        commitGrid,
      );
      if (width < 1 || height < 1) {
        setStatus("Rectangle needs non-zero width and height");
        return;
      }
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
        active === "arrow" || active === "polyline"
          ? `${active === "polyline" ? "Polyline" : "Arrow"}: click vertices; double-click or Enter to finish (Esc cancels)`
          : active === "rectangle"
            ? "Rectangle: click the opposite corner (Esc to cancel)"
            : active === "circle"
              ? "Circle: click the radius point (Esc to cancel)"
              : "Construction line: click next vertex (Enter to finish, Esc to cancel)",
      );
    } else if (active === "rectangle" || active === "circle") {
      commit(active, source, resolved.point);
      clear();
    } else {
      if (
        active === "polyline" &&
        waypoints.length >= 2 &&
        resolved.point.x === source.x &&
        resolved.point.y === source.y
      ) {
        commitArrow([source, ...waypoints, source]);
        clear();
        return;
      }
      const last = waypoints.at(-1) ?? source;
      if (last.x === resolved.point.x && last.y === resolved.point.y) return;
      setWaypoints((current) => [...current, resolved.point]);
      setHover(resolved.point);
      setSnapPoint(resolved.snap);
      setStatus(
        active === "arrow" || active === "polyline"
          ? `${active === "polyline" ? "Polyline" : "Arrow"}: ${waypoints.length + 1} bend(s) · double-click or Enter to finish`
          : `Construction line: ${waypoints.length + 1} bend(s)`,
      );
    }
  };

  const finish = (): void => {
    const active = activeTool();
    if (!active || source === null) return;
    if (active === "arrow" && arrowPreset.family === "outline") return;
    const end = hover ?? source;
    if (active === "arrow" || active === "polyline") {
      const points = [source, ...waypoints];
      if (
        end.x !== points[points.length - 1]!.x ||
        end.y !== points[points.length - 1]!.y
      )
        points.push(end);
      commitArrow(points);
    } else if (active === "rectangle" || active === "circle") {
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
      snapGridPoint(pointer.pointFromClient(x, y, svg), placementGrid);
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
