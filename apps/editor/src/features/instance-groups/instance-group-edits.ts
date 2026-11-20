import {
  validateConnectableEndpoint,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { GridRect, InstanceGroup, SchematicDocument } from "@icm/model";
import {
  deriveStableId,
  foldNetName,
  junctionElectricalEndpoints,
  NetlistIdentifierSchema,
  parseSignalExpression,
  routeEndpoints,
  type Instance,
  type RouteEndpoint,
} from "@icm/model";
import {
  resolveDocumentStyleProfile,
  resolveCommittedDocumentLogicalNets,
  buildEndpointObjectLookup,
  type ResolvedDocumentLogicalNets,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import {
  planPlaceAllUnplacedInstances,
  retainedPlacementDisplayEdits,
} from "../component-insert/placement-tray";

export function planInstanceGroupView(
  document: SchematicDocument,
  group: InstanceGroup,
  viewBox: GridRect,
  resolver: SymbolResolver,
): SchematicEdit[] {
  const placements = group.collapsed
    ? planPlaceAllUnplacedInstances(document, viewBox, new Set(group.memberIds))
    : [];
  return [
    ...placements,
    ...retainedPlacementDisplayEdits(
      document,
      resolver,
      resolveDocumentStyleProfile(document.presentation),
      placements,
    ),
    {
      kind: "set_instance_group",
      group: { ...group, collapsed: !group.collapsed },
    },
  ];
}

export function canCreateInstanceArray(
  document: SchematicDocument,
  seed: Instance,
): boolean {
  return (
    !!seed.netlist &&
    !!seed.placement &&
    !document.netlist?.terminals.some((terminal) =>
      terminal.interfaceInstanceIds.includes(seed.id),
    ) &&
    !document.instanceGroups?.some((group) => group.memberIds.includes(seed.id))
  );
}

export function planCreateInstanceArray(
  document: SchematicDocument,
  seedId: string,
  { prefix, first, last }: { prefix: string; first: number; last: number },
  groupId: string,
): SchematicEdit[] {
  const seed = document.instances.find(({ id }) => id === seedId);
  if (!seed || !canCreateInstanceArray(document, seed))
    throw new Error(
      "Select an ungrouped, placed circuit Instance to make an array",
    );
  const width = Math.abs(last - first) + 1;
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    first < 0 ||
    last < 0 ||
    first > 65535 ||
    last > 65535 ||
    width < 2 ||
    width > 256
  )
    throw new Error(
      "An array needs 2–256 members with indices between 0 and 65535",
    );
  const step = first > last ? -1 : 1;
  const references = Array.from(
    { length: width },
    (_, index) => `${prefix.trim()}${first + index * step}`,
  );
  if (
    !prefix.trim() ||
    references.some(
      (reference) => !NetlistIdentifierSchema.safeParse(reference).success,
    )
  )
    throw new Error("Enter a valid instance reference prefix");
  const taken = new Set(
    document.instances.flatMap((instance) =>
      instance.id === seedId || !instance.reference
        ? []
        : [foldNetName(instance.reference)],
    ),
  );
  const conflict = references.find((reference) =>
    taken.has(foldNetName(reference)),
  );
  if (conflict)
    throw new Error(`The reference ${conflict} already exists in this Cell`);

  const {
    sourceRef: _fromSource,
    importProvenance: _provenance,
    ...template
  } = seed;
  const members = references.slice(1).map((reference, index): Instance => ({
    ...template,
    id: deriveStableId("array-member", groupId, String(index + 1)),
    reference,
    placement: null,
  }));
  const edits: SchematicEdit[] = [];
  if (seed.reference !== references[0])
    edits.push({
      kind: "set_instance_reference",
      instanceId: seed.id,
      reference: references[0]!,
    });
  for (const instance of members)
    edits.push({ kind: "add_instance", instance });
  edits.push({
    kind: "set_instance_group",
    group: {
      id: groupId,
      memberIds: [seed.id, ...members.map(({ id }) => id)],
      collapsed: true,
    },
  });
  return edits;
}

export function commonArrayPins(
  document: SchematicDocument,
  resolver: SymbolResolver,
  group: InstanceGroup,
): string[] {
  const byId = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const pins = group.memberIds.map((id) => {
    const instance = byId.get(id);
    const symbol =
      instance && resolver.resolve(instance.symbolId, instance.symbolVariantId);
    return new Set(
      symbol?.definition.pins.flatMap((pin) =>
        (pin.signalMembers?.length ?? 0) < 2 &&
        pin.presentation.visibility !== "implicit"
          ? [pin.name]
          : [],
      ),
    );
  });
  return [...(pins[0] ?? [])].filter((pin) =>
    pins.every((names) => names.has(pin)),
  );
}

type Terminal = Extract<RouteEndpoint, { kind: "terminal" }>;
const terminalIdentity = ({
  instanceId,
  pinName,
  memberId,
}: Omit<Terminal, "kind">) => JSON.stringify([instanceId, pinName, memberId]);

export function instanceGroupNetNames(
  document: SchematicDocument,
  logical: ResolvedDocumentLogicalNets,
): ReadonlyMap<string, string> {
  const hints = new Map<string, Map<string, string>>();
  for (const item of document.connectivityEvidence) {
    if (item.kind !== "net-name-hint") continue;
    const id = logical.byBaseNetId.get(item.netId)?.id;
    if (!id) continue;
    const spellings = hints.get(id) ?? new Map<string, string>();
    spellings.set(foldNetName(item.sourceName), item.sourceName);
    hints.set(id, spellings);
  }
  return new Map(
    logical.groups.map((net) => {
      const hint = hints.get(net.id);
      return [
        net.id,
        net.name ??
          (hint?.size === 1 ? hint.values().next().value : undefined) ??
          net.id,
      ];
    }),
  );
}

export function planInstanceArrayConnection(
  document: SchematicDocument,
  resolver: SymbolResolver,
  group: InstanceGroup,
  pin: string,
  expression: string,
  reverse: boolean,
) {
  if (!commonArrayPins(document, resolver, group).includes(pin))
    throw new Error("Choose a scalar terminal shared by all members");
  const names = parseSignalExpression(expression);
  const width = group.memberIds.length;
  if (names.length !== 1 && names.length !== width)
    throw new Error(
      `The array has ${width} members but the signal has ${names.length} bits`,
    );
  const ordered = reverse ? [...names].reverse() : names;
  const logical = resolveCommittedDocumentLogicalNets(document);
  const netNames = instanceGroupNetNames(document, logical);
  const logicalByName = new Map<string, (typeof logical.groups)[number][]>();
  for (const net of logical.groups) {
    const name = foldNetName(netNames.get(net.id)!);
    const entries = logicalByName.get(name) ?? [];
    entries.push(net);
    logicalByName.set(name, entries);
  }
  const byId = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const owner = new Map<string, string>();
  const anchorsByNet = new Map<string, RouteEndpoint[]>();
  const addAnchor = (baseNetId: string, endpoint: RouteEndpoint) => {
    const logicalId = logical.byBaseNetId.get(baseNetId)?.id;
    if (!logicalId) return;
    const anchors = anchorsByNet.get(logicalId) ?? [];
    anchors.push(endpoint);
    anchorsByNet.set(logicalId, anchors);
    if (endpoint.kind === "terminal")
      owner.set(terminalIdentity(endpoint), logicalId);
  };
  for (const { id, terminals } of document.nets)
    for (const terminal of terminals)
      addAnchor(id, { kind: "terminal", ...terminal });
  for (const junction of document.junctions)
    for (const { netId, endpoint } of junctionElectricalEndpoints(junction))
      addAnchor(netId, endpoint);

  const rows = group.memberIds.map((instanceId, index) => {
    const name = ordered[names.length === 1 ? 0 : index]!;
    const [target, ...ambiguous] = logicalByName.get(foldNetName(name)) ?? [];
    if (!target || ambiguous.length || target.conflicts.length)
      throw new Error(`Choose an existing, unambiguous Net for ${name}`);
    const endpoint: Terminal = { kind: "terminal", instanceId, pinName: pin };
    const current = owner.get(terminalIdentity(endpoint));
    return {
      endpoint,
      target,
      current,
      reference: byId.get(instanceId)?.reference ?? instanceId,
      net: netNames.get(target.id)!,
    };
  });
  const changing = rows.filter(({ current, target }) => current !== target.id);
  const detached = new Set(
    changing.map(({ endpoint }) => terminalIdentity(endpoint)),
  );
  const oldRoutes = document.routes.filter((route) =>
    routeEndpoints(route).some(
      (endpoint) =>
        endpoint.kind === "terminal" &&
        detached.has(terminalIdentity(endpoint)),
    ),
  );
  const edits: SchematicEdit[] = [];
  for (const route of oldRoutes)
    edits.push({ kind: "remove_route_geometry", routeId: route.id });
  for (const { endpoint, current } of changing)
    if (current) edits.push({ kind: "disconnect_endpoint", endpoint });
  for (const mark of document.noConnects) {
    if (detached.has(terminalIdentity(mark.endpoint)))
      edits.push({ kind: "remove_no_connect", noConnectId: mark.id });
  }
  const lookup = buildEndpointObjectLookup(document);
  for (const { endpoint, target, net } of changing) {
    const anchor = anchorsByNet
      .get(target.id)
      ?.find(
        (anchor) =>
          (anchor.kind === "junction" ||
            !detached.has(terminalIdentity(anchor))) &&
          !validateConnectableEndpoint(document, anchor, resolver, lookup),
      );
    if (!anchor)
      throw new Error(
        `Net ${net} needs a contact outside the terminals being changed`,
      );
    edits.push({ kind: "connect_endpoints", from: endpoint, to: anchor });
  }
  return {
    rows: rows.map(({ reference, net }) => ({ reference, net })),
    edits,
    removedRouteCount: oldRoutes.length,
  };
}
