import {
  resolveAnnotationPresentation,
  resolveDocumentStyleProfile,
  visibleSymbolLocalBounds,
  resolveRouteGeometry,
} from "../../derived/dist/index.js";
import { transformPoint } from "../../model/dist/index.js";

const overlaps = (a, b) =>
  a.x < b.x + b.width + 10 &&
  a.x + a.width + 10 > b.x &&
  a.y < b.y + b.height + 10 &&
  a.y + a.height + 10 > b.y;
const hitsObstacle = (a, b) =>
  a.x < b.x + b.width + 3 &&
  a.x + a.width + 3 > b.x &&
  a.y < b.y + b.height + 3 &&
  a.y + a.height + 3 > b.y;

// Bounded, deterministic search keeps labels near their original anchors.
export function separateLabels(doc, resolver, fixedIds = new Set()) {
  const profile = resolveDocumentStyleProfile(doc.presentation);
  const bounds = (a) =>
    resolveAnnotationPresentation(doc, resolver, a, profile).bounds;
  const obstacles = doc.instances.flatMap((i) => {
    const resolved = resolver.resolve(i.symbolId, i.symbolVariantId);
    if (!resolved || !i.placement) return [];
    const b = visibleSymbolLocalBounds(resolved, i.signalFlowParameters);
    const corners = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) =>
      transformPoint({ x, y }, i.placement.position, i.placement),
    );
    const xs = corners.map((p) => p.x),
      ys = corners.map((p) => p.y);
    return [
      {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
    ];
  });
  for (const route of doc.routes) {
    for (const { from, to } of resolveRouteGeometry(doc, resolver, route)
      ?.segments ?? [])
      obstacles.push({
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(from.x - to.x),
        height: Math.abs(from.y - to.y),
      });
  }
  const offsets = [];
  for (let x = -80; x <= 80; x += 10)
    for (let y = -80; y <= 80; y += 10) offsets.push({ x, y });
  offsets.sort(
    (a, b) =>
      a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y || a.y - b.y || a.x - b.x,
  );
  const changes = [];
  const annotations = doc.annotations
    .filter((a) => a.visible !== false)
    .sort(
      (a, b) =>
        Number(b.locked || fixedIds.has(b.id)) -
          Number(a.locked || fixedIds.has(a.id)) ||
        a.id.localeCompare(b.id, "en"),
    );
  const placed = [];
  // Only the current label moves during a candidate search. Reuse all other
  // bounds, updating one entry after its final position has been chosen.
  const currentBounds = new Map(annotations.map((a) => [a.id, bounds(a)]));
  for (const annotation of annotations) {
    const original = structuredClone(annotation.anchor);
    const box = currentBounds.get(annotation.id);
    const otherBounds = [...currentBounds]
      .filter(([id]) => id !== annotation.id)
      .map(([, b]) => b);
    if (
      !annotation.locked &&
      !fixedIds.has(annotation.id) &&
      (placed.some((b) => overlaps(box, b)) ||
        obstacles.some((b) => hitsObstacle(box, b)))
    ) {
      for (const offset of offsets) {
        annotation.anchor = structuredClone(original);
        const anchor = annotation.anchor;
        const point =
          anchor.kind === "free"
            ? anchor.position
            : anchor.kind === "object"
              ? anchor.localOffset
              : null;
        if (!point) break;
        point.x += offset.x;
        point.y += offset.y;
        if (anchor.kind === "object") {
          anchor.fallbackPosition.x += offset.x;
          anchor.fallbackPosition.y += offset.y;
        }
        // Reserve unmoved labels too, rather than pushing a collision along a chain.
        const candidate = bounds(annotation);
        if (
          !otherBounds.some((b) => overlaps(candidate, b)) &&
          !obstacles.some((b) => hitsObstacle(candidate, b))
        ) {
          changes.push({
            id: annotation.id,
            before: original,
            after: structuredClone(anchor),
          });
          break;
        }
        annotation.anchor = structuredClone(original);
      }
    }
    const finalBounds = bounds(annotation);
    currentBounds.set(annotation.id, finalBounds);
    placed.push(finalBounds);
  }
  return changes;
}
