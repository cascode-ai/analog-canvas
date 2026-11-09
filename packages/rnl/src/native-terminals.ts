import {
  buildEndpointObjectLookup,
  deriveDocumentContactEvidence,
  endpointKey,
  pointOnSegment,
  resolveDocumentRoutingGeometry,
  supplyMarkerForSymbol,
} from "@icm/derived";
import {
  deriveStableId,
  flattenRichText,
  isGridAlignedCoordinate,
  routeEnd,
  transformPoint,
  type DerivedPoint,
  type Orientation,
  type RouteBranch,
  type RouteEndpoint,
  type SchematicDocument,
  type SymbolPin,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

type Junction = SchematicDocument["junctions"][number];
type Branch = { route: RouteBranch; toward: DerivedPoint };
type Anchor = { junction: Junction; branches: Branch[] };
const directions = ["east", "south", "west", "north"] as const;
const vectors = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function direction(toward: DerivedPoint) {
  return vectors.findIndex(({ x, y }) => x === toward.x && y === toward.y);
}

function placementAt(
  junction: Junction,
  pin: SymbolPin,
  branch: Branch,
  grid: number,
) {
  const facing = direction(branch.toward);
  if (facing === -1) return null;
  const rotation = (((facing - directions.indexOf(pin.direction) + 4) % 4) *
    90) as Orientation["rotation"];
  const orientation = { rotation, mirror: "none" as const };
  const offset = transformPoint(pin.at, { x: 0, y: 0 }, orientation);
  const position = {
    x: junction.position.x - offset.x,
    y: junction.position.y - offset.y,
  };
  return isGridAlignedCoordinate(position.x, grid) &&
    isGridAlignedCoordinate(position.y, grid)
    ? { ...orientation, position }
    : null;
}

const distance = (a: DerivedPoint, b: DerivedPoint) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const pointKey = ({ x, y }: DerivedPoint) => `${x},${y}`;

/**
 * Place native markers on ends already present in the RNL drawing. A wire
 * keeps its bends and contact coordinates. The netlist supplies the binding.
 */
export function applyNativeRnlAppearance(
  document: SchematicDocument,
  resolver: SymbolResolver,
  sourcePins: ReadonlySet<string>,
) {
  const endpointLookup = buildEndpointObjectLookup(document);
  const routing = resolveDocumentRoutingGeometry(document, resolver);
  // Index exact contacts only. An imported segment can span an arbitrary area.
  const contacts = deriveDocumentContactEvidence(document, resolver, routing, {
    endpointLookup,
  });
  const netsAtPoint = new Map<string, Set<string>>();
  for (const { point, netId } of contacts.contacts) {
    const key = pointKey(point);
    const nets = netsAtPoint.get(key) ?? new Set<string>();
    nets.add(netId);
    netsAtPoint.set(key, nets);
  }
  const netsById = new Map(document.nets.map((net) => [net.id, net]));
  const contactAt = (junction: Junction) =>
    contacts.byEndpointKey.get(
      endpointKey({ kind: "junction", junctionId: junction.id }),
    );
  const crossesOtherNet = ({ netId, position }: Junction) => {
    const nets = netsAtPoint.get(pointKey(position));
    if (nets && (nets.size > 1 || !nets.has(netId))) return true;
    return document.routes.some(
      (route) =>
        route.netId !== netId &&
        routing.routes
          .get(route.id)
          ?.segments.some(({ from, to }) => pointOnSegment(position, from, to)),
    );
  };
  const anchors = new Map<string, Anchor>();
  const add = (
    endpoint: RouteEndpoint,
    route: RouteBranch,
    point: DerivedPoint,
    neighbor: DerivedPoint,
  ) => {
    if (endpoint.kind !== "junction") return;
    const junction = endpointLookup.junctionsById.get(endpoint.junctionId);
    if (!junction) return;
    const anchor = anchors.get(junction.id) ?? { junction, branches: [] };
    anchor.branches.push({
      route,
      toward: {
        x: Math.sign(neighbor.x - point.x),
        y: Math.sign(neighbor.y - point.y),
      },
    });
    anchors.set(junction.id, anchor);
  };
  for (const route of document.routes) {
    const end = routeEnd(route);
    if (route.start.kind !== "junction" && end.kind !== "junction") continue;
    const points = routing.routes.get(route.id)?.centerline;
    if (!points || points.length < 2) continue;
    add(route.start, route, points[0]!, points[1]!);
    add(end, route, points.at(-1)!, points.at(-2)!);
  }

  // Follow a dedicated body branch across an intermediate point. A shared
  // contact, ordinary terminal or power rail marks the end of the branch.
  const bulk = document.routes.filter(
    (route) => route.presentation === "bulk-dashed",
  );
  for (const route of bulk) {
    for (const endpoint of [route.start, routeEnd(route)]) {
      if (endpoint.kind !== "junction") continue;
      const anchor = anchors.get(endpoint.junctionId);
      if (!anchor || anchor.branches.length !== 2) continue;
      const contact = contactAt(anchor.junction);
      if (contact?.endpoints.length !== 1 || contact.incidents.length !== 2)
        continue;
      const next = anchor.branches.find(
        ({ route: branch }) => branch.id !== route.id,
      )?.route;
      if (!next || next.netId !== route.netId || next.presentation) continue;
      next.presentation = "bulk-dashed";
      const { lineStyle: _lineStyle, ...style } = next.styleOverride ?? {};
      if (Object.keys(style).length) next.styleOverride = style;
      else delete next.styleOverride;
      bulk.push(next);
    }
  }

  const labels = (document.drafting?.objects ?? []).flatMap((item) =>
    item.kind === "text" && item.anchor.kind === "free"
      ? [
          {
            id: item.id,
            name: flattenRichText(item.content),
            at: item.anchor.position,
          },
        ]
      : [],
  );
  const grid = document.presentation.grid;
  const claimed = new Set<string>();
  const replacedLabels = new Set<string>();
  const unplacedPins: string[] = [];
  let unplacedGrounds = 0;
  const nearby = (name: string, at: DerivedPoint) =>
    labels.filter(
      (label) =>
        label.name === name &&
        !replacedLabels.has(label.id) &&
        distance(at, label.at) <= grid / 2,
    );
  const ground = supplyMarkerForSymbol("ground")!;
  const groundPin = resolver
    .resolve("ground")
    ?.definition.pins.find((pin) => pin.name === ground.pinName);
  if (groundPin) {
    const stubs = [...anchors.values()].filter(({ junction, branches }) => {
      const logical = endpointLookup.logicalNetResolution.byBaseNetId.get(
        junction.netId,
      );
      return (
        branches.length === 1 &&
        branches[0]?.route.netId === junction.netId &&
        logical?.name === ground.name &&
        logical.scope === ground.scope &&
        !logical.conflicts.length
      );
    });
    const labelled = stubs.map(({ junction, branches }) => ({
      junction,
      branches,
      labels: nearby(ground.name, junction.position),
    }));
    const endsPerLabel = new Map<string, number>();
    for (const { labels } of labelled)
      for (const label of labels)
        endsPerLabel.set(label.id, (endsPerLabel.get(label.id) ?? 0) + 1);
    for (const { junction, branches, labels } of labelled) {
      const [label, extra] = labels;
      if (!label) continue;
      const contact = contactAt(junction);
      const placement = placementAt(junction, groundPin, branches[0]!, grid);
      const net = netsById.get(junction.netId);
      if (
        !placement ||
        !net ||
        extra ||
        crossesOtherNet(junction) ||
        contact?.endpoints.length !== 1 ||
        contact.incidents.length !== 1 ||
        endsPerLabel.get(label.id) !== 1
      ) {
        unplacedGrounds += 1;
        continue;
      }
      const id = deriveStableId("ground", document.id, junction.id);
      document.instances.push({ id, symbolId: "ground", placement });
      net.terminals.push({ instanceId: id, pinName: ground.pinName });
      document.connectivityEvidence.push({
        id: deriveStableId("connectivity-evidence", document.id, id),
        kind: "name-claim",
        netId: net.id,
        name: ground.name,
        scope: ground.scope,
        powerDomain: ground.domain,
        owner: { kind: "power-marker", objectId: id },
      });
      // At the same contact point on the same Net, the marker joins the
      // existing Junction. Keep the wire's original endpoint and ownership.
      replacedLabels.add(label.id);
      claimed.add(junction.id);
    }
  }

  const portPin = resolver
    .resolve("port")
    ?.definition.pins.find((pin) => pin.name === "P");
  if (portPin) {
    for (const terminal of document.netlist?.terminals ?? []) {
      const [id, other] = terminal.interfaceInstanceIds;
      if (!id || other || sourcePins.has(id)) continue;
      const pin = endpointLookup.instancesById.get(id);
      if (pin?.symbolId !== "port") continue;
      const pinContact = contacts.byEndpointKey.get(
        endpointKey({
          kind: "terminal",
          instanceId: id,
          pinName: portPin.name,
        }),
      );
      if (pinContact?.incidents.some(({ kind }) => kind === "route")) continue;
      const from = pin.placement?.position ?? { x: 0, y: 0 };
      const candidates = [...anchors.values()].flatMap(
        ({ junction, branches }) => {
          if (
            junction.netId !== terminal.netId ||
            claimed.has(junction.id) ||
            branches.some(({ route }) => route.netId !== terminal.netId) ||
            crossesOtherNet(junction)
          )
            return [];
          const occupiedDirections =
            contactAt(junction)?.branchDirections ?? [];
          const branch = branches.find(
            ({ toward }) =>
              direction(toward) !== -1 &&
              !occupiedDirections.some(
                (other) => other.x === -toward.x && other.y === -toward.y,
              ),
          );
          const placement =
            branch && placementAt(junction, portPin, branch, grid);
          if (!branch || !placement) return [];
          const [label, extra] = nearby(terminal.name, junction.position);
          return [{ junction, placement, label: extra ? undefined : label }];
        },
      );
      const best = candidates.sort(
        (a, b) =>
          Number(Boolean(b.label)) - Number(Boolean(a.label)) ||
          distance(a.junction.position, from) -
            distance(b.junction.position, from) ||
          a.junction.id.localeCompare(b.junction.id, "en"),
      )[0];
      if (!best) {
        unplacedPins.push(terminal.name);
        continue;
      }
      pin.placement = best.placement;
      claimed.add(best.junction.id);
      if (best.label) replacedLabels.add(best.label.id);
    }
  }
  if (document.drafting && replacedLabels.size)
    document.drafting.objects = document.drafting.objects.filter(
      (item) => !replacedLabels.has(item.id),
    );
  return { unplacedPins, unplacedGrounds };
}
