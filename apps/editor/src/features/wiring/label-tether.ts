import {
  derivePowerRailComponent,
  resolveEndpointConnection,
  resolveRouteAttachment,
} from "@icm/derived";
import type {
  ResolvedDocumentLogicalNets,
  ResolvedDocumentRoutingGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import { routeEnd, transformPoint } from "@icm/model";
import type {
  Annotation,
  Point,
  Rect,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { clamp, closestPointOnSegment } from "../../canvas/canvas-geometry";
import {
  annotationAnchor,
  annotationHitBox,
  closestNetConductorPoint,
  closestRoutePoint,
  instanceHitBox,
  type RouteGeometryRecord,
} from "./route-interaction-geometry";

/**
 * A selected label's line to what it belongs to: a Net Label to its wire, a
 * pin's name to the pin, a part's name or value to the part. Once parts move,
 * a label can end up nearer another part than its own; the line settles it.
 */
export interface LabelTether {
  annotationId: string;
  kind: "wire" | "pin" | "part";
  /** The object whose drag carries the far end: a Route, Junction or part. */
  ownerId: string | null;
  /** The near end, on the label's text box. */
  label: Point;
  /** The far end: the wire tap, the pin, or the part's nearest edge. */
  target: Point;
}

export interface LabelTetherContext {
  document: SchematicDocument;
  resolver: SymbolResolver;
  styleProfile: SchematicStyleProfile;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  routingGeometry?: ResolvedDocumentRoutingGeometry;
  logicalNets?: ResolvedDocumentLogicalNets;
}

function nearestOnRect(rect: Rect, point: Point): Point {
  return {
    x: clamp(point.x, rect.x, rect.x + rect.width),
    y: clamp(point.y, rect.y, rect.y + rect.height),
  };
}

const endpointJunctionId = (endpoint: RouteEndpoint) =>
  endpoint.kind === "junction" ? endpoint.junctionId : null;

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The labels a lone selected part names: its name, value and pin name. */
export function labelsOwnedBy(
  document: SchematicDocument,
  instanceId: string,
): string[] {
  return document.annotations
    .filter(
      (annotation) =>
        (annotation.kind === "instance-label" ||
          annotation.kind === "instance-value" ||
          annotation.kind === "power-label") &&
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === instanceId &&
        annotation.visible !== false,
    )
    .map((annotation) => annotation.id);
}

function wireTarget(
  context: LabelTetherContext,
  annotation: Annotation,
  label: Point,
): { target: Point; ownerId: string | null } | null {
  const anchor = annotation.anchor;
  if (anchor.kind === "route") {
    const record = context.routeGeometryRecords.find(
      (candidate) => candidate.route.id === anchor.routeId,
    );
    const attachment = record
      ? resolveRouteAttachment(record.geometry, anchor)
      : null;
    if (attachment)
      return { target: attachment.conductorPoint, ownerId: anchor.routeId };
  }
  const netId =
    annotation.netId ??
    (annotation.binding?.kind === "net-name"
      ? annotation.binding.netId
      : undefined);
  const conductor = netId
    ? closestNetConductorPoint(context.routeGeometryRecords, netId, label)
    : null;
  return conductor ? { target: conductor, ownerId: null } : null;
}

/**
 * Where a pin's name points: the mark that reads as the pin, near the label.
 * A Pin's circle, a VDD marker's bar, or a rail's own thick line — not the
 * end of a lead or of a rail where a wire happens to join.
 */
function pinTarget(
  context: LabelTetherContext,
  objectId: string,
  label: Point,
): Point | null {
  const junction = context.document.junctions.find(
    (candidate) => candidate.id === objectId,
  );
  if (junction) {
    // A rail's name hangs on a Junction at its end; it points at the rail.
    const rail = context.document.routes.find(
      (route) =>
        route.presentation === "power-rail" &&
        route.netId === junction.netId &&
        (endpointJunctionId(route.start) === junction.id ||
          endpointJunctionId(routeEnd(route)) === junction.id),
    );
    const railRoutes = rail
      ? new Set(
          derivePowerRailComponent(context.document, rail.id)?.routeIds ?? [],
        )
      : null;
    return (
      (railRoutes &&
        closestRoutePoint(context.routeGeometryRecords, label, (route) =>
          railRoutes.has(route.id),
        )) ??
      junction.position
    );
  }
  const instance = context.document.instances.find(
    (candidate) => candidate.id === objectId,
  );
  const definition = instance
    ? context.resolver.resolve(instance.symbolId, instance.symbolVariantId)
        ?.definition
    : undefined;
  const pins = definition?.pins;
  if (!instance || pins?.length !== 1) return null;
  const placed = (point: Point) =>
    transformPoint(point, instance.placement!.position, instance.placement!);
  if (instance.placement) {
    // A Pin is drawn as a small circle on a short lead: its name points at
    // the circle, the Pin as it reads.
    const circle = definition?.primitives.find(
      (primitive) => primitive.kind === "circle",
    );
    if (circle?.kind === "circle") return placed(circle.center);
    // A VDD marker is a Pin too, drawn as a bar on a stem: its name points
    // at the nearest point along the bar.
    const bar = definition?.primitives.find(
      (primitive) =>
        primitive.kind === "polygon" && primitive.fill === "foreground",
    );
    if (bar?.kind === "polygon") {
      const xs = bar.points.map((point) => point.x);
      const ys = bar.points.map((point) => point.y);
      const [minX, maxX, minY, maxY] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
      ];
      const across = maxX - minX >= maxY - minY;
      const middle = across ? (minY + maxY) / 2 : (minX + maxX) / 2;
      return closestPointOnSegment(
        label,
        placed(across ? { x: minX, y: middle } : { x: middle, y: minY }),
        placed(across ? { x: maxX, y: middle } : { x: middle, y: maxY }),
      );
    }
  }
  return (
    resolveEndpointConnection(context.document, context.resolver, {
      kind: "terminal",
      instanceId: instance.id,
      pinName: pins[0]!.name,
    })?.contactPoint ?? null
  );
}

function tetherFor(
  context: LabelTetherContext,
  annotation: Annotation,
): LabelTether | null {
  const box = annotationHitBox(
    context.document,
    context.resolver,
    annotation,
    context.routeGeometryRecords,
    context.styleProfile,
    context.routingGeometry,
    context.logicalNets,
  );
  const reference = box
    ? center(box)
    : annotationAnchor(
        context.document,
        context.resolver,
        annotation,
        context.routeGeometryRecords,
        context.styleProfile,
      );
  const labelPoint = (target: Point) =>
    box ? nearestOnRect(box, target) : reference;
  const anchor = annotation.anchor;
  const objectId = anchor.kind === "object" ? anchor.objectId : null;
  const wire = (): LabelTether | null => {
    const found = wireTarget(context, annotation, reference);
    return found
      ? {
          annotationId: annotation.id,
          kind: "wire",
          ownerId: found.ownerId,
          label: labelPoint(found.target),
          target: found.target,
        }
      : null;
  };
  if (annotation.kind === "net-label") return wire();
  if (
    annotation.kind === "power-label" ||
    (annotation.kind === "instance-label" &&
      annotation.binding?.kind === "cell-terminal-name")
  ) {
    const target = objectId ? pinTarget(context, objectId, reference) : null;
    if (!target) return annotation.kind === "power-label" ? wire() : null;
    return {
      annotationId: annotation.id,
      kind: "pin",
      ownerId: objectId,
      label: labelPoint(target),
      target,
    };
  }
  if (!objectId) return null;
  if (
    annotation.kind !== "instance-label" &&
    annotation.kind !== "instance-value"
  )
    return null;
  const instance = context.document.instances.find(
    (candidate) => candidate.id === objectId,
  );
  const body = instance ? instanceHitBox(instance, context.resolver) : null;
  if (!body) return null;
  const target = nearestOnRect(body, reference);
  return {
    annotationId: annotation.id,
    kind: "part",
    ownerId: objectId,
    label: labelPoint(target),
    target,
  };
}

/** One tether per label that has something to point at. */
export function resolveLabelTethers(
  context: LabelTetherContext,
  annotationIds: readonly string[],
): LabelTether[] {
  const wanted = new Set(annotationIds);
  return context.document.annotations.flatMap((annotation) => {
    if (!wanted.has(annotation.id) || annotation.visible === false) return [];
    const tether = tetherFor(context, annotation);
    return tether ? [tether] : [];
  });
}
