import type { SchematicDocument } from "@icm/model";
import { resolveEndpointConnection } from "@icm/derived";
import type { ResolvedRouteGeometry } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

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
  // Liang-Barsky parametric clip; works for any orientation.
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
      if (q < 0) return null;
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
 * Conductor spans buried under symbol artwork. Escape leads (a pin's own
 * derived stem), bulk-dashed presentation, and spans riding exactly one pin
 * lead that the route's Net lists as a terminal are exempt; everything else
 * that crosses the deflated body box of any placed instance is reported so
 * the editor can paint a warning over the covered span.
 */
export function deriveWireUnderSymbolWarnings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  records: readonly {
    route: SchematicDocument["routes"][number];
    geometry: ResolvedRouteGeometry;
  }[],
): WireUnderSymbolWarning[] {
  const boxes = document.instances.flatMap((instance) => {
    if (!instance.placement) return [];
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    const box = resolved ? instanceVisibleHitBox(instance, resolved) : null;
    if (!box) return [];
    const deflated = {
      x: box.x + BODY_CLEARANCE,
      y: box.y + BODY_CLEARANCE,
      width: box.width - BODY_CLEARANCE * 2,
      height: box.height - BODY_CLEARANCE * 2,
    };
    return deflated.width > 0 && deflated.height > 0
      ? [
          {
            instanceId: instance.id,
            box: deflated,
            leads: visiblePinLeads(document, resolver, instance),
          },
        ]
      : [];
  });
  if (boxes.length === 0) return [];

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
      for (const { instanceId, box, leads } of boxes) {
        const clipped = clipSegmentToBox(segment.from, segment.to, box);
        if (!clipped) continue;
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
