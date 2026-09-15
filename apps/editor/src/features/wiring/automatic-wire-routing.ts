import { visibleSymbolInkBounds } from "@icm/derived";
import {
  compileWireDraft,
  type WireCornerOrder,
  type WireDraftStep,
  type WireRoutingMode,
  type WireSource,
} from "@icm/edit-engine";
import {
  transformPoint,
  type Point,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

interface Candidate {
  points: Point[];
  collisions: number;
  length: number;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (result.at(-1) && samePoint(result.at(-1)!, point)) continue;
    result.push({ ...point });
    while (result.length >= 3) {
      const [a, b, c] = result.slice(-3);
      if (
        (a!.x === b!.x && b!.x === c!.x) ||
        (a!.y === b!.y && b!.y === c!.y)
      ) {
        result.splice(result.length - 2, 1);
      } else {
        break;
      }
    }
  }
  return result;
}

function segmentCrossesInterior(from: Point, to: Point, box: Rect): boolean {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  if (from.y === to.y) {
    if (from.y <= top || from.y >= bottom) return false;
    return (
      Math.max(Math.min(from.x, to.x), left) <
      Math.min(Math.max(from.x, to.x), right)
    );
  }
  if (from.x === to.x) {
    if (from.x <= left || from.x >= right) return false;
    return (
      Math.max(Math.min(from.y, to.y), top) <
      Math.min(Math.max(from.y, to.y), bottom)
    );
  }
  return false;
}

function pointOnPath(point: Point, path: readonly Point[]): boolean {
  return path.slice(0, -1).some((from, index) => {
    const to = path[index + 1]!;
    if (from.x === to.x && point.x === from.x) {
      return (
        point.y >= Math.min(from.y, to.y) && point.y <= Math.max(from.y, to.y)
      );
    }
    if (from.y === to.y && point.y === from.y) {
      return (
        point.x >= Math.min(from.x, to.x) && point.x <= Math.max(from.x, to.x)
      );
    }
    return false;
  });
}

function endpointOwner(source: WireSource): string | null {
  return source.endpoint.kind === "terminal"
    ? source.endpoint.instanceId
    : null;
}

function obstacleBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  from: WireSource,
  to: WireSource,
  baseline: readonly Point[],
): Rect[] {
  const endpointOwners = new Set(
    [endpointOwner(from), endpointOwner(to)].filter(
      (id): id is string => id !== null,
    ),
  );
  const clearance = document.presentation.grid;
  return document.instances.flatMap((instance) => {
    if (!instance.placement || endpointOwners.has(instance.id)) return [];
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) return [];
    const hiddenPins = new Set(resolved.variant?.hiddenPinNames ?? []);
    const baselineMakesContact = resolved.definition.pins
      .filter((pin) => !hiddenPins.has(pin.name))
      .map((pin) =>
        transformPoint(
          pin.at,
          instance.placement!.position,
          instance.placement!,
        ),
      )
      .some((point) => pointOnPath(point, baseline));
    // A line deliberately running through a visible pin is an electrical
    // contact. Preserve that existing contract instead of routing around it.
    if (baselineMakesContact) return [];

    const local = visibleSymbolInkBounds(
      resolved,
      instance.signalFlowParameters,
    );
    const corners = [
      { x: local.x, y: local.y },
      { x: local.x + local.width, y: local.y },
      { x: local.x, y: local.y + local.height },
      { x: local.x + local.width, y: local.y + local.height },
    ].map((point) =>
      transformPoint(point, instance.placement!.position, instance.placement!),
    );
    const xs = corners.map(({ x }) => x);
    const ys = corners.map(({ y }) => y);
    const left = Math.min(...xs) - clearance;
    const top = Math.min(...ys) - clearance;
    return [
      {
        x: left,
        y: top,
        width: Math.max(...xs) + clearance - left,
        height: Math.max(...ys) + clearance - top,
      },
    ];
  });
}

function score(
  points: readonly Point[],
  obstacles: readonly Rect[],
): Candidate {
  const collisions = obstacles.reduce(
    (total, box) =>
      total +
      (points
        .slice(0, -1)
        .some((from, index) =>
          segmentCrossesInterior(from, points[index + 1]!, box),
        )
        ? 1
        : 0),
    0,
  );
  const length = points.slice(0, -1).reduce((total, from, index) => {
    const to = points[index + 1]!;
    return total + Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  }, 0);
  return { points: [...points], collisions, length };
}

/**
 * Add a small automatic dogleg only for a fresh, automatic orthogonal wire.
 * Explicit corner order, 45-degree/free modes, and every user-fixed point are
 * left untouched. Candidate corridors sit one grid outside symbol ink and the
 * shortest collision-free candidate wins.
 */
export function automaticWireDraftSteps(
  document: SchematicDocument,
  resolver: SymbolResolver,
  from: WireSource,
  to: WireSource,
  steps: readonly WireDraftStep[],
  routingMode: WireRoutingMode,
  cornerOrder: WireCornerOrder,
): readonly WireDraftStep[] {
  if (
    steps.length > 0 ||
    routingMode !== "orthogonal" ||
    cornerOrder !== "auto"
  ) {
    return steps;
  }
  const start = from.connection.gridLanding;
  const end = to.connection.gridLanding;
  const baseline = compileWireDraft(
    from,
    to,
    [],
    routingMode,
    cornerOrder,
  ).points;
  const obstacles = obstacleBounds(document, resolver, from, to, baseline);
  if (obstacles.length === 0 || score(baseline, obstacles).collisions === 0) {
    return steps;
  }

  const paths: Point[][] = [
    simplify([start, { x: end.x, y: start.y }, end]),
    simplify([start, { x: start.x, y: end.y }, end]),
  ];
  for (const box of obstacles) {
    for (const x of [box.x, box.x + box.width]) {
      paths.push(simplify([start, { x, y: start.y }, { x, y: end.y }, end]));
    }
    for (const y of [box.y, box.y + box.height]) {
      paths.push(simplify([start, { x: start.x, y }, { x: end.x, y }, end]));
    }
  }

  const unique = new Map(paths.map((path) => [JSON.stringify(path), path]));
  const best = [...unique.values()]
    .map((path) => score(path, obstacles))
    .sort(
      (left, right) =>
        left.collisions - right.collisions ||
        left.length - right.length ||
        left.points.length - right.points.length,
    )[0];
  if (!best || best.collisions > 0) return steps;
  if (best.points.length <= 2) return steps;
  return best.points.slice(1, -1).map((point) => ({
    point,
    routingMode: "orthogonal" as const,
    cornerOrder: "auto" as const,
  }));
}
