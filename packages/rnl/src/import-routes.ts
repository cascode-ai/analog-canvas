import { isMosBulkTerminal, resolveEndpointPoint } from "@icm/derived";
import {
  deriveStableId,
  type DerivedPoint,
  type RouteBranch,
  type RouteEndpoint,
} from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";

import {
  type LevelModel,
  type Point,
  type RnlSnapshotVertex,
  terminalOf,
  acPoint,
  NEAR,
  CORNER_GRID,
  isOrient,
  type Junction,
} from "./rnl-snapshot.js";
import { orientPoint } from "./orientation.js";
import { type LevelScope } from "./import-scope.js";
import { type Glyphs } from "./import-glyphs.js";

interface DrawnWire {
  route: RouteBranch;
  /** Corners in Canvas coordinates, after any wire-end adjustment. */
  corners: readonly DerivedPoint[];
  /** The authored path used to locate RNL markers. */
  sourceCorners: readonly DerivedPoint[];
  /** Where each source corner appears in the adjusted path. */
  sourceCornerIndices?: readonly number[];
  wire: string;
}

/** The routes a level's wires make, and where a point lies on them. */
export interface WireRoutes {
  drawn: readonly DrawnWire[];
  /** Each junction a glyph drawn as no glyph of its net ends its wires at, and which way its first wire leaves it. */
  openEnds: ReadonlyMap<
    string,
    { junction: Junction; away: { x: number; y: number } }
  >;
  legAt: (point: { x: number; y: number }) => {
    route: RouteBranch;
    atSourceEnd: boolean;
    index: number;
    from: { x: number; y: number };
    to: { x: number; y: number };
    length: number;
    t: number;
  } | null;
  legNear: (
    point: { x: number; y: number },
    netId: string,
    reach: number,
    only?: string,
  ) => {
    route: RouteBranch;
    index: number;
    t: number;
    normalOffset: number;
  } | null;
}

/**
 * The level's wires as routes, from each pin, point or glyph to the next
 * through their bends, and the junctions they meet at.
 */
export function routeWires(
  {
    project,
    document,
    level,
    model,
    warn,
    instanceOf,
    netOf,
    pinOf,
    snap,
  }: LevelScope,
  { glyphOf, openGlyphs }: Pick<Glyphs, "glyphOf" | "openGlyphs">,
  nativeAppearance: boolean,
): WireRoutes {
  // A wire's path runs through the vertices it writes, with the corners its
  // mode adds between them (`auto`, `manhattan` …; 13.1): where each written
  // vertex falls on the path, or, for a path that cannot be followed, the
  // vertices alone.
  const pathOf = new Map(
    model.wires.map((wire) => [wire, viaOnPath(wire, model)] as const),
  );
  const unfollowed = new Set(
    model.wires.flatMap((wire) => (pathOf.get(wire) ? [] : [wire.id])),
  );
  const onPath = (wire: LevelModel["wires"][number], index: number) =>
    pathOf.get(wire)?.[index] ?? index;
  // Named points that wires meet become junctions, on the net of the first
  // wire of one net: a wire of several nets (a bus), which the import leaves
  // out, names no junction's net.
  const junctions = new Map<string, Junction>();
  // An anonymous endpoint needs a Canvas anchor. Coordinate coincidence
  // does not name a shared junction in RNL.
  const coordinateJunctions = new Map<string, Junction>();
  const coordinateKey = (wireIndex: number, vertexIndex: number) =>
    `${wireIndex}:${vertexIndex}`;
  for (const [wireIndex, wire] of model.wires.entries()) {
    const netId = wire.nets.length === 1 ? netOf(wire.nets[0]!) : undefined;
    if (!netId) continue;
    for (const index of new Set([0, wire.via.length - 1])) {
      const vertex = wire.via[index];
      if (!vertex || !("at" in vertex)) continue;
      const key = coordinateKey(wireIndex, index);
      coordinateJunctions.set(key, {
        id: deriveStableId(
          "junction",
          document.id,
          level.id,
          "coordinate",
          key,
        ),
        netId,
        position: snap(acPoint(vertex.at), CORNER_GRID),
        role: "route-anchor",
      });
    }
  }
  for (const wire of model.wires)
    for (const vertex of wire.via) {
      if (!("point" in vertex) || junctions.has(vertex.point)) continue;
      const point = model.points.find((item) => item.id === vertex.point);
      const netId = wire.nets.length === 1 ? netOf(wire.nets[0]!) : undefined;
      if (!point?.at.value || !netId) continue;
      junctions.set(vertex.point, {
        id: deriveStableId("junction", document.id, level.id, vertex.point),
        netId,
        position: snap(acPoint(point.at.value), CORNER_GRID),
      });
    }
  // A glyph drawn as a picture or as its net's label: the wires RNL ends on
  // its pin end at a junction there, and run on from there as drawn.
  /** Each such junction, by glyph, and which way its first wire leaves it. */
  const openEnds = new Map<
    string,
    { junction: Junction; away: { x: number; y: number } }
  >();
  for (const wire of model.wires)
    wire.via.forEach((vertex, index) => {
      if (!("usage" in vertex) || openEnds.has(vertex.usage)) return;
      const glyph = openGlyphs.get(vertex.usage);
      const at = onPath(wire, index);
      const place = wire.points[at];
      const next = wire.points[index === 0 ? at + 1 : at - 1];
      if (
        !glyph ||
        !place ||
        wire.nets.length !== 1 ||
        netOf(wire.nets[0]!) !== glyph.netId
      )
        return;
      const position = snap(acPoint(place), CORNER_GRID);
      // A tag's body leaves its pin the way its glyph turns it (a net
      // label's lead, a port's outline: −x unturned), else away from the
      // wire, which may be of no length.
      const orient = glyph.label?.orient.value ?? null;
      const [x, y] = isOrient(orient) ? orientPoint(orient, [-1, 0]) : [0, 0];
      const toward =
        x || y
          ? { x: position.x - x, y: position.y + y }
          : next
            ? acPoint(next)
            : position;
      openEnds.set(vertex.usage, {
        junction: {
          id: deriveStableId("junction", document.id, level.id, vertex.usage),
          netId: glyph.netId,
          position,
        },
        away: {
          x: Math.sign(position.x - toward.x) + 0,
          y: Math.sign(position.y - toward.y) + 0,
        },
      });
    });
  document.junctions.push(
    ...junctions.values(),
    ...coordinateJunctions.values(),
    ...[...openEnds.values()].map(({ junction }) => junction),
  );

  // Wires: a route from each pin or point to the next, through its bends.
  const endpointOf = (
    vertex: RnlSnapshotVertex,
    wireIndex: number,
    vertexIndex: number,
  ): RouteEndpoint | null => {
    if ("at" in vertex) {
      const junction = coordinateJunctions.get(
        coordinateKey(wireIndex, vertexIndex),
      );
      return junction ? { kind: "junction", junctionId: junction.id } : null;
    }
    if ("terminal" in vertex) {
      const terminal = terminalOf(vertex.terminal);
      const instance = terminal && instanceOf(terminal.name);
      const pinName = instance && pinOf(instance, terminal.n);
      return instance && pinName
        ? { kind: "terminal", instanceId: instance.id, pinName }
        : null;
    }
    if ("point" in vertex) {
      const junction = junctions.get(vertex.point);
      return junction ? { kind: "junction", junctionId: junction.id } : null;
    }
    if ("usage" in vertex) {
      const glyph = glyphOf.get(vertex.usage);
      const open = openEnds.get(vertex.usage)?.junction;
      return glyph
        ? { kind: "terminal", ...glyph }
        : open
          ? { kind: "junction", junctionId: open.id }
          : null;
    }
    return null;
  };
  let skipped = 0;
  /**
   * The wires a run of which ends on a pin or a junction of another net
   * (RNL reports it, 13.1): Analog Canvas leaves that run out, not the
   * drawing.
   */
  const strays = new Set<string>();
  const adjustedWires = new Set<string>();
  const netOfJunction = new Map(
    document.junctions.map((junction) => [junction.id, junction.netId]),
  );
  let netOfPin: Map<string, string> | undefined;
  const netAt = (endpoint: RouteEndpoint) => {
    if (endpoint.kind === "junction")
      return netOfJunction.get(endpoint.junctionId);
    netOfPin ??= new Map(
      document.nets.flatMap((net) =>
        net.terminals.map(
          (terminal) =>
            [
              `${terminal.instanceId}\u0000${terminal.pinName}`,
              net.id,
            ] as const,
        ),
      ),
    );
    return netOfPin.get(`${endpoint.instanceId}\u0000${endpoint.pinName}`);
  };
  let resolver: SymbolResolver | undefined;
  // The Cell's import grid is chosen after all its bends have been read.
  // Resolve the actual contact without requiring a landing on the old grid.
  const pinDocument = {
    ...document,
    presentation: { ...document.presentation, grid: 1 },
  };
  const endpoints = {
    instancesById: new Map(document.instances.map((part) => [part.id, part])),
    junctionsById: new Map(
      document.junctions.map((junction) => [junction.id, junction]),
    ),
  };
  const endpointPoint = (
    endpoint: RouteEndpoint,
    fallback: DerivedPoint,
  ): DerivedPoint => {
    if (endpoint.kind === "junction")
      return (
        endpoints.junctionsById.get(endpoint.junctionId)?.position ?? fallback
      );
    resolver ??= createProjectSymbolResolver(project, builtInSymbols);
    return (
      resolveEndpointPoint(pinDocument, resolver, endpoint, endpoints) ??
      fallback
    );
  };
  /** Each route made, with its corners in Analog Canvas coordinates. */
  const drawn: DrawnWire[] = [];
  /** The wires whose path their mode drew (`auto`, `manhattan` …). */
  const modeDrawn = new Set(
    model.wires.flatMap((wire) =>
      wire.points.length === wire.via.length ? [] : [wire.id],
    ),
  );
  /**
   * How many wires reach each point. A dashed wire is a body tie, which
   * Analog Canvas ends on the wire it ties to without splitting it.
   */
  const wiresAt = new Map<string, number>();
  for (const wire of model.wires.filter(
    (item) => item.style["linestyle"] !== "dashed",
  ))
    for (const point of new Set(
      wire.via.flatMap((vertex) => ("point" in vertex ? [vertex.point] : [])),
    ))
      wiresAt.set(point, (wiresAt.get(point) ?? 0) + 1);
  model.wires.forEach((wire, wireIndex) => {
    const netId = wire.nets.length === 1 ? netOf(wire.nets[0]!) : undefined;
    if (!netId) {
      skipped += 1;
      return;
    }
    // Every vertex that is a pin or point ends one route and starts the next,
    // but one the wire runs straight through: the export names it so RNL
    // joins it, where Analog Canvas joins it by touching, as drawn. A point
    // another wire also reaches still ends a route, since Analog Canvas
    // joins only what a route reaches, not a junction it passes over.
    const through = (index: number) => {
      const here = onPath(wire, index);
      const [before, at, after] = [here - 1, here, here + 1].map(
        (item) => wire.points[item],
      );
      if (!before || !at || !after) return false;
      const cross =
        (at[0] - before[0]) * (after[1] - before[1]) -
        (at[1] - before[1]) * (after[0] - before[0]);
      const along =
        (at[0] - before[0]) * (after[0] - at[0]) +
        (at[1] - before[1]) * (after[1] - at[1]);
      return Math.abs(cross) < 1e-9 && along > 0;
    };
    const runs: number[][] = [];
    let run: number[] = [];
    wire.via.forEach((vertex, index) => {
      run.push(index);
      if (
        run.length > 1 &&
        (index === wire.via.length - 1 ||
          (!("at" in vertex) &&
            (("point" in vertex && (wiresAt.get(vertex.point) ?? 0) > 1) ||
              !through(index))))
      ) {
        runs.push(run);
        run = [index];
      }
    });
    // A bold wire is a power rail; a dashed, dotted or coloured one keeps its
    // look.
    const look = wire.style;
    const lineStyle =
      look["linestyle"] === "dashed" || look["linestyle"] === "dotted"
        ? look["linestyle"]
        : undefined;
    const color =
      typeof look["linecolor"] === "string" &&
      /^#[0-9a-f]{6}$/iu.test(look["linecolor"])
        ? look["linecolor"]
        : undefined;
    const presentation =
      look["linestyle"] === "bold" ? ("power-rail" as const) : undefined;
    runs.forEach((indices, runIndex) => {
      const vertices = indices.map((index) => wire.via[index]!);
      // A wire of no length joins things that touch; Analog Canvas joins
      // them by touching.
      const places = indices.map((index) => wire.points[onPath(wire, index)]);
      if (
        places.every(
          (place) =>
            place && place[0] === places[0]![0] && place[1] === places[0]![1],
        )
      )
        return;
      const start = endpointOf(vertices[0]!, wireIndex, indices[0]!);
      const end = endpointOf(vertices.at(-1)!, wireIndex, indices.at(-1)!);
      if (!start || !end || sameEndpoint(start, end)) {
        skipped += 1;
        return;
      }
      if (
        [start, end].some((endpoint) => (netAt(endpoint) ?? netId) !== netId)
      ) {
        strays.add(wire.id);
        return;
      }
      const pathIndex = (index: number) => onPath(wire, index);
      const cornerPlaces = runCorners(wire, indices, pathIndex);
      const sourceStart = cornerPlaces?.[0];
      const sourceEnd = cornerPlaces?.at(-1);
      if (!cornerPlaces || !sourceStart || !sourceEnd) {
        skipped += 1;
        return;
      }
      const from = endpointPoint(start, sourceStart);
      const to = endpointPoint(end, sourceEnd);
      const shiftedPins = [
        start.kind === "terminal" &&
          offOrthogonalLine(sourceStart, cornerPlaces[1] ?? sourceStart, from),
        end.kind === "terminal" &&
          offOrthogonalLine(sourceEnd, cornerPlaces.at(-2) ?? sourceEnd, to),
      ] as const;
      // Preserve every named point the original wire passes through when
      // fitting a pin lead. A shortened leg must not pass it by.
      const keepThrough =
        shiftedPins.some(Boolean) &&
        vertices.slice(1, -1).some((vertex) => !("at" in vertex));
      const sourceCorners = keepThrough
        ? (runCorners(wire, indices, pathIndex, true) ?? cornerPlaces)
        : cornerPlaces;
      const snappedBends = sourceCorners
        .slice(1, -1)
        .map((place) => snap(place, CORNER_GRID));
      const {
        path,
        adjusted: fitted,
        sourceCornerIndices,
      } = fitOrthogonalPinLeads(
        sourceCorners,
        [from, ...snappedBends, to],
        snap,
        shiftedPins,
        keepThrough,
      );
      const adjusted = fitted || sourceCorners.length > cornerPlaces.length;
      const bends = path.slice(1, -1);
      if (adjusted) adjustedWires.add(wire.id);
      // A dashed wire to a MOS body is Analog Canvas's body tie.
      const bodyTie =
        presentation !== "power-rail" &&
        (nativeAppearance || lineStyle === "dashed") &&
        [start, end].some((endpoint) => isMosBulkTerminal(document, endpoint));
      const drawnAs = bodyTie ? ("bulk-dashed" as const) : presentation;
      const lineOverride = bodyTie ? undefined : lineStyle;
      const id = (part: string, index = 0) =>
        deriveStableId(
          part,
          document.id,
          level.id,
          String(wireIndex),
          String(runIndex),
          String(index),
        );
      const route: RouteBranch = {
        id: id("route"),
        netId,
        start,
        legs: [
          ...bends.map((position, index) => ({
            id: id("leg", index),
            to: { kind: "bend" as const, bendId: id("bend", index), position },
            mode: "manual" as const,
          })),
          {
            id: id("leg", bends.length),
            to: { kind: "endpoint" as const, endpoint: end },
            mode: "manual" as const,
          },
        ],
        ...(drawnAs ? { presentation: drawnAs } : {}),
        ...(lineOverride || color
          ? {
              styleOverride: {
                ...(color ? { color } : {}),
                ...(lineOverride ? { lineStyle: lineOverride } : {}),
              },
            }
          : {}),
      };
      document.routes.push(route);
      drawn.push({
        route,
        wire: wire.id,
        // One corner per end of a leg: the start, each bend, the end. A
        // vertex the wire passes without a place of its own makes no leg, so
        // a text never reaches for a leg the route does not have (#1792).
        corners: adjusted ? path : cornerPlaces,
        sourceCorners: adjusted ? sourceCorners : cornerPlaces,
        ...(adjusted ? { sourceCornerIndices } : {}),
      });
    });
  });
  // A body tie branches: a dashed wire between junctions is one where it
  // meets one, though no body stands at either end.
  const junctionsOf = ({ start, legs }: RouteBranch) =>
    [
      start,
      ...legs.flatMap((leg) =>
        leg.to.kind === "endpoint" ? [leg.to.endpoint] : [],
      ),
    ].flatMap((end) => (end.kind === "junction" ? [end.junctionId] : []));
  for (let spread = true; spread;) {
    spread = false;
    const tied = new Set(
      drawn
        .filter(({ route }) => route.presentation === "bulk-dashed")
        .flatMap(({ route }) => junctionsOf(route)),
    );
    for (const { route } of drawn) {
      if (
        route.styleOverride?.lineStyle !== "dashed" ||
        !junctionsOf(route).some((id) => tied.has(id))
      )
        continue;
      const { lineStyle: _dashed, ...own } = route.styleOverride;
      if (Object.keys(own).length) route.styleOverride = own;
      else delete route.styleOverride;
      route.presentation = "bulk-dashed";
      spread = true;
    }
  }
  if (skipped)
    warn(
      "RNL_IMPORT_WIRE_SKIPPED",
      `${skipped} wires end somewhere Analog Canvas cannot name, or join several nets; they are left out`,
    );
  if (strays.size)
    warn(
      "RNL_IMPORT_WIRE_WRONG_NET",
      `${strays.size} wires reach a pin or junction of another net, which RNL reports; they are left out and the rest is drawn: ${statements(strays)}`,
    );
  if (unfollowed.size)
    warn(
      "RNL_IMPORT_WIRE_PATH",
      `${unfollowed.size} wires take a path Analog Canvas could not follow through the vertices they write; they are drawn straight between those vertices: ${statements(unfollowed)}`,
    );
  if (adjustedWires.size)
    warn(
      "RNL_IMPORT_WIRE_PIN_ADJUSTED",
      `Adjusted orthogonal wire ends to meet Canvas pins on ${adjustedWires.size} statements: ${[...adjustedWires].join(", ")}`,
    );
  const overlaps = overlappingWires(drawn, modeDrawn);
  if (overlaps.size)
    warn(
      "RNL_IMPORT_WIRES_OVERLAP",
      `${overlaps.size} wires a mode draws run over another wire of their net, which they join only at their ends, so where they part shows no junction; give the branch a point with $JUNCTION and run the wires through it: ${statements(overlaps)}`,
    );
  /** Find the original leg for a mark, then locate it on the Canvas route. */
  const legAt = (point: { x: number; y: number }) => {
    for (const item of drawn) {
      const { route, sourceCorners: corners } = item;
      for (let index = 0; index + 1 < corners.length; index++) {
        const from = corners[index]!;
        const to = corners[index + 1]!;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const along =
          ((point.x - from.x) * (to.x - from.x) +
            (point.y - from.y) * (to.y - from.y)) /
          (length || 1);
        const across =
          ((to.x - from.x) * (point.y - from.y) -
            (to.y - from.y) * (point.x - from.x)) /
          (length || 1);
        if (
          length &&
          Math.abs(across) < NEAR &&
          along > -NEAR &&
          along < length + NEAR
        ) {
          const position = projectedLeg(item, index, along / length);
          if (position)
            return {
              route,
              from,
              to,
              length,
              atSourceEnd: nearPoint(corners.at(-1) ?? to, point),
              ...position,
            };
        }
      }
    }
    return null;
  };
  /**
   * The leg corresponding to the nearest source wire on this net. Keep
   * the label's authored offset as it follows the projected wire.
   */
  const legNear = (
    point: { x: number; y: number },
    netId: string,
    reach: number,
    /** Only the routes read from this wire. */
    only?: string,
  ) => {
    let best: {
      route: RouteBranch;
      index: number;
      t: number;
      normalOffset: number;
    } | null = null;
    for (const item of drawn) {
      const { route, sourceCorners: corners, wire } = item;
      if (route.netId !== netId || (only !== undefined && wire !== only))
        continue;
      for (let index = 0; index + 1 < corners.length; index++) {
        const from = corners[index]!;
        const to = corners[index + 1]!;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (!length) continue;
        const along =
          ((point.x - from.x) * (to.x - from.x) +
            (point.y - from.y) * (to.y - from.y)) /
          length;
        const across =
          ((to.x - from.x) * (point.y - from.y) -
            (to.y - from.y) * (point.x - from.x)) /
          length;
        if (
          along < -NEAR ||
          along > length + NEAR ||
          Math.abs(across) > reach + NEAR ||
          (best && Math.abs(across) >= Math.abs(best.normalOffset))
        )
          continue;
        const position = projectedLeg(item, index, along / length);
        if (position) best = { route, ...position, normalOffset: across };
      }
    }
    return best;
  };
  return { drawn, openEnds, legAt, legNear };
}

/**
 * Keep each orthogonal end leg orthogonal when a Canvas pin moves off its
 * source line. Slide the adjacent corner when both legs can keep their
 * directions; otherwise bridge the end leg without moving the corner.
 */
function fitOrthogonalPinLeads(
  source: readonly DerivedPoint[],
  points: DerivedPoint[],
  snap: LevelScope["snap"],
  [startShifted, endShifted]: readonly [boolean, boolean],
  keepThrough: boolean,
): { path: DerivedPoint[]; adjusted: boolean; sourceCornerIndices: number[] } {
  let slid = false;
  for (const [end, step, shifted] of [
    [0, 1, startShifted],
    [points.length - 1, -1, endShifted],
  ] as const) {
    if (!shifted || keepThrough) continue;
    const index = end + step;
    const group = [end, index, index + step];
    const [pin, oldCorner, neighbor] = group.map((i) => points[i]);
    const [sourcePin, sourceCorner, sourceNeighbor] = group.map(
      (i) => source[i],
    );
    if (
      !pin ||
      !oldCorner ||
      !neighbor ||
      !sourcePin ||
      !sourceCorner ||
      !sourceNeighbor ||
      pin.x === oldCorner.x ||
      pin.y === oldCorner.y
    )
      continue;
    const endAxis = orthogonalAxis(sourcePin, sourceCorner);
    const nextAxis = orthogonalAxis(sourceCorner, sourceNeighbor);
    if (!endAxis || !nextAxis || endAxis === nextAxis) continue;
    const corner = { ...pin, [endAxis]: neighbor[endAxis] };
    if (!Number.isInteger(corner.x) || !Number.isInteger(corner.y)) continue;
    // Keep the turn on the same side of its neighbors. Moving it past one
    // would make the path double back along the next leg.
    const endLeg =
      (corner[endAxis] - pin[endAxis]) *
      (sourceCorner[endAxis] - sourcePin[endAxis]);
    const nextLeg =
      (neighbor[nextAxis] - corner[nextAxis]) *
      (sourceNeighbor[nextAxis] - sourceCorner[nextAxis]);
    if (endLeg > 0 && nextLeg > 0) {
      points[index] = snap(corner, CORNER_GRID);
      slid = true;
    }
  }

  const path: DerivedPoint[] = [];
  const sourceCornerIndices: number[] = [];
  for (const [index, from] of points.entries()) {
    sourceCornerIndices.push(path.length);
    path.push(from);
    const to = points[index + 1];
    const sourceFrom = source[index];
    const sourceTo = source[index + 1];
    // A diagonal symbol can put its contacts off the integer bend lattice.
    if (
      !to ||
      !sourceFrom ||
      !sourceTo ||
      !(
        (index === 0 && startShifted) ||
        (index === points.length - 2 && endShifted)
      ) ||
      from.x === to.x ||
      from.y === to.y ||
      ![from.x, from.y, to.x, to.y].every(Number.isInteger)
    )
      continue;

    const axis = orthogonalAxis(sourceFrom, sourceTo);
    if (!axis) continue;
    const turn = Math.round((from[axis] + to[axis]) / 2);
    if (from[axis] !== turn)
      path.push(snap({ ...from, [axis]: turn }, CORNER_GRID));
    if (to[axis] !== turn)
      path.push(snap({ ...to, [axis]: turn }, CORNER_GRID));
  }
  return {
    path,
    adjusted: slid || path.length > source.length,
    sourceCornerIndices,
  };
}

const nearPoint = (a: DerivedPoint, b: DerivedPoint) =>
  Math.abs(a.x - b.x) < NEAR && Math.abs(a.y - b.y) < NEAR;

function offOrthogonalLine(
  pin: DerivedPoint,
  neighbor: DerivedPoint,
  mapped: DerivedPoint,
): boolean {
  const axis = orthogonalAxis(pin, neighbor);
  if (!axis) return false;
  const across = axis === "x" ? "y" : "x";
  return Math.abs(pin[across] - mapped[across]) >= NEAR;
}

/** Keep a marker at the same fraction along its source leg's axis. */
function projectedLeg(
  { sourceCorners, corners, sourceCornerIndices }: DrawnWire,
  sourceIndex: number,
  t: number,
): { index: number; t: number } | null {
  const first = sourceCornerIndices?.[sourceIndex] ?? sourceIndex;
  const last = sourceCornerIndices?.[sourceIndex + 1] ?? sourceIndex + 1;
  if (last === first + 1) return { index: first, t };
  const from = sourceCorners[sourceIndex];
  const to = sourceCorners[sourceIndex + 1];
  const start = corners[first];
  const end = corners[last];
  const axis = from && to && orthogonalAxis(from, to);
  if (!axis || !start || !end) return null;
  const along =
    start[axis] + Math.min(1, Math.max(0, t)) * (end[axis] - start[axis]);
  for (let index = first; index < last; index++) {
    const a = corners[index]?.[axis];
    const b = corners[index + 1]?.[axis];
    if (a === undefined || b === undefined || a === b) continue;
    const fraction = (along - a) / (b - a);
    if (fraction >= 0 && fraction <= 1) return { index, t: fraction };
  }
  return null;
}

/** The axis of a nonzero orthogonal leg in RNL's coordinate tolerance. */
function orthogonalAxis(
  from: DerivedPoint,
  to: DerivedPoint,
): "x" | "y" | undefined {
  const horizontal = Math.abs(from.y - to.y) < NEAR;
  const vertical = Math.abs(from.x - to.x) < NEAR;
  if (horizontal === vertical) return undefined;
  return horizontal ? "x" : "y";
}

/**
 * Where each vertex a wire writes falls on the path its mode draws
 * (`points`), in order: the vertices' own indices where the path is just
 * them; null where a vertex's place is unknown or not on the path.
 */
function viaOnPath(
  wire: LevelModel["wires"][number],
  model: LevelModel,
): number[] | null {
  if (wire.points.length === wire.via.length)
    return wire.via.map((_, index) => index);
  const found: number[] = [];
  let from = 0;
  for (const vertex of wire.via) {
    const place = placeOfVertex(vertex, model);
    const index = place
      ? wire.points.findIndex(
          (point, at) => at >= from && samePlace(point, place),
        )
      : -1;
    if (index < 0) return null;
    found.push(index);
    from = index;
  }
  return found;
}

/**
 * One run of a wire as its corners in Analog Canvas coordinates: its ends,
 * and between them each point of its path, the coordinates the file writes
 * and the corners its mode adds, but no pin or point the wire runs straight
 * through; null where its path lacks a point.
 */
function runCorners(
  wire: LevelModel["wires"][number],
  indices: readonly number[],
  onPath: (index: number) => number,
  keepThrough = false,
): { x: number; y: number }[] | null {
  const [head] = indices;
  const tail = indices.at(-1);
  if (head === undefined || tail === undefined) return null;
  const first = onPath(head);
  const last = onPath(tail);
  const passed = new Set(
    indices
      .slice(1, -1)
      .filter((index) => {
        const vertex = wire.via[index];
        return vertex !== undefined && !("at" in vertex);
      })
      .map(onPath),
  );
  // A corner the file writes stays, even where it repeats the one before; one
  // the mode adds there is no corner.
  const written = new Set(indices.map(onPath));
  const corners: { x: number; y: number }[] = [];
  for (let index = first; index <= last; index++) {
    const point = wire.points[index];
    if (!point) return null;
    if (!keepThrough && index !== first && index !== last && passed.has(index))
      continue;
    const place = acPoint(point);
    const previous = corners.at(-1);
    if (
      !written.has(index) &&
      previous &&
      Math.abs(place.x - previous.x) < NEAR &&
      Math.abs(place.y - previous.y) < NEAR
    )
      continue;
    corners.push(place);
  }
  return corners;
}

/** Each level's pins by the terminal or the usage's role they stand for. */
const pinPlaces = new WeakMap<LevelModel, Map<string, Point>>();

/** Where a vertex a wire writes stands in the scene, or null. */
function placeOfVertex(
  vertex: RnlSnapshotVertex,
  model: LevelModel,
): Point | null {
  if ("at" in vertex) return vertex.at;
  if ("point" in vertex)
    return (
      model.points.find((item) => item.id === vertex.point)?.at.value ?? null
    );
  if ("owner" in vertex) {
    const owner = model.objects.find((item) => item.id === vertex.owner);
    const pin =
      owner?.pins.find((item) => item.index === vertex.pin) ??
      owner?.pins[vertex.pin];
    return pin?.at ?? null;
  }
  let places = pinPlaces.get(model);
  if (!places) {
    places = new Map();
    for (const object of model.objects)
      for (const { at, terminals } of object.pins)
        for (const terminal of at ? terminals : []) {
          const key =
            object.kind === "usage"
              ? `${object.id}\u0000${terminal}`
              : terminal;
          if (at && !places.has(key)) places.set(key, at);
        }
    pinPlaces.set(model, places);
  }
  return "terminal" in vertex
    ? (places.get(vertex.terminal) ?? null)
    : (places.get(`${vertex.usage}\u0000${vertex.role}`) ?? null);
}

/**
 * The wires a mode draws that run along another wire of their net for some
 * length, where RNL joins wires only at the pins and points they share.
 */
function overlappingWires(
  drawn: readonly DrawnWire[],
  modeDrawn: ReadonlySet<string>,
): Set<string> {
  const found = new Set<string>();
  if (!modeDrawn.size) return found;
  const segments = drawn.flatMap(({ route, sourceCorners: corners, wire }) =>
    corners.flatMap((from, index) => {
      const to = corners[index + 1];
      return to ? [{ net: route.netId, wire, from, to }] : [];
    }),
  );
  for (const [index, a] of segments.entries()) {
    for (const b of segments.slice(index + 1)) {
      if (
        a.net !== b.net ||
        a.wire === b.wire ||
        !(modeDrawn.has(a.wire) || modeDrawn.has(b.wire))
      )
        continue;
      if (sharedLength(a, b) > NEAR) found.add(a.wire).add(b.wire);
    }
  }
  return found;
}

/** How long two segments run along each other: 0 unless they are collinear. */
function sharedLength(
  a: { from: { x: number; y: number }; to: { x: number; y: number } },
  b: { from: { x: number; y: number }; to: { x: number; y: number } },
): number {
  const dx = a.to.x - a.from.x;
  const dy = a.to.y - a.from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return 0;
  const across = (point: { x: number; y: number }) =>
    (dx * (point.y - a.from.y) - dy * (point.x - a.from.x)) / length;
  if (Math.abs(across(b.from)) > NEAR || Math.abs(across(b.to)) > NEAR)
    return 0;
  const along = (point: { x: number; y: number }) =>
    (dx * (point.x - a.from.x) + dy * (point.y - a.from.y)) / length;
  const [from, to] = [along(b.from), along(b.to)];
  return Math.max(
    0,
    Math.min(length, Math.max(from, to)) - Math.max(0, Math.min(from, to)),
  );
}

/** RNL keeps coordinates to a millionth of its unit. */
const samePlace = (a: Point, b: Point) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** The statements that write some wires, as RNL names them (`@top.sp:12:5`). */
const statements = (ids: ReadonlySet<string>) =>
  [...ids].slice(0, 8).join(", ") + (ids.size > 8 ? ", …" : "");

function sameEndpoint(a: RouteEndpoint, b: RouteEndpoint): boolean {
  return a.kind === "junction"
    ? b.kind === "junction" && a.junctionId === b.junctionId
    : b.kind === "terminal" &&
        a.instanceId === b.instanceId &&
        a.pinName === b.pinName;
}
