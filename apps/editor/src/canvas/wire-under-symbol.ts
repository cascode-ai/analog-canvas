import {
  transformPoint,
  type DerivedPoint,
  type SchematicDocument,
  type SymbolLocalPoint,
} from "@icm/model";
import { resolveEndpointConnection } from "@icm/derived";
import type { ResolvedRouteGeometry } from "@icm/derived";
import type { ResolvedSymbol, SymbolResolver } from "@icm/symbols";

import { instanceVisibleHitBox } from "./instance-geometry";

export interface WireUnderSymbolWarning {
  routeId: string;
  instanceId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * How far inside a symbol's hit box a conductor must reach before it counts
 * as buried. Pin stems and wires skimming the outline are legitimate; a
 * wire crossing the artwork body is the drawing error being flagged.
 */
const BODY_CLEARANCE = 4;

const AXIS_EPSILON = 1e-6;

type CollisionRegion =
  | {
      kind: "box";
      box: { x: number; y: number; width: number; height: number };
    }
  | { kind: "convex-polygon"; points: readonly DerivedPoint[] };

interface PinLead {
  pinName: string;
  axis: "horizontal" | "vertical";
  contact: { x: number; y: number };
}

/**
 * Document-space lead lines of an instance's visible pins. A conductor that
 * rides one of these lines is the pin's own connection continued across the
 * body (the bias-rail-through-a-gate-row idiom), not a buried wire.
 */
function visiblePinLeads(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: SchematicDocument["instances"][number],
): PinLead[] {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return [];
  return resolved.definition.pins.flatMap((pin) => {
    if (pin.presentation.visibility === "implicit") return [];
    if (resolved.variant?.hiddenPinNames.includes(pin.name)) return [];
    const connection = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      instanceId: instance.id,
      pinName: pin.name,
    });
    if (!connection?.outward) return [];
    return [
      {
        pinName: pin.name,
        axis:
          connection.outward.x !== 0
            ? ("horizontal" as const)
            : ("vertical" as const),
        contact: connection.contactPoint,
      },
    ];
  });
}

/**
 * Whether a conductor segment is one pin's own connection drawn the
 * conventional way — a bias rail riding through a gate row. That holds only
 * when the segment rides exactly ONE of the instance's pin lead lines
 * (collinear with the lead and passing over its contact point) and the Net
 * of the route lists that pin as a terminal. Riding two leads of the same
 * instance means the wire tunnels between two of its terminals — a
 * shorted-through component that looks like a series insertion — and a
 * ridden pin the Net does not list is a component merely parked on a
 * foreign wire; both keep their warning. The original (unclipped) segment
 * is tested because contacts sit at the artwork edge, outside the deflated
 * body box.
 */
function segmentIsSingleConnectedPinRide(
  from: { x: number; y: number },
  to: { x: number; y: number },
  leads: readonly PinLead[],
  netTerminalPinNames: ReadonlySet<string>,
): boolean {
  const horizontal = Math.abs(from.y - to.y) <= AXIS_EPSILON;
  const vertical = Math.abs(from.x - to.x) <= AXIS_EPSILON;
  const ridden = leads.filter((lead) => {
    if (lead.axis === "horizontal" && horizontal) {
      return (
        Math.abs(from.y - lead.contact.y) <= AXIS_EPSILON &&
        lead.contact.x >= Math.min(from.x, to.x) - AXIS_EPSILON &&
        lead.contact.x <= Math.max(from.x, to.x) + AXIS_EPSILON
      );
    }
    if (lead.axis === "vertical" && vertical) {
      return (
        Math.abs(from.x - lead.contact.x) <= AXIS_EPSILON &&
        lead.contact.y >= Math.min(from.y, to.y) - AXIS_EPSILON &&
        lead.contact.y <= Math.max(from.y, to.y) + AXIS_EPSILON
      );
    }
    return false;
  });
  return ridden.length === 1 && netTerminalPinNames.has(ridden[0]!.pinName);
}

function clipSegmentToBox(
  from: { x: number; y: number },
  to: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  // Liang-Barsky parametric clip; works for any orientation. The box is
  // treated as OPEN along the axis a segment does not travel: a segment
  // lying exactly on a boundary line has zero penetration depth and is a
  // wire skimming the deflated envelope, not a buried one. Path-artwork
  // symbols fall back to their declaration viewBox, whose padding often
  // equals BODY_CLEARANCE, so the deflated edge lands exactly on the pin
  // contacts — a wire cornering at a pin must stay quiet.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t0 = 0;
  let t1 = 1;
  const edges: readonly [number, number][] = [
    [-dx, from.x - box.x],
    [dx, box.x + box.width - from.x],
    [-dy, from.y - box.y],
    [dy, box.y + box.height - from.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (t1 - t0 <= 1e-9) return null;
  return {
    from: { x: from.x + dx * t0, y: from.y + dy * t0 },
    to: { x: from.x + dx * t1, y: from.y + dy * t1 },
  };
}

/**
 * Read the deliberately small closed-path subset used by straight-edged
 * symbol bodies (`M x y L x y ... Z`). Curves and open decorative strokes
 * stay opaque and keep the conservative box fallback.
 */
function closedStraightPathPoints(data: string): SymbolLocalPoint[] | null {
  const tokenPattern =
    /[A-Za-z]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/gu;
  const tokens = data.match(tokenPattern) ?? [];
  const unsupported = data.replace(tokenPattern, "").replace(/[\s,]/gu, "");
  if (unsupported.length > 0 || tokens[0] !== "M") return null;

  const points: SymbolLocalPoint[] = [];
  let index = 1;
  const readPoint = (): SymbolLocalPoint | null => {
    const x = Number(tokens[index]);
    const y = Number(tokens[index + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    index += 2;
    return { x, y };
  };
  const first = readPoint();
  if (!first) return null;
  points.push(first);

  while (tokens[index] === "L") {
    index += 1;
    const point = readPoint();
    if (!point) return null;
    points.push(point);
  }
  if (
    tokens[index] !== "Z" ||
    index !== tokens.length - 1 ||
    points.length < 3
  ) {
    return null;
  }
  return points;
}

function signedPolygonArea(points: readonly SymbolLocalPoint[]): number {
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

function isConvexPolygon(points: readonly SymbolLocalPoint[]): boolean {
  let turn = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const c = points[(index + 2) % points.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= AXIS_EPSILON) continue;
    const direction = Math.sign(cross);
    if (turn !== 0 && direction !== turn) return false;
    turn = direction;
  }
  return turn !== 0 && Math.abs(signedPolygonArea(points)) > AXIS_EPSILON;
}

/** Clip a segment to a convex polygon inset by the body clearance. */
function clipSegmentToConvexPolygon(
  from: DerivedPoint,
  to: DerivedPoint,
  points: readonly DerivedPoint[],
): { from: DerivedPoint; to: DerivedPoint } | null {
  const area = signedPolygonArea(points);
  if (Math.abs(area) <= AXIS_EPSILON) return null;
  const orientation = Math.sign(area);
  let t0 = 0;
  let t1 = 1;

  for (let index = 0; index < points.length; index += 1) {
    const edgeFrom = points[index]!;
    const edgeTo = points[(index + 1) % points.length]!;
    const edgeX = edgeTo.x - edgeFrom.x;
    const edgeY = edgeTo.y - edgeFrom.y;
    const edgeLength = Math.hypot(edgeX, edgeY);
    if (edgeLength <= AXIS_EPSILON) continue;
    const signedDistance = (point: DerivedPoint) =>
      (orientation *
        (edgeX * (point.y - edgeFrom.y) - edgeY * (point.x - edgeFrom.x))) /
      edgeLength;
    const startDistance = signedDistance(from);
    const distanceDelta = signedDistance(to) - startDistance;
    if (Math.abs(distanceDelta) <= AXIS_EPSILON) {
      if (startDistance <= BODY_CLEARANCE) return null;
      continue;
    }
    const crossing = (BODY_CLEARANCE - startDistance) / distanceDelta;
    if (distanceDelta > 0) t0 = Math.max(t0, crossing);
    else t1 = Math.min(t1, crossing);
    if (t1 - t0 <= 1e-9) return null;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return {
    from: { x: from.x + dx * t0, y: from.y + dy * t0 },
    to: { x: from.x + dx * t1, y: from.y + dy * t1 },
  };
}

function collisionRegions(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
): CollisionRegion[] {
  if (!instance.placement) return [];
  const hiddenParts = new Set(resolved.variant?.hiddenPrimitiveParts ?? []);
  const primitives = [
    ...resolved.definition.primitives,
    ...(resolved.variant?.additionalPrimitives ?? []),
  ].filter((primitive) => !primitive.part || !hiddenParts.has(primitive.part));
  // Adaptive Signal Flow frames are rendered from per-instance dimensions;
  // their authored path is only the default size, so retain the bounds path.
  const polygons = resolved.definition.formulaPresentation?.adaptiveFrame
    ? []
    : primitives.flatMap((primitive) => {
        if (primitive.kind !== "path") return [];
        const points = closedStraightPathPoints(primitive.data);
        if (!points || !isConvexPolygon(points)) return [];
        return [
          {
            kind: "convex-polygon" as const,
            points: points.map((point) =>
              transformPoint(
                point,
                instance.placement!.position,
                instance.placement!,
              ),
            ),
          },
        ];
      });
  if (polygons.length > 0) return polygons;

  const box = instanceVisibleHitBox(instance, resolved);
  if (!box) return [];
  const deflated = {
    x: box.x + BODY_CLEARANCE,
    y: box.y + BODY_CLEARANCE,
    width: box.width - BODY_CLEARANCE * 2,
    height: box.height - BODY_CLEARANCE * 2,
  };
  return deflated.width > 0 && deflated.height > 0
    ? [{ kind: "box", box: deflated }]
    : [];
}

function clipSegmentToRegion(
  from: DerivedPoint,
  to: DerivedPoint,
  region: CollisionRegion,
): { from: DerivedPoint; to: DerivedPoint } | null {
  return region.kind === "box"
    ? clipSegmentToBox(from, to, region.box)
    : clipSegmentToConvexPolygon(from, to, region.points);
}

/**
 * Conductor spans buried under symbol artwork. Escape leads (a pin's own
 * derived stem), bulk-dashed presentation, and spans riding exactly one pin
 * lead that the route's Net lists as a terminal are exempt; everything else
 * that crosses the inset body region of any placed instance is reported so
 * the editor can paint a warning over the covered span. Closed straight-edged
 * bodies use their real polygon rather than the empty corners of a bounding
 * box; opaque or curved artwork keeps the conservative box fallback.
 */
export function deriveWireUnderSymbolWarnings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  records: readonly {
    route: SchematicDocument["routes"][number];
    geometry: ResolvedRouteGeometry;
  }[],
): WireUnderSymbolWarning[] {
  const targets = document.instances.flatMap((instance) => {
    if (!instance.placement) return [];
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) return [];
    const regions = collisionRegions(instance, resolved);
    return regions.length > 0
      ? [
          {
            instanceId: instance.id,
            regions,
            leads: visiblePinLeads(document, resolver, instance),
          },
        ]
      : [];
  });
  if (targets.length === 0) return [];

  const warnings: WireUnderSymbolWarning[] = [];
  for (const { route, geometry } of records) {
    if (route.presentation === "bulk-dashed") continue;
    const net = document.nets.find((candidate) => candidate.id === route.netId);
    const netPinNamesByInstance = new Map<string, Set<string>>();
    for (const terminal of net?.terminals ?? []) {
      const names = netPinNamesByInstance.get(terminal.instanceId) ?? new Set();
      names.add(terminal.pinName);
      netPinNamesByInstance.set(terminal.instanceId, names);
    }
    const noPins: ReadonlySet<string> = new Set();
    for (const segment of geometry.segments) {
      if (segment.mode === "escape") continue;
      for (const { instanceId, regions, leads } of targets) {
        if (
          segmentIsSingleConnectedPinRide(
            segment.from,
            segment.to,
            leads,
            netPinNamesByInstance.get(instanceId) ?? noPins,
          )
        ) {
          continue;
        }
        const clipped = regions
          .map((region) =>
            clipSegmentToRegion(segment.from, segment.to, region),
          )
          .find((candidate) => candidate !== null);
        if (!clipped) continue;
        warnings.push({
          routeId: route.id,
          instanceId,
          from: clipped.from,
          to: clipped.to,
        });
      }
    }
  }
  return warnings;
}
