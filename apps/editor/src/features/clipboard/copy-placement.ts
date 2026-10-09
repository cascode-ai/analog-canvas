// Where a copy attaches to the pointer, and how it turns and reflects about
// that point as one body.
import { followAttachedAnnotations } from "@icm/edit-engine";
import type {
  Annotation,
  DraftingObject,
  Point,
  Rotation,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { createEmptyDocument, routeBends } from "@icm/model";

import {
  applyOrientationOperations,
  type PlacementOrientationOperation,
} from "../../interaction/shortcut-orientation";

import type { SchematicClipboard } from "./clipboard";

/** What a copy needs to set its parts' labels the way the canvas does. */
export interface PartLabelContext {
  resolver: SymbolResolver;
  /** The drawing the copy lands in: its grid and label typography. */
  presentation: SchematicDocument["presentation"];
}

/**
 * The copied parts' own labels after each turn and reflection, taken one at
 * a time exactly as the Edit Engine takes a turn on the canvas: a label still
 * where the placement rule put it is set again beside the turned part, and
 * one the author moved turns with it. Keyed by annotation id.
 */
function followedPartLabels(
  clipboard: SchematicClipboard,
  operations: readonly PlacementOrientationOperation[],
  labels: PartLabelContext,
): Map<string, Annotation> {
  const scratch: SchematicDocument = {
    ...createEmptyDocument("copy-placement", "Copy placement"),
    presentation: labels.presentation,
    instances: structuredClone(clipboard.instances),
    annotations: structuredClone(clipboard.annotations),
  };
  for (const operation of operations) {
    for (const instance of scratch.instances) {
      if (!instance.placement) continue;
      const before = {
        rotation: instance.placement.rotation,
        mirror: instance.placement.mirror,
      };
      const next = applyOrientationOperations(before, [operation]);
      if (next.rotation === before.rotation && next.mirror === before.mirror)
        continue;
      instance.placement = { ...instance.placement, ...next };
      followAttachedAnnotations(
        scratch,
        instance.id,
        instance.placement.position,
        before,
        instance.placement.position,
        next,
        new Set(),
        labels.resolver,
      );
    }
  }
  return new Map(
    scratch.annotations.map((annotation) => [annotation.id, annotation]),
  );
}

/**
 * Turn or reflect the copied subgraph as ONE rigid body about the placement
 * anchor, exactly like the canvas group transform: positions, wire bends,
 * junctions, and annotations orbit together while each part also changes its
 * own orientation. R / Shift+R during copy placement previously spun every
 * part in place and left positions and wires untouched, which scrambled the
 * ghost and the stamped result.
 */
export function orientClipboard(
  clipboard: SchematicClipboard,
  operations: readonly PlacementOrientationOperation[],
  pivot?: Point,
  labels?: PartLabelContext,
): SchematicClipboard {
  if (operations.length === 0) return clipboard;
  const followed = labels
    ? followedPartLabels(clipboard, operations, labels)
    : new Map<string, Annotation>();
  const copiedInstanceIds = new Set(
    clipboard.instances.map((instance) => instance.id),
  );
  const anchor = pivot ?? clipboardPlacementAnchor(clipboard) ?? { x: 0, y: 0 };
  const mapVector = (vector: Point): Point =>
    operations.reduce((current, operation) => {
      if (operation.kind === "reflect") {
        return operation.direction === "left-right"
          ? { x: -current.x, y: current.y }
          : { x: current.x, y: -current.y };
      }
      if (operation.deltaDegrees === 90) {
        return { x: -current.y, y: current.x };
      }
      if (operation.deltaDegrees === -90) {
        return { x: current.y, y: -current.x };
      }
      const radians = (operation.deltaDegrees * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      return {
        x: current.x * cosine - current.y * sine,
        y: current.x * sine + current.y * cosine,
      };
    }, vector);
  const snap = (coordinate: number): number =>
    Math.round(coordinate / clipboard.sourceGrid) * clipboard.sourceGrid;
  const needsGridSnap = operations.some(
    (operation) =>
      operation.kind === "rotate" &&
      Math.abs(operation.deltaDegrees) % 90 !== 0,
  );
  const snapVector = (vector: Point): Point => {
    const mapped = mapVector(vector);
    return needsGridSnap ? { x: snap(mapped.x), y: snap(mapped.y) } : mapped;
  };
  const mapPoint = (point: Point): Point => {
    const mapped = mapVector({ x: point.x - anchor.x, y: point.y - anchor.y });
    const transformed = { x: anchor.x + mapped.x, y: anchor.y + mapped.y };
    return needsGridSnap
      ? { x: snap(transformed.x), y: snap(transformed.y) }
      : transformed;
  };
  const flipsWorldX = mapVector({ x: 1, y: 0 }).x < 0;
  return {
    ...clipboard,
    instances: clipboard.instances.map((instance) => ({
      ...structuredClone(instance),
      placement: instance.placement
        ? {
            ...applyOrientationOperations(instance.placement, operations),
            position: mapPoint(instance.placement.position),
          }
        : null,
    })),
    routes: clipboard.routes.map((route) => ({
      ...structuredClone(route),
      legs: route.legs.map((leg) => ({
        ...structuredClone(leg),
        to:
          leg.to.kind === "bend"
            ? { ...leg.to, position: mapPoint(leg.to.position) }
            : leg.to,
      })),
    })),
    junctions: clipboard.junctions.map((junction) => ({
      ...structuredClone(junction),
      position: mapPoint(junction.position),
    })),
    annotations: clipboard.annotations.map((annotation) => {
      const clone = structuredClone(annotation);
      const label = followed.get(annotation.id);
      const owner =
        clone.anchor.kind === "object" &&
        copiedInstanceIds.has(clone.anchor.objectId)
          ? clipboard.instances.find(
              (instance) =>
                clone.anchor.kind === "object" &&
                instance.id === clone.anchor.objectId,
            )
          : undefined;
      if (
        clone.anchor.kind === "object" &&
        label?.anchor.kind === "object" &&
        owner?.placement
      ) {
        // The part's own label, set where a turn on the canvas sets it.
        const position = mapPoint(owner.placement.position);
        clone.anchor.localOffset = label.anchor.localOffset;
        clone.anchor.fallbackPosition = {
          x: position.x + label.anchor.localOffset.x,
          y: position.y + label.anchor.localOffset.y,
        };
        clone.alignment = label.alignment;
        clone.rotation = label.rotation;
        return clone;
      }
      if (clone.anchor.kind === "free") {
        clone.anchor.position = mapPoint(clone.anchor.position);
      } else if (clone.anchor.kind === "object") {
        clone.anchor.localOffset = snapVector(clone.anchor.localOffset);
        clone.anchor.fallbackPosition = mapPoint(clone.anchor.fallbackPosition);
      } else {
        clone.anchor.fallbackPosition = mapPoint(clone.anchor.fallbackPosition);
      }
      // Upright text never mirrors as glyphs: when the body flips the world
      // x-axis the anchor swaps sides, so the extent direction swaps too.
      if (flipsWorldX && clone.alignment !== "middle") {
        clone.alignment = clone.alignment === "start" ? "end" : "start";
      }
      return clone;
    }),
    // Drafting objects are part of the same rigid body: their anchors and
    // kind-specific geometry orbit the anchor exactly like routes and
    // junctions do, or a rotated paste tears the group apart.
    draftingObjects: clipboard.draftingObjects.map((object) => {
      const clone = structuredClone(object);
      const mapAnchor = (anchor: typeof clone.anchor): typeof clone.anchor => {
        if (anchor.kind === "free") {
          return { ...anchor, position: mapPoint(anchor.position) };
        }
        if (anchor.kind === "object") {
          return {
            ...anchor,
            localOffset: snapVector(anchor.localOffset),
            fallbackPosition: mapPoint(anchor.fallbackPosition),
          };
        }
        return {
          ...anchor,
          fallbackPosition: mapPoint(anchor.fallbackPosition),
        };
      };
      const mappedAngle = (degrees: number): number => {
        const radians = (degrees * Math.PI) / 180;
        const turned = mapVector({
          x: Math.cos(radians),
          y: Math.sin(radians),
        });
        const next = (Math.atan2(turned.y, turned.x) * 180) / Math.PI;
        const normalized = ((next % 360) + 360) % 360;
        // Quarter turns and mirrors keep the angle exact in real math; only
        // strip the trig float dust, never a genuinely fractional angle.
        return Math.abs(normalized - Math.round(normalized)) < 1e-9
          ? Math.round(normalized) % 360
          : normalized;
      };
      const rotationDegrees = operations.reduce(
        (total, operation) =>
          operation.kind === "rotate"
            ? (((total + operation.deltaDegrees) % 360) + 360) % 360
            : total,
        0,
      );
      const turnedRotation = (rotation: Rotation): Rotation =>
        ((rotation + rotationDegrees) % 360) as Rotation;
      clone.anchor = mapAnchor(clone.anchor);
      switch (clone.kind) {
        case "text": {
          clone.rotation = turnedRotation(clone.rotation);
          if (flipsWorldX && clone.alignment !== "middle") {
            clone.alignment = clone.alignment === "start" ? "end" : "start";
          }
          break;
        }
        case "callout": {
          clone.rotation = turnedRotation(clone.rotation);
          clone.target = mapAnchor(clone.target);
          if (flipsWorldX && clone.alignment !== "middle") {
            clone.alignment = clone.alignment === "start" ? "end" : "start";
          }
          break;
        }
        case "leader": {
          clone.target = mapAnchor(clone.target);
          break;
        }
        case "arrow": {
          clone.from = mapAnchor(clone.from);
          clone.to = mapAnchor(clone.to);
          if (clone.waypoints) clone.waypoints = clone.waypoints.map(mapPoint);
          if (clone.curveControls) {
            clone.curveControls = clone.curveControls.map((control) =>
              control ? mapPoint(control) : control,
            );
          }
          break;
        }
        case "construction-line": {
          clone.points = clone.points.map(mapPoint);
          if (clone.curveControls) {
            clone.curveControls = clone.curveControls.map((control) =>
              control ? mapPoint(control) : control,
            );
          }
          break;
        }
        case "rectangle": {
          clone.center = mapPoint(clone.center);
          clone.rotation = mappedAngle(clone.rotation);
          break;
        }
        case "circle": {
          clone.center = mapPoint(clone.center);
          break;
        }
        case "floating-symbol": {
          clone.transform = applyOrientationOperations(
            clone.transform,
            operations,
          );
          break;
        }
      }
      return clone;
    }),
  };
}

/**
 * Returns the stable local origin used to attach a copied subgraph to the
 * pointer. Prefer an instance origin because it is also the point designers
 * intuitively grab when duplicating a component group.
 */
export function clipboardPlacementAnchor(
  clipboard: SchematicClipboard,
): Point | null {
  const annotation = clipboard.annotations[0];
  const annotationPosition = annotation
    ? annotation.anchor.kind === "free"
      ? annotation.anchor.position
      : annotation.anchor.fallbackPosition
    : null;
  return (
    clipboard.instances.find((instance) => instance.placement)?.placement
      ?.position ??
    clipboard.junctions[0]?.position ??
    (clipboard.routes[0] ? routeBends(clipboard.routes[0])[0] : undefined) ??
    annotationPosition ??
    draftingOrigin(clipboard.draftingObjects[0]) ??
    null
  );
}

/** Where a drafting object sits, for a copy that holds only drawing. */
function draftingOrigin(object: DraftingObject | undefined): Point | null {
  if (!object) return null;
  if (object.kind === "rectangle" || object.kind === "circle") {
    return object.center;
  }
  return object.anchor.kind === "free"
    ? object.anchor.position
    : object.anchor.kind === "object"
      ? object.anchor.fallbackPosition
      : null;
}
