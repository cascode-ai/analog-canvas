import type {
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  type WireDraftStep,
  createConnectivityProposal,
  createFreeWireAnchor,
  gateConnectivityProposal,
  insertRouteSegmentJog,
  proposeVisualRouteDeletion,
  proposeLooseRouteTranslation,
  proposePowerRailEndpointResize,
  proposePowerRailTranslation,
  proposeWireSegmentMove,
  removeRouteSegmentJog,
  proposeWireCommitThroughContacts,
  type SchematicEdit,
  type ConnectivityIntent,
  type ConnectivityProposal,
  type WireSource,
  type WireCornerOrder,
  type WireRoutingMode,
} from "@icm/edit-engine";
import {
  derivePowerRailComponent,
  endpointKey,
  isMosBulkTerminal,
  resolveElectricalContactTargets,
  resolveRouteTap,
} from "@icm/derived";
import { snapCoordinate } from "../../snap/engine";
import { transformPoint } from "@icm/model";
import type { Flightline } from "@icm/derived";
import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  startCanvasDragSession,
  type CanvasDragSession,
} from "../../canvas/canvas-drag-session";
import { startCanvasDragVisual } from "../../canvas/canvas-drag-visual";
import { closestPointOnSegment } from "../../canvas/canvas-geometry";
import {
  endpointNetId,
  looseRouteAnchorIds,
  type RouteGeometryRecord,
} from "./route-interaction-geometry";

export interface RouteStretchPreview {
  routeId: string;
  segmentIndex: number;
  intent:
    | "stretch-segment"
    | "move-loose-route"
    | "move-power-rail"
    | "resize-power-rail-start"
    | "resize-power-rail-end";
  start: Point;
  point: Point;
}

type TransactionResult = {
  ok: boolean;
  revision: number;
};

function snapRouteTapPoint(
  point: Point,
  from: Point,
  to: Point,
  grid: number,
): Point {
  const projected = closestPointOnSegment(point, from, to);
  if (from.y === to.y)
    return { x: snapCoordinate(projected.x, grid), y: from.y };
  if (from.x === to.x)
    return { x: from.x, y: snapCoordinate(projected.y, grid) };
  const slope = Math.sign(to.y - from.y) * Math.sign(to.x - from.x);
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const x = Math.min(maxX, Math.max(minX, snapCoordinate(projected.x, grid)));
  return { x, y: from.y + slope * (x - from.x) };
}

export interface UseWireInteractionOptions {
  document: SchematicDocument;
  resolver: SymbolResolver;
  selectedInstance: SchematicDocument["instances"][number] | undefined;
  selectedRouteId: string | null;
  selectedRouteSegmentIndex: number | null;
  visibleEndpoints: readonly WireSource[];
  routeGeometryRecords: readonly RouteGeometryRecord[];
  wireSource: WireSource | null;
  wireSourceRevision: number | null;
  wireWaypoints: readonly Point[];
  wireDraftSteps: readonly WireDraftStep[];
  wireRoutingMode: WireRoutingMode;
  wireCornerOrder: WireCornerOrder;
  nextRoutingSuffix: () => number;
  transact: (
    edits: SchematicEdit[],
    options?: { completesWireSession?: boolean },
  ) => TransactionResult;
  setStatus: (status: string) => void;
  setTool: (tool: "wire") => void;
  setWireSource: (source: WireSource | null, revision: number | null) => void;
  setWirePreviewPoint: (point: Point | null) => void;
  setWireDraftSteps: (steps: WireDraftStep[]) => void;
  completeWire: () => void;
  clearTransientCanvasState: () => void;
  cancelInteraction: () => void;
  setBulkDrawInstanceId: (instanceId: string | null) => void;
  replaceRouteSelection: (routeIds: readonly string[]) => void;
  selectOnly: (kind: "route", ids: readonly string[]) => void;
  setSelectedRouteSegmentIndex: (segmentIndex: number | null) => void;
  setSelectedEndpoint: (endpoint: WireSource | null) => void;
  canvasDragSessionRef: MutableRefObject<CanvasDragSession | null>;
  setRouteStretchPreview: (preview: RouteStretchPreview | null) => void;
  pointFromClient: (
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    snapToGrid: false,
  ) => Point;
  logicalRadiusForPixels: (svg: SVGSVGElement, pixels: number) => number;
  contactComponents: Parameters<typeof resolveElectricalContactTargets>[3];
  createRouteAnchor: (
    routeId: string,
    point: Point,
    segmentIndex: number,
  ) => WireSource;
}

/**
 * Owns wire sessions and route-specific drag lifecycles. The App remains the
 * cross-domain canvas pointer arbiter.
 */
export function useWireInteraction(options: UseWireInteractionOptions) {
  const transactProposal = (
    proposal: ConnectivityProposal,
    transactionOptions?: { completesWireSession?: boolean },
  ): TransactionResult => {
    const gate = gateConnectivityProposal(options.document, proposal);
    if (!gate.ok) {
      options.setStatus(gate.message);
      return { ok: false, revision: options.document.revision };
    }
    return options.transact([...gate.edits], transactionOptions);
  };
  const proposalFor = (
    intent: ConnectivityIntent,
    edits: readonly SchematicEdit[],
    preview?: unknown,
  ): ConnectivityProposal =>
    createConnectivityProposal(options.document, {
      intent,
      diagnostics: [],
      edits,
      ...(preview === undefined ? {} : { preview }),
    });

  const freeWireAnchor = (
    point: Point,
    netId: string,
    createNet: boolean,
  ): WireSource =>
    createFreeWireAnchor(point, netId, createNet, options.nextRoutingSuffix());

  const commitWire = (candidate: WireSource): void => {
    if (!options.wireSource) return;
    if (options.wireSourceRevision !== options.document.revision) {
      options.clearTransientCanvasState();
      options.cancelInteraction();
      options.setBulkDrawInstanceId(null);
      options.setStatus("Wire cancelled because its source revision is stale");
      return;
    }
    const proposal = proposeWireCommitThroughContacts(
      options.wireSource,
      candidate,
      options.wireWaypoints,
      options.visibleEndpoints.filter(
        (endpoint) => endpoint.endpoint.kind === "terminal",
      ),
      options.nextRoutingSuffix(),
      {
        steps: options.wireDraftSteps,
        routingMode: options.wireRoutingMode,
        cornerOrder: options.wireCornerOrder,
      },
    );
    const bulkEndpoint = [options.wireSource.endpoint, candidate.endpoint].find(
      (endpoint) => endpoint.kind === "terminal" && endpoint.pinName === "B",
    );
    const defaultBoundInstance =
      bulkEndpoint?.kind === "terminal"
        ? options.document.instances.find(
            (instance) => instance.id === bulkEndpoint.instanceId,
          )
        : undefined;
    const edits = defaultBoundInstance?.mosBulkBinding
      ? [
          {
            kind: "clear_mos_bulk_default" as const,
            instanceId: defaultBoundInstance.id,
          },
          ...proposal.edits.map((edit) => {
            if (edit.kind !== "connect_endpoints") return edit;
            const target =
              edit.from.kind === "terminal" && edit.from.pinName === "B"
                ? edit.to
                : edit.from;
            return {
              ...edit,
              from: target,
              to: {
                kind: "terminal" as const,
                instanceId: defaultBoundInstance.id,
                pinName: "B",
              },
            };
          }),
        ]
      : proposal.edits;
    const result = transactProposal(proposalFor("draw_wire", edits, proposal), {
      completesWireSession: true,
    });
    if (result.ok) {
      options.completeWire();
      options.setBulkDrawInstanceId(null);
      options.setStatus(
        `Committed route at revision ${result.revision} · Wire remains active · Esc exits`,
      );
    }
  };

  const handleWireEndpoint = (
    event: ReactPointerEvent<SVGCircleElement>,
    candidate: WireSource,
  ): void => {
    event.stopPropagation();
    if (event.altKey) {
      options.setStatus("Snap suppressed while Alt is held");
      return;
    }
    options.setTool("wire");
    if (!options.wireSource) {
      options.setWireSource(candidate, options.document.revision);
      options.setWirePreviewPoint(candidate.point);
      options.setWireDraftSteps([]);
      options.setStatus(`Wire source: ${endpointKey(candidate.endpoint)}`);
      return;
    }
    if (
      endpointKey(options.wireSource.endpoint) ===
      endpointKey(candidate.endpoint)
    ) {
      options.setStatus("Choose a different endpoint");
      return;
    }
    commitWire(candidate);
  };

  const handleFlightline = (
    event: ReactMouseEvent<SVGLineElement>,
    flightline: Flightline,
  ): void => {
    event.stopPropagation();
    const from: WireSource = {
      endpoint: flightline.from,
      netId: flightline.netId,
      point: flightline.fromPoint,
      preludeEdits: [],
      ...(isMosBulkTerminal(options.document, flightline.from)
        ? { routePresentation: "bulk-dashed" as const }
        : {}),
    };
    const to: WireSource = {
      endpoint: flightline.to,
      netId: flightline.netId,
      point: flightline.toPoint,
      preludeEdits: [],
      ...(isMosBulkTerminal(options.document, flightline.to)
        ? { routePresentation: "bulk-dashed" as const }
        : {}),
    };
    options.setTool("wire");
    if (options.wireSource) {
      const candidate =
        endpointKey(options.wireSource.endpoint) === endpointKey(from.endpoint)
          ? to
          : from;
      if (
        endpointKey(options.wireSource.endpoint) !==
        endpointKey(candidate.endpoint)
      ) {
        commitWire(candidate);
      }
      return;
    }
    options.setWireSource(from, options.document.revision);
    options.setWirePreviewPoint(to.point);
    options.setWireDraftSteps([]);
    options.setStatus(`Wire source: flightline on ${flightline.netId}`);
  };

  const drawSelectedMosBulk = (): void => {
    const instance = options.selectedInstance;
    if (!instance?.placement) return;
    const resolved = options.resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    const anchor = resolved?.variant?.auxiliaryPins?.find(
      (pin) => pin.name === "B",
    );
    if (!anchor) {
      options.setStatus("Selected instance has no Razavi bulk anchor");
      return;
    }
    const endpoint: RouteEndpoint = {
      kind: "terminal",
      instanceId: instance.id,
      pinName: "B",
    };
    const source: WireSource = {
      endpoint,
      netId: instance.mosBulkBinding
        ? null
        : endpointNetId(options.document, endpoint),
      point: transformPoint(
        anchor.at,
        instance.placement.position,
        instance.placement,
      ),
      preludeEdits: options.document.noConnects.flatMap((noConnect) =>
        noConnect.endpoint.kind === "terminal" &&
        noConnect.endpoint.instanceId === instance.id &&
        noConnect.endpoint.pinName === "B"
          ? [{ kind: "remove_no_connect" as const, noConnectId: noConnect.id }]
          : [],
      ),
      routePresentation: "bulk-dashed",
    };
    options.setBulkDrawInstanceId(instance.id);
    options.setTool("wire");
    options.setWireSource(source, options.document.revision);
    options.setWirePreviewPoint(source.point);
    options.setWireDraftSteps([]);
    options.setStatus(`Drawing ${instance.id}.B bulk connection`);
  };

  const deleteSelectedRouteConnection = (): void => {
    if (!options.selectedRouteId) return;
    const route = options.document.routes.find(
      (candidate) => candidate.id === options.selectedRouteId,
    );
    if (!route) return;
    const deletion = proposeVisualRouteDeletion(
      options.document,
      [route.id],
      [],
    );
    const result = transactProposal(
      proposalFor(
        route.presentation === "bulk-dashed"
          ? "remove_bulk_override"
          : "remove_wire_geometry",
        deletion.edits,
        deletion,
      ),
    );
    if (result.ok) {
      options.replaceRouteSelection([]);
      options.setStatus(`Deleted wire ${route.id}`);
    }
  };

  const editSelectedRouteJog = (action: "insert" | "remove"): void => {
    if (!options.selectedRouteId) return;
    const route = options.document.routes.find(
      (candidate) => candidate.id === options.selectedRouteId,
    );
    const record = options.routeGeometryRecords.find(
      (candidate) => candidate.route.id === options.selectedRouteId,
    );
    if (!route || !record) return;
    const segmentIndex = Math.min(
      options.selectedRouteSegmentIndex ?? 0,
      route.segmentModes.length - 1,
    );
    try {
      const geometry = {
        points: record.geometry.centerline,
        segmentModes: route.segmentModes,
      };
      const next =
        action === "insert"
          ? insertRouteSegmentJog(
              geometry,
              segmentIndex,
              options.document.presentation.grid,
            )
          : removeRouteSegmentJog(geometry, segmentIndex);
      const result = transactProposal(
        proposalFor(
          "edit_route_geometry",
          [
            {
              kind: "set_route_points",
              routeId: route.id,
              netId: route.netId,
              from: route.from,
              to: route.to,
              waypoints: next.waypoints,
              segmentModes: next.segmentModes,
              ...(route.presentation
                ? { presentation: route.presentation }
                : {}),
            },
          ],
          { action, routeId: route.id, segmentIndex },
        ),
      );
      if (result.ok) {
        options.setSelectedRouteSegmentIndex(
          action === "insert" ? segmentIndex + 1 : segmentIndex - 1,
        );
        options.setStatus(
          action === "insert"
            ? "Added orthogonal wire jog"
            : "Straightened orthogonal wire jog",
        );
      }
    } catch (error) {
      options.setStatus(
        error instanceof Error ? error.message : "Route geometry edit failed",
      );
    }
  };

  const selectRoute = (routeId: string, segmentIndex = 0): void => {
    options.selectOnly("route", [routeId]);
    options.setSelectedRouteSegmentIndex(segmentIndex);
    options.setSelectedEndpoint(null);
    options.setStatus(`Selected route ${routeId}, segment ${segmentIndex + 1}`);
  };

  const completeRouteStretch = (
    preview: RouteStretchPreview,
    point: Point,
  ): void => {
    const record = options.routeGeometryRecords.find(
      (candidate) => candidate.route.id === preview.routeId,
    );
    if (!record) return;
    try {
      if (preview.intent === "move-loose-route") {
        const anchorIds = looseRouteAnchorIds(options.document, record.route);
        if (!anchorIds)
          throw new Error(
            "Only a route with two loose ends can move as a whole",
          );
        const delta = {
          x: snapCoordinate(
            point.x - preview.start.x,
            options.document.presentation.grid,
          ),
          y: snapCoordinate(
            point.y - preview.start.y,
            options.document.presentation.grid,
          ),
        };
        if (delta.x !== 0 || delta.y !== 0) {
          const proposal = proposeLooseRouteTranslation(
            options.document,
            record.route.id,
            delta,
          );
          const result = transactProposal(
            proposalFor("edit_route_geometry", proposal.edits, proposal),
          );
          if (result.ok)
            options.setStatus(`Moved loose route ${record.route.id}`);
        }
      } else if (preview.intent === "move-power-rail") {
        const delta = {
          x: snapCoordinate(
            point.x - preview.start.x,
            options.document.presentation.grid,
          ),
          y: snapCoordinate(
            point.y - preview.start.y,
            options.document.presentation.grid,
          ),
        };
        if (delta.x !== 0 || delta.y !== 0) {
          const proposal = proposePowerRailTranslation(
            options.document,
            options.resolver,
            record.route.id,
            delta,
          );
          const result = transactProposal(
            proposalFor("edit_route_geometry", proposal.edits, proposal),
          );
          if (result.ok)
            options.setStatus(`Moved Power Rail ${record.route.id}`);
        }
      } else if (
        preview.intent === "resize-power-rail-start" ||
        preview.intent === "resize-power-rail-end"
      ) {
        const proposal = proposePowerRailEndpointResize(
          options.document,
          options.resolver,
          record.route.id,
          preview.intent === "resize-power-rail-start" ? "start" : "end",
          {
            x: snapCoordinate(point.x, options.document.presentation.grid),
            y: snapCoordinate(point.y, options.document.presentation.grid),
          },
        );
        const result = transactProposal(
          proposalFor("edit_route_geometry", proposal.edits, proposal),
        );
        if (result.ok)
          options.setStatus(`Resized Power Rail ${record.route.id}`);
      } else {
        const proposal = proposeWireSegmentMove(
          options.document,
          options.resolver,
          record.route.id,
          preview.segmentIndex,
          {
            x: snapCoordinate(point.x, options.document.presentation.grid),
            y: snapCoordinate(point.y, options.document.presentation.grid),
          },
        );
        const result = transactProposal(
          proposalFor("edit_route_geometry", proposal.edits, proposal.preview),
        );
        if (result.ok)
          options.setStatus(`Moved route segment ${record.route.id}`);
      }
    } catch (error) {
      options.setStatus(
        error instanceof Error ? error.message : "Route move failed",
      );
    }
  };

  const beginRouteStretch = (
    event: ReactPointerEvent<SVGElement>,
    routeId: string,
    segmentIndex: number,
    intent: RouteStretchPreview["intent"] = "stretch-segment",
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    options.canvasDragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const start = options.pointFromClient(
      event.clientX,
      event.clientY,
      svg,
      false,
    );
    const record = options.routeGeometryRecords.find(
      (candidate) => candidate.route.id === routeId,
    );
    if (!record) return;
    const powerRail =
      intent === "move-power-rail" ||
      intent === "resize-power-rail-start" ||
      intent === "resize-power-rail-end"
        ? derivePowerRailComponent(options.document, routeId)
        : null;
    const anchorIds =
      intent === "move-loose-route"
        ? (looseRouteAnchorIds(options.document, record.route) ?? [])
        : (powerRail?.junctionIds ?? []);
    const translatedRouteIds =
      intent === "move-power-rail" ||
      intent === "resize-power-rail-start" ||
      intent === "resize-power-rail-end"
        ? (powerRail?.routeIds ?? [routeId])
        : [routeId];
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, [
        ...translatedRouteIds,
        ...anchorIds,
      ]));
    const preview: RouteStretchPreview = {
      routeId,
      segmentIndex,
      intent,
      start,
      point: start,
    };
    options.setRouteStretchPreview(preview);
    options.canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: 4,
      onPreview: (client) => {
        const point = options.pointFromClient(client.x, client.y, svg, false);
        if (intent === "move-loose-route" || intent === "move-power-rail") {
          dragVisual().translate({
            x: point.x - start.x,
            y: point.y - start.y,
          });
          return;
        }
        if (
          intent === "resize-power-rail-start" ||
          intent === "resize-power-rail-end"
        ) {
          try {
            const plan = proposePowerRailEndpointResize(
              options.document,
              options.resolver,
              routeId,
              intent === "resize-power-rail-start" ? "start" : "end",
              {
                x: snapCoordinate(point.x, options.document.presentation.grid),
                y: snapCoordinate(point.y, options.document.presentation.grid),
              },
            );
            const movedJunctions = new Map(
              plan.preview?.junctions.map((junction) => [
                junction.junctionId,
                junction.position,
              ]),
            );
            for (const routeProposal of plan.preview?.routes ?? []) {
              const routeRecord = options.routeGeometryRecords.find(
                (candidate) => candidate.route.id === routeProposal.routeId,
              );
              if (!routeRecord) continue;
              const from =
                routeRecord.route.from.kind === "junction"
                  ? (movedJunctions.get(routeRecord.route.from.junctionId) ??
                    routeRecord.geometry.centerline[0]!)
                  : routeRecord.geometry.centerline[0]!;
              const to =
                routeRecord.route.to.kind === "junction"
                  ? (movedJunctions.get(routeRecord.route.to.junctionId) ??
                    routeRecord.geometry.centerline.at(-1)!)
                  : routeRecord.geometry.centerline.at(-1)!;
              dragVisual().setObjectPolyline(routeProposal.routeId, [
                from,
                ...routeProposal.waypoints,
                to,
              ]);
            }
          } catch {
            // Keep the last valid rail preview; commit reports the error.
          }
          return;
        }
        try {
          const plan = proposeWireSegmentMove(
            options.document,
            options.resolver,
            routeId,
            segmentIndex,
            point,
          );
          const proposal = plan.preview?.routes.find(
            (candidate) => candidate.routeId === routeId,
          );
          if (!proposal) return;
          dragVisual().setPolyline([
            record.geometry.centerline[0]!,
            ...proposal.waypoints,
            record.geometry.centerline.at(-1)!,
          ]);
        } catch {
          // Keep the last valid preview; commit reports the geometry error.
        }
      },
      onFinish: ({ client, dragged }) => {
        options.canvasDragSessionRef.current = null;
        visual?.restore();
        if (dragged) {
          completeRouteStretch(
            preview,
            options.pointFromClient(client.x, client.y, svg, false),
          );
        }
        options.setRouteStretchPreview(null);
      },
      onCancel: () => {
        options.canvasDragSessionRef.current = null;
        visual?.restore();
        options.setRouteStretchPreview(null);
      },
    });
  };

  const handleWireRoutePointerDown = (
    event: ReactPointerEvent<SVGElement>,
    routeId: string,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    event.stopPropagation();
    if (event.altKey) {
      options.setStatus("Snap suppressed while Alt is held");
      return;
    }
    const record = options.routeGeometryRecords.find(
      (candidate) => candidate.route.id === routeId,
    );
    if (!record) return;
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const pointer = options.pointFromClient(
      event.clientX,
      event.clientY,
      svg,
      false,
    );
    const tap = resolveRouteTap(
      record.geometry,
      pointer,
      options.logicalRadiusForPixels(svg, 7),
    );
    if (!tap) {
      options.setStatus("Wire must start or end inside a route segment");
      return;
    }
    const segment = record.geometry.segments[tap.address.segmentIndex];
    if (!segment) return;
    const tapPoint = snapRouteTapPoint(
      tap.point,
      segment.from,
      segment.to,
      options.document.presentation.grid,
    );
    const overlappingTargets = options.routeGeometryRecords.flatMap(
      (candidate) => {
        const candidateTap = resolveRouteTap(
          candidate.geometry,
          pointer,
          options.logicalRadiusForPixels(svg, 7),
        );
        return candidateTap
          ? [
              {
                kind: "route" as const,
                id: `route:${candidate.route.id}:${candidateTap.address.segmentIndex}`,
                point: candidateTap.point,
                netId: candidate.route.netId,
                routeId: candidate.route.id,
                segmentIndex: candidateTap.address.segmentIndex,
              },
            ]
          : [];
      },
    );
    if (
      resolveElectricalContactTargets(
        options.document,
        options.resolver,
        overlappingTargets,
        options.contactComponents,
      ).length > 1
    ) {
      options.setStatus(
        "Ambiguous intersection: choose one conductor away from the crossing",
      );
      return;
    }
    const anchor = options.createRouteAnchor(
      routeId,
      tapPoint,
      tap.address.segmentIndex,
    );
    if (!options.wireSource) {
      options.setWireSource(anchor, options.document.revision);
      options.setWirePreviewPoint(tapPoint);
      options.setWireDraftSteps([]);
      options.setStatus(`Wire source: route ${routeId}`);
      return;
    }
    commitWire(anchor);
  };

  const fixWirePoint = (point: Point): void => {
    if (!options.wireSource) {
      const source = freeWireAnchor(
        point,
        `net-ui-${options.nextRoutingSuffix()}`,
        true,
      );
      options.setWireSource(source, options.document.revision);
      options.setWirePreviewPoint(point);
      options.setWireDraftSteps([]);
      options.setStatus("Wire source: free grid point");
      return;
    }
    options.setWireDraftSteps([
      ...options.wireDraftSteps,
      {
        point,
        routingMode: options.wireRoutingMode,
        cornerOrder: options.wireCornerOrder,
      },
    ]);
    options.setWirePreviewPoint(point);
    options.setStatus("Wire step fixed; double-click or Enter to finish");
  };

  const finishWireAtPoint = (point: Point): void => {
    if (!options.wireSource) {
      fixWirePoint(point);
      return;
    }
    const netId =
      options.wireSource.netId ?? `net-ui-${options.nextRoutingSuffix()}`;
    commitWire(freeWireAnchor(point, netId, options.wireSource.netId === null));
  };

  return {
    beginRouteStretch,
    commitWire,
    completeRouteStretch,
    deleteSelectedRouteConnection,
    editSelectedRouteJog,
    drawSelectedMosBulk,
    fixWirePoint,
    finishWireAtPoint,
    handleFlightline,
    handleWireRoutePointerDown,
    handleWireEndpoint,
    selectRoute,
  };
}
