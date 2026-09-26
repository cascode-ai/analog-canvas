import type { Annotation, Point, Rect, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  isSchematicAnnotationVisible,
  resolveAnnotationPresentation,
  type AnnotationPresentation,
} from "./annotation-presentation.js";
import { resolveDocumentLogicalNets } from "./logical-net.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import {
  buildBoundsSpatialIndex,
  buildDocumentSpatialIndex,
} from "./spatial-index.js";
import { resolveDocumentStyleProfile } from "./style-profile.js";
import { visibleInstanceBounds, type VisualDiagnostic } from "./visual.js";

/** One bounded read model shared by optional arrangement and Agent observations. */
export function createLabelClearanceContext(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const style = resolveDocumentStyleProfile(document.presentation);
  const routing = resolveDocumentRoutingGeometry(document, resolver);
  const logical = resolveDocumentLogicalNets(document);
  const grid = document.presentation.grid;
  const visible = document.annotations.filter((a) =>
    isSchematicAnnotationVisible(document, a, logical),
  );
  const measurements = new WeakMap<Annotation, AnnotationPresentation>();
  const measure = (annotation: Annotation) => {
    let measured = measurements.get(annotation);
    if (!measured) {
      measured = resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        style,
        routing,
        logical,
      );
      measurements.set(annotation, measured);
    }
    return measured;
  };
  const labels = new Map(visible.map((a) => [a.id, measure(a).bounds]));
  const symbols = visibleInstanceBounds(document, resolver);
  const symbolIndex = buildBoundsSpatialIndex(
    symbols.map((s) => ({ bounds: s.bounds, value: s })),
    grid * 8,
  );
  const labelIndex = buildBoundsSpatialIndex(
    [...labels].map(([id, bounds]) => ({ bounds, value: id })),
    grid * 8,
  );
  const segments = buildDocumentSpatialIndex(document, routing).routeSegments;
  // A handful of accepted moves in this pass. Avoid rebuilding all geometry
  // for each candidate, and ignore stale index entries for already moved text.
  const moved = new Map<string, Rect>();
  const conflicts = (annotation: Annotation) => {
    const box = measure(annotation).bounds;
    const ids = new Set<string>();
    for (const symbol of symbolIndex.queryBounds(box))
      if (overlap(box, symbol.bounds)) ids.add(symbol.id);
    for (const id of labelIndex.queryBounds(box))
      if (
        id !== annotation.id &&
        !moved.has(id) &&
        overlap(box, labels.get(id)!)
      )
        ids.add(id);
    for (const [id, bounds] of moved)
      if (id !== annotation.id && overlap(box, bounds)) ids.add(id);
    for (const segment of segments.queryBounds(box))
      if (segmentCrossesBox(segment.from, segment.to, box))
        ids.add(segment.routeId);
    return [...ids].sort();
  };
  return {
    visible,
    symbols,
    measure,
    conflicts,
    accept: (a: Annotation) => moved.set(a.id, measure(a).bounds),
  };
}

/** Informational only; never part of GUI gestures or transaction acceptance. */
export function diagnoseLabelClearance(
  document: SchematicDocument,
  resolver: SymbolResolver,
): VisualDiagnostic[] {
  if (!document.annotations.some((a) => a.visible !== false)) return [];
  const context = createLabelClearanceContext(document, resolver);
  const owners = new Map(context.symbols.map((s) => [s.id, s.bounds]));
  const obstacles = new Set([
    ...owners.keys(),
    ...document.routes.map((r) => r.id),
  ]);
  return context.visible.flatMap((annotation) => {
    const bounds = context.measure(annotation).bounds;
    // Label/label overlap already has a clustered visual diagnostic.
    const conflicts = context
      .conflicts(annotation)
      .filter((id) => obstacles.has(id));
    const ownerId =
      annotation.anchor.kind === "object"
        ? annotation.anchor.objectId
        : undefined;
    const owner = ownerId ? owners.get(ownerId) : undefined;
    const gap = owner ? rectangleGap(bounds, owner) : 0;
    const maxGap = document.presentation.grid * 8;
    const diagnostics: VisualDiagnostic[] = [];
    if (conflicts.length)
      diagnostics.push({
        code: "VISUAL_LABEL_CLEARANCE",
        severity: "info",
        category: "observation",
        confidence: "low",
        gateEligible: false,
        message:
          "Measured label bounds intersect Symbol ink bounds or a wire; visual review may be useful",
        objectIds: [annotation.id, ...conflicts],
        bounds,
        parameters: { conflictingObjectCount: conflicts.length },
      });
    if (owner && gap > maxGap)
      diagnostics.push({
        code: "VISUAL_LABEL_OWNER_DISTANCE",
        severity: "info",
        category: "observation",
        confidence: "low",
        gateEligible: false,
        message:
          "Attached label is far from its owner; this may be intentional",
        objectIds: [annotation.id, ownerId!],
        bounds,
        parameters: { gap, reviewThreshold: maxGap },
      });
    return diagnostics;
  });
}

function overlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
function rectangleGap(a: Rect, b: Rect): number {
  return Math.hypot(
    Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
  );
}
/** Clip any straight segment, including diagonal wires, to the open box. */
function segmentCrossesBox(from: Point, to: Point, box: Rect): boolean {
  let lo = 0,
    hi = 1;
  for (const [start, end, min, max] of [
    [from.x, to.x, box.x, box.x + box.width],
    [from.y, to.y, box.y, box.y + box.height],
  ] as const) {
    const delta = end - start;
    if (delta === 0) {
      if (start <= min || start >= max) return false;
    } else {
      const a = (min - start) / delta,
        b = (max - start) / delta;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
      if (lo >= hi) return false;
    }
  }
  return lo < hi;
}
