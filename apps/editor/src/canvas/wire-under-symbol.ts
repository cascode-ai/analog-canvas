import type { SchematicDocument } from "@icm/model";
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
 * derived stem) and bulk-dashed presentation are exempt; everything else
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
      ? [{ instanceId: instance.id, box: deflated }]
      : [];
  });
  if (boxes.length === 0) return [];

  const warnings: WireUnderSymbolWarning[] = [];
  for (const { route, geometry } of records) {
    if (route.presentation === "bulk-dashed") continue;
    for (const segment of geometry.segments) {
      if (segment.mode === "escape") continue;
      for (const { instanceId, box } of boxes) {
        const clipped = clipSegmentToBox(segment.from, segment.to, box);
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
