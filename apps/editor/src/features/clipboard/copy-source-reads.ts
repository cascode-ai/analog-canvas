import type { SchematicDocument } from "@icm/model";
import {
  isFrozenSnapshot,
  isPowerMarkerSymbol,
  routeEndpoints,
} from "@icm/model";
import { buildEndpointObjectLookup } from "@icm/derived";
import type { ExplicitCopyRoutingSelection } from "./clipboard";

/** Fetch matches for any of the keys, once each and in original declaration order. */
function related<T>(items: readonly T[], keys: (item: T) => readonly string[]) {
  const positions = new Map<string, number[]>();
  items.forEach((item, position) => {
    for (const key of keys(item)) {
      const list = positions.get(key);
      if (list) list.push(position);
      else positions.set(key, [position]);
    }
  });
  return (wanted: Iterable<string>) => {
    const result = new Set<number>();
    for (const key of wanted)
      for (const position of positions.get(key) ?? []) result.add(position);
    return [...result]
      .sort((a, b) => a - b)
      .map((position) => items[position]!);
  };
}

function buildReads(document: SchematicDocument) {
  const routes = new Map(document.routes.map((r) => [r.id, r]));
  const nets = new Map(document.nets.map((n) => [n.id, n]));
  const lookup = buildEndpointObjectLookup(document);
  const netsOf = related(document.nets, (n) =>
    n.terminals.map((t) => t.instanceId),
  );
  const annotationsOf = related(document.annotations, (a) => [
    a.id,
    ...(a.anchor.kind === "object"
      ? [a.anchor.objectId]
      : a.anchor.kind === "route"
        ? [a.anchor.routeId]
        : []),
  ]);
  const claimsOf = related(document.connectivityEvidence, (e) =>
    e.kind === "name-claim" && e.owner.kind === "net-label"
      ? [e.owner.annotationId]
      : e.kind === "name-claim" && e.owner.kind === "power-marker"
        ? [e.owner.objectId]
        : [],
  );
  const wiresOn = new Set(document.routes.map((r) => r.netId));
  const junctionsOn = new Set(document.junctions.map((j) => j.netId));
  const styledJunctions = document.junctions.some(
    (j) => j.styleOverride?.color,
  );
  return {
    routes,
    nets,
    lookup,
    netsOf,
    annotationsOf,
    claimsOf,
    wiresOn,
    junctionsOn,
    styledJunctions,
  };
}

type CopyReads = ReturnType<typeof buildReads>;
const reads = new WeakMap<SchematicDocument, CopyReads>();

export function copySourceReads(document: SchematicDocument): CopyReads {
  const cached = reads.get(document);
  if (cached) return cached;
  const index = buildReads(document);
  if (isFrozenSnapshot(document)) reads.set(document, index);
  return index;
}

/** Routing membership only needs explicitly selected wires, their ends and the
 * name-bearing owners. Body policy, hidden pins and detached artwork continue
 * to consult the entire source Cell. Styled contact Junctions and power markers
 * use the full ownership path to preserve implicit contacts and legacy claims. */
export function copySelectionInputs(
  source: SchematicDocument,
  instanceIds: readonly string[],
  selection?: ExplicitCopyRoutingSelection,
): SchematicDocument {
  if (!isFrozenSnapshot(source)) return source;
  const read = copySourceReads(source);
  if (
    read.styledJunctions ||
    instanceIds.some((id) => {
      const i = read.lookup.instancesById.get(id);
      return i && isPowerMarkerSymbol(i.symbolId);
    })
  )
    return source;
  const routes = (selection?.routeIds ?? []).flatMap(
    (id) => read.routes.get(id) ?? [],
  );
  const junctionIds = new Set(selection?.junctionIds);
  for (const route of routes) {
    for (const endpoint of routeEndpoints(route))
      if (endpoint.kind === "junction") junctionIds.add(endpoint.junctionId);
  }
  const junctions = [...junctionIds].flatMap(
    (id) => read.lookup.junctionsById.get(id) ?? [],
  );
  const selected = new Set(instanceIds);
  const netIds = new Set<string>();
  for (const item of [...routes, ...junctions]) {
    netIds.add(item.netId);
    for (const lane of item.members ?? []) netIds.add(lane.netId);
  }
  for (const terminal of source.netlist?.terminals ?? [])
    if (terminal.interfaceInstanceIds.some((id) => selected.has(id))) {
      netIds.add(terminal.netId);
      for (const lane of terminal.signal?.members ?? []) netIds.add(lane.netId);
    }
  const owners = [
    ...instanceIds,
    ...junctionIds,
    ...routes.map((r) => r.id),
    ...(selection?.annotationIds ?? []),
  ];
  const claimed = read.claimsOf([
    ...owners,
    ...read.annotationsOf(owners).map((a) => a.id),
  ]);
  for (const claim of claimed) {
    netIds.add(claim.netId);
    if (claim.kind === "name-claim")
      for (const lane of claim.signal?.members ?? []) netIds.add(lane.netId);
  }
  const annotations = read.annotationsOf([...owners, ...netIds]);
  // Keep native declaration order even when the input selection is reversed.
  const routeIds = new Set(routes.map((r) => r.id));
  return {
    ...source,
    routes: orderedIds(source.routes, routeIds),
    junctions: orderedIds(source.junctions, junctionIds),
    nets: orderedIds(source.nets, netIds),
    instances: orderedIds(source.instances, selected),
    annotations,
    connectivityEvidence: read.claimsOf([
      ...owners,
      ...annotations.map((a) => a.id),
      ...netIds,
    ]),
  };
}

const idPositions = new WeakMap<
  readonly { id: string }[],
  Map<string, number>
>();
function orderedIds<T extends { id: string }>(
  items: readonly T[],
  ids: ReadonlySet<string>,
): T[] {
  let positions = idPositions.get(items);
  if (!positions) {
    positions = new Map(items.map((item, i) => [item.id, i]));
    if (isFrozenSnapshot(items)) idPositions.set(items, positions);
  }
  const indexes = [...ids].flatMap((id) => positions.get(id) ?? []);
  return indexes.sort((a, b) => a - b).map((i) => items[i]!);
}
