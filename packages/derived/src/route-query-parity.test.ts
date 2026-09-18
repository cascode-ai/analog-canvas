import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { findRouteSegmentsAtPoint } from "./route-query.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import { SEGMENT_EPSILON } from "./segment-geometry.js";
import { buildDocumentSpatialIndex } from "./spatial-index.js";
import { createLargePerformanceFixture } from "./test-support/large-performance-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * `findRouteSegmentsAtPoint` accepts an optional broad phase. Its soundness
 * rests on one argument: `pointOnSegment` accepts a point up to
 * `SEGMENT_EPSILON` outside a segment's bounding box, so the box query is
 * widened by exactly that much before the exact predicate decides. This pins
 * the indexed answer to the scanned one, including at the tolerance boundary —
 * the case a widened-by-too-little query would silently drop.
 */
describe("indexed route-segment query", () => {
  const project = createLargePerformanceFixture(resolver);
  const document = project.documents[0]!;
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  const spatialIndex = buildDocumentSpatialIndex(document, geometry);

  /** Every point worth asking about, plus the tolerance boundary around them. */
  const points = (() => {
    const samples: { x: number; y: number }[] = [];
    for (const route of geometry.routes.values()) {
      for (const segment of route.segments) {
        const midX = (segment.from.x + segment.to.x) / 2;
        const midY = (segment.from.y + segment.to.y) / 2;
        samples.push(segment.from, segment.to, { x: midX, y: midY });
        // Just inside and just outside the default tolerance, perpendicular.
        const dx = segment.to.y - segment.from.y;
        const dy = segment.from.x - segment.to.x;
        const length = Math.hypot(dx, dy);
        if (length === 0) continue;
        const unitX = dx / length;
        const unitY = dy / length;
        for (const offset of [
          SEGMENT_EPSILON / 2,
          SEGMENT_EPSILON * 0.99,
          SEGMENT_EPSILON * 1.01,
          SEGMENT_EPSILON * 4,
        ]) {
          samples.push({
            x: midX + unitX * offset,
            y: midY + unitY * offset,
          });
        }
      }
    }
    // Strictly off the drawing too, so an empty answer is covered.
    for (let step = 0; step < 64; step += 1) {
      samples.push({ x: -4000 + step * 137, y: -3000 + step * 91 });
    }
    return samples;
  })();

  it("answers exactly what the full scan answers", () => {
    expect(points.length).toBeGreaterThan(1000);
    for (const point of points) {
      expect(
        findRouteSegmentsAtPoint(geometry, point, spatialIndex),
        `point ${point.x},${point.y}`,
      ).toStrictEqual(findRouteSegmentsAtPoint(geometry, point));
    }
  }, 60_000);

  it("finds at least one segment, so the comparison is not vacuous", () => {
    const onSegment = points.filter(
      (point) => findRouteSegmentsAtPoint(geometry, point).length > 0,
    );
    expect(onSegment.length).toBeGreaterThan(100);
  });

  it("refuses a spatial index built for another revision", () => {
    const stale = { ...document, revision: document.revision + 1 };
    const staleIndex = buildDocumentSpatialIndex(
      stale,
      resolveDocumentRoutingGeometry(stale, resolver),
    );
    expect(() =>
      findRouteSegmentsAtPoint(geometry, { x: 0, y: 0 }, staleIndex),
    ).toThrow(/stale spatial index/u);
  });
});
