import type {
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  type WireDraftStep,
  createRoutingOperationPlan,
  createFreeWireAnchor,
  createRouteWireAnchor,
  gateRoutingOperationPlan,
  planRoutingDeletion,
  proposeLooseRouteTranslation,
  proposePowerRailEndpointResize,
  proposePowerRailTranslation,
  proposeRouteEndpointMove,
  proposeWireSegmentMove,
  proposeWireCommitThroughContacts,
  type SchematicEdit,
  type ExpectedElectricalEffect,
  type RoutingOperationIntent,
  type RoutingOperationPlan,
  type WireSource,
  type WireCornerOrder,
  type WireRoutingMode,
} from "@icm/edit-engine";
import {
  derivePowerRailComponent,
  endpointKey,
  isMosBulkTerminal,
  resolveEndpointConnection,
  resolveElectricalContactTargets,
  resolveRouteTap,
} from "@icm/derived";
import { snapCoordinate } from "../../snap/engine";
import type { Flightline } from "@icm/derived";
import {
  routeEnd,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
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
  routeTapPoint,
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
    | "resize-power-rail-end"
    | "resize-route-start"
    | "resize-route-end";
  start: Point;
  point: Point;
}

type TransactionResult = {
  ok: boolean;
  revision: number;
};

export interface UseWireInteractionOptions {
  model: {
    document: SchematicDocument;
    resolver: SymbolResolver;
    visibleEndpoints: readonly WireSource[];
    routeGeometryRecords: readonly RouteGeometryRecord[];
    contactComponents: Parameters<typeof resolveElectricalContactTargets>[3];
  };
  selection: {
    selectedInstance: SchematicDocument["instances"][number] | undefined;
    selectedRouteId: string | null;
    selectedRouteSegmentIndex: number | null;
    replaceRouteSelection: (routeIds: readonly string[]) => void;
    selectOnly: (kind: "route", ids: readonly string[]) => void;
    setSelectedRouteSegmentIndex: (segmentIndex: number | null) => void;
    setSelectedEndpoint: (endpoint: WireSource | null) => void;
  };
  session: {
    wireSource: WireSource | null;
    wireSourceRevision: number | null;
    wireWaypoints: readonly Point[];
    wireDraftSteps: readonly WireDraftStep[];
    wireRoutingMode: WireRoutingMode;
    wireCornerOrder: WireCornerOrder;
    setTool: (tool: "wire") => void;
    setWireSource: (source: WireSource | null, revision: number | null) => void;
    setWirePreviewPoint: (point: Point | null) => void;
    setWireDraftSteps: (steps: WireDraftStep[]) => void;
    completeWire: () => void;
    clearTransientCanvasState: () => void;
    cancelInteraction: () => void;
    setBulkDrawInstanceId: (instanceId: string | null) => void;
  };
  transaction: {
    nextRoutingSuffix: () => number;
    transact: (
      edits: SchematicEdit[],
      options?: { completesWireSession?: boolean },
    ) => TransactionResult;
    setStatus: (status: string) => void;
  };
  drag: {
    canvasDragSessionRef: MutableRefObject<CanvasDragSession | null>;
    setRouteStretchPreview: (preview: RouteStretchPreview | null) => void;
    pointFromClient: (
      clientX: number,
      clientY: number,
      svg: SVGSVGElement,
      snapToGrid: false,
    ) => Point;
    logicalRadiusForPixels: (svg: SVGSVGElement, pixels: number) => number;
  };
}

/**
 * Owns wire sessions and route-specific drag lifecycles. The App remains the
 * cross-domain canvas pointer arbiter.
 */
export function useWireInteraction(capabilities: UseWireInteractionOptions) {
  const options = {
    ...capabilities.model,
    ...capabilities.selection,
    ...capabilities.session,
    ...capabilities.transaction,
    ...capabilities.drag,
  };
  const transactProposal = (
    proposal: RoutingOperationPlan,
    transactionOptions?: { completesWireSession?: boolean },
  ): TransactionResult => {
    const gate = gateRoutingOperationPlan(options.document, proposal, {
      symbolResolver: options.resolver,
    });
    if (!gate.ok) {
      options.setStatus(gate.message);
      return { ok: false, revision: options.document.revision };
    }
    return options.transact([...gate.edits], transactionOptions);
  };
  const proposalFor = (
    intent: RoutingOperationIntent,
    edits: readonly SchematicEdit[],
    expectedElectricalEffect?: ExpectedElectricalEffect,
  ): RoutingOperationPlan =>
    createRoutingOperationPlan(options.document, {
      intent,
      diagnostics: [],
      edits,
      ...(expectedElectricalEffect ? { expectedElectricalEffect } : {}),
    });

  const freeWireAnchor = (
    point: Point,
    netId: string,
    createNet: boolean,
  ): WireSource =>
    createFreeWireAnchor(point, netId, createNet, options.nextRoutingSuffix());

  const routeAnchor = (
    routeId: string,
    point: Point,
    segmentIndex: number,
  ): WireSource => {
    const route = options.document.routes.find(
      (candidate) => candidate.id === routeId,
    )!;
    // Persisted route taps must be projected back onto the document grid;
    // createRouteWireAnchor owns that normalization and split validation.
    return createRouteWireAnchor(
      options.document,
      route,
      point,
      segmentIndex,
      options.document.presentation.grid,
      options.nextRoutingSuffix(),
    );
  };

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
    const result = transactProposal(proposalFor("connect", edits), {
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
    // Only the primary button starts or commits on an endpoint. A middle
    // press bubbles to the canvas gesture (corner cycling) unless the caller
    // intercepted it; right-click keeps cancelling via the context menu.
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.altKey) {
      options.setStatus("Snap suppressed while Alt is held");
      return;
    }
    options.setTool("wire");
    if (!options.wireSource) {
      options.setWireSource(candidate, options.document.revision);
      options.setWirePreviewPoint(candidate.connection.contactPoint);
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
    const fromConnection = resolveEndpointConnection(
      options.document,
      options.resolver,
      flightline.from,
    );
    const toConnection = resolveEndpointConnection(
      options.document,
      options.resolver,
      flightline.to,
    );
    if (!fromConnection || !toConnection) {
      options.setStatus("Flightline endpoint has no routable grid landing");
      return;
    }
    const from: WireSource = {
      endpoint: flightline.from,
      netId: flightline.fromNetId,
      connection: fromConnection,
      preludeEdits: [],
      ...(isMosBulkTerminal(options.document, flightline.from)
        ? { routePresentation: "bulk-dashed" as const }
        : {}),
    };
    const to: WireSource = {
      endpoint: flightline.to,
      netId: flightline.toNetId,
      connection: toConnection,
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
    options.setWirePreviewPoint(to.connection.contactPoint);
    options.setWireDraftSteps([]);
    options.setStatus(`Wire source: flightline on ${flightline.netId}`);
  };

  const drawSelectedMosBulk = (): void => {
    const instance = options.selectedInstance;
    if (!instance?.placement) return;
    const endpoint: RouteEndpoint = {
      kind: "terminal",
      instanceId: instance.id,
      pinName: "B",
    };
    const connection = resolveEndpointConnection(
      options.document,
      options.resolver,
      endpoint,
    );
    if (!connection) {
      options.setStatus("Selected instance has no routable Razavi bulk anchor");
      return;
    }
    const source: WireSource = {
      endpoint,
      netId: instance.mosBulkBinding
        ? null
        : endpointNetId(options.document, endpoint),
      connection,
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
    options.setWirePreviewPoint(source.connection.contactPoint);
    options.setWireDraftSteps([]);
    options.setStatus(`Drawing ${instance.id}.B bulk connection`);
  };

  const deleteSelectedRouteConnection = (): void => {
    if (!options.selectedRouteId) return;
    const route = options.document.routes.find(
      (candidate) => candidate.id === options.selectedRouteId,
    );
    if (!route) return;
    const deletion = planRoutingDeletion(
      options.document,
      options.resolver,
      { instanceIds: [], routeIds: [route.id], junctionIds: [] },
      options.nextRoutingSuffix(),
    );
    const result = transactProposal(deletion);
    if (result.ok) {
      options.replaceRouteSelection([]);
      options.setStatus(`Deleted wire ${route.id}`);
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
            {
              resolver: options.resolver,
              suffix: `land-${options.nextRoutingSuffix()}`,
            },
          );
          const result = transactProposal(
            proposalFor(
              "route-geometry",
              proposal.edits,
              proposal.expectedElectricalEffect,
            ),
          );
          if (result.ok) {
            options.setStatus(
              proposal.expectedElectricalEffect
                ? `Moved ${record.route.id} onto the wire it now shares a net with`
                : `Moved loose route ${record.route.id}`,
            );
          }
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
            proposalFor("route-geometry", proposal.edits),
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
          proposalFor("route-geometry", proposal.edits),
        );
        if (result.ok)
          options.setStatus(`Resized Power Rail ${record.route.id}`);
      } else if (
        preview.intent === "resize-route-start" ||
        preview.intent === "resize-route-end"
      ) {
        const proposal = proposeRouteEndpointMove(
          options.document,
          options.resolver,
          record.route.id,
          preview.intent === "resize-route-start" ? "start" : "end",
          {
            x: snapCoordinate(point.x, options.document.presentation.grid),
            y: snapCoordinate(point.y, options.document.presentation.grid),
          },
        );
        const result = transactProposal(
          proposalFor("route-geometry", proposal.edits),
        );
        if (result.ok) options.setStatus(`Resized wire ${record.route.id}`);
      } else {
        const grid = options.document.presentation.grid;
        const planAt = (at: Point) =>
          proposeWireSegmentMove(
            options.document,
            options.resolver,
            record.route.id,
            preview.segmentIndex,
            {
              x: snapCoordinate(at.x, grid),
              y: snapCoordinate(at.y, grid),
            },
          );
        const proposal = (() => {
          try {
            return planAt(point);
          } catch (error) {
            // Land on the furthest position the drag actually planned, which
            // is the geometry the preview was showing when the pointer went
            // past what the wire could do.
            if (preview.point === preview.start) throw error;
            return planAt(preview.point);
          }
        })();
        const result = transactProposal(
          proposalFor("route-geometry", proposal.edits),
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
    const routeEndpoint =
      intent === "resize-route-start"
        ? record.route.start
        : intent === "resize-route-end"
          ? routeEnd(record.route)
          : null;
    const routeEndpointJunctionId =
      routeEndpoint?.kind === "junction" ? routeEndpoint.junctionId : null;
    const routeEndpointRouteIds = routeEndpointJunctionId
      ? options.document.routes
          .filter((candidate) => {
            const end = routeEnd(candidate);
            return (
              (candidate.start.kind === "junction" &&
                candidate.start.junctionId === routeEndpointJunctionId) ||
              (end.kind === "junction" &&
                end.junctionId === routeEndpointJunctionId)
            );
          })
          .map((candidate) => candidate.id)
      : [];
    const anchorIds =
      intent === "move-loose-route"
        ? (looseRouteAnchorIds(options.document, record.route) ?? [])
        : routeEndpointJunctionId
          ? [routeEndpointJunctionId]
          : (powerRail?.junctionIds ?? []);
    const translatedRouteIds =
      intent === "move-power-rail" ||
      intent === "resize-power-rail-start" ||
      intent === "resize-power-rail-end"
        ? (powerRail?.routeIds ?? [routeId])
        : routeEndpointRouteIds.length > 0
          ? routeEndpointRouteIds
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
          intent === "resize-power-rail-end" ||
          intent === "resize-route-start" ||
          intent === "resize-route-end"
        ) {
          try {
            const snapped = {
              x: snapCoordinate(point.x, options.document.presentation.grid),
              y: snapCoordinate(point.y, options.document.presentation.grid),
            };
            const plan =
              intent === "resize-route-start" || intent === "resize-route-end"
                ? proposeRouteEndpointMove(
                    options.document,
                    options.resolver,
                    routeId,
                    intent === "resize-route-start" ? "start" : "end",
                    snapped,
                  )
                : proposePowerRailEndpointResize(
                    options.document,
                    options.resolver,
                    routeId,
                    intent === "resize-power-rail-start" ? "start" : "end",
                    snapped,
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
              const routeEndPoint = routeEnd(routeRecord.route);
              const from =
                routeRecord.route.start.kind === "junction"
                  ? (movedJunctions.get(routeRecord.route.start.junctionId) ??
                    routeRecord.geometry.centerline[0]!)
                  : routeRecord.geometry.centerline[0]!;
              const to =
                routeEndPoint.kind === "junction"
                  ? (movedJunctions.get(routeEndPoint.junctionId) ??
                    routeRecord.geometry.centerline.at(-1)!)
                  : routeRecord.geometry.centerline.at(-1)!;
              dragVisual().setObjectPolyline(routeProposal.routeId, [
                from,
                ...routeProposal.waypoints,
                to,
              ]);
            }
          } catch {
            // Keep the last valid endpoint preview; commit reports the error.
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
          // Remember how far the drag actually planned. Releasing past that
          // point used to plan once more, fail, and snap the wire back to
          // where it started, discarding everything the preview had shown.
          preview.point = point;
          dragVisual().setPolyline([
            record.geometry.centerline[0]!,
            ...proposal.waypoints,
            record.geometry.centerline.at(-1)!,
          ]);
        } catch {
          // Keep the last valid preview; commit lands on it instead.
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
    if (event.button !== 0) return;
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
    const tapPoint = routeTapPoint(
      tap.point,
      segment.from,
      segment.to,
      options.document.presentation.grid,
      options.wireSource
        ? (options.wireWaypoints.at(-1) ??
            options.wireSource.connection.gridLanding)
        : null,
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
    const anchor = routeAnchor(routeId, tapPoint, tap.address.segmentIndex);
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
    createRouteAnchor: routeAnchor,
    beginRouteStretch,
    commitWire,
    completeRouteStretch,
    deleteSelectedRouteConnection,
    drawSelectedMosBulk,
    fixWirePoint,
    finishWireAtPoint,
    handleFlightline,
    handleWireRoutePointerDown,
    handleWireEndpoint,
    selectRoute,
  };
}
