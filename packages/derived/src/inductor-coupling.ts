// Coupled inductors: which drawn parts can be coupled, the names a new
// coupling takes, and where its polarity dots and curved arrow are drawn.
import { deviceRegistry } from "@icm/devices";
import { transformPoint } from "@icm/model";
import type {
  DerivedPoint as Point,
  InductorCoupling,
  Instance,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { arrowArtwork, type ArrowArtwork } from "./arrow-artwork.js";
import type { SchematicStyleProfile } from "./style-profile.js";

/** The plain two-pin inductors; T-coils and transformers couple themselves. */
export const COUPLABLE_INDUCTOR_SYMBOL_IDS: ReadonlySet<string> = new Set([
  "inductor",
  "inductor-compact",
  "variable-inductor",
]);

/** The two pins of a couplable inductor in netlist order, or null. */
export function couplableInductorPins(
  symbolId: string,
): readonly [string, string] | null {
  if (!COUPLABLE_INDUCTOR_SYMBOL_IDS.has(symbolId)) return null;
  const pins = deviceRegistry.bySymbolId(symbolId)?.pinOrder;
  return pins?.length === 2 ? [pins[0]!, pins[1]!] : null;
}

export function isCouplableInductor(
  instance: Pick<Instance, "symbolId">,
): boolean {
  return couplableInductorPins(instance.symbolId) !== null;
}

export function inductorCouplingsOf(
  document: Pick<SchematicDocument, "inductorCouplings">,
  instanceId: string,
): InductorCoupling[] {
  return (document.inductorCouplings ?? []).filter((coupling) =>
    coupling.members.some((member) => member.instanceId === instanceId),
  );
}

export function couplesInstances(
  coupling: InductorCoupling,
  first: string,
  second: string,
): boolean {
  const [a, b] = coupling.members;
  return (
    (a.instanceId === first && b.instanceId === second) ||
    (a.instanceId === second && b.instanceId === first)
  );
}

/** The next free `TFn`, compared without case as the model does. */
export function nextInductorCouplingName(
  taken: Iterable<string>,
  prefix = "TF",
): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  let index = 1;
  while (used.has(`${prefix}${index}`.toLowerCase())) index += 1;
  return `${prefix}${index}`;
}

/** A name kept unless taken; otherwise its stem with the next free number. */
export function uniqueInductorCouplingName(
  name: string,
  taken: Iterable<string>,
): string {
  const used = new Set([...taken].map((item) => item.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  return nextInductorCouplingName(used, name.replace(/\d+$/u, "") || "TF");
}

export const INDUCTOR_COUPLING_DOT_RADIUS = 2.2903;
// Beside the winding's first turn on the side away from its bumps, the way
// the transformer Symbol places its own dots.
const DOT_SIDE_OFFSET = 6;
const ARROW_GAP = 5;

export interface InductorCouplingDot {
  instanceId: string;
  pinName: string;
  center: Point;
  radius: number;
}

export interface ResolvedInductorCoupling {
  coupling: InductorCoupling;
  /** One per placed member. */
  dots: InductorCouplingDot[];
  /** Absent when hidden or when a member is not placed. */
  arrow?: {
    points: [Point, Point];
    control: Point;
    artwork: ArrowArtwork;
    label: {
      /** Baseline anchor of the italic name. */
      position: Point;
      anchor: "start" | "middle" | "end";
      base: string;
      subscript: string;
    };
  };
}

function dotFor(
  instance: Instance,
  pinName: string,
  resolver: SymbolResolver,
): InductorCouplingDot | null {
  const placement = instance.placement;
  if (!placement) return null;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  const pin = resolved?.definition.pins.find(
    (candidate) => candidate.name === pinName,
  );
  if (!pin) return null;
  // The couplable Symbols are drawn upright with their bumps to +x; go one
  // lead inward along the pin and step off to the other side.
  const inward = pin.direction === "north" ? 1 : -1;
  const lead = pin.presentation.leadLength ?? 10;
  const local = { x: pin.at.x - DOT_SIDE_OFFSET, y: pin.at.y + inward * lead };
  return {
    instanceId: instance.id,
    pinName,
    center: transformPoint(local, placement.position, placement),
    radius: INDUCTOR_COUPLING_DOT_RADIUS,
  };
}

/**
 * Where each coupling of the Document is drawn: a filled dot at each
 * inductor's dotted end and, unless hidden, a double-headed arrow bowing
 * between the dots with the coupling's name at its middle. Read from the
 * records, so it follows the inductors wherever they move.
 */
export function resolveInductorCouplingGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
): ResolvedInductorCoupling[] {
  const couplings = document.inductorCouplings ?? [];
  if (!couplings.length) return [];
  const instances = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  return couplings.map((coupling) => {
    const placed = coupling.members.map((member) => {
      const instance = instances.get(member.instanceId);
      return instance ? dotFor(instance, member.dotPin, resolver) : null;
    });
    const dots = placed.filter(
      (dot): dot is InductorCouplingDot => dot !== null,
    );
    const [first, second] = placed;
    if (coupling.arrow === false || !first || !second)
      return { coupling, dots };
    const dx = second.center.x - first.center.x;
    const dy = second.center.y - first.center.y;
    const length = Math.hypot(dx, dy);
    if (length < ARROW_GAP * 3) return { coupling, dots };
    const ux = dx / length;
    const uy = dy / length;
    const middle = {
      x: (first.center.x + second.center.x) / 2,
      y: (first.center.y + second.center.y) / 2,
    };
    // Bow away from the two inductors' bodies, so the arrow arcs over the
    // space beside them instead of across their windings.
    let nx = uy;
    let ny = -ux;
    const bodies = coupling.members.flatMap((member) => {
      const position = instances.get(member.instanceId)?.placement?.position;
      return position ? [position] : [];
    });
    const centre = {
      x: bodies.reduce((sum, point) => sum + point.x, 0) / bodies.length,
      y: bodies.reduce((sum, point) => sum + point.y, 0) / bodies.length,
    };
    if ((middle.x - centre.x) * nx + (middle.y - centre.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const bow = Math.min(length * 0.3, 60);
    const control = { x: middle.x + nx * bow, y: middle.y + ny * bow };
    const towards = (from: Point, to: Point): Point => {
      const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return {
        x: from.x + ((to.x - from.x) / distance) * ARROW_GAP,
        y: from.y + ((to.y - from.y) / distance) * ARROW_GAP,
      };
    };
    const points: [Point, Point] = [
      towards(first.center, control),
      towards(second.center, control),
    ];
    const artwork = arrowArtwork(
      { styleOverride: { arrowStart: "small-arrow", arrowEnd: "small-arrow" } },
      points,
      [control],
      profile,
    );
    // The curve's own middle, then a little further out for the label.
    const apex = {
      x: 0.25 * points[0].x + 0.5 * control.x + 0.25 * points[1].x,
      y: 0.25 * points[0].y + 0.5 * control.y + 0.25 * points[1].y,
    };
    const match = /^(.*?)(\d+)$/u.exec(coupling.name);
    const fontSize = profile.typography.annotationFontSize;
    const gap = fontSize * 0.4;
    const anchor = nx > 0.5 ? "start" : nx < -0.5 ? "end" : "middle";
    // Beside the curve on its outer side: above it, below it (one line
    // lower, since text hangs above its baseline) or level with it.
    const lift =
      anchor !== "middle" ? fontSize * 0.35 : ny > 0 ? fontSize * 0.8 : 0;
    return {
      coupling,
      dots,
      arrow: {
        points,
        control,
        artwork,
        label: {
          position: { x: apex.x + nx * gap, y: apex.y + ny * gap + lift },
          anchor,
          base: match?.[1] || coupling.name,
          subscript: match?.[1] ? match[2]! : "",
        },
      },
    };
  });
}
