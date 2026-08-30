import {
  endpointKey,
  resolveEndpointConnection,
  type NetHighlight,
  type ResolvedRouteGeometry,
} from "@icm/derived";
import type { Diagnostic } from "@icm/derived";
import type { GridRect, RouteBranch, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { EditorTool } from "../interaction/interaction-state";
import { serializePolylinePoints } from "./canvas-geometry";
import type { DiagnosticMarker } from "./diagnostic-markers";

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

/**
 * Actionable findings placed on the canvas: an open severity-colored ring
 * over a light halo, so the marker never occludes what it marks. Pointer-down
 * navigates through the same jump the workbench uses; the hit circle stops
 * propagation so markers never enter ordinary canvas hit ranking.
 */
export function DiagnosticMarkersOverlay({
  markers,
  onSelectMarker,
}: {
  markers: readonly DiagnosticMarker[];
  onSelectMarker: (diagnostic: Diagnostic) => void;
}) {
  if (markers.length === 0) return null;
  return (
    <g data-testid="diagnostic-markers" className="diagnostic-markers">
      {markers.map((marker) => (
        <g
          key={marker.key}
          className="diagnostic-marker"
          data-severity={marker.severity}
        >
          <circle
            className="diagnostic-marker-halo"
            pointerEvents="none"
            cx={marker.point.x}
            cy={marker.point.y}
            r={6}
          />
          <circle
            className="diagnostic-marker-ring"
            pointerEvents="none"
            cx={marker.point.x}
            cy={marker.point.y}
            r={6}
          />
          {marker.count > 1 ? (
            <text
              className="diagnostic-marker-count"
              pointerEvents="none"
              x={marker.point.x + 8}
              y={marker.point.y - 6}
            >
              {marker.count}
            </text>
          ) : null}
          <circle
            className="diagnostic-marker-hit"
            data-testid={`diagnostic-marker-${marker.key}`}
            cx={marker.point.x}
            cy={marker.point.y}
            r={9}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onSelectMarker(marker.diagnostic);
            }}
            onClick={(event) => event.stopPropagation()}
          />
        </g>
      ))}
    </g>
  );
}

export interface NetLabelTether {
  label: { x: number; y: number };
  conductor: { x: number; y: number };
  netName: string | null;
}

/**
 * Selected net label -> its conductor tap: a dashed tether and a ring on
 * the exact attachment point, so the label's electrical home is visible.
 */
export function NetLabelTetherOverlay({
  tether,
}: {
  tether: NetLabelTether | null;
}) {
  if (!tether) return null;
  return (
    <g
      data-testid="net-label-tether"
      className="net-label-tether"
      pointerEvents="none"
    >
      <line
        x1={tether.label.x}
        y1={tether.label.y}
        x2={tether.conductor.x}
        y2={tether.conductor.y}
      />
      <circle cx={tether.conductor.x} cy={tether.conductor.y} r="4.5" />
    </g>
  );
}
