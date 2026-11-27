// Turning or mirroring a selection as one rigid body: its parts orbit one
// pivot, and its wires, Junctions and labels follow.
import { stretchRouteEndpoint } from "./route-endpoint-stretch.js";
import {
  reflectedAnnotationPlacement,
  rotatedAnnotationPlacement,
  rotatePointAboutPivot,
} from "./annotation-reflection.js";
import {
  reflectOrientation,
  rotateOrientation,
  routeEnd,
  type Orientation,
  type Point,
  type RotationDelta,
  type RouteEndpoint,
  type SchematicDocument,
  type ScreenFlip,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  deriveInternalGroupSelection as deriveRoutingInternalGroupSelection,
  NET_LABEL_INK_ABOVE_WIRE,
  NET_LABEL_WIRE_GAP,
  netLabelBaselineAboveWire,
  netLabelCapHeight,
  netLabelDirection,
  netLabelLook,
  nextNetLabelDirection,
  resolveAnnotationPresentation,
  resolveAnnotationText,
  resolveDocumentRoutingGeometry,
  resolveDocumentStyleProfile,
  type ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import { normalizeRouteGeometry } from "./route-geometry-edit.js";
import type {
  AnnotationMoveProposal,
  JunctionMoveProposal,
  RouteStretchProposal,
} from "./route-operations.js";
import {
  assertPowerRailStaysStraight,
  carriedRouteProposal,
  collapsedDirectContact,
  normalizeProposal,
  routeEditPathFromGeometry,
} from "./route-stretch-proposal.js";
import {
  movedInstanceBodies,
  smoothedBoundaryProposal,
  type BoundarySmoothing,
} from "./route-boundary-smoothing.js";

export interface InstanceRotationProposal {
  instanceId: string;
  position: Point;
  rotation: Orientation["rotation"];
  mirror: Orientation["mirror"];
}

export interface GroupRotationProposal {
  instances: InstanceRotationProposal[];
  routes: RouteStretchProposal[];
  junctions: JunctionMoveProposal[];
  annotations: AnnotationMoveProposal[];
  pivot: Point;
}

/** Screen-space turn: positive angles turn clockwise, as SVG rotate() does. */
function turn(
  point: Point,
  pivot: Point,
  deltaDegrees: RotationDelta,
  grid: number,
): Point {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  if (deltaDegrees === 90) return { x: pivot.x - dy, y: pivot.y + dx };
  if (deltaDegrees === -90) return { x: pivot.x + dy, y: pivot.y - dx };
  if (deltaDegrees === 180) return { x: pivot.x - dx, y: pivot.y - dy };
  const radians = (deltaDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const snap = (coordinate: number): number =>
    Math.round(coordinate / grid) * grid;
  return {
    x: snap(pivot.x + dx * cosine - dy * sine),
    y: snap(pivot.y + dx * sine + dy * cosine),
  };
}

/**
 * Turn a selection as one rigid body.
 *
 * Rotating each Instance about its own origin leaves the group's layout
 * untouched, which is not what selecting several parts and turning them
 * means. Here every member orbits one shared pivot and turns by the same
 * angle, so the arrangement itself rotates.
 *
 * The pivot is the centre of the selected Instances' bounding box snapped to
 * the grid. Quarter turns remain exact; diagonal turns quantize authored
 * positions and bends back onto the document grid while terminal contacts
 * retain their exact derived coordinates and use explicit escape geometry.
 *
 * A rigid turn also fixes where each pin lands: an Instance and its pins
 * rotate together, so a terminal endpoint's new position is simply its old
 * position orbited about the pivot. Routes wholly inside the selection turn
 * with it; a Route that leaves the selection keeps its outside endpoint and
 * stretches, exactly as a group translation does.
 */
export function proposeGroupRotation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  deltaDegrees: RotationDelta,
  center?: Point,
  additionalJunctionIds: readonly string[] = [],
): GroupRotationProposal {
  return proposeRigidBodyMove(
    document,
    resolver,
    instanceIds,
    (pivot) => ({
      point: (point) =>
        turn(point, pivot, deltaDegrees, document.presentation.grid),
      placement: (placement) => rotateOrientation(placement, deltaDegrees),
    }),
    center,
    additionalJunctionIds,
    undefined,
    deltaDegrees,
  );
}

/**
 * Reflect a selection as one rigid body.
 *
 * Reflecting each part about its own centre leaves the arrangement exactly
 * where it was, the same way rotating each part in place did — a row of three
 * flipped one at a time is still the same row. Here the arrangement reflects
 * about the selection's own axis and every part reflects with it, so a signal
 * path that ran left to right runs right to left.
 */
export function proposeGroupReflection(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  direction: ScreenFlip,
  center?: Point,
  additionalJunctionIds: readonly string[] = [],
): GroupRotationProposal {
  const axis = direction === "left-right" ? "x" : "y";
  return proposeRigidBodyMove(
    document,
    resolver,
    instanceIds,
    (pivot) => ({
      point: (point) => ({ ...point, [axis]: 2 * pivot[axis] - point[axis] }),
      placement: (placement) => reflectOrientation(placement, direction),
    }),
    center,
    additionalJunctionIds,
    direction,
  );
}

interface RigidBodyTransform {
  point: (point: Point) => Point;
  placement: (placement: Orientation) => Orientation;
}

function proposeRigidBodyMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  transformFor: (pivot: Point) => RigidBodyTransform,
  center?: Point,
  /**
   * Explicitly selected Junctions that turn with the body even when the
   * instance closure alone would not carry them — the translate path has
   * always taken these; rotate and mirror dropped them (audit #7).
   */
  additionalJunctionIds: readonly string[] = [],
  /** Set when the body is mirrored rather than turned. */
  reflection?: ScreenFlip,
  /** Set when the body is turned rather than mirrored. */
  rotationDelta?: RotationDelta,
): GroupRotationProposal {
  const selected = new Set(instanceIds);
  const placed = document.instances.filter(
    (instance) => selected.has(instance.id) && instance.placement,
  );
  // Wires alone turn too: the Junctions on a selected wire's ends carry it,
  // so a flipped L of wire is the same drawing mirrored, not nothing.
  const carriedJunctions = document.junctions.filter((junction) =>
    additionalJunctionIds.includes(junction.id),
  );
  if (placed.length === 0 && carriedJunctions.length === 0) {
    return {
      instances: [],
      routes: [],
      junctions: [],
      annotations: [],
      pivot: { x: 0, y: 0 },
    };
  }

  const grid = document.presentation.grid;
  const anchors =
    placed.length > 0
      ? placed.map((instance) => instance.placement!.position)
      : carriedJunctions.map((junction) => junction.position);
  const xs = anchors.map((point) => point.x);
  const ys = anchors.map((point) => point.y);
  // A mirror about a half-grid line still lands every grid point on the grid,
  // and it lets the axis sit exactly on the body's centre: mirroring twice
  // then restores the drawing where it was instead of walking it a grid step.
  const pivotStep = reflection ? grid / 2 : grid;
  const snap = (value: number): number =>
    pivotStep > 0 ? Math.round(value / pivotStep) * pivotStep : value;
  const pivot = center
    ? { x: snap(center.x), y: snap(center.y) }
    : {
        x: snap((Math.min(...xs) + Math.max(...xs)) / 2),
        y: snap((Math.min(...ys) + Math.max(...ys)) / 2),
      };

  const transform = transformFor(pivot);
  const instances = placed
    .map((instance): InstanceRotationProposal => {
      const placement = instance.placement!;
      const oriented = transform.placement(placement);
      return {
        instanceId: instance.id,
        position: transform.point(placement.position),
        rotation: oriented.rotation,
        mirror: oriented.mirror,
      };
    })
    .sort((left, right) =>
      left.instanceId.localeCompare(right.instanceId, "en"),
    );

  const internalSelection = deriveRoutingInternalGroupSelection(document, [
    ...selected,
  ]);
  const internalNetIds = new Set(internalSelection.netIds);
  const turningJunctionIds = new Set(internalSelection.junctionIds);
  for (const junctionId of additionalJunctionIds) {
    if (document.junctions.some((junction) => junction.id === junctionId)) {
      turningJunctionIds.add(junctionId);
    }
  }
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const movedDocument = structuredClone(document);
  for (const instance of movedDocument.instances) {
    if (!selected.has(instance.id) || !instance.placement) continue;
    const oriented = transform.placement(instance.placement);
    instance.placement = {
      ...instance.placement,
      position: transform.point(instance.placement.position),
      rotation: oriented.rotation,
      mirror: oriented.mirror,
    };
  }
  for (const junction of movedDocument.junctions) {
    if (turningJunctionIds.has(junction.id)) {
      junction.position = transform.point(junction.position);
    }
  }
  const smoothing: BoundarySmoothing = {
    originalDocument: document,
    movedDocument,
    movedBodies: movedInstanceBodies(movedDocument, resolver, selected),
  };

  const turns = (endpoint: RouteEndpoint): boolean =>
    (endpoint.kind === "terminal" && selected.has(endpoint.instanceId)) ||
    (endpoint.kind === "junction" &&
      turningJunctionIds.has(endpoint.junctionId));

  const proposals = new Map<string, RouteStretchProposal>();
  const rigidRouteIds = new Set<string>();
  for (const route of document.routes) {
    const fromTurns = turns(route.start);
    const toTurns = turns(routeEnd(route));
    if (!fromTurns && !toTurns) continue;

    if (fromTurns && toTurns) {
      if (route.legs.some((leg) => leg.mode === "locked")) {
        throw new Error(`Route ${route.id} contains a locked segment`);
      }
      // Wholly inside: the Route is part of the body, so its own geometry
      // turns rather than being stretched between two moved ends.
      const contact = collapsedDirectContact(document, routingGeometry, route);
      if (contact) {
        proposals.set(route.id, contact);
        continue;
      }
      rigidRouteIds.add(route.id);
      proposals.set(
        route.id,
        carriedRouteProposal(routingGeometry, route, transform.point),
      );
      continue;
    }

    const original = routeEditPathFromGeometry(routingGeometry, route.id);
    if (!original) throw new Error(`Route ${route.id} has unresolved geometry`);
    const points = original.points.map((point) => ({ ...point }));
    const modes = [...original.segmentModes];
    if (fromTurns) {
      const from = original.points[0]!;
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "from",
        from,
        transform.point(from),
      );
    }
    if (toTurns) {
      const to = original.points.at(-1)!;
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "to",
        to,
        transform.point(to),
      );
    }
    const stretchedProposal = smoothedBoundaryProposal(
      route,
      original.points.length - 2,
      normalizeProposal(route.id, points, modes),
      smoothing,
      resolver,
      normalizeRouteGeometry(points, modes).points.length - 2,
    );
    assertPowerRailStaysStraight(
      route,
      points[0]!,
      points.at(-1)!,
      stretchedProposal.waypoints,
    );
    proposals.set(route.id, stretchedProposal);
  }

  const turnedObjectIds = new Set<string>([
    ...internalNetIds,
    ...internalSelection.routeIds,
    ...turningJunctionIds,
  ]);
  return {
    instances,
    pivot,
    routes: [...proposals.values()].sort((left, right) =>
      left.routeId.localeCompare(right.routeId, "en"),
    ),
    junctions: document.junctions
      .filter((junction) => turningJunctionIds.has(junction.id))
      .map((junction) => ({
        junctionId: junction.id,
        position: transform.point(junction.position),
      }))
      .sort((left, right) =>
        left.junctionId.localeCompare(right.junctionId, "en"),
      ),
    annotations: (reflection
      ? reflectedFollowerAnnotations(
          document,
          resolver,
          routingGeometry,
          pivot,
          transform,
          reflection,
          { rigidRouteIds, turningJunctionIds, turnedObjectIds },
        )
      : rotatedFollowerAnnotations(
          document,
          resolver,
          routingGeometry,
          pivot,
          transform,
          rotationDelta ?? 90,
          { rigidRouteIds, turningJunctionIds, turnedObjectIds },
        )
    ).sort((left, right) =>
      left.annotationId.localeCompare(right.annotationId, "en"),
    ),
  };
}

/**
 * The labels a rotated body carries: those on its rigid wires, on its
 * Junctions, and free labels naming one of its Nets. Upright wire labels keep
 * readable clearance on the rotated side of their segment so a horizontal
 * wire's label never strikes across a vertical wire after a quarter turn or
 * drops its capitals into the wire after a half turn.
 */
function rotatedFollowerAnnotations(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  pivot: Point,
  transform: RigidBodyTransform,
  deltaDegrees: RotationDelta,
  body: {
    rigidRouteIds: ReadonlySet<string>;
    turningJunctionIds: ReadonlySet<string>;
    turnedObjectIds: ReadonlySet<string>;
  },
): AnnotationMoveProposal[] {
  const styleProfile = resolveDocumentStyleProfile(document.presentation);
  return document.annotations.flatMap(
    (annotation): AnnotationMoveProposal[] => {
      if (annotation.locked) return [];
      const anchor = annotation.anchor;
      const follows =
        anchor.kind === "route"
          ? body.rigidRouteIds.has(anchor.routeId) &&
            (annotation.kind === "net-label" ||
              annotation.kind === "power-label")
          : anchor.kind === "object"
            ? body.turningJunctionIds.has(anchor.objectId)
            : body.turnedObjectIds.has(annotation.netId ?? "");
      if (!follows) return [];
      if (anchor.kind === "free") {
        const placement = rotatedAnnotationPlacement(
          document,
          resolver,
          annotation,
          pivot,
          deltaDegrees,
          routingGeometry,
        );
        return [
          {
            annotationId: annotation.id,
            anchor: { kind: "free", position: placement.position },
            ...(placement.alignment === annotation.alignment
              ? {}
              : { alignment: placement.alignment }),
          },
        ];
      }
      if (anchor.kind === "object") {
        const junction = document.junctions.find(
          (candidate) => candidate.id === anchor.objectId,
        );
        if (!junction) return [];
        const moved = transform.point(junction.position);
        const placement = rotatedAnnotationPlacement(
          document,
          resolver,
          annotation,
          pivot,
          deltaDegrees,
          routingGeometry,
        );
        return [
          {
            annotationId: annotation.id,
            anchor: {
              ...anchor,
              localOffset: {
                x: placement.position.x - moved.x,
                y: placement.position.y - moved.y,
              },
              fallbackPosition: placement.position,
            },
            ...(placement.alignment === annotation.alignment
              ? {}
              : { alignment: placement.alignment }),
          },
        ];
      }
      if (
        (annotation.rotation !== 0 && annotation.rotation !== 270) ||
        Math.abs(deltaDegrees) % 90 !== 0
      ) {
        return [];
      }
      const segment = routingGeometry.routes
        .get(anchor.routeId)
        ?.segments.find(
          (candidate) => candidate.address.legId === anchor.legId,
        );
      if (!segment) return [];
      const from = transform.point(segment.from);
      const to = transform.point(segment.to);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) return [];
      const conductor = {
        x: from.x + dx * anchor.t,
        y: from.y + dy * anchor.t,
      };
      const sizeScale = annotation.sizeScale ?? 1;
      if (annotation.rotation === 270) {
        const turns = (((deltaDegrees / 90) % 4) + 4) % 4;
        let direction = netLabelDirection({
          rotation: annotation.rotation,
          alignment: annotation.alignment,
        });
        for (let step = 0; step < turns; step += 1) {
          direction = nextNetLabelDirection(direction);
        }
        const look = netLabelLook(
          direction,
          from,
          to,
          netLabelCapHeight(styleProfile, sizeScale),
          netLabelBaselineAboveWire(
            resolveAnnotationText(document, annotation),
            styleProfile,
            sizeScale,
          ),
        );
        const normal = { x: -dy / length, y: dx / length };
        const fallbackPosition = {
          x: Math.round(conductor.x + normal.x * look.normalOffset),
          y: Math.round(conductor.y + normal.y * look.normalOffset),
        };
        return [
          {
            annotationId: annotation.id,
            anchor: {
              ...anchor,
              normalOffset: Math.round(look.normalOffset * 1000) / 1000,
              fallbackPosition,
            },
            ...(look.alignment === annotation.alignment
              ? {}
              : { alignment: look.alignment }),
            ...(look.rotation === annotation.rotation
              ? {}
              : { rotation: look.rotation }),
          },
        ];
      }
      const oldConductor = {
        x: segment.from.x + (segment.to.x - segment.from.x) * anchor.t,
        y: segment.from.y + (segment.to.y - segment.from.y) * anchor.t,
      };
      const oldPresentation = resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        styleProfile,
        routingGeometry,
      );
      const oldInk = oldPresentation.inkBounds;
      const oldVector = {
        x: oldInk.x + oldInk.width / 2 - oldConductor.x,
        y: oldInk.y + oldInk.height / 2 - oldConductor.y,
      };
      const rotatedVector = rotatePointAboutPivot(
        oldVector,
        { x: 0, y: 0 },
        deltaDegrees,
      );
      const vertical = Math.abs(dy) > Math.abs(dx);
      let targetPoint: Point;
      let alignment: AnnotationMoveProposal["alignment"];
      if (vertical) {
        const rightSide = rotatedVector.x >= 0;
        const oldClearance =
          Math.abs(segment.to.y - segment.from.y) >
          Math.abs(segment.to.x - segment.from.x)
            ? Math.max(
                oldInk.x - oldConductor.x,
                oldConductor.x - (oldInk.x + oldInk.width),
              )
            : Math.max(
                oldInk.y - oldConductor.y,
                oldConductor.y - (oldInk.y + oldInk.height),
              );
        const gap = Math.max(NET_LABEL_WIRE_GAP, Math.round(oldClearance));
        targetPoint = {
          x: Math.round(conductor.x + (rightSide ? gap : -gap)),
          y: Math.round(conductor.y),
        };
        alignment = rightSide ? "start" : "end";
      } else {
        const above = rotatedVector.y <= 0;
        const baselineAbove = netLabelBaselineAboveWire(
          resolveAnnotationText(document, annotation),
          styleProfile,
          sizeScale,
        );
        const capHeight = netLabelCapHeight(styleProfile, sizeScale);
        const offsetY = above
          ? -baselineAbove
          : Math.ceil(capHeight + NET_LABEL_INK_ABOVE_WIRE);
        targetPoint = {
          x: Math.round(conductor.x),
          y: Math.round(conductor.y + offsetY),
        };
        alignment =
          annotation.alignment === "middle"
            ? "middle"
            : above
              ? "start"
              : "end";
      }
      const normalOffset =
        ((targetPoint.x - conductor.x) * -dy +
          (targetPoint.y - conductor.y) * dx) /
        length;
      return [
        {
          annotationId: annotation.id,
          anchor: {
            ...anchor,
            normalOffset: Math.round(normalOffset * 1000) / 1000,
            fallbackPosition: targetPoint,
          },
          ...(alignment === annotation.alignment ? {} : { alignment }),
        },
      ];
    },
  );
}

/**
 * The labels a mirrored body carries: those on its rigid wires, on its
 * Junctions, and free labels naming one of its Nets. Labels on a part follow
 * that part's own mirror. Each one's text box reflects and its glyphs stay
 * readable; a label on a wire stays at the same point along it and keeps
 * the mirrored side.
 */
function reflectedFollowerAnnotations(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  pivot: Point,
  transform: RigidBodyTransform,
  direction: ScreenFlip,
  body: {
    rigidRouteIds: ReadonlySet<string>;
    turningJunctionIds: ReadonlySet<string>;
    turnedObjectIds: ReadonlySet<string>;
  },
): AnnotationMoveProposal[] {
  return document.annotations.flatMap(
    (annotation): AnnotationMoveProposal[] => {
      if (annotation.locked) return [];
      const anchor = annotation.anchor;
      const follows =
        anchor.kind === "route"
          ? body.rigidRouteIds.has(anchor.routeId)
          : anchor.kind === "object"
            ? body.turningJunctionIds.has(anchor.objectId)
            : body.turnedObjectIds.has(annotation.netId ?? "");
      if (!follows) return [];
      const placement = reflectedAnnotationPlacement(
        document,
        resolver,
        annotation,
        pivot,
        direction,
        routingGeometry,
      );
      const alignment =
        placement.alignment === annotation.alignment
          ? {}
          : { alignment: placement.alignment };
      if (anchor.kind === "free") {
        return [
          {
            annotationId: annotation.id,
            anchor: { kind: "free", position: placement.position },
            ...alignment,
          },
        ];
      }
      if (anchor.kind === "object") {
        const junction = document.junctions.find(
          (candidate) => candidate.id === anchor.objectId,
        );
        if (!junction) return [];
        const moved = transform.point(junction.position);
        return [
          {
            annotationId: annotation.id,
            anchor: {
              ...anchor,
              localOffset: {
                x: placement.position.x - moved.x,
                y: placement.position.y - moved.y,
              },
              fallbackPosition: placement.position,
            },
            ...alignment,
          },
        ];
      }
      const segment = routingGeometry.routes
        .get(anchor.routeId)
        ?.segments.find(
          (candidate) => candidate.address.legId === anchor.legId,
        );
      if (!segment) return [];
      // The wire keeps its point order through the mirror, so the same `t`
      // names the mirrored point. Only the side and distance change.
      const from = transform.point(segment.from);
      const to = transform.point(segment.to);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) return [];
      const conductor = {
        x: from.x + dx * anchor.t,
        y: from.y + dy * anchor.t,
      };
      const normalOffset =
        ((placement.position.x - conductor.x) * -dy +
          (placement.position.y - conductor.y) * dx) /
        length;
      return [
        {
          annotationId: annotation.id,
          anchor: {
            ...anchor,
            normalOffset: Math.round(normalOffset * 1000) / 1000,
            fallbackPosition: placement.position,
          },
          ...alignment,
        },
      ];
    },
  );
}
