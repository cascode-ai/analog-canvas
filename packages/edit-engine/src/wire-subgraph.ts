import { reviewedExternalDefinitionBinding } from "@icm/devices";
import {
  cachedDocumentConnectivityIndex,
  endpointKey,
  mosBulkKind,
  supplyMarkerForSymbol,
} from "@icm/derived";
import {
  isValidatedCell,
  routeEndpoints,
  type SchematicDocument,
  type RouteBranch,
  type RouteEndpoint,
} from "@icm/model";
import type { EditExecutionContext } from "./transaction-result.js";
import type { SchematicEdit } from "./edit-schema.js";
import { isLocalScalarNet } from "./local-scalar-connection.js";

export type ConductorRows = Pick<
  SchematicDocument,
  "nets" | "junctions" | "routes"
>;
export type ConductorFilter = (
  row: ConductorRows[keyof ConductorRows][number],
) => boolean;
const ordinaryRoute = (route: RouteBranch) =>
  !route.members && (!route.presentation || route.presentation === "wire");

/** Physical closure of a scalar Wire edit, before rebuilding or after contact and topology normalization. */
export function selectWireSubgraph(
  before: SchematicDocument,
  draft: SchematicDocument,
  context: EditExecutionContext,
  edits: readonly SchematicEdit[],
  changed: ReadonlySet<string>,
) {
  if (
    !isValidatedCell(before) ||
    !edits.every(
      (edit) =>
        // A compound cut can retire a path authored earlier in the same
        // transaction. Its actual conductor need not exist in either snapshot.
        (edit.kind === "cut_connection" && edits.length === 1) ||
        (edit.kind === "add_junction" &&
          !edit.members &&
          !edit.contactAnchor) ||
        (edit.kind === "set_route_path" && ordinaryRoute(edit.route)),
    )
  )
    return undefined;
  const index = cachedDocumentConnectivityIndex(
    before,
    context.symbolResolver,
    "committed",
  );
  if (!index) return undefined;
  const nets = new Set<string>(changed);
  const simpleEndpoint = (e: RouteEndpoint) => {
    if (e.memberId) return false;
    if (e.kind === "junction")
      return (
        !e.junctionId.includes(":member:") &&
        !index.junctionsById.get(e.junctionId)?.members
      );
    const instance = index.instancesById.get(e.instanceId);
    const binding = instance?.netlist?.binding;
    // A terminal key with separators can alias a different physical pin.
    if (
      !instance ||
      e.instanceId.includes(":") ||
      e.pinName.includes(":") ||
      e.instanceId.includes("\u0000") ||
      e.pinName.includes("\u0000") ||
      (e.pinName === "B" && mosBulkKind(instance)) ||
      supplyMarkerForSymbol(instance.symbolId)
    )
      return false;
    if (!binding || binding.kind === "model" || binding.kind === "primitive")
      return true;
    if (
      binding.kind !== "external-subcircuit" ||
      (instance.symbolId !== "nmos" && instance.symbolId !== "pmos") ||
      !["D", "G", "S"].includes(e.pinName)
    )
      return false;
    // A reviewed external MOS wrapper has ordinary local artwork pins. A
    // child Cell, inferred interface or imported custom implementation does not supply this proof.
    const definition = context.externalSubcircuitDefinitions?.find(
      (d) => d.id === binding.definitionId,
    );
    if (definition?.interfaceStatus !== "declared") return false;
    return !!reviewedExternalDefinitionBinding(
      definition,
      instance.symbolId,
    )?.terminals.some(
      (t) => t.pinName === e.pinName && t.interaction === "canvas",
    );
  };
  // Each validated old Route belongs to the Base Net of BOTH ends. For a
  // pending path the hint is insufficient: include its actual old owners.
  const includeRoute = (route: RouteBranch) => {
    nets.add(route.netId);
    return (
      ordinaryRoute(route) &&
      routeEndpoints(route).every((endpoint) => {
        const owner = index.endpointToBaseNetId.get(endpointKey(endpoint));
        if (owner !== undefined) nets.add(owner);
        return simpleEndpoint(endpoint);
      })
    );
  };
  for (const id of changed) {
    if (id === before.id || index.instancesById.has(id)) return undefined;
    const old = index.routesById.get(id);
    if (old && !includeRoute(old)) return undefined;
    const junction = index.junctionsById.get(id);
    if (junction) nets.add(junction.netId);
  }
  for (const route of draft.routes)
    if (changed.has(route.id) && !includeRoute(route)) return undefined;
  for (const junction of draft.junctions)
    if (changed.has(junction.id)) {
      if (junction.members || junction.contactAnchor) return undefined;
      nets.add(junction.netId);
    }
  for (const id of nets) {
    const net = index.netsById.get(id);
    if (!net) continue;
    if (
      !isLocalScalarNet(index, id, (t) =>
        simpleEndpoint({ kind: "terminal", ...t }),
      ) ||
      index.logicalNetResolution.byBaseNetId.get(id)?.powerDomain !== "none" ||
      id === before.mosBulkDefaults?.nmosNetId ||
      id === before.mosBulkDefaults?.pmosNetId ||
      index.junctionsByNetId
        .get(id)
        ?.some((j) => j.contactAnchor || j.id.includes(":member:")) ||
      index.routesByNetId.get(id)?.some((r) => !ordinaryRoute(r))
    )
      return undefined;
  }
  // Preserve authored order. After partition or merge include newly allocated
  // Net IDs recorded by the executor when rebuilding the phase's read maps.
  const includes: ConductorFilter = (row) =>
    nets.has(row.id) ||
    changed.has(row.id) ||
    ("netId" in row && (nets.has(row.netId) || changed.has(row.netId)));
  return includes;
}
