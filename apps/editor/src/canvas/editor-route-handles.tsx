import type { PointerEvent as ReactPointerEvent } from "react";

import {
  derivePowerRailComponent,
  type ResolvedRouteGeometry,
} from "@icm/derived";
import type { RouteBranch, SchematicDocument } from "@icm/model";

import type { RouteStretchPreview } from "../features/wiring/use-wire-interaction";
import { looseRouteAnchorIds } from "../features/wiring/route-interaction-geometry";
import type { EditorTool } from "../interaction/interaction-state";
import { centerOfBounds, polylineBounds } from "./canvas-geometry";

type RouteGeometryRecord = {
  route: RouteBranch;
  geometry: ResolvedRouteGeometry;
};

export function EditorRouteHandles({
  document,
  routeGeometryRecords,
  selectedRouteId,
  selectedRouteSegmentIndex,
  routeStretchPreview,
  tool,
  onHandlePointerDown,
}: {
  document: SchematicDocument;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  selectedRouteId: string | null;
  selectedRouteSegmentIndex: number | null;
  routeStretchPreview: RouteStretchPreview | null;
  tool: EditorTool;
  onHandlePointerDown: (
    event: ReactPointerEvent<SVGCircleElement>,
    routeId: string,
    segmentIndex: number,
    intent: RouteStretchPreview["intent"],
  ) => void;
}) {
  return routeGeometryRecords
    .filter(({ route }) => route.id === selectedRouteId)
    .map(({ route, geometry }) => {
      const segmentIndex = Math.min(
        selectedRouteSegmentIndex ?? 0,
        geometry.centerline.length - 2,
      );
      const from = geometry.centerline[segmentIndex]!;
      const to = geometry.centerline[segmentIndex + 1]!;
      const translatesWholeRoute =
        looseRouteAnchorIds(document, route) !== null;
      const powerRail =
        route.presentation === "power-rail"
          ? derivePowerRailComponent(document, route.id)
          : null;
      const powerRailEnds = powerRail?.endpointJunctionIds
        .map((junctionId) =>
          document.junctions.find((junction) => junction.id === junctionId),
        )
        .filter((junction): junction is NonNullable<typeof junction> =>
          Boolean(junction),
        )
        .sort((left, right) =>
          left.position.x === right.position.x
            ? left.position.y - right.position.y
            : left.position.x - right.position.x,
        );
      // Both ends are draggable, including one anchored to a pin: re-pointing
      // an existing wire is an ordinary edit, and offering no handle there
      // left deleting the wire and drawing it again as the only way to do it.
      const ordinaryRouteEnds = powerRail
        ? []
        : [
            { side: "start" as const, point: geometry.centerline[0]! },
            { side: "end" as const, point: geometry.centerline.at(-1)! },
          ];
      const routeCenter = centerOfBounds(polylineBounds(geometry.centerline));
      const preview =
        routeStretchPreview?.routeId === route.id
          ? routeStretchPreview.point
          : null;
      const pointerEvents = tool === "wire" ? "none" : undefined;
      return (
        <g key={`handle-${route.id}`}>
          <circle
            data-testid={`route-handle-${route.id}`}
            data-canvas-hit-kind="handle"
            data-canvas-hit-id={`route-handle-${route.id}`}
            className="route-handle"
            cx={
              powerRail
                ? routeCenter.x
                : translatesWholeRoute
                  ? (preview?.x ?? routeCenter.x)
                  : from.y === to.y
                    ? (from.x + to.x) / 2
                    : (preview?.x ?? (from.x + to.x) / 2)
            }
            cy={
              powerRail
                ? routeCenter.y
                : translatesWholeRoute
                  ? (preview?.y ?? routeCenter.y)
                  : from.x === to.x
                    ? (from.y + to.y) / 2
                    : (preview?.y ?? (from.y + to.y) / 2)
            }
            r="6"
            onPointerDown={(event) =>
              onHandlePointerDown(
                event,
                route.id,
                segmentIndex,
                powerRail
                  ? "move-power-rail"
                  : translatesWholeRoute
                    ? "move-loose-route"
                    : "stretch-segment",
              )
            }
            pointerEvents={pointerEvents}
          />
          {powerRailEnds?.map((junction, index) => (
            <circle
              key={`power-rail-handle-${route.id}-${index}`}
              data-testid={`power-rail-handle-${route.id}-${index === 0 ? "start" : "end"}`}
              data-canvas-hit-kind="handle"
              data-canvas-hit-id={`power-rail-handle-${route.id}-${index === 0 ? "start" : "end"}`}
              className="route-handle"
              cx={junction.position.x}
              cy={junction.position.y}
              r="6"
              onPointerDown={(event) =>
                onHandlePointerDown(
                  event,
                  route.id,
                  segmentIndex,
                  index === 0
                    ? "resize-power-rail-start"
                    : "resize-power-rail-end",
                )
              }
              pointerEvents={pointerEvents}
            />
          ))}
          {ordinaryRouteEnds.map(({ side, point }) => (
            <circle
              key={`route-endpoint-handle-${route.id}-${side}`}
              data-testid={`route-endpoint-handle-${route.id}-${side}`}
              data-canvas-hit-kind="handle"
              data-canvas-hit-id={`route-endpoint-handle-${route.id}-${side}`}
              aria-label={`Resize wire ${side}`}
              className="route-handle route-endpoint-handle"
              cx={point.x}
              cy={point.y}
              r="5"
              onPointerDown={(event) =>
                onHandlePointerDown(
                  event,
                  route.id,
                  side === "start" ? 0 : geometry.centerline.length - 2,
                  side === "start" ? "resize-route-start" : "resize-route-end",
                )
              }
              pointerEvents={pointerEvents}
            />
          ))}
        </g>
      );
    });
}
