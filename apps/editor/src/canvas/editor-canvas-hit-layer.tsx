import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import {
  derivePowerRailComponent,
  isSchematicAnnotationVisible,
  resolveDocumentStyleProfile,
  type ResolvedRouteGeometry,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import type { Annotation, RouteBranch, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  annotationAnchor,
  annotationHitBox,
  instanceHitBox,
} from "../features/wiring/route-interaction-geometry";
import type { EditorTool } from "../interaction/interaction-state";
import { serializePolylinePoints } from "./canvas-geometry";

type Instance = SchematicDocument["instances"][number];
type Route = SchematicDocument["routes"][number];
type StyleProfile = ReturnType<typeof resolveDocumentStyleProfile>;
type StretchIntent = "resize-power-rail-start" | "resize-power-rail-end";
type RouteGeometryRecord = {
  route: RouteBranch;
  geometry: ResolvedRouteGeometry;
};

interface SelectionHitTargetProps {
  document: SchematicDocument;
  resolver: SymbolResolver;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  styleProfile: StyleProfile;
  tool: EditorTool;
  selectedInstanceIds: readonly string[];
  selectedRouteId: string | null;
  supplementalRouteIds: readonly string[];
  selectedInternalRouteIds: ReadonlySet<string>;
  selectedAnnotationId: string | null;
  supplementalAnnotationIds: readonly string[];
  cellSymbolLayoutInstanceId: string | null;
  /**
   * Everything a drag starting on the selection would carry: selected
   * objects plus their translated routes, junctions, and annotations.
   * Members get the `would-move` tint so the moving body reads as one.
   */
  wouldMoveIds: ReadonlySet<string>;
  onInstanceClick: (instance: Instance, additive: boolean) => void;
  onInstanceOpen: (instance: Instance) => void;
  onInstancePointerDown: (
    event: ReactPointerEvent<SVGRectElement>,
    instance: Instance,
  ) => void;
  onInstanceContextMenu: (
    instance: Instance,
    clientX: number,
    clientY: number,
  ) => void;
  onRoutePointerDown: (
    event: ReactPointerEvent<SVGPolylineElement>,
    routeId: string,
  ) => void;
  onAnnotationPointerDown: (
    event: ReactPointerEvent<SVGRectElement>,
    annotation: Annotation,
  ) => void;
  onAnnotationContextMenu: (
    annotation: Annotation,
    clientX: number,
    clientY: number,
  ) => void;
  onAnnotationEdit: (annotation: Annotation) => void;
  onNetPointerEnter?: (netId: string) => void;
  onNetPointerLeave?: () => void;
}

interface EndpointHitTargetProps {
  document: SchematicDocument;
  endpoints: readonly WireSource[];
  tool: EditorTool;
  selectedRoute: Route | undefined;
  selectedRouteSegmentIndex: number | null;
  selectedEndpoint: WireSource | null;
  supplementalJunctionIds: readonly string[];
  endpointLabel: (endpoint: WireSource["endpoint"]) => string;
  onEndpointActions: (endpoint: WireSource) => void;
  onPowerRailStretch: (
    event: ReactPointerEvent<SVGCircleElement>,
    routeId: string,
    segmentIndex: number,
    intent: StretchIntent,
  ) => void;
  onJunctionSelect: (endpoint: WireSource) => void;
  onWireEndpoint: (
    event: ReactPointerEvent<SVGCircleElement>,
    endpoint: WireSource,
  ) => void;
  onNetPointerEnter?: (netId: string) => void;
  onNetPointerLeave?: () => void;
}

export function EditorCanvasHitLayer({
  selection,
  endpoints,
}: {
  selection: SelectionHitTargetProps;
  endpoints: EndpointHitTargetProps;
}) {
  return (
    <SelectionHitTargets {...selection}>
      <EndpointHitTargets {...endpoints} />
    </SelectionHitTargets>
  );
}

function SelectionHitTargets({
  document,
  resolver,
  routeGeometryRecords,
  styleProfile,
  tool,
  selectedInstanceIds,
  selectedRouteId,
  supplementalRouteIds,
  selectedInternalRouteIds,
  selectedAnnotationId,
  supplementalAnnotationIds,
  cellSymbolLayoutInstanceId,
  wouldMoveIds,
  onInstanceClick,
  onInstanceOpen,
  onInstancePointerDown,
  onInstanceContextMenu,
  onRoutePointerDown,
  onAnnotationPointerDown,
  onAnnotationContextMenu,
  onAnnotationEdit,
  onNetPointerEnter,
  onNetPointerLeave,
  children,
}: SelectionHitTargetProps & { children: ReactNode }) {
  return (
    <>
      {document.instances
        .filter((instance) => instance.placement !== null)
        .map((instance) => {
          const hitBox = instanceHitBox(instance, resolver);
          if (!hitBox || cellSymbolLayoutInstanceId === instance.id)
            return null;
          return (
            <rect
              key={instance.id}
              data-testid={`hit-${instance.id}`}
              data-canvas-hit-kind="instance"
              data-canvas-hit-id={instance.id}
              data-drag-object-id={instance.id}
              {...hitBox}
              className={
                selectedInstanceIds.includes(instance.id)
                  ? "hit-target selected"
                  : wouldMoveIds.has(instance.id)
                    ? "hit-target would-move"
                    : "hit-target"
              }
              onClick={(event) => {
                event.stopPropagation();
                onInstanceClick(instance, event.shiftKey || event.ctrlKey);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onInstanceOpen(instance);
              }}
              onPointerDown={(event) => onInstancePointerDown(event, instance)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onInstanceContextMenu(instance, event.clientX, event.clientY);
              }}
              pointerEvents={tool === "wire" ? "none" : undefined}
            />
          );
        })}
      {routeGeometryRecords.map(({ route, geometry }) => (
        <polyline
          key={route.id}
          data-testid={`route-hit-${route.id}`}
          data-canvas-hit-kind="route"
          data-canvas-hit-id={route.id}
          data-drag-object-id={route.id}
          className={
            selectedRouteId === route.id ||
            supplementalRouteIds.includes(route.id) ||
            selectedInternalRouteIds.has(route.id)
              ? "route-hit selected"
              : wouldMoveIds.has(route.id)
                ? "route-hit would-move"
                : "route-hit"
          }
          points={serializePolylinePoints(geometry.centerline)}
          onPointerDown={(event) => onRoutePointerDown(event, route.id)}
          onPointerEnter={() => onNetPointerEnter?.(route.netId)}
          onPointerLeave={() => onNetPointerLeave?.()}
          onClick={(event) => event.stopPropagation()}
        />
      ))}
      {children}
      {document.annotations
        .filter((annotation) =>
          isSchematicAnnotationVisible(document, annotation),
        )
        .map((annotation) => {
          const anchor = annotationAnchor(
            document,
            resolver,
            annotation,
            routeGeometryRecords,
            styleProfile,
          );
          const hitBox = annotationHitBox(
            document,
            annotation,
            anchor,
            routeGeometryRecords,
            styleProfile,
          );
          const selected =
            selectedAnnotationId === annotation.id ||
            supplementalAnnotationIds.includes(annotation.id);
          return (
            <rect
              key={`annotation-hit-${annotation.id}`}
              data-testid={`annotation-hit-${annotation.id}`}
              data-canvas-hit-kind="annotation"
              data-canvas-hit-id={annotation.id}
              data-drag-object-id={annotation.id}
              className={
                selected
                  ? "hit-target annotation-text-hit selected"
                  : wouldMoveIds.has(annotation.id)
                    ? "hit-target annotation-text-hit would-move"
                    : "hit-target annotation-text-hit"
              }
              {...hitBox}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) =>
                onAnnotationPointerDown(event, annotation)
              }
              onPointerEnter={() =>
                annotation.netId && onNetPointerEnter?.(annotation.netId)
              }
              onPointerLeave={() => onNetPointerLeave?.()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onAnnotationContextMenu(
                  annotation,
                  event.clientX,
                  event.clientY,
                );
              }}
              pointerEvents={tool === "wire" ? "none" : undefined}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onAnnotationEdit(annotation);
              }}
            />
          );
        })}
    </>
  );
}

function EndpointHitTargets({
  document,
  endpoints,
  tool,
  selectedRoute,
  selectedRouteSegmentIndex,
  selectedEndpoint,
  supplementalJunctionIds,
  endpointLabel,
  onEndpointActions,
  onPowerRailStretch,
  onJunctionSelect,
  onWireEndpoint,
  onNetPointerEnter,
  onNetPointerLeave,
}: EndpointHitTargetProps) {
  const powerRailEnds =
    selectedRoute?.presentation === "power-rail"
      ? (derivePowerRailComponent(document, selectedRoute.id)
          ?.endpointJunctionIds.map((junctionId) =>
            document.junctions.find((junction) => junction.id === junctionId),
          )
          .filter((junction): junction is NonNullable<typeof junction> =>
            Boolean(junction),
          )
          .sort((left, right) => left.position.x - right.position.x) ?? [])
      : [];
  return endpoints.map((candidate) => {
    const candidateJunctionId =
      candidate.endpoint.kind === "junction"
        ? candidate.endpoint.junctionId
        : null;
    const powerRailEndIndex =
      candidateJunctionId !== null
        ? powerRailEnds.findIndex(
            (junction) => junction.id === candidateJunctionId,
          )
        : -1;
    const label = endpointLabel(candidate.endpoint);
    return (
      <circle
        key={`${candidate.netId}:${label}`}
        data-testid={label}
        data-canvas-hit-kind={
          candidate.endpoint.kind === "junction" ? "junction" : undefined
        }
        data-canvas-hit-id={candidateJunctionId ?? undefined}
        data-drag-object-id={candidateJunctionId ?? undefined}
        className={
          tool === "wire" ||
          (candidateJunctionId !== null &&
            supplementalJunctionIds.includes(candidateJunctionId)) ||
          (selectedEndpoint?.endpoint.kind === "junction" &&
            candidateJunctionId !== null &&
            selectedEndpoint.endpoint.junctionId === candidateJunctionId)
            ? "endpoint-hit active"
            : "endpoint-hit"
        }
        cx={candidate.connection.contactPoint.x}
        cy={candidate.connection.contactPoint.y}
        r={4}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onEndpointActions(candidate);
        }}
        onPointerDown={(event) => {
          if (tool === "pointer" && selectedRoute && powerRailEndIndex >= 0) {
            onPowerRailStretch(
              event,
              selectedRoute.id,
              selectedRouteSegmentIndex ?? 0,
              powerRailEndIndex === 0
                ? "resize-power-rail-start"
                : "resize-power-rail-end",
            );
            return;
          }
          if (tool === "pointer" && candidate.endpoint.kind === "junction") {
            event.stopPropagation();
            onJunctionSelect(candidate);
            return;
          }
          onWireEndpoint(event, candidate);
        }}
        onPointerEnter={() =>
          candidate.netId && onNetPointerEnter?.(candidate.netId)
        }
        onPointerLeave={() => onNetPointerLeave?.()}
      />
    );
  });
}
