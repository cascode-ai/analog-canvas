import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import { findRouteSegmentsAtPoint } from "./route-query.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import { SEGMENT_EPSILON } from "./segment-geometry.js";
import { buildDocumentSpatialIndex } from "./spatial-index.js";
import { createLargePerformanceFixture } from "./test-support/large-performance-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * `findRouteSegmentsAtPoint` accepts an optional broad phase. Its soundness
 * requires a conservative candidate set for the cross/dot-product tolerance.
 * Short segments need special handling, not a fixed-distance box. This pins
 * the indexed answer to the scanned one, including at the tolerance boundary —
 * the case a widened-by-too-little query would silently drop.
 */
describe("indexed route-segment query", () => {
  it("preserves short, diagonal, degenerate and endpoint-extension matches", () => {
    for (const [dx, dy] of [
      [0.1, 0],
      [0, 0.1],
      [0.1, 0.1],
      [2, 2],
      [0, 0],
    ]) {
      const d = createEmptyDocument("short", "Short geometry");
      // Derived symbol contacts can be fractional, unlike authored grid bends.
      d.junctions = [
        { id: "a", netId: "n", position: { x: 0, y: 0 }, role: "branch" },
        { id: "b", netId: "n", position: { x: dx!, y: dy! }, role: "branch" },
      ];
      d.routes = [
        createRoutePath({
          id: "r",
          netId: "n",
          start: { kind: "junction", junctionId: "a" },
          end: { kind: "junction", junctionId: "b" },
          bends: [],
          modes: ["manual"],
        }),
      ];
      const g = resolveDocumentRoutingGeometry(d, resolver);
      const index = buildDocumentSpatialIndex(d, g);
      const length = Math.hypot(dx!, dy!);
      for (const t of [0, 0.5, 1]) {
        for (const sign of [-1, 1]) {
          for (const scale of [0, 0.5, 0.99, 1.01, 4]) {
            const offset = (sign * scale * SEGMENT_EPSILON) / (length || 1);
            for (const direction of [
              [dx!, dy!],
              [-dy!, dx!],
            ]) {
              const p = {
                x: dx! * t + (direction[0]! * offset) / (length || 1),
                y: dy! * t + (direction[1]! * offset) / (length || 1),
              };
              expect(findRouteSegmentsAtPoint(g, p, index)).toEqual(
                findRouteSegmentsAtPoint(g, p),
              );
            }
          }
        }
      }
      if (dx === 0.1 && dy === 0) {
        const p = { x: 0.05, y: 5e-9 };
        expect(findRouteSegmentsAtPoint(g, p)).toHaveLength(1);
        expect(findRouteSegmentsAtPoint(g, p, index)).toEqual(
          findRouteSegmentsAtPoint(g, p),
        );
      }
      const { shortRouteSegments: _omitted, ...legacyIndex } = index;
      expect(findRouteSegmentsAtPoint(g, { x: 0, y: 0 }, legacyIndex)).toEqual(
        findRouteSegmentsAtPoint(g, { x: 0, y: 0 }),
      );
    }
  });
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
