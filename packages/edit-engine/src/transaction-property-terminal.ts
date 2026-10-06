import { routeEnd, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./edit-schema.js";
import { rejectedEditMutation, type RejectEdit } from "./transaction-domain.js";

/** Shared local mutation; the transaction coordinator owns normalization and validation. */
export function applyPropertyTerminalEdit(
  edit: Extract<SchematicEdit, { kind: "set_property_terminal_net" }>,
  context: {
    draft: SchematicDocument;
    resolver: SymbolResolver | undefined;
    changedObjectIds: Set<string>;
    reject: RejectEdit;
  },
) {
  const { draft, resolver, changedObjectIds, reject } = context;
  const refuse = (...args: Parameters<RejectEdit>) =>
    rejectedEditMutation(reject, ...args);
  const instance = draft.instances.find((item) => item.id === edit.instanceId);
  if (!instance)
    return refuse(
      "OBJECT_NOT_FOUND",
      `Instance does not exist: ${edit.instanceId}`,
      [],
      [edit.instanceId],
    );
  const symbol = resolver?.resolve(instance.symbolId, instance.symbolVariantId);
  if (!symbol)
    return refuse(
      "EDIT_PRECONDITION",
      "Property terminal edits require a Symbol Resolver",
      [],
      [instance.id],
    );
  if (symbol.definition.pins.some((pin) => pin.name === edit.pinName))
    return refuse(
      "EDIT_PRECONDITION",
      `Canvas terminal ${instance.id}.${edit.pinName} must be wired, not property-bound`,
      [],
      [instance.id],
    );
  if (
    draft.routes.some((route) =>
      [route.start, routeEnd(route)].some(
        (endpoint) =>
          endpoint.kind === "terminal" &&
          endpoint.instanceId === instance.id &&
          endpoint.pinName === edit.pinName,
      ),
    ) ||
    draft.noConnects.some(
      (item) =>
        item.endpoint.instanceId === instance.id &&
        item.endpoint.pinName === edit.pinName,
    )
  )
    return refuse(
      "EDIT_PRECONDITION",
      `Property terminal ${instance.id}.${edit.pinName} cannot own Route or NoConnect geometry`,
      [],
      [instance.id],
    );
  if (edit.netId !== null && !draft.nets.some((net) => net.id === edit.netId))
    return refuse(
      "OBJECT_NOT_FOUND",
      `Net does not exist: ${edit.netId}`,
      [],
      [edit.netId],
    );
  const currentNet = draft.nets.find((net) =>
    net.terminals.some(
      (terminal) =>
        terminal.instanceId === instance.id &&
        terminal.pinName === edit.pinName,
    ),
  );
  if ((currentNet?.id ?? null) === edit.netId)
    return refuse(
      "EDIT_PRECONDITION",
      "Property terminal Net selection does not change the instance",
      [],
      [instance.id],
    );
  for (const net of draft.nets)
    net.terminals = net.terminals.filter(
      (terminal) =>
        terminal.instanceId !== instance.id ||
        terminal.pinName !== edit.pinName,
    );
  if (edit.netId !== null) {
    draft.nets
      .find((net) => net.id === edit.netId)!
      .terminals.push({ instanceId: instance.id, pinName: edit.pinName });
    changedObjectIds.add(edit.netId);
  }
  if (currentNet) changedObjectIds.add(currentNet.id);
  changedObjectIds.add(instance.id);
  return { ok: true as const, connectivityChanged: true };
}
