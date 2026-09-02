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
        data-camera-bounds="true"
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
          data-camera-bounds="true"
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
          data-camera-bounds="true"
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

/** An annulus path: ring-band hit area whose centre stays click-through. */
function ringBandPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
): string {
  const circle = (r: number, sweep: 0 | 1) =>
    `M ${cx - r},${cy} a ${r},${r} 0 1,${sweep} ${2 * r},0 a ${r},${r} 0 1,${sweep} ${-2 * r},0`;
  return `${circle(outer, 0)} ${circle(inner, 1)}`;
}

/**
 * Actionable findings placed on the canvas: an open severity-colored ring
 * over a light halo, so the marker never occludes what it marks. Pointer-down
 * on the ring band navigates through the same jump the workbench uses and
 * stops propagation, so markers never enter ordinary canvas hit ranking —
 * while the band's open centre keeps the pin or junction it rings directly
 * clickable (and right-clickable).
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
          <path
            className="diagnostic-marker-hit"
            data-testid={`diagnostic-marker-${marker.key}`}
            d={ringBandPath(marker.point.x, marker.point.y, 8.5, 3)}
            fillRule="evenodd"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
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

/**
 * One operating-point voltage, ready to paint. Declared structurally so the
 * canvas layer stays below features: the simulation feature decides which
 * nets earn a badge and where it sits, and hands the result down.
 */
export interface OperatingPointBadge {
  netId: string;
  netLabel: string;
  text: string;
  at: { x: number; y: number };
  /** Permanent because the author named the net, or transient on demand. */
  reason: "named" | "selected" | "hovered" | "all";
}

/**
 * Simulated node voltages, drawn over the schematic and never part of it.
 *
 * Pure annotation: no pointer events, no hit geometry, nothing selectable.
 * A simulation result is not a document object — ADR 0055 keeps results out
 * of the model entirely — so this layer must not offer any way to grab one.
 *
 * Each badge gets an opaque plate because a bare number over a wire and the
 * grid is unreadable exactly where it matters most.
 */
export function OperatingPointOverlay({
  badges,
}: {
  badges: readonly OperatingPointBadge[];
}) {
  if (badges.length === 0) return null;
  return (
    <g
      data-testid="operating-point-badges"
      className="operating-point-badges"
      pointerEvents="none"
      aria-hidden="true"
    >
      {badges.map((badge) => (
        <g
          key={badge.netId}
          className="operating-point-badge"
          data-reason={badge.reason}
          data-net-id={badge.netId}
        >
          {/* Sized from the text length: the canvas has no measurement pass,
              and a plate that is too small is worse than none. */}
          <rect
            className="operating-point-plate"
            x={badge.at.x - badge.text.length * 3.1 - 3}
            y={badge.at.y - 17}
            width={badge.text.length * 6.2 + 6}
            height={13}
            rx={2}
          />
          <text
            className="operating-point-text"
            x={badge.at.x}
            y={badge.at.y - 7}
            textAnchor="middle"
          >
            {badge.text}
          </text>
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
