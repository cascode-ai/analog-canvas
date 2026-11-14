import type { Point, Rect } from "@icm/model";

import type { FilledRegion } from "./drawing-scene.js";
import {
  intersectSegments,
  projectPointToSegment,
} from "./segment-geometry.js";

export function rectangleCorners({ x, y, width, height }: Rect): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

type Segment = Readonly<{ from: Point; to: Point }>;

/** Candidate points on the segment, to be checked by actual fill containment. */
export function regionSegmentEvidence(
  region: FilledRegion,
  { from, to }: Segment,
): Point[] {
  if (region.kind === "path") {
    const witness = region.segmentWitness(from, to);
    return witness ? [witness] : [];
  }
  if (region.kind === "circle") {
    const closest = projectPointToSegment(region.center, from, to);
    return closest ? [closest.point] : [];
  }
  const outline =
    region.kind === "polygon" ? region.points : rectangleCorners(region.bounds);
  const cuts = [0, 1];
  for (const [index, corner] of outline.entries()) {
    const next = outline[(index + 1) % outline.length];
    if (!next) continue;
    const intersection = intersectSegments(from, to, corner, next);
    if (!intersection) continue;
    const cut = projectPointToSegment(intersection.point, from, to)?.t;
    if (cut !== undefined) cuts.push(cut);
    if (intersection.kind === "overlap") {
      // Coincident edges contribute an interval, even if its first point
      // lies at one end of the original segment.
      for (const endpoint of [corner, next]) {
        const projection = projectPointToSegment(endpoint, from, to);
        if (projection) cuts.push(projection.t);
      }
    }
  }
  const unique = [...new Set(cuts)].sort((left, right) => left - right);
  return unique.slice(1).flatMap((end, index) => {
    const start = unique[index];
    if (start === undefined) return [];
    const middle = (start + end) / 2;
    return [
      {
        x: from.x + (to.x - from.x) * middle,
        y: from.y + (to.y - from.y) * middle,
      },
    ];
  });
}

/** A center and outline samples. Concave regions and holes still need containment checks. */
export function regionAreaEvidence(region: FilledRegion): Point[] {
  if (region.kind === "circle") {
    const {
      center: { x, y },
      radius,
    } = region;
    return [
      region.center,
      { x: x - radius, y },
      { x: x + radius, y },
      { x, y: y - radius },
      { x, y: y + radius },
    ];
  }
  const points =
    region.kind === "polygon" ? region.points : rectangleCorners(region.bounds);
  if (!points.length) return [];
  const sum = points.reduce(
    ({ x, y }, point) => ({ x: x + point.x, y: y + point.y }),
    { x: 0, y: 0 },
  );
  return [{ x: sum.x / points.length, y: sum.y / points.length }, ...points];
}
