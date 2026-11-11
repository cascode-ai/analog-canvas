import { isMosBulkTerminal } from "@icm/derived";
import {
  deriveStableId,
  type RouteBranch,
  type RouteEndpoint,
} from "@icm/model";

import {
  type RnlSnapshotVertex,
  terminalOf,
  acPoint,
  NEAR,
  CORNER_GRID,
  type Junction,
} from "./rnl-snapshot.js";
import { type LevelScope } from "./import-scope.js";
import { type Glyphs } from "./import-glyphs.js";

/** The routes a level's wires make, and where a point lies on them. */
export interface WireRoutes {
  /** Each route made, with its corners in Analog Canvas coordinates. */
  drawn: readonly {
    route: RouteBranch;
    corners: { x: number; y: number }[];
    /** The RNL wire it was read from. */
    wire: string;
  }[];
  /** Each junction a glyph drawn as no glyph of its net ends its wires at, and which way its first wire leaves it. */
  openEnds: ReadonlyMap<
    string,
    { junction: Junction; away: { x: number; y: number } }
  >;
  legAt: (point: { x: number; y: number }) => {
    route: RouteBranch;
    corners: { x: number; y: number }[];
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
  { document, level, model, warn, instanceOf, netOf, pinOf, snap }: LevelScope,
  { glyphOf, openGlyphs }: Pick<Glyphs, "glyphOf" | "openGlyphs">,
  nativeAppearance: boolean,
): WireRoutes {
  // Named points that wires meet become junctions, on the net of the first.
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
      const netId = wire.nets[0] && netOf(wire.nets[0]);
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
      const place = wire.points[index];
      const next = wire.points[index === 0 ? 1 : index - 1];
      if (
        !glyph ||
        !place ||
        wire.nets.length !== 1 ||
        netOf(wire.nets[0]!) !== glyph.netId
      )
        return;
      const position = snap(acPoint(place), CORNER_GRID);
      const toward = next ? acPoint(next) : position;
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
  /** Each route made, with its corners in Analog Canvas coordinates. */
  const drawn: {
    route: RouteBranch;
    corners: { x: number; y: number }[];
    /** The RNL wire it was read from. */
    wire: string;
  }[] = [];
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
      const [before, at, after] = [index - 1, index, index + 1].map(
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
      const places = indices.map((index) => wire.points[index]);
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
      const bends = vertices
        .slice(1, -1)
        .flatMap((vertex) =>
          "at" in vertex ? [snap(acPoint(vertex.at), CORNER_GRID)] : [],
        );
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
        corners: places
          .filter(
            (_, at) =>
              at === 0 || at === places.length - 1 || "at" in vertices[at]!,
          )
          .map((place) => acPoint(place!)),
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
  /** The route leg a point lies on, and how far along it. */
  const legAt = (point: { x: number; y: number }) => {
    for (const { route, corners } of drawn)
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
        )
          return { route, corners, index, from, to, length, t: along / length };
      }
    return null;
  };
  /**
   * The leg of a net's wires nearest a point within reach, with the point
   * where it stands from the leg: how far along, and how far to the left of
   * its way (Analog Canvas's normal offset).
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
    for (const { route, corners, wire } of drawn) {
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
        best = { route, index, t: along / length, normalOffset: across };
      }
    }
    return best;
  };
  return { drawn, openEnds, legAt, legNear };
}

function sameEndpoint(a: RouteEndpoint, b: RouteEndpoint): boolean {
  return a.kind === "junction"
    ? b.kind === "junction" && a.junctionId === b.junctionId
    : b.kind === "terminal" &&
        a.instanceId === b.instanceId &&
        a.pinName === b.pinName;
}
