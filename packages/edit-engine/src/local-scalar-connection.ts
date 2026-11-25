import {
  endpointKey,
  scalarEndpointFromKey,
  type DocumentConnectivityIndex,
} from "@icm/derived";
import { routeEndpoints, type Instance, type RouteEndpoint } from "@icm/model";
import type { SchematicEdit } from "./edit-schema.js";
import type { ExpectedElectricalEffect } from "./routing-operation-plan.js";

function isNativeInstance(instance: Instance | undefined): boolean {
  const binding = instance?.netlist?.binding;
  return !binding || binding.kind === "primitive" || binding.kind === "model";
}

/** Limit the scalar proof to the local electrical components of an already validated transaction. */
export function isLocalScalarConnection(
  edits: readonly SchematicEdit[],
  expected: Extract<ExpectedElectricalEffect, { kind: "preserve" | "merge" }>,
  index: DocumentConnectivityIndex,
  memberships: ReadonlyMap<string, string | undefined>,
  changedNetIds: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  const localNet = (id: string | undefined): boolean => {
    if (!id || visited.has(id)) return true;
    visited.add(id);
    const net = index.netsById.get(id);
    if (!net) return true; // A new Net has no prior component.
    const group = index.logicalNetResolution.byBaseNetId.get(id);
    return (
      !!group &&
      group.scope !== "global" &&
      group.formalTerminalIds.length === 0 &&
      group.conflicts.length === 0 &&
      group.baseNetIds.length === 1 &&
      net.terminals.every(
        (t) =>
          !t.memberId &&
          isNativeInstance(index.instancesById.get(t.instanceId)),
      ) &&
      !index.junctionsByNetId.get(id)?.some((j) => j.members) &&
      !index.routesByNetId.get(id)?.some((r) => r.members)
    );
  };
  // Includes both sides of incidental contacts and normalizer changes, even
  // when no planner edit explicitly named the old Net or its remote owners.
  for (const id of changedNetIds) if (!localNet(id)) return false;
  const localEndpoint = (endpoint: RouteEndpoint) =>
    !endpoint.memberId &&
    (endpoint.kind === "junction"
      ? !index.junctionsById.get(endpoint.junctionId)?.members
      : isNativeInstance(index.instancesById.get(endpoint.instanceId))) &&
    localNet(index.endpointToBaseNetId.get(endpointKey(endpoint)));
  const localRoute = (id: string) => {
    const route = index.routesById.get(id);
    return route && !route.members && localNet(route.netId);
  };

  if (
    expected.kind === "merge" &&
    !expected.endpointGroups.every((group) =>
      group.every((key) => {
        const endpoint = scalarEndpointFromKey(key);
        return (
          !!endpoint &&
          localEndpoint(endpoint) &&
          localNet(memberships.get(key))
        );
      }),
    )
  )
    return false;

  return edits.every((edit) => {
    // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- other edit families require full evaluation
    switch (edit.kind) {
      case "add_instance":
        return (
          (edit.instance.symbolId === "nmos" ||
            edit.instance.symbolId === "pmos") &&
          isNativeInstance(edit.instance)
        );
      case "set_route_path":
        return (
          !edit.route.members &&
          localNet(edit.route.netId) &&
          routeEndpoints(edit.route).every(localEndpoint) &&
          !index.routesById.has(edit.route.id)
        );
      case "connect_endpoints":
        return (
          localEndpoint(edit.from) &&
          localEndpoint(edit.to) &&
          localNet(edit.newNetId)
        );
      case "attach_endpoint_to_route":
        return localEndpoint(edit.endpoint) && localRoute(edit.routeId);
      case "add_junction":
        return (
          !edit.members &&
          !edit.contactAnchor &&
          localNet(edit.netId) &&
          (!edit.split || localRoute(edit.split.routeId))
        );
      case "merge_nets":
        return localNet(edit.sourceNetId) && localNet(edit.targetNetId);
      case "upsert_schematic_annotation":
        return (
          edit.annotation.kind === "instance-label" ||
          edit.annotation.kind === "instance-value"
        );
      default:
        return false;
    }
  });
}
