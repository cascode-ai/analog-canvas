import { useMemo } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import {
  derivePowerRailComponent,
  endpointKey,
  isSchematicAnnotationVisible,
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
  resolveDocumentStyleProfile,
  type ResolvedRouteGeometry,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import {
  mirrorScale,
  routeEnd,
  type Annotation,
  type RouteBranch,
  type SchematicDocument,
} from "@icm/model";
import {
  getRazaviCatalogEntry,
  resolveAdaptiveSignalFlowBlockLayout,
  type ResolvedSymbol,
  type SymbolPrimitive,
  type SymbolResolver,
} from "@icm/symbols";

import {
  annotationHitBox,
  instanceHitBox,
} from "../features/wiring/route-interaction-geometry";
import type { EditorTool } from "../interaction/interaction-state";
import type { SelectionPolicy } from "../features/selection/selection-filter";
import { serializePolylinePoints } from "./canvas-geometry";

type Instance = SchematicDocument["instances"][number];
type Route = SchematicDocument["routes"][number];
type StyleProfile = ReturnType<typeof resolveDocumentStyleProfile>;
type StretchIntent =
  | "resize-power-rail-start"
  | "resize-power-rail-end"
  | "resize-route-start"
  | "resize-route-end";
type RouteGeometryRecord = {
  route: RouteBranch;
  geometry: ResolvedRouteGeometry;
};

function instanceTransform(instance: Instance): string {
  const placement = instance.placement!;
  const scale = mirrorScale(placement.mirror);
  const mirror =
    scale.x === 1 && scale.y === 1 ? "" : ` scale(${scale.x} ${scale.y})`;
  return `translate(${placement.position.x} ${placement.position.y})${mirror} rotate(${placement.rotation})`;
}

function analogBlockHitPrimitives(
  instance: Instance,
  resolved: ResolvedSymbol,
): SymbolPrimitive[] {
  const adaptive = resolveAdaptiveSignalFlowBlockLayout(
    resolved.definition,
    instance.signalFlowParameters,
  );
  if (adaptive) {
    const { body, pinSpan, shape } = adaptive;
    const center = resolved.definition.formulaPresentation!.center;
    const bodyRight = body.x + body.width;
    const bodyBottom = body.y + body.height;
    const frame: SymbolPrimitive =
      shape === "right-tapered-trapezoid"
        ? {
            kind: "polygon",
            points: [
              { x: body.x, y: body.y },
              { x: bodyRight, y: body.y + body.height / 4 },
              { x: bodyRight, y: bodyBottom - body.height / 4 },
              { x: body.x, y: bodyBottom },
            ],
            fill: "none",
            stroke: "foreground",
          }
        : {
            kind: "polygon",
            points: [
              { x: body.x, y: body.y },
              { x: bodyRight, y: body.y },
              { x: bodyRight, y: bodyBottom },
              { x: body.x, y: bodyBottom },
            ],
            fill: "none",
            stroke: "foreground",
          };
    return [
      {
        kind: "line",
        from: { x: center.x - pinSpan, y: center.y },
        to: { x: body.x, y: center.y },
      },
      frame,
      {
        kind: "line",
        from: { x: bodyRight, y: center.y },
        to: { x: center.x + pinSpan, y: center.y },
      },
    ];
  }

  const hiddenParts = new Set(resolved.variant?.hiddenPrimitiveParts ?? []);
  return [
    ...resolved.definition.primitives,
    ...(resolved.variant?.additionalPrimitives ?? []),
  ].filter((primitive) => !primitive.part || !hiddenParts.has(primitive.part));
}

function AnalogBlockHitGeometry({
  instance,
  resolved,
  selected,
  pointerEvents,
}: {
  instance: Instance;
  resolved: ResolvedSymbol;
  selected: boolean;
  pointerEvents: "none" | undefined;
}) {
  const primitives = analogBlockHitPrimitives(instance, resolved);
  const renderPrimitive = (
    primitive: SymbolPrimitive,
    index: number,
    outline: boolean,
  ) => {
    const key = `${outline ? "outline" : "hit"}-${index}`;
    const filled =
      primitive.kind === "polygon" ||
      primitive.kind === "circle" ||
      (primitive.kind === "path" && /z\s*$/iu.test(primitive.data));
    const common = outline
      ? {
          className: "analog-block-hit-outline",
          pointerEvents: "none" as const,
        }
      : {
          className: `analog-block-hit-area${filled ? " filled" : ""}${selected ? " selected" : ""}`,
          pointerEvents,
        };
    switch (primitive.kind) {
      case "line":
        return (
          <line
            key={key}
            {...common}
            x1={primitive.from.x}
            y1={primitive.from.y}
            x2={primitive.to.x}
            y2={primitive.to.y}
          />
        );
      case "polyline":
      case "polygon": {
        const points = serializePolylinePoints(primitive.points);
        return primitive.kind === "polygon" ? (
          <polygon key={key} {...common} points={points} />
        ) : (
          <polyline key={key} {...common} points={points} />
        );
      }
      case "circle":
        return (
          <circle
            key={key}
            {...common}
            cx={primitive.center.x}
            cy={primitive.center.y}
            r={primitive.radius}
          />
        );
      case "path":
        return <path key={key} {...common} d={primitive.data} />;
    }
  };

  return (
    <>
      {primitives.map((primitive, index) =>
        renderPrimitive(primitive, index, false),
      )}
      {primitives.map((primitive, index) =>
        renderPrimitive(primitive, index, true),
      )}
    </>
  );
}

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
  selectionPolicy: SelectionPolicy;
  onInstanceClick: (instance: Instance, additive: boolean) => void;
  onInstanceOpen: (instance: Instance) => void;
  onInstanceContextMenu: (
    instance: Instance,
    clientX: number,
    clientY: number,
  ) => void;
  /**
   * Reached only while a drawing tool is up. The pointer tool's presses are
   * claimed and stopped by the capture-phase router, which is the one place
   * that decides ownership; the wire gesture reads the whole press itself.
   */
  onRoutePointerDown: (
    event: ReactPointerEvent<SVGPolylineElement>,
    routeId: string,
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
  selectionPolicy: SelectionPolicy;
  endpointLabel: (endpoint: WireSource["endpoint"]) => string;
  onEndpointActions: (
    endpoint: WireSource,
    clientX: number,
    clientY: number,
  ) => void;
  onRouteStretch: (
    event: ReactPointerEvent<SVGCircleElement>,
    routeId: string,
    segmentIndex: number,
    intent: StretchIntent,
  ) => void;
  onJunctionSelect: (endpoint: WireSource) => void;
  /**
   * Radius of the endpoint and Junction hit circles, in document units,
   * converted so the target keeps one size on screen at any zoom.
   */
  endpointHitRadius: number;
  onWireEndpoint: (
    event: ReactPointerEvent<SVGCircleElement>,
    endpoint: WireSource,
  ) => void;
  onNetPointerEnter?: (netId: string) => void;
  onNetPointerLeave?: () => void;
  terminalPickState?: (
    endpoint: Extract<WireSource["endpoint"], { kind: "terminal" }>,
  ) => "candidate" | "origin" | "partner";
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
  selectionPolicy,
  onInstanceClick,
  onInstanceOpen,
  onInstanceContextMenu,
  onRoutePointerDown,
  onAnnotationContextMenu,
  onAnnotationEdit,
  onNetPointerEnter,
  onNetPointerLeave,
  children,
}: SelectionHitTargetProps & { children: ReactNode }) {
  // Every Annotation hit box needs the Document's routing geometry. Deriving
  // it once per render replaces one full re-derivation per Annotation, which
  // is what made this layer dominate a drag on a large Project.
  const routingGeometry = useMemo(
    () => resolveDocumentRoutingGeometry(document, resolver),
    [document, resolver],
  );
  // An Annotation's hit box and the visibility filter both resolve a Net
  // label's text, and that resolution re-derived logical Nets unless it was
  // handed them. One pass per render serves every Annotation.
  const logicalNets = useMemo(
    () => resolveDocumentLogicalNets(document),
    [document],
  );
  return (
    <>
      {document.instances
        .filter((instance) => instance.placement !== null)
        .map((instance) => {
          const hitBox = instanceHitBox(instance, resolver);
          if (!hitBox || cellSymbolLayoutInstanceId === instance.id)
            return null;
          const resolved = resolver.resolve(
            instance.symbolId,
            instance.symbolVariantId,
          );
          const analogBlock =
            resolved &&
            getRazaviCatalogEntry(instance.symbolId)?.category ===
              "analog-block";
          const selected = selectedInstanceIds.includes(instance.id);
          const wouldMove = wouldMoveIds.has(instance.id);
          const className = selected
            ? "hit-target selected"
            : wouldMove
              ? "hit-target would-move"
              : "hit-target";
          const onClick = (event: ReactMouseEvent<SVGElement>) => {
            if (
              !selectionPolicy.allowsCanvasHit(
                { kind: "instance", id: instance.id },
                "select",
              )
            )
              return;
            event.stopPropagation();
            onInstanceClick(instance, event.shiftKey || event.ctrlKey);
          };
          const onDoubleClick = (event: ReactMouseEvent<SVGElement>) => {
            if (
              !selectionPolicy.allowsCanvasHit(
                { kind: "instance", id: instance.id },
                "edit",
              )
            )
              return;
            event.stopPropagation();
            onInstanceOpen(instance);
          };
          const onContextMenu = (event: ReactMouseEvent<SVGElement>) => {
            if (
              !selectionPolicy.allowsCanvasHit(
                { kind: "instance", id: instance.id },
                "context-menu",
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            onInstanceContextMenu(instance, event.clientX, event.clientY);
          };
          if (analogBlock) {
            return (
              <g
                key={instance.id}
                data-testid={`hit-${instance.id}`}
                data-canvas-hit-kind="instance"
                data-canvas-hit-id={instance.id}
                data-drag-object-id={instance.id}
                className={
                  selected
                    ? "analog-block-hit-target selected"
                    : wouldMove
                      ? "analog-block-hit-target would-move"
                      : "analog-block-hit-target"
                }
                transform={instanceTransform(instance)}
                onClick={onClick}
                onDoubleClick={onDoubleClick}
                onContextMenu={onContextMenu}
              >
                <AnalogBlockHitGeometry
                  instance={instance}
                  resolved={resolved}
                  selected={selected}
                  pointerEvents={tool === "wire" ? "none" : undefined}
                />
              </g>
            );
          }
          return (
            <rect
              key={instance.id}
              data-testid={`hit-${instance.id}`}
              data-canvas-hit-kind="instance"
              data-canvas-hit-id={instance.id}
              data-drag-object-id={instance.id}
              {...hitBox}
              className={className}
              onClick={onClick}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
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
          // Drawing tools only: under the pointer tool the capture-phase
          // router has already claimed this press and stopped it, so this
          // handler runs for the wire gesture and for nothing else.
          onPointerDown={(event) => {
            if (
              tool === "pointer" &&
              !selectionPolicy.allowsCanvasHit(
                { kind: "route", id: route.id },
                "drag",
              )
            )
              return;
            onRoutePointerDown(event, route.id);
          }}
          onPointerEnter={() => onNetPointerEnter?.(route.netId)}
          onPointerLeave={() => onNetPointerLeave?.()}
          onClick={(event) => {
            if (
              tool !== "pointer" ||
              selectionPolicy.allowsCanvasHit(
                { kind: "route", id: route.id },
                "select",
              )
            ) {
              event.stopPropagation();
            }
          }}
        />
      ))}
      {children}
      {document.annotations
        .filter((annotation) =>
          isSchematicAnnotationVisible(document, annotation, logicalNets),
        )
        .map((annotation) => {
          const hitBox = annotationHitBox(
            document,
            resolver,
            annotation,
            routeGeometryRecords,
            styleProfile,
            routingGeometry,
            logicalNets,
          );
          const selected =
            selectedAnnotationId === annotation.id ||
            supplementalAnnotationIds.includes(annotation.id);
          // An instance label belongs to the component it names rather than
          // standing beside it, so it needs no would-move tint of its own once
          // that component carries a halo — the tint only repeated what the
          // halo already said, as a box next to a device that had none.
          // A label the person selected in its own right still marks itself:
          // suppressing that would answer a deliberate click with nothing.
          const carriedByMarkedOwner =
            annotation.kind === "instance-label" &&
            annotation.anchor.kind === "object" &&
            (selectedInstanceIds.includes(annotation.anchor.objectId) ||
              wouldMoveIds.has(annotation.anchor.objectId));
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
                  : wouldMoveIds.has(annotation.id) && !carriedByMarkedOwner
                    ? "hit-target annotation-text-hit would-move"
                    : "hit-target annotation-text-hit"
              }
              {...hitBox}
              onClick={(event) => {
                if (
                  selectionPolicy.allowsCanvasHit(
                    { kind: "annotation", id: annotation.id },
                    "select",
                  )
                ) {
                  event.stopPropagation();
                }
              }}
              onPointerEnter={() =>
                annotation.netId && onNetPointerEnter?.(annotation.netId)
              }
              onPointerLeave={() => onNetPointerLeave?.()}
              onContextMenu={(event) => {
                if (
                  !selectionPolicy.allowsCanvasHit(
                    { kind: "annotation", id: annotation.id },
                    "context-menu",
                  )
                )
                  return;
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
                if (
                  !selectionPolicy.allowsCanvasHit(
                    { kind: "annotation", id: annotation.id },
                    "edit",
                  )
                )
                  return;
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
  selectionPolicy,
  endpointLabel,
  endpointHitRadius,
  onEndpointActions,
  onRouteStretch,
  onJunctionSelect,
  onWireEndpoint,
  onNetPointerEnter,
  onNetPointerLeave,
  terminalPickState,
}: EndpointHitTargetProps) {
  const selectedRouteEnd = selectedRoute ? routeEnd(selectedRoute) : null;
  // Which end of the selected wire an endpoint IS, by identity rather than by
  // Junction id: a pin-anchored end is one of its ends too, and matching only
  // Junctions left the resize grip drawn under this layer unreachable there.
  const selectedRouteEndKeys =
    selectedRoute && selectedRoute.presentation !== "power-rail"
      ? {
          start: endpointKey(selectedRoute.start),
          end: selectedRouteEnd ? endpointKey(selectedRouteEnd) : null,
        }
      : { start: null, end: null };
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
  const pickEntries = endpoints.flatMap((candidate) => {
    if (candidate.endpoint.kind !== "terminal" || !terminalPickState) return [];
    return [
      {
        candidate,
        state: terminalPickState(candidate.endpoint),
      },
    ];
  });
  const pickOrigin = pickEntries.find(({ state }) => state === "origin");
  const pickPartners = pickEntries.filter(({ state }) => state === "partner");
  const hitTargets = endpoints.map((candidate) => {
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
    const candidateKey = endpointKey(candidate.endpoint);
    const selectedRouteEndSide =
      candidateKey === selectedRouteEndKeys.start
        ? "start"
        : candidateKey === selectedRouteEndKeys.end
          ? "end"
          : null;
    const label = endpointLabel(candidate.endpoint);
    return (
      <circle
        key={`${candidate.netId}:${label}`}
        data-testid={label}
        data-endpoint-kind={candidate.endpoint.kind}
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
        r={endpointHitRadius}
        onClick={(event) => {
          if (
            tool !== "pointer" ||
            selectionPolicy.allowsEndpoint(candidate.endpoint.kind, "select")
          ) {
            event.stopPropagation();
          }
        }}
        onContextMenu={(event) => {
          if (
            tool === "pointer" &&
            !selectionPolicy.allowsEndpoint(
              candidate.endpoint.kind,
              "context-menu",
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          onEndpointActions(candidate, event.clientX, event.clientY);
        }}
        onPointerDown={(event) => {
          if (
            tool === "pointer" &&
            selectedRoute &&
            (powerRailEndIndex >= 0 || selectedRouteEndSide !== null) &&
            !selectionPolicy.allowsClass("route", "handle")
          ) {
            return;
          }
          if (tool === "pointer" && selectedRoute && powerRailEndIndex >= 0) {
            onRouteStretch(
              event,
              selectedRoute.id,
              selectedRouteSegmentIndex ?? 0,
              powerRailEndIndex === 0
                ? "resize-power-rail-start"
                : "resize-power-rail-end",
            );
            return;
          }
          if (
            tool === "pointer" &&
            selectedRoute &&
            selectedRouteEndSide !== null
          ) {
            onRouteStretch(
              event,
              selectedRoute.id,
              selectedRouteEndSide === "start"
                ? 0
                : selectedRoute.legs.length - 1,
              selectedRouteEndSide === "start"
                ? "resize-route-start"
                : "resize-route-end",
            );
            return;
          }
          if (
            tool === "pointer" &&
            !selectionPolicy.allowsEndpoint(candidate.endpoint.kind, "select")
          ) {
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
  return (
    <>
      {pickOrigin
        ? pickPartners.map(({ candidate }) => (
            <TerminalCurrentDirectionPreview
              key={`current-direction-${endpointKey(candidate.endpoint)}`}
              from={pickOrigin.candidate.connection.contactPoint}
              to={candidate.connection.contactPoint}
              arrowSize={endpointHitRadius * 1.6}
            />
          ))
        : null}
      {pickEntries.map(({ candidate, state }) => {
        const label = endpointLabel(candidate.endpoint);
        return (
          <circle
            key={`${label}-current-pick-marker`}
            data-testid={`${label}-current-pick-marker`}
            className={`simulation-terminal-pick-marker ${state}`}
            cx={candidate.connection.contactPoint.x}
            cy={candidate.connection.contactPoint.y}
            r={endpointHitRadius}
          />
        );
      })}
      {hitTargets}
    </>
  );
}

function TerminalCurrentDirectionPreview({
  from,
  to,
  arrowSize,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  arrowSize: number;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  const tip = { x: from.x + dx * 0.62, y: from.y + dy * 0.62 };
  const base = { x: tip.x - ux * arrowSize, y: tip.y - uy * arrowSize };
  const halfWidth = arrowSize * 0.56;
  const left = { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth };
  const right = { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth };
  return (
    <g
      className="simulation-terminal-direction-preview"
      data-testid="simulation-terminal-direction-preview"
    >
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      <polygon
        points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
      />
    </g>
  );
}
