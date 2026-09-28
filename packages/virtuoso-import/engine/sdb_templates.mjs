import { createRoutePath, routeEnd } from "../../model/dist/index.js";
import {
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "../../derived/dist/index.js";

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const endpointKey = (endpoint) =>
  endpoint.kind === "junction" ? endpoint.junctionId : null;

function terminalJunctionRoutes(doc, netId, instanceId, pinName) {
  const matches = [];
  for (const route of doc.routes) {
    if (route.netId !== netId) continue;
    const ends = [route.start, routeEnd(route)];
    for (let side = 0; side < 2; side++) {
      const terminal = ends[side],
        other = ends[1 - side];
      if (
        terminal.kind === "terminal" &&
        terminal.instanceId === instanceId &&
        terminal.pinName === pinName &&
        other.kind === "junction"
      )
        matches.push({
          route,
          junctionId: other.junctionId,
          terminalSide: side,
        });
    }
  }
  return matches;
}

function sharedMosNet(doc, instanceId) {
  return doc.nets.find((net) =>
    ["D", "S", "B"].every((pin) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instanceId && terminal.pinName === pin,
      ),
    ),
  );
}

export function applySdbTemplates(doc, resolver) {
  const changes = [];
  const junctions = new Map(
    doc.junctions.map((junction) => [junction.id, junction]),
  );
  for (const instance of doc.instances) {
    if (!["nmos", "pmos"].includes(instance.symbolId)) continue;
    const net = sharedMosNet(doc, instance.id);
    if (!net) continue;
    const drain = terminalJunctionRoutes(doc, net.id, instance.id, "D");
    const source = terminalJunctionRoutes(doc, net.id, instance.id, "S");
    const shared = source.find((item) =>
      drain.some((peer) => peer.junctionId === item.junctionId),
    );
    if (!shared) continue;
    const rail = junctions.get(shared.junctionId);
    const sourceConnection = resolveEndpointConnection(doc, resolver, {
      kind: "terminal",
      instanceId: instance.id,
      pinName: "S",
    });
    const drainConnection = resolveEndpointConnection(doc, resolver, {
      kind: "terminal",
      instanceId: instance.id,
      pinName: "D",
    });
    if (!rail || !sourceConnection?.outward || !drainConnection) continue;
    const contact = sourceConnection.contactPoint,
      outward = sourceConnection.outward;
    const grid = doc.presentation.grid;
    const escape = {
      x: contact.x + outward.x * grid,
      y: contact.y + outward.y * grid,
    };
    const corner = outward.x
      ? { x: escape.x, y: rail.position.y }
      : { x: rail.position.x, y: escape.y };
    const points = [contact, escape, corner, rail.position];
    const original = resolveRouteGeometry(doc, resolver, shared.route);
    const oldLength = original?.segments.reduce(
      (sum, segment) => sum + manhattan(segment.from, segment.to),
      0,
    );
    const newLength = points
      .slice(1)
      .reduce((sum, point, index) => sum + manhattan(points[index], point), 0);
    let shortened = false;
    if (
      manhattan(escape, corner) >= grid &&
      manhattan(corner, rail.position) >= grid &&
      oldLength !== undefined &&
      original.segments.every(
        (segment) =>
          segment.from.x === segment.to.x || segment.from.y === segment.to.y,
      ) &&
      points
        .slice(1)
        .every(
          (point, index) =>
            point.x === points[index].x || point.y === points[index].y,
        ) &&
      newLength < oldLength
    ) {
      const ordered =
        shared.terminalSide === 0 ? points : [...points].reverse();
      shared.route.legs = createRoutePath({
        id: shared.route.id,
        netId: net.id,
        start: shared.route.start,
        end: routeEnd(shared.route),
        bends: ordered.slice(1, -1),
        modes: Array(ordered.length - 1).fill("manual"),
      }).legs;
      shortened = true;
    }

    const removed = [];
    for (const other of drain) {
      if (other.junctionId === shared.junctionId) continue;
      const outer = junctions.get(other.junctionId);
      if (
        !outer ||
        manhattan(rail.position, drainConnection.contactPoint) > 4 * grid ||
        manhattan(outer.position, drainConnection.contactPoint) > 4 * grid
      )
        continue;
      const redundant = doc.routes.find(
        (route) =>
          route.netId === net.id &&
          !route.presentation &&
          ((endpointKey(route.start) === rail.id &&
            endpointKey(routeEnd(route)) === outer.id) ||
            (endpointKey(route.start) === outer.id &&
              endpointKey(routeEnd(route)) === rail.id)),
      );
      if (
        !redundant ||
        doc.annotations.some(
          (annotation) => annotation.anchor?.objectId === redundant.id,
        ) ||
        doc.drafting.objects.some(
          (object) => object.anchor?.objectId === redundant.id,
        )
      )
        continue;
      doc.routes.splice(doc.routes.indexOf(redundant), 1);
      removed.push(redundant.id);
    }
    if (shortened || removed.length)
      changes.push({
        instanceId: instance.id,
        sourceRouteId: shared.route.id,
        shortened,
        removedRedundantRoutes: removed,
      });
  }
  return changes;
}
