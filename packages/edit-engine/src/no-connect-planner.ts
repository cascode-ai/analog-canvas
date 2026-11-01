import {
  deriveStableId,
  type NoConnect,
  type SchematicDocument,
} from "@icm/model";
import { endpointKey } from "@icm/derived";
import { drawnPinNames, type SymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./edit-schema.js";
import { signalEndpointMembers } from "./signal-endpoint.js";
import { migrateSignalContacts } from "./signal-contact-migration.js";

/** The same explicit endpoint set serves the pin menu and semantic Agent command. */
export function planSetNoConnect(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoints: readonly NoConnect["endpoint"][],
  marked: boolean,
): SchematicEdit[] {
  if (!endpoints.length || endpoints.length > 256)
    throw new Error("Choose between 1 and 256 pins or members");
  const keys = new Set<string>();
  return endpoints.flatMap((endpoint): SchematicEdit[] => {
    const key = endpointKey(endpoint);
    if (keys.has(key)) throw new Error("Choose each pin or member only once");
    keys.add(key);
    const instance = document.instances.find(
      (item) => item.id === endpoint.instanceId,
    );
    const symbol =
      instance && resolver.resolve(instance.symbolId, instance.symbolVariantId);
    const pin = symbol?.definition.pins.find(
      (item) => item.name === endpoint.pinName,
    );
    if (!pin)
      throw new Error(
        `Unknown pin: ${endpoint.instanceId}.${endpoint.pinName}`,
      );
    // A pin the part does not draw, as an op-amp's hidden VDD, takes its Net
    // or Auto, never a mark (#1833); an old mark may still be removed.
    if (marked && !drawnPinNames(symbol!).includes(pin.name))
      throw new Error(
        `${instance!.reference ?? instance!.id}.${pin.name} is not drawn; only a drawn pin takes a No Connect mark`,
      );
    const members = signalEndpointMembers(document, resolver, {
      ...endpoint,
      memberId: undefined,
    });
    if (
      members
        ? !members.some((member) => member.id === endpoint.memberId)
        : endpoint.memberId !== undefined
    )
      throw new Error("Choose an explicit existing member of this bus");
    const previous = document.noConnects.find(
      (item) => endpointKey(item.endpoint) === key,
    );
    if (!marked)
      return previous
        ? [{ kind: "remove_no_connect", noConnectId: previous.id }]
        : [];
    if (
      document.nets.some((net) =>
        net.terminals.some(
          (terminal) => endpointKey({ kind: "terminal", ...terminal }) === key,
        ),
      )
    )
      throw new Error(
        `Disconnect this ${endpoint.memberId ? "member" : "endpoint"} before marking it No Connect`,
      );
    if (previous) return [];
    return [
      {
        kind: "add_no_connect",
        noConnect: {
          id: deriveStableId(
            "no-connect",
            document.id,
            String(document.revision),
            key,
          ),
          endpoint,
        },
      },
    ];
  });
}

/** Detach the requested lane using the same preserved-stub rules as interface migration. */
export function planDisconnectPinMember(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: NoConnect["endpoint"],
): SchematicEdit[] {
  const members = signalEndpointMembers(document, resolver, {
    ...endpoint,
    memberId: undefined,
  });
  if (
    !endpoint.memberId ||
    !members?.some((member) => member.id === endpoint.memberId)
  )
    throw new Error("Choose one existing bus member to disconnect");
  if (
    document.netlist?.terminals.some(
      (terminal) =>
        terminal.interfaceInstanceIds.includes(endpoint.instanceId) &&
        endpoint.pinName === "P",
    )
  )
    throw new Error("A formal Cell Pin keeps its interface membership");
  const sourceKey = endpointKey(endpoint);
  if (
    !document.nets.some((net) =>
      net.terminals.some(
        (terminal) =>
          endpointKey({ kind: "terminal", ...terminal }) === sourceKey,
      ),
    )
  )
    return [];
  const draft = structuredClone(document);
  const previous = members.map((member) => ({
    ...member,
    name: member.name ?? member.id,
  }));
  migrateSignalContacts(
    draft,
    resolver,
    { ...endpoint, nextName: endpoint.pinName },
    previous,
    previous.filter((member) => member.id !== endpoint.memberId),
    true,
  );
  const edits: SchematicEdit[] = [];
  for (const junction of draft.junctions) {
    if (document.junctions.some((item) => item.id === junction.id)) continue;
    // Establish all local lanes before routes or selector bindings refer to them.
    edits.push({
      kind: "add_junction",
      junctionId: junction.id,
      netId: junction.netId,
      position: junction.position,
      createNet: true,
    });
    if (junction.members)
      edits.push({
        kind: "set_junction_signal",
        junctionId: junction.id,
        members: junction.members,
      });
  }
  for (const route of draft.routes)
    if (
      JSON.stringify(route) !==
      JSON.stringify(document.routes.find((item) => item.id === route.id))
    )
      edits.push({ kind: "set_route_path", route });
  for (const annotation of draft.annotations)
    if (
      JSON.stringify(annotation) !==
      JSON.stringify(
        document.annotations.find((item) => item.id === annotation.id),
      )
    )
      edits.push({ kind: "upsert_schematic_annotation", annotation });
  edits.push({ kind: "disconnect_endpoint", endpoint });
  return edits;
}
