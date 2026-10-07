import {
  assessImportReference,
  deriveNetConnectivity,
  deriveNetConnectivityContext,
  endpointKey,
  isVisibleEndpoint,
  pointOnSegment,
  projectPointToSegment,
  resolveEndpointConnection,
  resolveRouteGeometry,
  type RoutingGuidanceComponent,
} from "@icm/derived";
import {
  deriveStableId,
  electricalConnectionGrid,
  foldNetName,
  routeEnd,
  snapGridPoint,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  createRouteClearance,
  type ClearPath,
  type RouteClearance,
} from "./route-clearance.js";
import type { WireIntent } from "./routing-planner.js";
import { planWireBatch } from "./wire-batch-planner.js";

type Pin = { instanceId: string; pinName: string };
export type RouteNetTarget =
  | { kind: "net"; net: string }
  | { kind: "member"; instanceId: string; pinName: string }
  | { kind: "pins"; pins: readonly Pin[] }
  | { kind: "import-net"; sourceNetId: string };

/** Bounded convenience over existing visible-connectivity, MST and wire planners.
 * Not a general autorouter: each wire takes the cheapest of a few simple paths
 * that passes over no other Net's pin or wire and through no part, and the Net
 * is refused, naming the obstacle, when none does. No edits reach the live
 * Document until all succeed. */
export function planRouteNet(
  document: SchematicDocument,
  resolver: SymbolResolver,
  input: {
    target: RouteNetTarget;
    trunk?: { start: Point; end: Point } | undefined;
  },
  maxEdits: number,
) {
  const context = deriveNetConnectivityContext(document, resolver);
  const target = input.target;
  let selected: RouteEndpoint[];
  if (target.kind === "import-net") {
    if (
      !document.importReference?.nets.some(
        (net) => net.id === target.sourceNetId,
      )
    )
      throw new Error(
        `Imported reference Net does not exist: ${target.sourceNetId}`,
      );
    const assessment = assessImportReference(document, resolver, context);
    const blocked = assessment.issues.filter(
      (issue) =>
        issue.sourceNetIds.includes(target.sourceNetId) &&
        issue.code !== "IMPORT_REFERENCE_OPEN",
    );
    if (blocked.length)
      throw new Error(blocked.map((issue) => issue.message).join("; "));
    const guides = assessment.guides.filter(
      (guide) => guide.sourceNetId === target.sourceNetId,
    );
    if (!guides.length) return { edits: [] };
    selected = guides.flatMap((guide) => [guide.from, guide.to]);
  } else if (target.kind === "pins") {
    selected = target.pins.map((pin) => ({ kind: "terminal", ...pin }));
  } else {
    const requested =
      target.kind === "member"
        ? document.nets.find((net) =>
            net.terminals.some(
              (pin) =>
                pin.instanceId === target.instanceId &&
                pin.pinName === target.pinName,
            ),
          )?.id
        : target.net;
    if (!requested)
      throw new Error(
        "Member pin has no Net; use explicit pins to create a connection",
      );
    const logical = context.logicalNetResolution;
    const byId =
      logical.byBaseNetId.get(requested) ?? logical.byId.get(requested);
    const matches = byId
      ? [byId]
      : [...logical.byId.values()].filter(
          (net) => foldNetName(net.name ?? "") === foldNetName(requested),
        );
    if (matches.length !== 1)
      throw new Error(
        `Expected one Net for ${requested}; found ${matches.length}`,
      );
    const baseIds = new Set(matches[0]!.baseNetIds);
    selected = document.nets
      .filter((net) => baseIds.has(net.id))
      .flatMap((net) => [
        ...net.terminals.map((pin): RouteEndpoint => ({
          kind: "terminal",
          ...pin,
        })),
        ...document.junctions
          .filter((junction) => junction.netId === net.id)
          .map((junction): RouteEndpoint => ({
            kind: "junction",
            junctionId: junction.id,
          })),
      ]);
  }
  const keys = new Set<string>();
  const nodes = new Map<string, RoutingGuidanceComponent["nodes"][number]>();
  for (const endpoint of selected) {
    const key = endpointKey(endpoint);
    if (keys.has(key)) continue;
    if (endpoint.kind === "terminal") {
      const instance = context.instancesById.get(endpoint.instanceId);
      if (
        !instance ||
        !resolver
          .resolve(instance.symbolId, instance.symbolVariantId)
          ?.definition.pins.some((pin) => pin.name === endpoint.pinName)
      )
        throw new Error(
          `Missing route-net pin: ${endpoint.instanceId}.${endpoint.pinName}`,
        );
      if (!instance.placement)
        throw new Error(
          `Place ${instance.reference ?? instance.id} before routing its Net`,
        );
      if (!isVisibleEndpoint(document, resolver, endpoint, context)) {
        if (target.kind === "pins")
          throw new Error(
            `Explicit route-net pin is not visible: ${endpoint.instanceId}.${endpoint.pinName}`,
          );
        continue;
      }
    }
    const connection = resolveEndpointConnection(
      document,
      resolver,
      endpoint,
      context,
    );
    if (!connection) throw new Error(`No routing landing for ${key}`);
    keys.add(key);
    nodes.set(key, {
      key,
      endpoint,
      point: connection.gridLanding,
      priority: endpoint.kind === "junction" ? 0 : 1,
    });
  }
  const components: RoutingGuidanceComponent[] = [];
  const consumed = new Set<string>();
  for (const net of document.nets) {
    for (const component of deriveNetConnectivity(
      document,
      resolver,
      net,
      context,
    ).components) {
      if (!component.nodes.some((node) => keys.has(node.key))) continue;
      for (const node of component.nodes) consumed.add(node.key);
      const candidates = component.nodes.flatMap((node) => {
        const connection = resolveEndpointConnection(
          document,
          resolver,
          node.endpoint,
          context,
        );
        return connection
          ? [
              {
                ...node,
                point: connection.gridLanding,
                priority: node.endpoint.kind === "junction" ? 0 : 1,
              },
            ]
          : [];
      });
      components.push({ id: component.id, netId: net.id, nodes: candidates });
    }
  }
  for (const [key, node] of nodes) {
    if (!consumed.has(key))
      components.push({ id: key, netId: null, nodes: [node] });
  }
  if (components.length < 2) return { edits: [] };
  if (components.length - 1 > maxEdits)
    throw new Error(
      `route-net needs at least ${components.length - 1} connections, exceeding the ${maxEdits}-edit transaction limit`,
    );
  const id = (part: string) =>
    deriveStableId("route-net", document.id, String(document.revision), part);
  // A generated wire over another Net's pin, through a part or onto another
  // Net's wire would read as a connection the netlist does not have.
  const clearance = createRouteClearance(document, resolver, context, {
    logicalIds: new Set(
      components.flatMap((component) =>
        component.netId
          ? [
              context.logicalNetResolution.byBaseNetId.get(component.netId)
                ?.id ?? component.netId,
            ]
          : [],
      ),
    ),
    endpointKeys: new Set(
      components.flatMap((component) =>
        component.nodes.map((node) => node.key),
      ),
    ),
  });
  let wires: WireIntent[];
  if (input.trunk) {
    const { start, end } = input.trunk;
    if ((start.x === end.x) === (start.y === end.y))
      throw new Error(
        "route-net trunk must be one non-zero horizontal or vertical segment",
      );
    // A trunk endpoint already at a selected pin need not be authored as a
    // free end and then tapped back onto the same point. Reuse that component
    // directly: fewer transient edits and no redundant endpoint Junctions.
    const at = (point: Point, excluded?: string) => {
      // Keep the ordinary wire-at ambiguity checks when any existing wire
      // meets this point. Direct endpoint reuse is only a vacant-end shortcut.
      const touching = document.routes.filter((route) =>
        resolveRouteGeometry(document, resolver, route)?.segments.some(
          (segment) => pointOnSegment(point, segment.from, segment.to),
        ),
      );
      const foreign = touching.find(
        (route) =>
          !components.some((component) => component.netId === route.netId),
      );
      if (foreign)
        throw new Error(
          `route-net trunk endpoint (${point.x}, ${point.y}) would join a different Net via Route ${foreign.id}`,
        );
      if (touching.length) return undefined;
      return components
        .filter((component) => component.id !== excluded)
        .flatMap((component) =>
          component.nodes
            .filter(
              (node) => node.point.x === point.x && node.point.y === point.y,
            )
            .map((node) => ({ component, node })),
        )
        .sort((a, b) => a.node.key.localeCompare(b.node.key, "en"))[0];
    };
    const first = at(start);
    const last = at(end, first?.component.id);
    const attached = new Set([first?.component.id, last?.component.id]);
    const trunkConflict = clearance.conflict(
      [start, end],
      [first?.node.endpoint, last?.node.endpoint],
    );
    if (trunkConflict) throw new Error(`route-net: the trunk ${trunkConflict}`);
    wires = [
      {
        id: id("trunk"),
        from: first
          ? { kind: "endpoint", endpoint: first.node.endpoint }
          : { kind: "free", point: start },
        to: last
          ? { kind: "endpoint", endpoint: last.node.endpoint }
          : { kind: "free", point: end },
      },
    ];
    for (const component of components) {
      if (attached.has(component.id)) continue;
      const best = component.nodes
        .map((node) => ({
          node,
          projected: projectPointToSegment(node.point, start, end)!,
        }))
        .sort(
          (a, b) =>
            a.projected.distanceSquared - b.projected.distanceSquared ||
            a.node.key.localeCompare(b.node.key, "en"),
        )[0]!;
      const tap = snapGridPoint(
        best.projected.point,
        electricalConnectionGrid(document.presentation.grid),
      );
      // The branch is drawn horizontal first, as an unconstrained wire is.
      const from = best.node.point;
      const branchConflict = clearance.conflict(
        from.x === tap.x || from.y === tap.y
          ? [from, tap]
          : [from, { x: tap.x, y: from.y }, tap],
        [best.node.endpoint, undefined],
      );
      if (branchConflict)
        throw new Error(
          `route-net: the branch from ${best.node.key} ${branchConflict}`,
        );
      wires.push({
        id: id(component.id),
        from: { kind: "endpoint", endpoint: best.node.endpoint },
        to: { kind: "wire-at", point: tap },
      });
    }
  } else {
    wires = planNetTree(document, resolver, components, clearance, id);
  }
  const plan = planWireBatch(document, resolver, wires, maxEdits);
  if (typeof plan === "string") throw new Error(`route-net: ${plan}`);
  return plan;
}

type TreeNode = RoutingGuidanceComponent["nodes"][number];
type Segment = readonly [Point, Point];

/**
 * The wires that join a Net's visible components, drawn as a person draws a
 * node. First a straight trunk between two pins that line up with nothing in
 * the way; then, one at a time, the component cheapest to join, at a pin or
 * Junction already joined or straight onto a wire already drawn. Joining pin
 * to pin alone drew a pipeline stage's hold node down to its capacitor's pin
 * and back up on its way to the adder, two Junctions where one T belongs.
 */
function planNetTree(
  document: SchematicDocument,
  resolver: SymbolResolver,
  components: readonly RoutingGuidanceComponent[],
  clearance: RouteClearance,
  id: (part: string) => string,
): WireIntent[] {
  const sorted = [...components].sort((a, b) => a.id.localeCompare(b.id, "en"));
  const nodes = sorted.flatMap((component) =>
    [...component.nodes]
      .sort((a, b) => a.key.localeCompare(b.key, "en"))
      .map((node) => ({ component, node })),
  );
  const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  const distance = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const joined = new Set<string>();
  const treeNodes: TreeNode[] = [];
  const segments: Segment[] = [];
  const wires: WireIntent[] = [];
  const along = (points: readonly Point[]): Segment[] =>
    points.slice(1).map((to, index) => [points[index]!, to] as const);
  const join = (
    component: RoutingGuidanceComponent,
    points: readonly Point[] = [],
  ) => {
    joined.add(component.id);
    treeNodes.push(...component.nodes);
    const keys = new Set(component.nodes.map((node) => node.key));
    for (const route of document.routes) {
      if (
        !keys.has(endpointKey(route.start)) &&
        !keys.has(endpointKey(routeEnd(route)))
      )
        continue;
      const line = resolveRouteGeometry(document, resolver, route)?.centerline;
      if (line) segments.push(...along(line));
    }
    segments.push(...along(points));
  };
  // A wire may not run over a pin it does not join: the pin would sit on
  // the wire without belonging to it.
  const overOtherPins = (points: readonly Point[], ends: readonly Point[]) =>
    nodes.some(
      ({ component, node }) =>
        !joined.has(component.id) &&
        !ends.some((end) => same(end, node.point)) &&
        along(points).some(([from, to]) =>
          pointOnSegment(node.point, from, to),
        ),
    );

  // The trunk: the longest straight run between two components' pins.
  let trunk: { a: (typeof nodes)[number]; b: (typeof nodes)[number] } | null =
    null;
  let trunkLength = 0;
  for (const [index, a] of nodes.entries())
    for (const b of nodes.slice(index + 1)) {
      if (a.component.id === b.component.id) continue;
      const [p, q] = [a.node.point, b.node.point];
      if ((p.x !== q.x && p.y !== q.y) || same(p, q)) continue;
      const length = distance(p, q);
      if (length <= trunkLength) continue;
      if (
        overOtherPins([p, q], [p, q]) ||
        clearance.conflict([p, q], [a.node.endpoint, b.node.endpoint])
      )
        continue;
      trunk = { a, b };
      trunkLength = length;
    }
  if (trunk) {
    wires.push({
      id: id("trunk"),
      from: { kind: "endpoint", endpoint: trunk.a.node.endpoint },
      to: { kind: "endpoint", endpoint: trunk.b.node.endpoint },
    });
    join(trunk.a.component, [trunk.a.node.point, trunk.b.node.point]);
    join(trunk.b.component);
  } else {
    // No pins line up: start from the cheapest pair to join.
    let seed: {
      a: (typeof nodes)[number];
      b: (typeof nodes)[number];
      path: ClearPath;
    } | null = null;
    let reason: string | null = null;
    const pairs = nodes
      .flatMap((a, index) =>
        nodes
          .slice(index + 1)
          .filter((b) => b.component.id !== a.component.id)
          .map((b) => ({
            a,
            b,
            estimate: distance(a.node.point, b.node.point),
          })),
      )
      .sort((left, right) => left.estimate - right.estimate)
      .slice(0, 8);
    for (const { a, b } of pairs) {
      const path = clearance.path(a.node.endpoint, b.node.endpoint);
      if (typeof path === "string") {
        reason ??= path;
        continue;
      }
      if (overOtherPins(path.points!, [a.node.point, b.node.point])) continue;
      if (!seed || path.cost! < seed.path.cost!) seed = { a, b, path };
    }
    if (!seed) throw new Error(`route-net: ${reason ?? "no clear path"}`);
    wires.push({
      id: id(seed.a.component.id),
      from: { kind: "endpoint", endpoint: seed.a.node.endpoint },
      to: { kind: "endpoint", endpoint: seed.b.node.endpoint },
      ...(seed.path.waypoints.length ? { waypoints: seed.path.waypoints } : {}),
      // The clear path is orthogonal; its corners are the planner's (#1437).
      routingMode: "orthogonal",
      cornerOrder: seed.path.cornerOrder,
    });
    join(seed.a.component, seed.path.points);
    join(seed.b.component);
  }

  const tapGrid = electricalConnectionGrid(document.presentation.grid);
  while (joined.size < sorted.length) {
    let best: {
      component: RoutingGuidanceComponent;
      node: TreeNode;
      endpoint: RouteEndpoint | null;
      point: Point;
      path: ClearPath;
    } | null = null;
    let reason: string | null = null;
    for (const { component, node } of nodes) {
      if (joined.has(component.id)) continue;
      // A joined pin or Junction, or straight onto a drawn wire.
      const targets = [
        ...treeNodes.map((target) => ({
          endpoint: target.endpoint as RouteEndpoint | null,
          point: target.point,
        })),
        ...segments.flatMap(([from, to]) => {
          if (from.x !== to.x && from.y !== to.y) return [];
          const projected = projectPointToSegment(node.point, from, to);
          if (!projected) return [];
          const foot = snapGridPoint(projected.point, tapGrid);
          if (
            same(foot, from) ||
            same(foot, to) ||
            !pointOnSegment(foot, from, to)
          )
            return [];
          return [{ endpoint: null as RouteEndpoint | null, point: foot }];
        }),
      ]
        .filter((target) => !same(target.point, node.point))
        .sort(
          (left, right) =>
            distance(node.point, left.point) -
              distance(node.point, right.point) ||
            left.point.x - right.point.x ||
            left.point.y - right.point.y,
        )
        .slice(0, 4);
      for (const target of targets) {
        const path = clearance.path(
          node.endpoint,
          target.endpoint ?? target.point,
        );
        if (typeof path === "string") {
          reason ??= path;
          continue;
        }
        if (overOtherPins(path.points!, [node.point, target.point])) continue;
        if (!best || path.cost! < best.path.cost!)
          best = { component, node, ...target, path };
      }
    }
    if (!best) throw new Error(`route-net: ${reason ?? "no clear path"}`);
    wires.push({
      id: id(best.component.id),
      from: { kind: "endpoint", endpoint: best.node.endpoint },
      to: best.endpoint
        ? { kind: "endpoint", endpoint: best.endpoint }
        : { kind: "wire-at", point: best.point },
      ...(best.path.waypoints.length ? { waypoints: best.path.waypoints } : {}),
      // The clear path is orthogonal; its corners are the planner's (#1437).
      routingMode: "orthogonal",
      cornerOrder: best.path.cornerOrder,
    });
    join(best.component, best.path.points);
  }
  return wires;
}
