// Power Rail moves: the whole rail, one end, or its span, and the pin
// contacts a translated or resized rail makes.
import { derivePowerRailComponent, resolveRouteGeometry } from "@icm/derived";
import {
  proposeJunctionGroupTranslation,
  type JunctionMoveProposal,
} from "./route-operations.js";
import type { Point, SchematicDocument } from "@icm/model";
import { routeEnd, routeEndpoints } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./transaction.js";
import { projectRoutingEditGeometry } from "./routing-geometry-projection.js";
import { planPowerRailPinContacts } from "./power-rail-contact-planner.js";
import { routeEdits } from "./route-proposal-edits.js";
import type { RouteEditPlan } from "./routing-planner.js";

function withPowerRailPinContacts(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeIds: readonly string[],
  plan: RouteEditPlan,
): RouteEditPlan {
  const projected = projectRoutingEditGeometry(document, plan.edits);
  const contacts = planPowerRailPinContacts(
    projected,
    resolver,
    projected.routes
      .filter((route) => routeIds.includes(route.id))
      .flatMap((route) => {
        const geometry = resolveRouteGeometry(projected, resolver, route);
        return geometry
          ? [
              {
                routeId: route.id,
                netId: route.netId,
                start: geometry.centerline[0]!,
                end: geometry.centerline.at(-1)!,
                endpoints: routeEndpoints(route),
              },
            ]
          : [];
      }),
  );
  return {
    ...plan,
    edits: [...plan.edits, ...contacts.edits],
    ...(contacts.endpointGroups.length
      ? {
          expectedElectricalEffect: {
            kind: "merge" as const,
            endpointGroups: contacts.endpointGroups,
          },
        }
      : {}),
  };
}

/**
 * Translate every fragment and Junction belonging to one visually continuous
 * VDD rail. Ordinary branch wires are not translated wholesale: they are
 * reshaped around the moved rail Junction instead.
 */
export function proposePowerRailTranslation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  delta: Point,
): RouteEditPlan {
  const component = derivePowerRailComponent(document, routeId);
  if (!component) {
    throw new Error(`Route ${routeId} is not a power rail`);
  }
  if (delta.x === 0 && delta.y === 0) return { routeId, edits: [] };
  const proposal = proposeJunctionGroupTranslation(
    document,
    resolver,
    component.junctionIds.map((junctionId) => {
      const junction = document.junctions.find(
        (candidate) => candidate.id === junctionId,
      )!;
      return {
        junctionId,
        position: {
          x: junction.position.x + delta.x,
          y: junction.position.y + delta.y,
        },
      };
    }),
  );
  return withPowerRailPinContacts(document, resolver, component.routeIds, {
    routeId,
    edits: [
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
    ],
  });
}

/** Resize the leading or trailing visual end of one straight Power Rail. */
export function proposePowerRailEndpointResize(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  side: "start" | "end",
  point: Point,
): RouteEditPlan {
  const component = derivePowerRailComponent(document, routeId);
  if (!component || component.endpointJunctionIds.length !== 2) {
    throw new Error("Power rail must have exactly two editable ends");
  }
  const endpoints = component.endpointJunctionIds.map((junctionId) =>
    document.junctions.find((junction) => junction.id === junctionId)!,
  );
  const horizontal =
    endpoints[0]!.position.y === endpoints[1]!.position.y &&
    endpoints[0]!.position.x !== endpoints[1]!.position.x;
  const vertical =
    endpoints[0]!.position.x === endpoints[1]!.position.x &&
    endpoints[0]!.position.y !== endpoints[1]!.position.y;
  if (!horizontal && !vertical) {
    throw new Error("Power rail must be straight and axis-aligned");
  }
  endpoints.sort((left, right) =>
    horizontal
      ? left.position.x - right.position.x
      : left.position.y - right.position.y,
  );
  const start = endpoints[0]!;
  const end = endpoints[1]!;
  const target = side === "start" ? start : end;
  const fixed = side === "start" ? end : start;
  const coordinate = horizontal ? point.x : point.y;
  const fixedCoordinate = horizontal ? fixed.position.x : fixed.position.y;
  if (
    (side === "start" && coordinate >= fixedCoordinate) ||
    (side === "end" && coordinate <= fixedCoordinate)
  ) {
    throw new Error("Power rail must retain a non-zero length");
  }
  const proposal = proposeJunctionGroupTranslation(document, resolver, [
    {
      junctionId: target.id,
      position: horizontal
        ? { x: coordinate, y: target.position.y }
        : { x: target.position.x, y: coordinate },
    },
  ]);
  return withPowerRailPinContacts(document, resolver, component.routeIds, {
    routeId,
    preview: {
      routes: proposal.routes,
      junctions: proposal.junctions,
    },
    edits: [
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
    ],
  });
}

/**
 * Set both visual ends of one straight Power Rail: the rail grows or shrinks
 * along its own line, every tap Junction stays where it is, and the label,
 * anchored to its end, goes with that end. Planned as the GUI's end drag is,
 * without pin contact capture: geometry alone joins no pin.
 */
export function proposePowerRailSpan(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  from: Point,
  to: Point,
): RouteEditPlan {
  const component = derivePowerRailComponent(document, routeId);
  if (!component || component.endpointJunctionIds.length !== 2) {
    throw new Error("Power rail must have exactly two editable ends");
  }
  const ends = component.endpointJunctionIds.map((junctionId) =>
    document.junctions.find((junction) => junction.id === junctionId)!,
  );
  const horizontal =
    ends[0]!.position.y === ends[1]!.position.y &&
    ends[0]!.position.x !== ends[1]!.position.x;
  const vertical =
    ends[0]!.position.x === ends[1]!.position.x &&
    ends[0]!.position.y !== ends[1]!.position.y;
  if (!horizontal && !vertical) {
    throw new Error("Power rail must be straight and axis-aligned");
  }
  const along = (point: Point) => (horizontal ? point.x : point.y);
  const across = (point: Point) => (horizontal ? point.y : point.x);
  const line = across(ends[0]!.position);
  if (across(from) !== line || across(to) !== line) {
    throw new Error(
      `A Power Rail keeps its line: both ends need ${horizontal ? "y" : "x"} = ${line}`,
    );
  }
  const [low, high] = [from, to].sort(
    (left, right) => along(left) - along(right),
  );
  if (along(low!) === along(high!)) {
    throw new Error("Power rail must retain a non-zero length");
  }
  ends.sort((left, right) => along(left.position) - along(right.position));
  const railIds = new Set(component.routeIds);
  const tapped = (junctionId: string) =>
    document.routes.some(
      (route) =>
        !railIds.has(route.id) &&
        [route.start, routeEnd(route)].some(
          (end) => end.kind === "junction" && end.junctionId === junctionId,
        ),
    );
  for (const junctionId of component.junctionIds) {
    if (component.endpointJunctionIds.includes(junctionId)) continue;
    const tap = document.junctions.find(
      (junction) => junction.id === junctionId,
    )!;
    if (along(tap.position) < along(low!) || along(tap.position) > along(high!))
      throw new Error(
        `Tap ${tap.id} at ${along(tap.position)} would fall off the rail; keep the span over every tap`,
      );
  }
  const moves: JunctionMoveProposal[] = [];
  for (const [end, target] of [
    [ends[0]!, low!],
    [ends[1]!, high!],
  ] as const) {
    if (end.position.x === target.x && end.position.y === target.y) continue;
    if (tapped(end.id))
      throw new Error(
        `Rail end ${end.id} carries a tap, which would move with it; re-tap that wire, or change only the other end`,
      );
    moves.push({ junctionId: end.id, position: { x: target.x, y: target.y } });
  }
  if (moves.length === 0) return { routeId, edits: [] };
  const proposal = proposeJunctionGroupTranslation(document, resolver, moves);
  return {
    routeId,
    preview: {
      routes: proposal.routes,
      junctions: proposal.junctions,
    },
    edits: [
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
    ],
  };
}
