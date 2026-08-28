import {
  endpointKey,
  resolveEndpointConnection,
  type NetHighlight,
  type ResolvedRouteGeometry,
} from "@icm/derived";
import type { GridRect, RouteBranch, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { EditorTool } from "../interaction/interaction-state";
import { serializePolylinePoints } from "./canvas-geometry";

export function CanvasGridOverlay({
  visible,
  viewBox,
}: {
  visible: boolean;
  viewBox: GridRect;
}) {
  if (!visible) return null;
  return (
    <>
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle className="canvas-grid-dot" cx="0" cy="0" r="0.7" />
        </pattern>
      </defs>
      <rect
        data-testid="canvas-grid-dots"
        x={viewBox.x}
        y={viewBox.y}
        width={viewBox.width}
        height={viewBox.height}
        fill="url(#grid)"
      />
    </>
  );
}

export function CanvasInputPlanes({
  tool,
  viewBox,
  componentPlacementActive,
  copyPlacementActive,
}: {
  tool: EditorTool;
  viewBox: GridRect;
  componentPlacementActive: boolean;
  copyPlacementActive: boolean;
}) {
  return (
    <>
      {tool === "wire" ? (
        <rect
          data-testid="wire-input-plane"
          className="wire-input-plane"
          x={viewBox.x}
          y={viewBox.y}
          width={viewBox.width}
          height={viewBox.height}
        />
      ) : null}
      {componentPlacementActive ? (
        <rect
          data-testid={
            copyPlacementActive
              ? "copy-placement-input-plane"
              : "component-input-plane"
          }
          className="component-input-plane"
          x={viewBox.x}
          y={viewBox.y}
          width={viewBox.width}
          height={viewBox.height}
        />
      ) : null}
    </>
  );
}

export function NetHighlightOverlay({
  highlight,
  document,
  resolver,
  routeGeometryRecords,
}: {
  highlight: NetHighlight | undefined;
  document: SchematicDocument;
  resolver: SymbolResolver;
  routeGeometryRecords: readonly {
    route: RouteBranch;
    geometry: ResolvedRouteGeometry;
  }[];
}) {
  if (!highlight) return null;
  const highlightedRoutes = routeGeometryRecords.filter(({ route }) =>
    highlight.routes.includes(route.id),
  );
  return (
    <g
      data-testid="net-highlight-overlay"
      data-net-id={highlight.netId}
      className="net-highlight-overlay"
      pointerEvents="none"
    >
      {highlightedRoutes.map(({ route, geometry }) => (
        <polyline
          key={route.id}
          className="net-highlight-halo"
          points={serializePolylinePoints(geometry.centerline)}
        />
      ))}
      {highlightedRoutes.map(({ route, geometry }) => (
        <polyline
          key={`${route.id}-core`}
          className="net-highlight-core"
          points={serializePolylinePoints(geometry.centerline)}
        />
      ))}
      {document.junctions
        .filter((junction) => highlight.junctions.includes(junction.id))
        .map((junction) => (
          <circle
            key={junction.id}
            cx={junction.position.x}
            cy={junction.position.y}
            r="4.5"
          />
        ))}
      {highlight.visibleEndpoints.flatMap((endpoint) => {
        const connection = resolveEndpointConnection(
          document,
          resolver,
          endpoint,
        );
        if (!connection) return [];
        return [
          <circle
            key={`endpoint:${endpointKey(endpoint)}`}
            className="net-highlight-endpoint"
            cx={connection.contactPoint.x}
            cy={connection.contactPoint.y}
            r="5.5"
          />,
        ];
      })}
    </g>
  );
}

import type { WireUnderSymbolWarning } from "./wire-under-symbol";

/**
 * Red spans over wires buried under symbol artwork. The symbol's own hit
 * box sits above the wire there, so each span carries its own click
 * target that selects the buried Route for deletion.
 */
export function WireUnderSymbolOverlay({
  warnings,
  onSelectRoute,
}: {
  warnings: readonly WireUnderSymbolWarning[];
  onSelectRoute: (routeId: string) => void;
}) {
  if (warnings.length === 0) return null;
  return (
    <g
      data-testid="wire-under-symbol-overlay"
      className="wire-under-symbol-overlay"
    >
      {warnings.map((warning, index) => (
        <g key={`${warning.routeId}:${warning.instanceId}:${index}`}>
          <line
            className="wire-under-symbol-paint"
            pointerEvents="none"
            x1={warning.from.x}
            y1={warning.from.y}
            x2={warning.to.x}
            y2={warning.to.y}
          />
          <line
            className="wire-under-symbol-hit"
            data-testid={`wire-under-symbol-hit-${warning.routeId}`}
            x1={warning.from.x}
            y1={warning.from.y}
            x2={warning.to.x}
            y2={warning.to.y}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onSelectRoute(warning.routeId);
            }}
            onClick={(event) => event.stopPropagation()}
          />
        </g>
      ))}
    </g>
  );
}
