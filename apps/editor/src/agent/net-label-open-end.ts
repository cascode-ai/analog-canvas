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
 * two-block DAC array were drawn over something. When the label's horizontal
 * segment ends open, the label stands at that end and reads away from the
 * wire, if it is clear there. Otherwise it keeps its spot. The Net Label tool
 * is unchanged: a person sees the preview where the label commits.
 *
 * `text` is what the label will read. Its name claim lands in the same
 * transaction, so the document cannot tell yet.
 */
export function netLabelAtOpenEnd(
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
  if (!route || !segment || segment.from.y !== segment.to.y) return label;
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
  if (!ends.length) return label;
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
  for (const t of ends) {
    const attachment = { ...anchor, t };
    const placed = resolveRouteAttachment(geometry, attachment);
    if (!placed) continue;
    const [at, other] = t
      ? [segment.to, segment.from]
      : [segment.from, segment.to];
    const candidate: Annotation = {
      ...label,
      alignment: at.x < other.x ? "end" : "start",
      anchor: {
        ...attachment,
        fallbackPosition: {
          x: Math.round(placed.labelPoint.x),
          y: Math.round(placed.labelPoint.y),
        },
      },
    };
    if (clear(candidate)) return candidate;
  }
  return label;
}
