import type { Point, RouteEndpoint } from "@icm/model";

export type SnapAxis = "x" | "y";

export type SnapTargetKind =
  | "grid"
  | "instance-center"
  | "instance-edge"
  | "pin"
  | "junction"
  | "route"
  | "drafting";

export type SnapElectricalRef =
  | { kind: "endpoint"; endpoint: RouteEndpoint; netId: string | null }
  | {
      kind: "route";
      routeId: string;
      segmentIndex: number;
      netId: string;
    };

export interface SnapAnchor {
  id: string;
  point: Point;
  kind: SnapTargetKind;
  axes?: readonly SnapAxis[];
  electrical?: SnapElectricalRef;
  /** Route projections are computed for one moving pin, never all pins. */
  acceptsMovingAnchorId?: string;
}

export interface SnapProfile {
  kinds: ReadonlySet<SnapTargetKind>;
  exactElectrical: boolean;
  gridAlignedTranslation: boolean;
  /** Existing selections must reach each grid step; placement keeps its pin magnet radius. */
  captureWithinGridStep?: boolean;
}

export interface SnapGuideLine {
  axis: SnapAxis;
  coordinate: number;
  from: number;
  to: number;
  kind: SnapTargetKind;
}

export interface SnapMatch {
  axis: SnapAxis;
  movingAnchorId: string;
  targetAnchorId: string;
  targetKind: SnapTargetKind;
  coordinate: number;
  correction: number;
}

export interface ElectricalSnapMatch {
  moving: SnapAnchor;
  target: SnapAnchor;
}

export interface SnapResult {
  delta: Point;
  xMatch?: SnapMatch;
  yMatch?: SnapMatch;
  electricalMatch?: ElectricalSnapMatch;
  pointMatch?: SnapAnchor;
  pointMatches?: readonly SnapAnchor[];
  guides: SnapGuideLine[];
}

export interface TranslationSnapRequest {
  rawDelta: Point;
  movingAnchors: readonly SnapAnchor[];
  targetAnchors: readonly SnapAnchor[];
  primaryAnchorId: string;
  grid: number;
  tolerance: number;
  profile: SnapProfile;
}

const INSTANCE_SNAP_KINDS = new Set<SnapTargetKind>([
  "grid",
  "instance-center",
  "instance-edge",
  "pin",
  "junction",
  "route",
]);

export const SNAP_PROFILES = {
  instanceMove: {
    kinds: INSTANCE_SNAP_KINDS,
    exactElectrical: true,
    gridAlignedTranslation: true,
    captureWithinGridStep: true,
  },
  instancePlacement: {
    kinds: INSTANCE_SNAP_KINDS,
    exactElectrical: true,
    gridAlignedTranslation: true,
  },
  draftingMove: {
    kinds: new Set<SnapTargetKind>([
      "grid",
      "instance-center",
      "instance-edge",
      "drafting",
    ]),
    exactElectrical: false,
    gridAlignedTranslation: false,
  },
  draftingHandle: {
    kinds: new Set<SnapTargetKind>([
      "grid",
      "instance-center",
      "instance-edge",
      "pin",
      "junction",
      "route",
      "drafting",
    ]),
    exactElectrical: false,
    gridAlignedTranslation: false,
  },
  wire: {
    kinds: new Set<SnapTargetKind>([
      "grid",
      "pin",
      "junction",
      "route",
      "drafting",
    ]),
    exactElectrical: true,
    gridAlignedTranslation: false,
  },
} as const satisfies Record<string, SnapProfile>;

const KIND_PRIORITY: Record<SnapTargetKind, number> = {
  pin: 0,
  junction: 0,
  route: 2,
  "instance-center": 3,
  "instance-edge": 4,
  drafting: 5,
  grid: 9,
};

export function snapCoordinate(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

export function logicalToleranceForScale(
  screenPixels: number,
  screenUnitsPerLogicalUnit: number,
): number {
  return screenUnitsPerLogicalUnit > 0
    ? screenPixels / screenUnitsPerLogicalUnit
    : screenPixels;
}

function axes(anchor: SnapAnchor): readonly SnapAxis[] {
  return anchor.axes ?? ["x", "y"];
}

function endpointKey(endpoint: RouteEndpoint): string {
  switch (endpoint.kind) {
    case "terminal":
      return `terminal:${endpoint.instanceId}:${endpoint.pinName}`;
    case "junction":
      return `junction:${endpoint.junctionId}`;
  }
}

function compatibleElectrical(left: SnapAnchor, right: SnapAnchor): boolean {
  if (!left.electrical || !right.electrical) return false;
  if (left.electrical.kind !== "endpoint") return false;
  if (
    right.electrical.kind === "endpoint" &&
    endpointKey(left.electrical.endpoint) ===
      endpointKey(right.electrical.endpoint)
  ) {
    return false;
  }
  // Different Base Nets are still eligible for an exact visual snap. The
  // high-level direct-contact planner decides whether they may be merged and
  // atomically rejects incompatible names or power domains; snap geometry
  // must not make that decision from raw Net IDs.
  return true;
}

function compatibleAxisKinds(moving: SnapAnchor, target: SnapAnchor): boolean {
  switch (target.kind) {
    case "instance-center":
      return moving.kind === "instance-center" || moving.kind === "drafting";
    case "instance-edge":
      return moving.kind === "instance-edge" || moving.kind === "drafting";
    case "pin":
    case "junction":
      return moving.electrical !== undefined || moving.kind === "drafting";
    case "route":
      return moving.electrical !== undefined || moving.kind === "drafting";
    case "drafting":
      return moving.kind === "drafting";
    case "grid":
      return false;
  }
}

interface AxisCandidate extends SnapMatch {
  distance: number;
  priority: number;
  movingPoint: Point;
  targetPoint: Point;
}

function compareCandidate(left: AxisCandidate, right: AxisCandidate): number {
  return (
    left.priority - right.priority ||
    left.distance - right.distance ||
    left.targetAnchorId.localeCompare(right.targetAnchorId) ||
    left.movingAnchorId.localeCompare(right.movingAnchorId)
  );
}

function retainedCandidate(
  candidates: readonly AxisCandidate[],
  previous: SnapMatch | undefined,
  releaseTolerance: number,
): AxisCandidate | undefined {
  // Grid rounding has no capture state: keeping yesterday's grid point would
  // stop a freely moving selection from reaching the next one.
  if (!previous || previous.targetKind === "grid") return undefined;
  return candidates.find(
    (candidate) =>
      candidate.movingAnchorId === previous.movingAnchorId &&
      candidate.targetAnchorId === previous.targetAnchorId &&
      candidate.distance <= releaseTolerance,
  );
}

function guideFor(candidate: AxisCandidate): SnapGuideLine {
  const otherAxis = candidate.axis === "x" ? "y" : "x";
  return {
    axis: candidate.axis,
    coordinate: candidate.coordinate,
    from: Math.min(
      candidate.movingPoint[otherAxis],
      candidate.targetPoint[otherAxis],
    ),
    to: Math.max(
      candidate.movingPoint[otherAxis],
      candidate.targetPoint[otherAxis],
    ),
    kind: candidate.targetKind,
  };
}

function coordinateLandsOnGrid(value: number, grid: number): boolean {
  if (grid <= 0) return true;
  return Math.abs(value - snapCoordinate(value, grid)) < 1e-6;
}

function translationLandsOnGrid(
  primary: SnapAnchor,
  delta: Point,
  grid: number,
): boolean {
  return (
    coordinateLandsOnGrid(primary.point.x + delta.x, grid) &&
    coordinateLandsOnGrid(primary.point.y + delta.y, grid)
  );
}

function exactElectricalCandidate(
  request: TranslationSnapRequest,
  primary: SnapAnchor,
  retainedAxes: readonly (AxisCandidate | undefined)[],
): ElectricalSnapMatch | undefined {
  if (!request.profile.exactElectrical) return undefined;
  const candidates = request.movingAnchors.flatMap((moving) => {
    if (!moving.electrical) return [];
    const moved = {
      x: moving.point.x + request.rawDelta.x,
      y: moving.point.y + request.rawDelta.y,
    };
    return request.targetAnchors.flatMap((target) => {
      if (!target.electrical || !request.profile.kinds.has(target.kind))
        return [];
      if (
        target.acceptsMovingAnchorId &&
        target.acceptsMovingAnchorId !== moving.id
      ) {
        return [];
      }
      if (!compatibleElectrical(moving, target)) return [];
      const distance = Math.hypot(
        target.point.x - moved.x,
        target.point.y - moved.y,
      );
      const delta = {
        x: request.rawDelta.x + target.point.x - moved.x,
        y: request.rawDelta.y + target.point.y - moved.y,
      };
      if (
        retainedAxes.some(
          (retained) =>
            retained &&
            Math.abs(
              delta[retained.axis] -
                request.rawDelta[retained.axis] -
                retained.correction,
            ) > 1e-6,
        )
      ) {
        return [];
      }
      if (
        request.profile.gridAlignedTranslation &&
        !translationLandsOnGrid(primary, delta, request.grid)
      ) {
        return [];
      }
      // Grid-bounded movement captures/releases by axis, just like retained
      // alignment. A diagonal nudge must not lose contact while both axes
      // still hold the exact same terminal position.
      const withinCapture = request.profile.captureWithinGridStep
        ? (["x", "y"] as const).every(
            (axis) =>
              // Retained axes have already passed the release threshold and
              // landing check. Only uncaptured axes use the capture threshold.
              retainedAxes.some((retained) => retained?.axis === axis) ||
              Math.abs(target.point[axis] - moved[axis]) <= request.tolerance,
          )
        : distance <= request.tolerance;
      return withinCapture ? [{ moving, target, distance }] : [];
    });
  });
  const closest = candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      KIND_PRIORITY[left.target.kind] - KIND_PRIORITY[right.target.kind] ||
      left.target.id.localeCompare(right.target.id) ||
      left.moving.id.localeCompare(right.moving.id),
  )[0];
  return closest
    ? { moving: closest.moving, target: closest.target }
    : undefined;
}

export function resolveTranslationSnap(
  request: TranslationSnapRequest,
  previous?: SnapResult,
): SnapResult {
  const primary =
    request.movingAnchors.find(
      (anchor) => anchor.id === request.primaryAnchorId,
    ) ?? request.movingAnchors[0];
  if (!primary) return { delta: request.rawDelta, guides: [] };
  // Screen-space tolerances grow in drawing units when zooming out. A grid
  // move must still reach every adjacent grid point, not stick for several
  // steps to a distant alignment/contact.
  const gridRadius =
    request.profile.captureWithinGridStep && request.grid > 0
      ? request.grid / 2
      : Infinity;
  const captureTolerance = Math.min(request.tolerance, gridRadius);
  const releaseTolerance = Math.min(request.tolerance * 1.5, gridRadius);
  const candidates: Record<SnapAxis, AxisCandidate[]> = { x: [], y: [] };
  for (const moving of request.movingAnchors) {
    const moved = {
      x: moving.point.x + request.rawDelta.x,
      y: moving.point.y + request.rawDelta.y,
    };
    for (const target of request.targetAnchors) {
      if (!request.profile.kinds.has(target.kind)) continue;
      if (!compatibleAxisKinds(moving, target)) continue;
      for (const axis of axes(moving)) {
        if (!axes(target).includes(axis)) continue;
        const correction = target.point[axis] - moved[axis];
        const distance = Math.abs(correction);
        if (distance > releaseTolerance) continue;
        if (
          request.profile.gridAlignedTranslation &&
          !coordinateLandsOnGrid(
            primary.point[axis] + request.rawDelta[axis] + correction,
            request.grid,
          )
        ) {
          continue;
        }
        candidates[axis].push({
          axis,
          movingAnchorId: moving.id,
          targetAnchorId: target.id,
          targetKind: target.kind,
          coordinate: target.point[axis],
          correction,
          distance,
          priority: KIND_PRIORITY[target.kind],
          movingPoint: moved,
          targetPoint: target.point,
        });
      }
    }
  }

  if (request.profile.kinds.has("grid") && request.grid > 0) {
    const moved = {
      x: primary.point.x + request.rawDelta.x,
      y: primary.point.y + request.rawDelta.y,
    };
    for (const axis of ["x", "y"] as const) {
      const coordinate = snapCoordinate(moved[axis], request.grid);
      candidates[axis].push({
        axis,
        movingAnchorId: primary.id,
        targetAnchorId: `grid:${axis}:${coordinate}`,
        targetKind: "grid",
        coordinate,
        correction: coordinate - moved[axis],
        distance: Math.abs(coordinate - moved[axis]),
        priority: KIND_PRIORITY.grid,
        movingPoint: moved,
        targetPoint: { ...moved, [axis]: coordinate },
      });
    }
  }

  const retained = (axis: SnapAxis): AxisCandidate | undefined =>
    retainedCandidate(
      candidates[axis],
      axis === "x" ? previous?.xMatch : previous?.yMatch,
      releaseTolerance,
    );
  const retainedX = retained("x");
  const retainedY = retained("y");
  // Filter against the retained landing before selecting the closest pin.
  // Rejecting only the first candidate would lose a still-held contact when
  // another equally close pin happened to sort ahead of it.
  const electricalMatch = exactElectricalCandidate(
    { ...request, tolerance: captureTolerance },
    primary,
    [retainedX, retainedY],
  );
  if (electricalMatch) {
    const moved = {
      x: electricalMatch.moving.point.x + request.rawDelta.x,
      y: electricalMatch.moving.point.y + request.rawDelta.y,
    };
    const correction = {
      x: electricalMatch.target.point.x - moved.x,
      y: electricalMatch.target.point.y - moved.y,
    };
    const match = (axis: SnapAxis): AxisCandidate => ({
      axis,
      movingAnchorId: electricalMatch.moving.id,
      targetAnchorId: electricalMatch.target.id,
      targetKind: electricalMatch.target.kind,
      coordinate: electricalMatch.target.point[axis],
      correction: correction[axis],
      distance: Math.abs(correction[axis]),
      priority: KIND_PRIORITY[electricalMatch.target.kind],
      movingPoint: moved,
      targetPoint: electricalMatch.target.point,
    });
    const x = match("x");
    const y = match("y");
    return {
      delta: {
        x: request.rawDelta.x + correction.x,
        y: request.rawDelta.y + correction.y,
      },
      xMatch: x,
      yMatch: y,
      electricalMatch,
      guides: [guideFor(x), guideFor(y)],
    };
  }

  const choose = (axis: SnapAxis): AxisCandidate | undefined =>
    (axis === "x" ? retainedX : retainedY) ??
    candidates[axis]
      .filter(
        (candidate) =>
          candidate.distance <= captureTolerance ||
          candidate.targetKind === "grid",
      )
      .sort(compareCandidate)[0];
  const x = choose("x");
  const y = choose("y");
  return {
    delta: {
      x: request.rawDelta.x + (x?.correction ?? 0),
      y: request.rawDelta.y + (y?.correction ?? 0),
    },
    ...(x ? { xMatch: x } : {}),
    ...(y ? { yMatch: y } : {}),
    guides: [x, y]
      .filter((candidate): candidate is AxisCandidate => Boolean(candidate))
      .filter((candidate) => candidate.targetKind !== "grid")
      .map(guideFor),
  };
}

export function resolvePointSnap(
  point: Point,
  targetAnchors: readonly SnapAnchor[],
  options: {
    grid: number;
    tolerance: number;
    profile: SnapProfile;
    previous?: SnapResult;
    excludedTargetIds?: ReadonlySet<string>;
  },
): SnapResult {
  const pointKinds = new Set<SnapTargetKind>([
    "pin",
    "junction",
    "route",
    "drafting",
  ]);
  const pointCandidates = targetAnchors
    .filter(
      (target) =>
        !options.excludedTargetIds?.has(target.id) &&
        options.profile.kinds.has(target.kind) &&
        pointKinds.has(target.kind) &&
        axes(target).includes("x") &&
        axes(target).includes("y"),
    )
    .map((target) => ({
      target,
      distance: Math.hypot(target.point.x - point.x, target.point.y - point.y),
    }))
    .filter((candidate) => candidate.distance <= options.tolerance)
    .sort(
      (left, right) =>
        KIND_PRIORITY[left.target.kind] - KIND_PRIORITY[right.target.kind] ||
        left.distance - right.distance ||
        left.target.id.localeCompare(right.target.id),
    );
  const bestCandidate = pointCandidates[0];
  if (bestCandidate) {
    const pointMatch = bestCandidate.target;
    const pointMatches = pointCandidates
      .filter(
        (candidate) =>
          KIND_PRIORITY[candidate.target.kind] ===
            KIND_PRIORITY[pointMatch.kind] &&
          Math.abs(candidate.distance - bestCandidate.distance) < 1e-9 &&
          Math.abs(candidate.target.point.x - pointMatch.point.x) < 1e-9 &&
          Math.abs(candidate.target.point.y - pointMatch.point.y) < 1e-9,
      )
      .map((candidate) => candidate.target);
    const makeMatch = (axis: SnapAxis): SnapMatch => ({
      axis,
      movingAnchorId: "pointer",
      targetAnchorId: pointMatch.id,
      targetKind: pointMatch.kind,
      coordinate: pointMatch.point[axis],
      correction: pointMatch.point[axis] - point[axis],
    });
    return {
      delta: {
        x: pointMatch.point.x - point.x,
        y: pointMatch.point.y - point.y,
      },
      xMatch: makeMatch("x"),
      yMatch: makeMatch("y"),
      pointMatch,
      pointMatches,
      guides: [],
    };
  }
  return resolveTranslationSnap(
    {
      rawDelta: { x: 0, y: 0 },
      movingAnchors: [{ id: "pointer", point, kind: "drafting" }],
      targetAnchors,
      primaryAnchorId: "pointer",
      grid: options.grid,
      tolerance: options.tolerance,
      profile: options.profile,
    },
    options.previous,
  );
}
