import {
  endpointKey,
  isVisibleEndpoint,
  pointOnSegment,
  resolveEndpointConnection,
} from "@icm/derived";
import { deriveStableId, routeEndpoints } from "@icm/model";
import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./edit-schema.js";
import { proposeWireCommit } from "./routing-planner.js";

export interface PowerRailContactSpan {
  routeId: string;
  netId: string;
  start: Point;
  end: Point;
  endpoints: readonly RouteEndpoint[];
}

/**
 * A rail gesture explicitly bonds the visible pin tips along its final span.
 * Junction taps keep every fragment in the same editable rail component;
 * making pins the rail's own endpoints would break whole-rail transforms.
 * The existing contact normalizer joins the tap to the pin and splits the
 * conductor. Nothing scans or rewires untouched rails when a file is opened.
 */
export function planPowerRailPinContacts(
  document: SchematicDocument,
  resolver: SymbolResolver,
  spans: readonly PowerRailContactSpan[],
): { edits: SchematicEdit[]; endpointGroups: string[][] } {
  const edits: SchematicEdit[] = [];
  const endpointGroups: string[][] = [];
  const taps = new Map<string, string>();
  const mergedNetIds = new Set<string>();
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const symbol = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    for (const pin of symbol?.definition.pins ?? []) {
      const endpoint: RouteEndpoint = {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      };
      if (!isVisibleEndpoint(document, resolver, endpoint)) continue;
      const connection = resolveEndpointConnection(
        document,
        resolver,
        endpoint,
      );
      if (!connection) continue;
      const point = connection.contactPoint;
      const span = spans.find((candidate) =>
        pointOnSegment(point, candidate.start, candidate.end),
      );
      if (!span) continue;
      const pinNet = document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === instance.id &&
            terminal.pinName === pin.name,
        ),
      );
      // An existing rail endpoint already carries this exact pin contact.
      if (
        pinNet?.id === span.netId &&
        span.endpoints.some((candidate) => {
          const anchor = resolveEndpointConnection(
            document,
            resolver,
            candidate,
          )?.contactPoint;
          return (
            (anchor?.x === point.x && anchor.y === point.y) ||
            document.routes.some((route) => {
              const keys = routeEndpoints(route).map(endpointKey);
              return (
                keys.includes(endpointKey(endpoint)) &&
                keys.includes(endpointKey(candidate))
              );
            })
          );
        })
      )
        continue;

      // Rail anchors must remain on the page grid, even when the actual
      // artwork tip is between grid points. A short ordinary lead carries
      // that exact tip to the rail, using the normal wire escape geometry.
      const grid = document.presentation.grid;
      const tapPoint = {
        x: Math.round(point.x / grid) * grid,
        y: Math.round(point.y / grid) * grid,
      };
      const key = `${span.netId}:${tapPoint.x},${tapPoint.y}`;
      let junctionId = taps.get(key);
      if (!junctionId) {
        junctionId = deriveStableId(
          "junction",
          document.id,
          "rail-pin-tap",
          span.routeId,
          String(document.revision),
          key,
        );
        taps.set(key, junctionId);
        edits.push({
          kind: "add_junction",
          junctionId,
          netId: span.netId,
          position: tapPoint,
        });
      }
      if (tapPoint.x !== point.x || tapPoint.y !== point.y) {
        const pinNetId =
          pinNet && !mergedNetIds.has(pinNet.id) ? pinNet.id : span.netId;
        const lead = proposeWireCommit(
          {
            endpoint: { kind: "junction", junctionId },
            netId: span.netId,
            preludeEdits: [],
            connection: {
              endpoint: { kind: "junction", junctionId },
              contactPoint: tapPoint,
              gridLanding: tapPoint,
              escapePath: [],
              outward: null,
            },
          },
          { endpoint, netId: pinNetId, preludeEdits: [], connection },
          [],
          {
            routeId: deriveStableId("route", junctionId, endpointKey(endpoint)),
            newNetId: span.netId,
          },
        );
        edits.push(...lead.edits);
        if (pinNet && pinNet.id !== span.netId) mergedNetIds.add(pinNet.id);
      }
      endpointGroups.push([
        endpointKey(endpoint),
        endpointKey({ kind: "junction", junctionId }),
        ...span.endpoints.map(endpointKey),
      ]);
    }
  }
  return { edits, endpointGroups };
}
