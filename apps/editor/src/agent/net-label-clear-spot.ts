import {
  createLabelClearanceContext,
  resolveRouteAttachment,
  type ResolvedRouteGeometry,
} from "@icm/derived";
import {
  routeEndpoints,
  type Annotation,
  type RichTextDocument,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

/**
 * Where an Agent's new upright Net Label stands when the spot its point gave
 * is not clear of parts, wires and other labels. Centred on a stub two grid
 * steps out of a block's pin, a label reached back into the block, and one
 * with a subscript reached the stub of the pin above: all 12 labels of a
 * two-block DAC array were drawn over something. When the label's segment
 * ends open, the label stands at that end, if it is clear there: reading
 * away from a horizontal wire, and beside a vertical one as before. A
 * transmission gate's S̄ beside the stub below its NMOS gate had reached up
 * into the NMOS.
 *
 * Otherwise the label slides along its segment, a grid step at a time, to
 * the clear spot nearest the one it was given. In a beta-multiplier
 * reference, the vbn label given by M1's drain stood at the middle of the
 * vbn wire, where the startup's wire crosses it, and read struck through.
 * Where nothing is clear it keeps its spot. The Net Label tool is unchanged:
 * a person sees the preview where the label commits.
 *
 * `text` is what the label will read. Its name claim lands in the same
 * transaction, so the document cannot tell yet.
 */
export function netLabelAtClearSpot(
  document: SchematicDocument,
  resolver: SymbolResolver,
  label: Annotation,
  text: RichTextDocument,
  geometry: ResolvedRouteGeometry,
): Annotation {
  const anchor = label.anchor;
  if (anchor.kind !== "route" || label.rotation !== 0) return label;
  const route = document.routes.find(({ id }) => id === anchor.routeId);
  const index = geometry.segments.findIndex(
    ({ address }) => address.legId === anchor.legId,
  );
  const segment = geometry.segments[index];
  if (!route || !segment) return label;
  const vertical = segment.from.x === segment.to.x;
  if (!vertical && segment.from.y !== segment.to.y) return label;
  const context = createLabelClearanceContext(document, resolver);
  const clear = (candidate: Annotation) => {
    const ink = context.measure({
      ...candidate,
      formatOverride: text,
    }).inkBounds;
    return (
      !context.conflictsAt(ink, candidate.id).length &&
      !context.dotsAt(ink).length
    );
  };
  if (clear(label)) return label;
  const at = (
    t: number,
    alignment: Annotation["alignment"],
  ): Annotation | null => {
    const attachment = { ...anchor, t };
    const placed = resolveRouteAttachment(geometry, attachment);
    return placed
      ? {
          ...label,
          alignment,
          anchor: {
            ...attachment,
            fallbackPosition: {
              x: Math.round(placed.labelPoint.x),
              y: Math.round(placed.labelPoint.y),
            },
          },
        }
      : null;
  };

  const [start, end] = routeEndpoints(route);
  const open = (endpoint: typeof start) =>
    endpoint.kind === "junction" &&
    document.routes
      .flatMap((candidate) => routeEndpoints(candidate))
      .filter(
        (other) =>
          other.kind === "junction" && other.junctionId === endpoint.junctionId,
      ).length === 1;
  const ends = [
    ...(index === 0 && open(start) ? [0] : []),
    ...(index === geometry.segments.length - 1 && open(end) ? [1] : []),
  ].sort((a, b) => Math.abs(a - anchor.t) - Math.abs(b - anchor.t));
  for (const t of ends) {
    const [from, other] = t
      ? [segment.to, segment.from]
      : [segment.from, segment.to];
    const candidate = at(
      t,
      vertical ? label.alignment : from.x < other.x ? "end" : "start",
    );
    if (candidate && clear(candidate)) return candidate;
  }

  const length = Math.hypot(
    segment.to.x - segment.from.x,
    segment.to.y - segment.from.y,
  );
  const step = document.presentation.grid / length;
  for (let distance = step; distance < 1; distance += step)
    for (const t of [anchor.t - distance, anchor.t + distance]) {
      if (t <= 0 || t >= 1) continue;
      const candidate = at(t, label.alignment);
      if (candidate && clear(candidate)) return candidate;
    }
  return label;
}
