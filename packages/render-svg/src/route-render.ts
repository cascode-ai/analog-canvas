/**
 * Route paint beside the conductor ink: direction arrows, the miter bridges
 * that join strokes at pins and Junctions, and No Connect marks.
 */
import { objectStyleProfile, resolveEndpointPoint } from "@icm/derived";
import type { EndpointJoin, SchematicStyleProfile } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { escapeXml, pointList } from "./svg-markup.js";

export function renderRouteDirectionArrow(
  centerline: ReadonlyArray<{ x: number; y: number }>,
  placement: "middle" | "end" | undefined,
  color: string,
  profile: SchematicStyleProfile,
): string {
  if (!placement || centerline.length < 2) return "";
  const segments = centerline.slice(1).flatMap((to, index) => {
    const from = centerline[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    return length > 0 ? [{ from, to, dx, dy, length }] : [];
  });
  const totalLength = segments.reduce(
    (sum, segment) => sum + segment.length,
    0,
  );
  if (totalLength === 0) return "";
  const targetDistance = placement === "end" ? totalLength : totalLength / 2;
  let traversed = 0;
  let selected = segments.at(-1)!;
  for (const segment of segments) {
    // At an exact bend, use the incoming segment so the arrow head remains
    // entirely on the already-drawn conductor instead of projecting backward
    // from the outgoing segment into empty space.
    if (targetDistance <= traversed + segment.length) {
      selected = segment;
      break;
    }
    traversed += segment.length;
  }
  if (placement === "end") traversed = totalLength - selected.length;
  const distanceOnSegment = Math.min(
    selected.length,
    Math.max(0, targetDistance - traversed),
  );
  const ratio = distanceOnSegment / selected.length;
  const tip = {
    x: selected.from.x + selected.dx * ratio,
    y: selected.from.y + selected.dy * ratio,
  };
  const availableShaft = distanceOnSegment;
  const headLength = Math.min(
    profile.annotations.arrowHeadLength,
    availableShaft,
  );
  if (headLength <= 0) return "";
  const scale = headLength / profile.annotations.arrowHeadLength;
  const halfWidth = (profile.annotations.arrowHeadWidth * scale) / 2;
  const unitX = selected.dx / selected.length;
  const unitY = selected.dy / selected.length;
  const base = {
    x: tip.x - unitX * headLength,
    y: tip.y - unitY * headLength,
  };
  const normal = { x: -unitY, y: unitX };
  return `<polygon data-role="route-direction-arrow" data-arrow-position="${placement}" points="${pointList(
    [
      tip,
      {
        x: base.x + normal.x * halfWidth,
        y: base.y + normal.y * halfWidth,
      },
      {
        x: base.x - normal.x * halfWidth,
        y: base.y - normal.y * halfWidth,
      },
    ],
  )}" fill="${escapeXml(color)}" stroke="none" pointer-events="none"/>`;
}

/**
 * A No Connect declaration is electrical intent, not an editor-only hint.
 * Keep its mark in the formal scene so canvas rendering and SVG/PDF export
 * cannot disagree.  It is deliberately centred on the real endpoint rather
 * than offset along a lead: the declaration applies to that exact terminal or
 * port origin.
 */
export function renderNoConnectMarkers(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  objectIds?: ReadonlySet<string>,
): string {
  return [...document.noConnects]
    .filter((item) => !objectIds || objectIds.has(item.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap((noConnect) => {
      const point = resolveEndpointPoint(
        document,
        resolver,
        noConnect.endpoint,
      );
      if (!point) return [];
      const markProfile = objectStyleProfile(profile, noConnect);
      const halfExtent = Math.max(markProfile.strokes.normal * 3, 4);
      const strokeWidth = markProfile.strokes.normal;
      return [
        `<path data-object-id="${escapeXml(noConnect.id)}" data-role="no-connect" d="M ${point.x - halfExtent} ${point.y - halfExtent} L ${point.x + halfExtent} ${point.y + halfExtent} M ${point.x + halfExtent} ${point.y - halfExtent} L ${point.x - halfExtent} ${point.y + halfExtent}" fill="none" stroke="${markProfile.foreground}" stroke-width="${strokeWidth}" stroke-linecap="${markProfile.lineCap}"/>`,
      ];
    })
    .join("");
}

/**
 * Route topology always terminates at the exact electrical pin origin. Draw a
 * short path from inside a terminal lead, through the exact pin, into the
 * actual route segment. SVG then owns the sharp miter at the corner, removing
 * the separate-stroke anti-alias seam without adding route geometry.
 */
export function terminalMiterBridgePaths(
  joins: readonly EndpointJoin[],
  profile: SchematicStyleProfile,
): string[] {
  const overlap = Math.max(profile.strokes.wire, profile.strokes.symbol) * 0.75;
  return joins
    .filter(
      (join): join is Extract<EndpointJoin, { kind: "terminal-miter" }> =>
        join.kind === "terminal-miter",
    )
    .map(
      (join) =>
        `M ${join.at.x - join.pinOutward.x * overlap} ${join.at.y - join.pinOutward.y * overlap} L ${join.at.x} ${join.at.y} L ${join.at.x + join.routeDirection.x * overlap} ${join.at.y + join.routeDirection.y * overlap}`,
    );
}

/**
 * Any retained degree-two Junction is visually one dotless conductor even
 * when storage keeps two Route strokes (for example because an annotation or
 * constraint owns the Junction). Bridge the strokes through one SVG miter so
 * storage history cannot expose a butt-cap seam. A true branch has more than
 * two incident Route directions and therefore produces no recipe here.
 */
export function junctionMiterBridgePaths(
  joins: readonly EndpointJoin[],
  profileOf: (junctionId: string) => SchematicStyleProfile,
  strokeColors: ReadonlyMap<string, string>,
): Array<{ strokeColor: string; strokeWidth: number; d: string }> {
  return joins
    .filter(
      (join): join is Extract<EndpointJoin, { kind: "junction-miter" }> =>
        join.kind === "junction-miter",
    )
    .map((join) => {
      const profile = profileOf(join.junctionId);
      const overlap =
        Math.max(profile.strokes.wire, profile.strokes.symbol) * 0.75;
      const [first, second] = join.directions;
      return {
        strokeColor: strokeColors.get(join.junctionId) ?? profile.foreground,
        strokeWidth: profile.strokes.wire,
        d: `M ${join.at.x + first.x * overlap} ${join.at.y + first.y * overlap} L ${join.at.x} ${join.at.y} L ${join.at.x + second.x * overlap} ${join.at.y + second.y * overlap}`,
      };
    });
}
