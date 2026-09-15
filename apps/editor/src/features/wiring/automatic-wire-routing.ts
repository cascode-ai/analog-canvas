import { resolveRouteGeometry, visibleSymbolInkBounds } from "@icm/derived";
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

interface Obstacle {
  instanceId: string;
  box: Rect;
}

type Axis = "horizontal" | "vertical";

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

function cardinalOutward(source: WireSource): Point | null {
  const outward = source.connection.outward;
  if (!outward) return null;
  if (
    (outward.x === 0 && Math.abs(outward.y) === 1) ||
    (outward.y === 0 && Math.abs(outward.x) === 1)
  ) {
    return outward;
  }
  return null;
}

function splitRouteAxis(
  document: SchematicDocument,
  resolver: SymbolResolver,
  source: WireSource,
): Axis | null {
  const split = source.preludeEdits.find(
    (edit) => edit.kind === "add_junction" && edit.split,
  );
  if (split?.kind !== "add_junction" || !split.split) return null;
  const route = document.routes.find(
    (candidate) => candidate.id === split.split!.routeId,
  );
  if (!route) return null;
  const segment = resolveRouteGeometry(
    document,
    resolver,
    route,
  )?.segments.find(({ address }) => address.legId === split.split!.legId);
  if (!segment) return null;
  if (segment.from.y === segment.to.y) return "horizontal";
  if (segment.from.x === segment.to.x) return "vertical";
  return null;
}

function obstacleBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  from: WireSource,
  to: WireSource,
  baseline: readonly Point[],
): Obstacle[] {
  const endpointOwners = new Set(
    [endpointOwner(from), endpointOwner(to)].filter(
      (id): id is string => id !== null,
    ),
  );
  const clearance = document.presentation.grid;
  return document.instances.flatMap((instance) => {
    if (!instance.placement) return [];
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
    if (!endpointOwners.has(instance.id) && baselineMakesContact) return [];

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
        instanceId: instance.id,
        box: {
          x: left,
          y: top,
          width: Math.max(...xs) + clearance - left,
          height: Math.max(...ys) + clearance - top,
        },
      },
    ];
  });
}

function escapePoint(
  source: WireSource,
  owner: Obstacle | undefined,
  grid: number,
): Point {
  const point = source.connection.gridLanding;
  const outward = cardinalOutward(source);
  if (!outward) return point;
  if (!owner) {
    return { x: point.x + outward.x * grid, y: point.y + outward.y * grid };
  }

  const { box } = owner;
  const edge =
    outward.x < 0
      ? box.x
      : outward.x > 0
        ? box.x + box.width
        : outward.y < 0
          ? box.y
          : box.y + box.height;
  const coordinate = outward.x === 0 ? point.y : point.x;
  const signedDistance = (edge - coordinate) * (outward.x || outward.y);
  const cells = Math.max(1, Math.ceil((signedDistance - 1e-9) / grid));
  return {
    x: point.x + outward.x * cells * grid,
    y: point.y + outward.y * cells * grid,
  };
}

function routingEscapePoints(
  document: SchematicDocument,
  resolver: SymbolResolver,
  source: WireSource,
  owner: Obstacle | undefined,
): Point[] {
  const point = source.connection.gridLanding;
  if (cardinalOutward(source)) {
    return [escapePoint(source, owner, document.presentation.grid)];
  }
  const routeAxis = splitRouteAxis(document, resolver, source);
  const grid = document.presentation.grid;
  if (routeAxis === "horizontal") {
    return [
      { x: point.x, y: point.y - grid },
      { x: point.x, y: point.y + grid },
    ];
  }
  if (routeAxis === "vertical") {
    return [
      { x: point.x - grid, y: point.y },
      { x: point.x + grid, y: point.y },
    ];
  }
  return [point];
}

function leavesTerminalOutward(
  from: Point,
  to: Point,
  source: WireSource,
): boolean {
  const outward = cardinalOutward(source);
  return Boolean(
    outward && (to.x - from.x) * outward.x + (to.y - from.y) * outward.y > 0,
  );
}

function entersTerminalFromOutward(
  from: Point,
  to: Point,
  target: WireSource,
): boolean {
  const outward = cardinalOutward(target);
  return Boolean(
    outward && (from.x - to.x) * outward.x + (from.y - to.y) * outward.y > 0,
  );
}

function segmentAxis(from: Point, to: Point): Axis | null {
  if (from.y === to.y && from.x !== to.x) return "horizontal";
  if (from.x === to.x && from.y !== to.y) return "vertical";
  return null;
}

function baselineRespectsEndpoint(
  document: SchematicDocument,
  resolver: SymbolResolver,
  points: readonly Point[],
  source: WireSource,
  atStart: boolean,
): boolean {
  if (points.length < 2) return true;
  const segmentFrom = atStart ? points[0]! : points.at(-2)!;
  const segmentTo = atStart ? points[1]! : points.at(-1)!;
  const outward = cardinalOutward(source);
  if (outward) {
    return atStart
      ? leavesTerminalOutward(segmentFrom, segmentTo, source)
      : entersTerminalFromOutward(segmentFrom, segmentTo, source);
  }
  const routeAxis = splitRouteAxis(document, resolver, source);
  const approachAxis = segmentAxis(segmentFrom, segmentTo);
  return !routeAxis || !approachAxis || routeAxis !== approachAxis;
}

function score(
  points: readonly Point[],
  obstacles: readonly Obstacle[],
  from: WireSource,
  to: WireSource,
): Candidate {
  const fromOwner = endpointOwner(from);
  const toOwner = endpointOwner(to);
  const lastSegment = points.length - 2;
  const collisions = obstacles.reduce(
    (total, obstacle) =>
      total +
      (points.slice(0, -1).some((segmentFrom, index) => {
        const segmentTo = points[index + 1]!;
        const allowedSourceEscape =
          obstacle.instanceId === fromOwner &&
          index === 0 &&
          leavesTerminalOutward(segmentFrom, segmentTo, from);
        const allowedTargetEscape =
          obstacle.instanceId === toOwner &&
          index === lastSegment &&
          entersTerminalFromOutward(segmentFrom, segmentTo, to);
        return (
          !allowedSourceEscape &&
          !allowedTargetEscape &&
          segmentCrossesInterior(segmentFrom, segmentTo, obstacle.box)
        );
      })
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

function joinPathParts(...parts: readonly (readonly Point[])[]): Point[] {
  const result: Point[] = [];
  for (const part of parts) {
    for (const point of part) {
      if (!result.at(-1) || !samePoint(result.at(-1)!, point)) {
        result.push({ ...point });
      }
    }
  }
  return result;
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
  const baselineIsClear = score(baseline, obstacles, from, to).collisions === 0;
  const baselineApproachIsValid =
    baselineRespectsEndpoint(document, resolver, baseline, from, true) &&
    baselineRespectsEndpoint(document, resolver, baseline, to, false);
  if (baselineIsClear && baselineApproachIsValid) {
    return steps;
  }

  const sourceEscapes = routingEscapePoints(
    document,
    resolver,
    from,
    obstacles.find(({ instanceId }) => instanceId === endpointOwner(from)),
  );
  const targetEscapes = routingEscapePoints(
    document,
    resolver,
    to,
    obstacles.find(({ instanceId }) => instanceId === endpointOwner(to)),
  );

  const grid = document.presentation.grid;
  const paths: Point[][] = [];
  for (const sourceEscape of sourceEscapes) {
    for (const targetEscape of targetEscapes) {
      const corePaths: Point[][] = [
        simplify([
          sourceEscape,
          { x: targetEscape.x, y: sourceEscape.y },
          targetEscape,
        ]),
        simplify([
          sourceEscape,
          { x: sourceEscape.x, y: targetEscape.y },
          targetEscape,
        ]),
      ];
      for (const { box } of obstacles) {
        for (const x of [
          Math.floor(box.x / grid) * grid,
          Math.ceil((box.x + box.width) / grid) * grid,
        ]) {
          corePaths.push(
            simplify([
              sourceEscape,
              { x, y: sourceEscape.y },
              { x, y: targetEscape.y },
              targetEscape,
            ]),
          );
        }
        for (const y of [
          Math.floor(box.y / grid) * grid,
          Math.ceil((box.y + box.height) / grid) * grid,
        ]) {
          corePaths.push(
            simplify([
              sourceEscape,
              { x: sourceEscape.x, y },
              { x: targetEscape.x, y },
              targetEscape,
            ]),
          );
        }
      }
      paths.push(
        ...corePaths.map((core) =>
          joinPathParts([start, sourceEscape], core, [targetEscape, end]),
        ),
      );
    }
  }

  const unique = new Map(paths.map((path) => [JSON.stringify(path), path]));
  const best = [...unique.values()]
    .map((path) => score(path, obstacles, from, to))
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
