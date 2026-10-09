// Pasted geometry moved by the paste offset, with its anchors and endpoints
// pointed at the copied objects.
import type {
  DraftingObject,
  Point,
  RouteEndpoint,
  VisualAnchor,
} from "@icm/model";

export function movePoint(point: Point, offset: Point): Point {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

export function remapPastedVisualAnchor(
  anchor: VisualAnchor,
  objectIds: ReadonlyMap<string, string>,
  routeIds: ReadonlyMap<string, string>,
  legIds: ReadonlyMap<string, string>,
  offset: Point,
  translateFree = false,
): VisualAnchor {
  if (anchor.kind === "free") {
    return translateFree
      ? { ...anchor, position: movePoint(anchor.position, offset) }
      : anchor;
  }
  if (anchor.kind === "object") {
    return {
      ...anchor,
      objectId: objectIds.get(anchor.objectId) ?? anchor.objectId,
      fallbackPosition: movePoint(anchor.fallbackPosition, offset),
    };
  }
  return {
    ...anchor,
    routeId: routeIds.get(anchor.routeId) ?? anchor.routeId,
    legId: legIds.get(anchor.legId) ?? anchor.legId,
    fallbackPosition: movePoint(anchor.fallbackPosition, offset),
  };
}

export function remapPastedDraftingAnchors(
  object: DraftingObject,
  objectIds: ReadonlyMap<string, string>,
  routeIds: ReadonlyMap<string, string>,
  legIds: ReadonlyMap<string, string>,
  offset: Point,
): DraftingObject {
  const clone = structuredClone(object);
  const remap = (anchor: VisualAnchor): VisualAnchor =>
    remapPastedVisualAnchor(anchor, objectIds, routeIds, legIds, offset);
  clone.anchor = remap(clone.anchor);
  if (clone.kind === "arrow") {
    clone.from = remap(clone.from);
    clone.to = remap(clone.to);
  } else if (clone.kind === "leader" || clone.kind === "callout") {
    // translateDraftingObject moves the primary anchor, while the leader tip
    // is independent geometry and still needs the paste offset here.
    clone.target = remapPastedVisualAnchor(
      clone.target,
      objectIds,
      routeIds,
      legIds,
      offset,
      true,
    );
  }
  return clone;
}

export function mapEndpoint(
  endpoint: RouteEndpoint,
  instanceIds: ReadonlyMap<string, string>,
  junctionIds: ReadonlyMap<string, string>,
): RouteEndpoint {
  switch (endpoint.kind) {
    case "terminal":
      return {
        ...endpoint,
        instanceId: instanceIds.get(endpoint.instanceId) ?? endpoint.instanceId,
      };
    case "junction":
      return {
        ...endpoint,
        junctionId: junctionIds.get(endpoint.junctionId) ?? endpoint.junctionId,
      };
  }
}
