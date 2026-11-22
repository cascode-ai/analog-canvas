import {
  collapsedArrayGroup,
  deriveStableId,
  type InstanceGroup,
  type SchematicDocument,
} from "@icm/model";
import {
  hasExplicitMosBulkRoute,
  resolveCommittedDocumentLogicalNets,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { commonArrayPins, instanceArrayTerminals } from "./instance-array.js";
import type { SchematicEdit } from "./edit-schema.js";
import { endpointOwnerNetId } from "./transaction-routing.js";
import { isFreeWireAnchor, type WireSource } from "./wire-commit-planner.js";
import type { WireMemberEvaluation } from "./wire-member-choice.js";

/** Materialize an array pin with existing junction lanes and real scalar terminals. */
function arrayWireSource(
  document: SchematicDocument,
  source: WireSource,
  peer: WireSource,
  group: InstanceGroup,
  share: boolean,
) {
  const endpoint = source.endpoint;
  if (endpoint.kind !== "terminal")
    throw new Error("An array pin requires a terminal");

  const terminals = instanceArrayTerminals(group, endpoint.pinName);

  const junctionId = deriveStableId("array-pin", group.id, endpoint.pinName);
  const net = (index: number) =>
    deriveStableId("array-pin-net", junctionId, String(index));
  const existing = document.junctions.find(
    (junction) =>
      junction.contactAnchor?.instanceId === endpoint.instanceId &&
      junction.contactAnchor.pinName === endpoint.pinName &&
      junction.members?.length === terminals.length,
  );
  const preludeEdits: SchematicEdit[] = [...source.preludeEdits];
  const byId = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const owners = terminals.map((terminal) => {
    if (
      terminal.pinName === "B" &&
      byId.get(terminal.instanceId)?.mosBulkBinding &&
      !hasExplicitMosBulkRoute(document, terminal.instanceId)
    ) {
      if (
        !preludeEdits.some(
          (edit) =>
            edit.kind === "clear_mos_bulk_default" &&
            edit.instanceId === terminal.instanceId,
        )
      )
        preludeEdits.push({
          kind: "clear_mos_bulk_default",
          instanceId: terminal.instanceId,
        });
      return null;
    }
    return endpointOwnerNetId(document, terminal);
  });
  const logical = resolveCommittedDocumentLogicalNets(document);
  const identity = (netId: string) =>
    logical.byBaseNetId.get(netId)?.id ?? netId;
  if (share) {
    if (
      new Set(owners.flatMap((netId) => (netId ? [identity(netId)] : [])))
        .size > 1 ||
      existing
    )
      throw new Error(
        "The array pin already connects distinct nets; reassign its terminals in Properties first",
      );
    const netId = owners.find(Boolean) ?? net(0);
    const root = terminals[Math.max(0, owners.findIndex(Boolean))]!;
    for (const terminal of terminals.filter((terminal) => terminal !== root))
      preludeEdits.push({
        kind: "connect_endpoints",
        from: root,
        to: terminal,
        newNetId: netId,
      });
    return { ...source, netId, preludeEdits };
  }
  if (peer.members && peer.members.length !== terminals.length)
    throw new Error("The bus width must match the number of array members");
  const members = terminals.map((terminal, index) => {
    if (existing) {
      const lane = existing.members!.find(
        (member) => member.netId === owners[index],
      );
      if (!lane)
        throw new Error(
          "The previous array wiring no longer matches these terminals",
        );
      return lane;
    }
    return {
      id: deriveStableId("array-pin-member", junctionId, terminal.instanceId),
      netId: owners[index] ?? net(index),
    };
  });
  if (
    new Set(members.map((member) => identity(member.netId))).size !==
    terminals.length
  )
    throw new Error(
      "The array pin already shares a scalar net; reassign its terminals in Properties first",
    );
  const anchor = {
    kind: "junction" as const,
    junctionId: existing?.id ?? junctionId,
  };
  if (!existing) {
    preludeEdits.push(
      {
        kind: "add_junction",
        junctionId,
        netId: members[0]!.netId,
        createNet: true,
        position: source.connection.gridLanding,
        contactAnchor: {
          instanceId: endpoint.instanceId,
          pinName: endpoint.pinName,
        },
      },
      { kind: "set_junction_signal", junctionId, members },
    );
    terminals.forEach((terminal, index) =>
      preludeEdits.push({
        kind: "connect_endpoints",
        from: terminal,
        to: { ...anchor, memberId: members[index]!.id },
      }),
    );
  }
  return {
    ...source,
    endpoint: anchor,
    connection: { ...source.connection, endpoint: anchor },
    netId: members[0]!.netId,
    members,
    arrayPinNames: terminals.map(
      (t) =>
        (byId.get(t.instanceId)?.reference ?? t.instanceId) + "." + t.pinName,
    ),
    preludeEdits,
  };
}

export function resolveArrayWirePair(
  document: SchematicDocument,
  resolver: SymbolResolver,
  from: WireSource,
  to: WireSource,
  shareArrayPin: boolean,
): WireMemberEvaluation {
  const groupAt = (source: WireSource) => {
    const pin = source.endpoint;
    if (pin.kind !== "terminal" || pin.memberId || source.members) return;
    const group = collapsedArrayGroup(document, pin.instanceId);
    if (
      group &&
      commonArrayPins(document, resolver, group).includes(pin.pinName)
    )
      return group;
  };
  const fromGroup = groupAt(from);
  const toGroup = groupAt(to);
  if (
    fromGroup &&
    toGroup &&
    fromGroup.memberIds.length !== toGroup.memberIds.length
  )
    return {
      kind: "invalid",
      message: "The two array pins have different widths",
    };
  const pair = { from, to };
  try {
    for (const side of ["from", "to"] as const) {
      const group = side === "from" ? fromGroup : toGroup;
      if (!group) continue;
      const source = side === "from" ? from : to;
      const peer = side === "from" ? to : from;
      const peerGroup = side === "from" ? toGroup : fromGroup;
      const share =
        !peer.members &&
        !peerGroup &&
        (!isFreeWireAnchor(peer) || peer.declaredScalarName !== undefined);
      const prepared = arrayWireSource(document, source, peer, group, share);
      if (share && !shareArrayPin && source.endpoint.kind === "terminal") {
        const netName =
          peer.declaredScalarName ??
          (peer.netId &&
            resolveCommittedDocumentLogicalNets(document).byBaseNetId.get(
              peer.netId,
            )?.name);
        const label =
          "Connect all " +
          group.memberIds.length +
          " " +
          source.endpoint.pinName +
          " pins to " +
          (netName || "this net");
        return {
          kind: "choose",
          side,
          choice: {
            source: prepared,
            allowWhole: false,
            expectedWidth: 1,
            options: [],
            sharedPinLabel: label,
          },
        };
      }
      pair[side] = prepared;
    }
  } catch (error) {
    return {
      kind: "invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { kind: "ready", ...pair };
}
