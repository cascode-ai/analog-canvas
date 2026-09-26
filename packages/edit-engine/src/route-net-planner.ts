import {
  assessImportReference,
  deriveNetConnectivity,
  deriveNetConnectivityContext,
  deriveRoutingGuidance,
  endpointKey,
  isVisibleEndpoint,
  projectPointToSegment,
  resolveEndpointConnection,
  type RoutingGuidanceComponent,
} from "@icm/derived";
import {
  deriveStableId,
  electricalConnectionGrid,
  foldNetName,
  snapGridPoint,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { WireIntent } from "./routing-planner.js";
import { planWireBatch } from "./wire-batch-planner.js";

type Pin = { instanceId: string; pinName: string };
export type RouteNetTarget =
  | { kind: "net"; net: string }
  | { kind: "member"; instanceId: string; pinName: string }
  | { kind: "pins"; pins: readonly Pin[] }
  | { kind: "import-net"; sourceNetId: string };

/** Bounded convenience over existing visible-connectivity, MST and wire planners.
 * Not an obstacle autorouter; no edits reach the live Document until all succeed. */
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
  let wires: WireIntent[];
  if (input.trunk) {
    const { start, end } = input.trunk;
    if ((start.x === end.x) === (start.y === end.y))
      throw new Error(
        "route-net trunk must be one non-zero horizontal or vertical segment",
      );
    wires = [
      {
        id: id("trunk"),
        from: { kind: "free", point: start },
        to: { kind: "free", point: end },
      },
    ];
    for (const component of components) {
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
      wires.push({
        id: id(component.id),
        from: { kind: "endpoint", endpoint: best.node.endpoint },
        to: {
          kind: "wire-at",
          point: snapGridPoint(
            best.projected.point,
            electricalConnectionGrid(document.presentation.grid),
          ),
        },
      });
    }
  } else {
    wires = deriveRoutingGuidance({
      netId: components[0]!.netId ?? "unbound",
      components,
    }).map((guide) => ({
      id: id(guide.id),
      from: { kind: "endpoint", endpoint: guide.from },
      to: { kind: "endpoint", endpoint: guide.to },
    }));
  }
  const plan = planWireBatch(document, resolver, wires, maxEdits);
  if (typeof plan === "string") throw new Error(`route-net: ${plan}`);
  return plan;
}
