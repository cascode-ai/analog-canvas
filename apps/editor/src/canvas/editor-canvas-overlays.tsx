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
  canSelectRoute,
  onSelectRoute,
}: {
  warnings: readonly WireUnderSymbolWarning[];
  canSelectRoute: (routeId: string) => boolean;
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
            pointerEvents={canSelectRoute(warning.routeId) ? undefined : "none"}
            onPointerDown={(event) => {
              if (!canSelectRoute(warning.routeId)) return;
              event.stopPropagation();
              event.preventDefault();
              onSelectRoute(warning.routeId);
            }}
            onClick={(event) => {
              if (canSelectRoute(warning.routeId)) event.stopPropagation();
            }}
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
 * A label's line to what it belongs to, ready to paint. Declared structurally
 * so the canvas layer stays below features: the wiring feature decides which
 * labels get one and where its ends sit, and hands the result down.
 */
export interface LabelTether {
  annotationId: string;
  kind: "wire" | "pin" | "part";
  ownerId: string | null;
  label: { x: number; y: number };
  target: { x: number; y: number };
}

/**
 * Each selected label -> what it belongs to: a Net Label to its wire tap, a
 * pin's name to the pin, a part's name or value to the part, whose outline
 * the selection halo lights. The line glows under a dashed core. Its ends
 * name their label and owner, so a drag stretches the line with whichever
 * one moves.
 */
export function LabelTetherOverlay({
  tethers,
}: {
  tethers: readonly LabelTether[];
}) {
  if (tethers.length === 0) return null;
  return (
    <g data-testid="label-tethers" pointerEvents="none">
      {tethers.map((tether) => {
        const ends = {
          x1: tether.label.x,
          y1: tether.label.y,
          x2: tether.target.x,
          y2: tether.target.y,
          "data-tether-label-id": tether.annotationId,
          ...(tether.ownerId ? { "data-tether-owner-id": tether.ownerId } : {}),
        };
        return (
          <g
            key={tether.annotationId}
            data-testid="label-tether"
            data-tether-kind={tether.kind}
            data-tether-for={tether.annotationId}
            className={`label-tether label-tether--${tether.kind}`}
          >
            {/* Drawn even at zero length, when the label touches its owner:
                a drag then has a line to stretch. */}
            <line className="label-tether-glow" {...ends} />
            <line className="label-tether-line" {...ends} />
            {tether.kind === "part" ? null : (
              <circle
                cx={tether.target.x}
                cy={tether.target.y}
                r="4.5"
                {...(tether.ownerId
                  ? { "data-drag-object-id": tether.ownerId }
                  : {})}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
