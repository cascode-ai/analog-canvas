import type { Annotation, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { DocumentDerivedContext } from "./document-derived-context.js";

import {
  endpointKey,
  netEndpoints,
  resolveEndpointPoint,
  type EndpointObjectLookup,
} from "./endpoint.js";
import { resolveVisualAnchor } from "./anchor.js";
import { nearestRouteSegment } from "./route-query.js";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";

export interface ResolvedNetLabelBinding {
  annotationId: string;
  netId: string;
  routeId?: string;
  segmentIndex?: number;
  legId?: string;
  endpoint: RouteEndpoint;
}

interface NetLabelLookup extends Pick<
  DocumentDerivedContext,
  "netsById" | "routesById"
> {
  routesByPrimaryNetId?: DocumentDerivedContext["routesByNetId"];
  junctionsByNetId?: DocumentDerivedContext["junctionsByNetId"];
  junctionsById?: DocumentDerivedContext["junctionsById"];
  endpointLookup?: EndpointObjectLookup;
}

/**
 * Resolves the single accepted electrical meaning of a Net Label.
 *
 * `netId` is the electrical identity. `anchor` separately controls placement:
 * an explicit route anchor is exact, while a free/object anchor resolves to
 * the nearest routed component only for virtual-connectivity presentation.
 */
export function resolveNetLabelBinding(
  document: SchematicDocument,
  resolver: SymbolResolver,
  annotation: Annotation,
  routingGeometry: ResolvedDocumentRoutingGeometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
  ),
  lookup?: NetLabelLookup,
): ResolvedNetLabelBinding | null {
  if (
    (annotation.kind !== "net-label" && annotation.kind !== "power-label") ||
    !annotation.netId ||
    !(lookup
      ? lookup.netsById.has(annotation.netId)
      : document.nets.some((net) => net.id === annotation.netId))
  ) {
    return null;
  }
  const netId = annotation.netId;
  const anchor = annotation.anchor;
  if (anchor.kind === "route") {
    // A draft can repeat a Route ID. Its first matching Route on this Net wins.
    const route =
      lookup && lookup.routesById.size === document.routes.length
        ? lookup.routesById.get(anchor.routeId)
        : document.routes.find(
            (candidate) =>
              candidate.id === anchor.routeId && candidate.netId === netId,
          );
    if (route?.netId === netId) {
      return {
        annotationId: annotation.id,
        netId,
        routeId: route.id,
        legId: anchor.legId,
        segmentIndex: route.legs.findIndex((leg) => leg.id === anchor.legId),
        endpoint: route.start,
      };
    }
  }
  if (anchor.kind === "object") {
    const junction =
      lookup?.junctionsById?.size === document.junctions.length
        ? lookup.junctionsById.get(anchor.objectId)
        : document.junctions.find(
            (item) => item.id === anchor.objectId && item.netId === netId,
          );
    if (junction?.netId === netId) {
      return {
        annotationId: annotation.id,
        netId,
        endpoint: { kind: "junction", junctionId: junction.id },
      };
    }
  }
  const position = resolveVisualAnchor(
    document,
    resolver,
    annotation.anchor,
    routingGeometry,
  ).position;
  const routes = lookup?.routesByPrimaryNetId
    ? (lookup.routesByPrimaryNetId.get(netId) ?? [])
    : document.routes.filter((route) => route.netId === netId);
  const routeCandidates = routes
    .flatMap((route) => {
      const geometry = routingGeometry.routes.get(route.id);
      const hit = geometry ? nearestRouteSegment(geometry, position) : null;
      return hit
        ? [
            {
              distance: hit.distanceSquared,
              endpoint: route.start,
              routeId: route.id,
              legId: hit.address.legId,
              segmentIndex: hit.address.segmentIndex,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.routeId.localeCompare(right.routeId, "en") ||
        left.segmentIndex - right.segmentIndex,
    );
  const route = routeCandidates[0];
  if (route) {
    return {
      annotationId: annotation.id,
      netId,
      routeId: route.routeId,
      legId: route.legId,
      segmentIndex: route.segmentIndex,
      endpoint: route.endpoint,
    };
  }

  const net =
    lookup && lookup.netsById.size === document.nets.length
      ? lookup.netsById.get(netId)!
      : document.nets.find((candidate) => candidate.id === netId)!;
  const junctions = lookup?.junctionsByNetId
    ? (lookup.junctionsByNetId.get(netId) ?? [])
    : document.junctions;
  const endpoint = netEndpoints(document, net, junctions)
    .flatMap((candidate) => {
      const endpointPosition = resolveEndpointPoint(
        document,
        resolver,
        candidate,
        lookup?.endpointLookup,
      );
      return endpointPosition
        ? [
            {
              endpoint: candidate,
              distance:
                (position.x - endpointPosition.x) ** 2 +
                (position.y - endpointPosition.y) ** 2,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        endpointKey(left.endpoint).localeCompare(
          endpointKey(right.endpoint),
          "en",
        ),
    )[0]?.endpoint;
  return endpoint ? { annotationId: annotation.id, netId, endpoint } : null;
}

export function resolveNetLabelBindings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  netId: string,
  routingGeometry: ResolvedDocumentRoutingGeometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
  ),
): ResolvedNetLabelBinding[] {
  return document.annotations
    .flatMap((annotation) => {
      const binding = resolveNetLabelBinding(
        document,
        resolver,
        annotation,
        routingGeometry,
      );
      return binding?.netId === netId ? [binding] : [];
    })
    .sort((left, right) =>
      left.annotationId.localeCompare(right.annotationId, "en"),
    );
}
