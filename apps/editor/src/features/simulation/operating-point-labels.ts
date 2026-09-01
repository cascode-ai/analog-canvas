import {
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
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

/**
 * A stable, readable anchor for one net's badge: the midpoint of its longest
 * horizontal conductor, because text sits beside a horizontal wire without
 * crossing it. Falls back to the longest segment of any orientation, then to
 * any junction, so a net always gets an anchor if it has any geometry at all.
 */
function netAnchor(
  document: SchematicDocument,
  resolver: SymbolResolver,
  netId: string,
): Point | null {
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  let best: { at: Point; length: number; horizontal: boolean } | null = null;
  for (const route of geometry.routes.values()) {
    if (route.netId !== netId) continue;
    for (const segment of route.segments) {
      const dx = segment.to.x - segment.from.x;
      const dy = segment.to.y - segment.from.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const horizontal = Math.abs(dy) < Math.abs(dx);
      const better =
        best === null ||
        (horizontal && !best.horizontal) ||
        (horizontal === best.horizontal && length > best.length);
      if (!better) continue;
      best = {
        at: {
          x: (segment.from.x + segment.to.x) / 2,
          y: (segment.from.y + segment.to.y) / 2,
        },
        length,
        horizontal,
      };
    }
  }
  if (best) return best.at;
  const junction = document.junctions.find(
    (candidate) => candidate.netId === netId,
  );
  return junction ? junction.position : null;
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
    const at = netAnchor(document, resolver, netId);
    if (!at) continue;
    labels.push({
      netId,
      netLabel: name ?? netId,
      text: formatNodeVoltage(volts),
      at,
      reason,
    });
  }
  return labels.sort((left, right) => left.netId.localeCompare(right.netId));
}
