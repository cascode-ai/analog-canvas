import { labelTextDocument } from "@icm/model";
import type {
  Annotation,
  Point,
  RichTextDocument,
  RouteAnnotationAttachment,
  SchematicDocument,
} from "@icm/model";

import { labelInkDescentEm } from "./annotation-presentation.js";
import { resolveAnnotationText } from "./annotation-text.js";
import { LABEL_CAP_HEIGHT_EM } from "./instance-label-placement.js";
import type { ResolvedRouteGeometry } from "./resolved-route-geometry.js";
import {
  isNearVerticalSegment,
  netLabelSideOffset,
  resolveRouteAttachment,
} from "./route-attachment.js";
import {
  resolveDocumentStyleProfile,
  type SchematicStyleProfile,
} from "./style-profile.js";

/** Which way a Net Label's text runs from the point where it meets its wire. */
export type NetLabelDirection = "right" | "down" | "left" | "up";

/** R turns a Net Label a quarter clockwise, as it turns a part. */
export function nextNetLabelDirection(
  direction: NetLabelDirection,
): NetLabelDirection {
  switch (direction) {
    case "right":
      return "down";
    case "down":
      return "left";
    case "left":
      return "up";
    case "up":
      return "right";
  }
}

/** The way a label's text runs now, read from its look. A centred upright
 * label counts as running right, so the first turn takes it down. */
export function netLabelDirection(look: {
  rotation: number;
  alignment: "start" | "middle" | "end";
}): NetLabelDirection {
  const rotation = ((look.rotation % 360) + 360) % 360;
  if (rotation === 270) return look.alignment === "end" ? "down" : "up";
  if (rotation === 90) return look.alignment === "end" ? "up" : "down";
  return look.alignment === "end" ? "left" : "right";
}

/** Clear space between a Net Label's text and its wire. */
export const NET_LABEL_WIRE_GAP = 8;

/**
 * How far above a horizontal wire an upright Net Label's baseline stands at
 * most: a grid step, so a subscript (V_out) still clears the wire by half a
 * step. At the wire gap the subscript came within three units of it.
 */
export const NET_LABEL_BASELINE_ABOVE_WIRE = 10;

/**
 * Clear space between an upright Net Label's lowest ink and the horizontal
 * wire under it. A label without a subscript stood a whole grid step up, so
 * on stubs 20 units apart it read as naming the wire above (#1300).
 */
export const NET_LABEL_INK_ABOVE_WIRE = 4;

/**
 * How far a Net Label's ink reaches below its baseline: a subscript's
 * figures, a descender (g, p, y), or nothing.
 */
export function netLabelInkDescent(
  content: RichTextDocument,
  profile: SchematicStyleProfile,
  sizeScale = 1,
): number {
  return (
    profile.typography.netFontSize *
    sizeScale *
    labelInkDescentEm(content, profile.typography)
  );
}

/**
 * Baseline height of an upright Net Label above a horizontal wire, for what
 * it reads: its lowest ink keeps NET_LABEL_INK_ABOVE_WIRE from the wire, up
 * to the grid step a subscript has always taken.
 */
export function netLabelBaselineAboveWire(
  content: RichTextDocument,
  profile: SchematicStyleProfile,
  sizeScale = 1,
): number {
  return Math.min(
    NET_LABEL_BASELINE_ABOVE_WIRE,
    Math.ceil(
      NET_LABEL_INK_ABOVE_WIRE +
        netLabelInkDescent(content, profile, sizeScale),
    ),
  );
}

export interface NetLabelLook {
  /** Signed normal offset of the label's attachment on this segment. */
  normalOffset: number;
  alignment: "start" | "end";
  rotation: 0 | 270;
}

/** Capital height of a Net Label's text, which a label standing beside a
 * vertical wire keeps clear of it. */
export function netLabelCapHeight(
  profile: SchematicStyleProfile,
  sizeScale = 1,
): number {
  return profile.typography.netFontSize * sizeScale * LABEL_CAP_HEIGHT_EM;
}

/**
 * How a Net Label reads in `direction` from its point on a wire segment,
 * clear of the wire and never across it. Upright text reads left to right
 * and vertical text bottom to top, so every turn stays readable.
 * - Running away from the wire, the text starts NET_LABEL_WIRE_GAP from it
 *   (right or left of a vertical wire, up or down from a horizontal one).
 * - Running along the wire, it stands on the side labels take there, above
 *   a horizontal wire and right of a vertical one: an upright label's
 *   baseline NET_LABEL_BASELINE_ABOVE_WIRE above it, a vertical label's
 *   capitals the gap beside it.
 */
export function netLabelLook(
  direction: NetLabelDirection,
  from: Point,
  to: Point,
  capHeight: number,
  /** An upright label's baseline above a horizontal wire; see netLabelBaselineAboveWire. */
  baselineAboveWire = NET_LABEL_BASELINE_ABOVE_WIRE,
): NetLabelLook {
  const vertical = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
  const standard = (distance: number) => netLabelSideOffset(from, to, distance);
  const opposite = (distance: number) => -standard(distance);
  const gap = NET_LABEL_WIRE_GAP;
  if (vertical)
    switch (direction) {
      case "right":
        return { normalOffset: standard(gap), alignment: "start", rotation: 0 };
      case "left":
        return { normalOffset: opposite(gap), alignment: "end", rotation: 0 };
      case "up":
        return {
          normalOffset: standard(Math.ceil(gap + capHeight)),
          alignment: "start",
          rotation: 270,
        };
      case "down":
        return {
          normalOffset: standard(Math.ceil(gap + capHeight)),
          alignment: "end",
          rotation: 270,
        };
    }
  const baseline = baselineAboveWire;
  switch (direction) {
    case "right":
      return {
        normalOffset: standard(baseline),
        alignment: "start",
        rotation: 0,
      };
    case "left":
      return {
        normalOffset: standard(baseline),
        alignment: "end",
        rotation: 0,
      };
    case "up":
      return { normalOffset: standard(gap), alignment: "start", rotation: 270 };
    case "down":
      return { normalOffset: opposite(gap), alignment: "end", rotation: 270 };
  }
}

/** The normal offset of a new, unturned Net Label on a segment: above a
 * horizontal wire, right of a vertical one, as `netLabelLook` puts a label
 * reading to the right. */
export function netLabelStandardOffset(
  from: Point,
  to: Point,
  baselineAboveWire = NET_LABEL_BASELINE_ABOVE_WIRE,
): number {
  return netLabelLook("right", from, to, 0, baselineAboveWire).normalOffset;
}

/**
 * netLabelBaselineAboveWire for a label of this Net name and look, read as
 * the label will draw it: its own format, or the name's semantic label text.
 */
export function netLabelBaselineForName(
  name: string,
  formatOverride: RichTextDocument | undefined,
  presentation: SchematicDocument["presentation"],
  sizeScale = 1,
): number {
  return netLabelBaselineAboveWire(
    formatOverride ?? labelTextDocument(name, presentation),
    resolveDocumentStyleProfile(presentation),
    sizeScale,
  );
}

/**
 * A Net Label attachment a placement tool computed at the full grid step,
 * re-seated for the text it carries (#1300). Only an upright label standing
 * at that standard offset over a horizontal segment moves, closer to its
 * wire; a turned label, a label beside a vertical wire, or one placed at any
 * other offset keeps its place.
 */
export function netLabelAttachmentForText(
  attachment: RouteAnnotationAttachment,
  position: Point,
  rotation: number,
  baselineAboveWire: number,
  geometry: ResolvedRouteGeometry,
): { attachment: RouteAnnotationAttachment; position: Point } {
  const segment = geometry.segments.find(
    (candidate) => candidate.address.legId === attachment.legId,
  );
  const unchanged = { attachment, position };
  if (
    !segment ||
    ((rotation % 360) + 360) % 360 !== 0 ||
    isNearVerticalSegment(segment.from, segment.to) ||
    attachment.normalOffset !== netLabelStandardOffset(segment.from, segment.to)
  )
    return unchanged;
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return unchanged;
  const normalOffset = netLabelStandardOffset(
    segment.from,
    segment.to,
    baselineAboveWire,
  );
  const shift = normalOffset - attachment.normalOffset;
  return {
    attachment: { ...attachment, normalOffset },
    position: {
      x: Math.round(position.x - (dy / length) * shift),
      y: Math.round(position.y + (dx / length) * shift),
    },
  };
}

/** A direction's alignment and rotation away from any wire: a label
 * dragged off its wire, or the placement preview between wires. */
export function netLabelDirectionText(direction: NetLabelDirection): {
  alignment: "start" | "end";
  rotation: 0 | 270;
} {
  switch (direction) {
    case "right":
      return { alignment: "start", rotation: 0 };
    case "left":
      return { alignment: "end", rotation: 0 };
    case "up":
      return { alignment: "start", rotation: 270 };
    case "down":
      return { alignment: "end", rotation: 270 };
  }
}

/**
 * A placed Net Label turned a quarter by R, still on its wire: the side,
 * offset and reading direction its next direction takes on that segment. A
 * label dragged off its wire turns where it is. Null for any other label.
 */
export function turnedNetLabel(
  annotation: Annotation,
  geometryOf: (routeId: string) => ResolvedRouteGeometry | undefined,
  profile: SchematicStyleProfile,
  /** The drawing, so an upright turn stands as close as its text allows. */
  document?: SchematicDocument,
): Annotation | null {
  if (annotation.kind !== "net-label") return null;
  const direction = nextNetLabelDirection(netLabelDirection(annotation));
  const anchor = annotation.anchor;
  if (anchor.kind === "free")
    return { ...annotation, ...netLabelDirectionText(direction) };
  if (anchor.kind !== "route") return null;
  const geometry = geometryOf(anchor.routeId);
  const segment = geometry?.segments.find(
    (candidate) => candidate.address.legId === anchor.legId,
  );
  if (!geometry || !segment) return null;
  const look = netLabelLook(
    direction,
    segment.from,
    segment.to,
    netLabelCapHeight(profile, annotation.sizeScale ?? 1),
    document
      ? netLabelBaselineAboveWire(
          resolveAnnotationText(document, annotation),
          profile,
          annotation.sizeScale ?? 1,
        )
      : NET_LABEL_BASELINE_ABOVE_WIRE,
  );
  const attachment = { ...anchor, normalOffset: look.normalOffset };
  const resolved = resolveRouteAttachment(geometry, attachment);
  return {
    ...annotation,
    alignment: look.alignment,
    rotation: look.rotation,
    anchor: {
      ...attachment,
      fallbackPosition: resolved
        ? {
            x: Math.round(resolved.labelPoint.x),
            y: Math.round(resolved.labelPoint.y),
          }
        : anchor.fallbackPosition,
    },
  };
}
