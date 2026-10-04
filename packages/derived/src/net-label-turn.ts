import type { Annotation, Point } from "@icm/model";

import { LABEL_CAP_HEIGHT_EM } from "./instance-label-placement.js";
import type { ResolvedRouteGeometry } from "./resolved-route-geometry.js";
import {
  netLabelSideOffset,
  resolveRouteAttachment,
} from "./route-attachment.js";
import type { SchematicStyleProfile } from "./style-profile.js";

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
 * How far above a horizontal wire an upright Net Label's baseline stands: a
 * grid step, so a subscript (V_out) still clears the wire by half a step. At
 * the wire gap the subscript came within three units of it.
 */
export const NET_LABEL_BASELINE_ABOVE_WIRE = 10;

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
  const baseline = NET_LABEL_BASELINE_ABOVE_WIRE;
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
export function netLabelStandardOffset(from: Point, to: Point): number {
  return netLabelLook("right", from, to, 0).normalOffset;
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
