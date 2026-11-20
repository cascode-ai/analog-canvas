import {
  deriveStableId,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveDocumentLogicalNets,
  type EndpointObjectLookup,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

/** Read aggregate membership from the electrical declaration, never label spelling. */
export function signalEndpointMembers(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint,
  lookup?: EndpointObjectLookup,
): Array<{ id: string; netId: string; name?: string }> | undefined {
  if (endpoint.memberId) return undefined;
  if (endpoint.kind === "junction") {
    const junction = lookup
      ? lookup.junctionsById.get(endpoint.junctionId)
      : document.junctions.find((item) => item.id === endpoint.junctionId);
    const members = junction?.members;
    if (!members) return undefined;
    const logical =
      lookup?.logicalNetResolution ?? resolveDocumentLogicalNets(document);
    return members.map((member) => ({
      ...member,
      ...(logical.byBaseNetId.get(member.netId)?.name
        ? { name: logical.byBaseNetId.get(member.netId)!.name! }
        : {}),
    }));
  }
  const declaration = document.netlist?.terminals.find(
    (item) =>
      item.interfaceInstanceIds.includes(endpoint.instanceId) &&
      endpoint.pinName === "P",
  );
  if (declaration?.signal && declaration.signal.members.length > 1)
    return declaration.signal.members;
  const instance = lookup
    ? lookup.instancesById.get(endpoint.instanceId)
    : document.instances.find((item) => item.id === endpoint.instanceId);
  const members =
    instance &&
    resolver
      .resolve(instance.symbolId, instance.symbolVariantId)
      ?.definition.pins.find((pin) => pin.name === endpoint.pinName)
      ?.signalMembers;
  if (!members) return undefined;
  return members.map((member) => ({
    ...member,
    netId:
      document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === endpoint.instanceId &&
            terminal.pinName === endpoint.pinName &&
            terminal.memberId === member.id,
        ),
      )?.id ?? deriveStableId("signal-net", endpoint.instanceId, member.id),
  }));
}
