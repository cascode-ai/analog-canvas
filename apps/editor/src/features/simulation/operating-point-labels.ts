import {
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
  visibleSymbolInkBounds,
} from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

/**
 * Where operating-point voltages go on the canvas.
 *
 * A DC operating point produces one number per node, and a real circuit has
 * dozens. Painting all of them destroys the drawing they are annotating —
 * the schematic stops being readable exactly when the author is trying to
 * read it. Painting none of them makes the result useless at a glance.
 *
 * The rule here uses a signal the author already gave us: **a net they took
 * the trouble to name is a net they care about.** Named nets carry their
 * voltage permanently; everything else answers on demand, when the net is
 * selected or hovered. A deliberate "all" mode stays available for the moment
 * someone genuinely wants the full picture and accepts the clutter.
 *
 * This adds no label where the author has not already accepted one, and it
 * scales: a sixty-node circuit typically names five or ten nets.
 */
export type OperatingPointDisplay = "named" | "all";

export interface OperatingPointLabel {
  netId: string;
  /** What to call the net out loud; its name when it has one. */
  netLabel: string;
  /** Formatted voltage, already carrying its unit. */
  text: string;
  at: Point;
  /** Why this label is on screen, so the view can style transient ones. */
  reason: "named" | "selected" | "hovered" | "all";
}

/**
 * Node voltages in volts, keyed by Base Net id. The simulator reports node
 * names; mapping those back to Net ids belongs to the result adapter, not
 * here, so this module stays independent of any simulator's spelling.
 */
export type NodeVoltages = ReadonlyMap<string, number>;

/**
 * Engineering notation with a fixed significant width, so a column of
 * voltages lines up and a millivolt-scale node does not read as "0.00 V".
 */
export function formatNodeVoltage(volts: number): string {
  const magnitude = Math.abs(volts);
  if (magnitude === 0) return "0 V";
  if (magnitude < 1e-6) return `${(volts * 1e9).toPrecision(3)} nV`;
  if (magnitude < 1e-3) return `${(volts * 1e6).toPrecision(3)} µV`;
  if (magnitude < 1) return `${(volts * 1e3).toPrecision(3)} mV`;
  if (magnitude < 1e3) return `${volts.toPrecision(4)} V`;
  return `${(volts / 1e3).toPrecision(3)} kV`;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * What is already drawn and must not be covered: symbol artwork, and the
 * labels the author placed. Text has no measured width here — the canvas has
 * no measurement pass — so a label is treated as a modest box around its
 * anchor. Under-estimating is the safe direction: a badge that clears a
 * generous box certainly clears the real glyphs.
 */
function occupiedRects(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Rect[] {
  const rects: Rect[] = [];
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const ink = visibleSymbolInkBounds(resolved, instance.signalFlowParameters);
    // Ink bounds are symbol-local; the placement translates them. Rotation is
    // ignored deliberately: a rotated bounding box is at most the same size
    // swapped, and the inflation below already covers that error.
    rects.push({
      x: instance.placement.position.x + ink.x - 4,
      y: instance.placement.position.y + ink.y - 4,
      width: ink.width + 8,
      height: ink.height + 8,
    });
  }
  for (const annotation of document.annotations) {
    const anchor = annotation.anchor;
    const at =
      anchor.kind === "free"
        ? anchor.position
        : anchor.kind === "object" || anchor.kind === "route"
          ? anchor.fallbackPosition
          : null;
    if (!at) continue;
    rects.push({ x: at.x - 26, y: at.y - 10, width: 52, height: 20 });
  }
  return rects;
}

const BADGE_HEIGHT = 13;
const BADGE_LIFT = 17;

function badgeRect(at: Point, text: string): Rect {
  const width = text.length * 6.2 + 6;
  return {
    x: at.x - width / 2,
    y: at.y - BADGE_LIFT,
    width,
    height: BADGE_HEIGHT,
  };
}

/**
 * Candidate anchors for one net's badge, best first.
 *
 * The first choice is the midpoint of the longest horizontal conductor: text
 * sits beside a horizontal wire without crossing it. What follows are the
 * same point flipped below the wire, then the other segment midpoints, so a
 * badge that would land on artwork has somewhere to go instead of covering
 * it. Falls back to a junction, so a net with any geometry gets an anchor.
 */
function netAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
  netId: string,
): Point[] {
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  const midpoints: { at: Point; length: number; horizontal: boolean }[] = [];
  const segments: { from: Point; to: Point }[] = [];
  for (const route of geometry.routes.values()) {
    if (route.netId !== netId) continue;
    for (const segment of route.segments) {
      const dx = segment.to.x - segment.from.x;
      const dy = segment.to.y - segment.from.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      segments.push({ from: segment.from, to: segment.to });
      midpoints.push({
        at: {
          x: (segment.from.x + segment.to.x) / 2,
          y: (segment.from.y + segment.to.y) / 2,
        },
        length,
        horizontal: Math.abs(dy) < Math.abs(dx),
      });
    }
  }
  midpoints.sort((left, right) =>
    left.horizontal === right.horizontal
      ? right.length - left.length
      : left.horizontal
        ? -1
        : 1,
  );
  const candidates: Point[] = [];
  for (const midpoint of midpoints) {
    candidates.push(midpoint.at);
    // Same spot, badge hanging below the conductor instead of above it.
    candidates.push({ x: midpoint.at.x, y: midpoint.at.y + BADGE_LIFT + 10 });
  }
  // Then slide along each conductor. A badge that has to move stays on the
  // wire it describes rather than drifting into blank page, so the reader
  // never has to work out which conductor a number belongs to.
  for (const segment of segments) {
    for (const fraction of [0.25, 0.75, 0.12, 0.88]) {
      const on = {
        x: segment.from.x + (segment.to.x - segment.from.x) * fraction,
        y: segment.from.y + (segment.to.y - segment.from.y) * fraction,
      };
      candidates.push(on);
      candidates.push({ x: on.x, y: on.y + BADGE_LIFT + 10 });
    }
  }
  if (candidates.length === 0) {
    const junction = document.junctions.find(
      (candidate) => candidate.netId === netId,
    );
    if (junction) candidates.push(junction.position);
  }
  return candidates;
}

export interface OperatingPointLabelInput {
  document: SchematicDocument;
  resolver: SymbolResolver;
  voltages: NodeVoltages;
  display: OperatingPointDisplay;
  selectedNetIds?: readonly string[];
  hoveredNetId?: string | null;
}

/** The badges to paint, in a deterministic order. */
export function operatingPointLabels({
  document,
  resolver,
  voltages,
  display,
  selectedNetIds = [],
  hoveredNetId = null,
}: OperatingPointLabelInput): readonly OperatingPointLabel[] {
  const logical = resolveDocumentLogicalNets(document);
  const selected = new Set(selectedNetIds);
  const labels: OperatingPointLabel[] = [];
  // Artwork and author labels are fixed; each badge placed also becomes an
  // obstacle, so badges do not stack on each other either.
  const obstacles = occupiedRects(document, resolver);
  for (const [netId, volts] of voltages) {
    const name = logical.byBaseNetId.get(netId)?.name;
    // Order matters: an explicit "all" is the author asking for everything,
    // and a net they pointed at should read as pointed-at even when named.
    const reason: OperatingPointLabel["reason"] | null =
      hoveredNetId === netId
        ? "hovered"
        : selected.has(netId)
          ? "selected"
          : name
            ? "named"
            : display === "all"
              ? "all"
              : null;
    if (!reason) continue;
    const text = formatNodeVoltage(volts);
    const candidates = netAnchors(document, resolver, netId);
    if (candidates.length === 0) continue;
    // First candidate that covers nothing. If every one collides the badge
    // still appears, at its best position: a voltage the author asked for is
    // more useful slightly crowded than missing without explanation.
    const at =
      candidates.find(
        (candidate) =>
          !obstacles.some((rect) => overlaps(badgeRect(candidate, text), rect)),
      ) ?? candidates[0]!;
    obstacles.push(badgeRect(at, text));
    labels.push({
      netId,
      netLabel: name ?? netId,
      text,
      at,
      reason,
    });
  }
  return labels.sort((left, right) => left.netId.localeCompare(right.netId));
}
