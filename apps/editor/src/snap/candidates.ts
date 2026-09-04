import { resolveDraftingObjectGeometry } from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import type { Point, Rect, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { closestPointOnSegment } from "../canvas/canvas-geometry";
import { instanceVisibleHitBox } from "../canvas/instance-geometry";
import type { SnapAnchor, SnapTargetKind } from "./engine";

function boundsAnchors(prefix: string, bounds: Rect): SnapAnchor[] {
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  return [
    { id: `${prefix}:center`, point: center, kind: "instance-center" },
    {
      id: `${prefix}:left`,
      point: { x: bounds.x, y: center.y },
      kind: "instance-edge",
      axes: ["x"],
    },
    {
      id: `${prefix}:right`,
      point: { x: bounds.x + bounds.width, y: center.y },
      kind: "instance-edge",
      axes: ["x"],
    },
    {
      id: `${prefix}:top`,
      point: { x: center.x, y: bounds.y },
      kind: "instance-edge",
      axes: ["y"],
    },
    {
      id: `${prefix}:bottom`,
      point: { x: center.x, y: bounds.y + bounds.height },
      kind: "instance-edge",
      axes: ["y"],
    },
  ];
}

function endpointKind(source: WireSource): SnapTargetKind {
  switch (source.endpoint.kind) {
    case "terminal":
      return "pin";
    case "junction":
      return "junction";
  }
}

export function endpointSnapAnchor(source: WireSource): SnapAnchor {
  const endpointId =
    source.endpoint.kind === "terminal"
      ? `${source.endpoint.instanceId}:${source.endpoint.pinName}`
      : source.endpoint.junctionId;
  return {
    id: `endpoint:${source.endpoint.kind}:${endpointId}`,
    point: source.connection.contactPoint,
    kind: endpointKind(source),
    electrical: {
      kind: "endpoint",
      endpoint: source.endpoint,
      netId: source.netId,
    },
  };
}

function draftingGeometryPoints(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: NonNullable<SchematicDocument["drafting"]>["objects"][number],
): Point[] {
  const geometry = resolveDraftingObjectGeometry(document, resolver, object);
  switch (geometry.kind) {
    case "text":
    case "floating-symbol":
      return [geometry.position];
    case "arrow":
      return geometry.vertices;
    case "leader":
      return [geometry.anchor, geometry.target];
    case "callout":
      return [geometry.textPosition, geometry.target];
    case "construction-line":
      return geometry.vertices;
    case "rectangle":
      return [geometry.center, ...geometry.corners];
    case "circle":
      return [
        geometry.center,
        { x: geometry.center.x + geometry.radius, y: geometry.center.y },
        { x: geometry.center.x - geometry.radius, y: geometry.center.y },
        { x: geometry.center.x, y: geometry.center.y + geometry.radius },
        { x: geometry.center.x, y: geometry.center.y - geometry.radius },
      ];
  }
}

export function buildDraftingAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
  objectIds?: ReadonlySet<string>,
): SnapAnchor[] {
  return (document.drafting?.objects ?? []).flatMap((object) => {
    if (objectIds && !objectIds.has(object.id)) return [];
    return draftingGeometryPoints(document, resolver, object).map(
      (point, index): SnapAnchor => ({
        id: `drafting:${object.id}:${index}`,
        point,
        kind: "drafting",
      }),
    );
  });
}

export function buildRectangleEdgeSnapAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
): SnapAnchor[] {
  const fractions = [
    { id: "quarter", value: 1 / 4 },
    { id: "third", value: 1 / 3 },
    { id: "center", value: 1 / 2 },
    { id: "two-thirds", value: 2 / 3 },
    { id: "three-quarters", value: 3 / 4 },
  ] as const;
  return (document.drafting?.objects ?? []).flatMap((object) => {
    if (object.kind !== "rectangle") return [];
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    if (geometry.kind !== "rectangle") return [];
    return geometry.corners.flatMap((corner, index): SnapAnchor[] => {
      const next = geometry.corners[(index + 1) % geometry.corners.length]!;
      return fractions.map(({ id, value }) => ({
        id: `drafting:${object.id}:edge-${index}:${id}`,
        point: {
          x: corner.x + (next.x - corner.x) * value,
          y: corner.y + (next.y - corner.y) * value,
        },
        kind: "drafting",
      }));
    });
  });
}

function quadraticPoint(
  from: Point,
  control: Point,
  to: Point,
  t: number,
): Point {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

/** Exact point on a quadratic selected through a bounded one-dimensional search. */
function closestPointOnQuadratic(
  point: Point,
  from: Point,
  control: Point,
  to: Point,
): Point {
  const distanceSquared = (t: number): number => {
    const candidate = quadraticPoint(from, control, to, t);
    return (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
  };
  const samples = 24;
  let best = 0;
  for (let index = 1; index <= samples; index += 1) {
    if (distanceSquared(index / samples) < distanceSquared(best / samples))
      best = index;
  }
  let left = Math.max(0, (best - 1) / samples);
  let right = Math.min(1, (best + 1) / samples);
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const first = left + (right - left) / 3;
    const second = right - (right - left) / 3;
    if (distanceSquared(first) <= distanceSquared(second)) right = second;
    else left = first;
  }
  return quadraticPoint(from, control, to, (left + right) / 2);
}

/**
 * Pointer-local visual projections. They are transient coordinate candidates,
 * never persisted attachments or electrical contacts.
 */
export function buildDraftingProjectionSnapTargets(
  document: SchematicDocument,
  resolver: SymbolResolver,
  point: Point,
  excludedDraftingIds: ReadonlySet<string> = new Set(),
): SnapAnchor[] {
  const targets: SnapAnchor[] = [];
  const segment = (
    objectId: string,
    index: number,
    from: Point,
    to: Point,
    control?: Point | null,
  ): void => {
    targets.push({
      id: `drafting:${objectId}:projection-${index}`,
      point: control
        ? closestPointOnQuadratic(point, from, control, to)
        : closestPointOnSegment(point, from, to),
      kind: "drafting",
    });
  };
  for (const object of document.drafting?.objects ?? []) {
    if (excludedDraftingIds.has(object.id)) continue;
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    if (geometry.kind === "arrow" || geometry.kind === "construction-line") {
      for (let index = 0; index < geometry.vertices.length - 1; index += 1) {
        segment(
          object.id,
          index,
          geometry.vertices[index]!,
          geometry.vertices[index + 1]!,
          geometry.curveControls[index],
        );
      }
    } else if (geometry.kind === "rectangle") {
      for (let index = 0; index < geometry.corners.length; index += 1) {
        segment(
          object.id,
          index,
          geometry.corners[index]!,
          geometry.corners[(index + 1) % geometry.corners.length]!,
        );
      }
    } else if (geometry.kind === "circle") {
      const dx = point.x - geometry.center.x;
      const dy = point.y - geometry.center.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        targets.push({
          id: `drafting:${object.id}:projection-circle`,
          point: {
            x: geometry.center.x + (dx / length) * geometry.radius,
            y: geometry.center.y + (dy / length) * geometry.radius,
          },
          kind: "drafting",
        });
      }
    } else if (geometry.kind === "leader") {
      segment(object.id, 0, geometry.anchor, geometry.target);
    } else if (geometry.kind === "callout") {
      segment(object.id, 0, geometry.textPosition, geometry.target);
    }
  }
  return targets;
}

export function buildInstanceAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
  visibleEndpoints: readonly WireSource[],
  instanceIds: ReadonlySet<string>,
): SnapAnchor[] {
  const geometryAnchors = document.instances.flatMap((instance) => {
    if (!instanceIds.has(instance.id) || !instance.placement) return [];
    return buildInstanceGeometryAnchors(instance, resolver);
  });
  const electricalAnchors = visibleEndpoints
    .filter(
      (source) =>
        source.endpoint.kind === "terminal" &&
        instanceIds.has(source.endpoint.instanceId),
    )
    .map(endpointSnapAnchor);
  return [...geometryAnchors, ...electricalAnchors];
}

function buildInstanceGeometryAnchors(
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver,
): SnapAnchor[] {
  if (!instance.placement) return [];
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return [];
  const bounds = instanceVisibleHitBox(instance, resolved);
  return [
    {
      id: `instance:${instance.id}:origin`,
      point: instance.placement.position,
      kind: "instance-center" as const,
    },
    ...(bounds ? boundsAnchors(`instance:${instance.id}`, bounds) : []),
  ];
}

export function buildSceneSnapTargets(
  document: SchematicDocument,
  resolver: SymbolResolver,
  visibleEndpoints: readonly WireSource[],
  excludedInstanceIds: ReadonlySet<string> = new Set(),
  excludedDraftingIds: ReadonlySet<string> = new Set(),
): SnapAnchor[] {
  return sceneSnapTargetsExcluding(
    buildSceneSnapTargetIndex(document, resolver, visibleEndpoints),
    excludedInstanceIds,
    excludedDraftingIds,
  );
}

interface IndexedSceneSnapTarget {
  anchor: SnapAnchor;
  instanceId?: string;
  draftingId?: string;
}

/**
 * Revision-scoped snap geometry. Building visible bounds and drafting anchor
 * geometry is comparatively expensive, while a drag changes only its
 * exclusion set. The editor therefore builds this index once per Document
 * revision and filters the already-resolved anchors during pointer movement.
 */
export interface SceneSnapTargetIndex {
  readonly targets: readonly IndexedSceneSnapTarget[];
}

export function buildSceneSnapTargetIndex(
  document: SchematicDocument,
  resolver: SymbolResolver,
  visibleEndpoints: readonly WireSource[],
): SceneSnapTargetIndex {
  const targets: IndexedSceneSnapTarget[] = [];
  for (const instance of document.instances) {
    for (const anchor of buildInstanceGeometryAnchors(instance, resolver)) {
      targets.push({ anchor, instanceId: instance.id });
    }
  }
  for (const source of visibleEndpoints) {
    targets.push({
      anchor: endpointSnapAnchor(source),
      ...(source.endpoint.kind === "terminal"
        ? { instanceId: source.endpoint.instanceId }
        : {}),
    });
  }
  for (const object of document.drafting?.objects ?? []) {
    for (const [index, point] of draftingGeometryPoints(
      document,
      resolver,
      object,
    ).entries()) {
      const anchor: SnapAnchor = {
        id: `drafting:${object.id}:${index}`,
        point,
        kind: "drafting",
      };
      targets.push({ anchor, draftingId: object.id });
    }
  }
  return { targets };
}

export function sceneSnapTargetsExcluding(
  index: SceneSnapTargetIndex,
  excludedInstanceIds: ReadonlySet<string> = new Set(),
  excludedDraftingIds: ReadonlySet<string> = new Set(),
): SnapAnchor[] {
  return index.targets.flatMap((target) =>
    (target.instanceId && excludedInstanceIds.has(target.instanceId)) ||
    (target.draftingId && excludedDraftingIds.has(target.draftingId))
      ? []
      : [target.anchor],
  );
}
