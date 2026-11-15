// What a caller's drawing keeps when the symbol of a part it places changes:
// the same pins joined, and every join still drawn (#2287, #2289).
import type {
  CircuitProject,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  sameCommonPinJoins,
  type UnresolvedStretchedRoute,
} from "./stretched-route-clearance.js";
import { findUndrawnCallerJoin } from "./transaction-direct-contact.js";

/**
 * Why a caller's follow of its changed symbol is refused, or null: the follow
 * joins pins its drawing did not join or parts pins it did (#2287), or leaves
 * two pins joined with nothing drawn between them (#2289). `after` is null
 * when the follow itself was refused; that refusal is named here only when a
 * wire was left over another Net for want of a clear path. Names the changed
 * Cell, the moved pin and what its wire meets.
 */
export function callerConnectivityRefusal(
  project: CircuitProject,
  before: { document: SchematicDocument; resolver: SymbolResolver },
  after: { document: SchematicDocument; resolver: SymbolResolver } | null,
  callerIds: ReadonlySet<string>,
  unresolved: readonly UnresolvedStretchedRoute[],
): string | null {
  const parent = before.document;
  const pinText = (endpoint: RouteEndpoint) => {
    if (endpoint.kind !== "terminal") return `Junction ${endpoint.junctionId}`;
    const instance = parent.instances.find(
      (item) => item.id === endpoint.instanceId,
    );
    return `${instance?.reference ?? endpoint.instanceId}.${endpoint.pinName}`;
  };
  const cellOf = (instanceId: string) => {
    const binding = parent.instances.find((item) => item.id === instanceId)
      ?.netlist?.binding;
    if (binding?.kind === "subcircuit")
      return (
        project.documents.find(
          (document) => document.id === binding.childDocumentId,
        )?.netlist?.name ?? binding.childDocumentId
      );
    if (binding?.kind === "external-subcircuit")
      return (
        project.externalSubcircuitDefinitions.find(
          (definition) => definition.id === binding.definitionId,
        )?.name ?? binding.definitionId
      );
    return instanceId;
  };
  const callerPin = (endpoints: readonly RouteEndpoint[]) =>
    endpoints.find(
      (endpoint) =>
        endpoint.kind === "terminal" && callerIds.has(endpoint.instanceId),
    ) as Extract<RouteEndpoint, { kind: "terminal" }> | undefined;
  const nothing = "Nothing was changed.";
  // A wire with no clear path at all is the one to name; a clear path
  // refused may be refused only while that wire merges two Nets.
  // One that meets only another stuck wire is named after that wire.
  const rank = (item: UnresolvedStretchedRoute) =>
    Number(item.clearPath) * 2 +
    Number(
      unresolved.some(
        (other) =>
          other !== item && item.conflict.includes(`Route ${other.routeId} `),
      ),
    );
  const blocked = [...unresolved]
    .sort((a, b) => rank(a) - rank(b))
    .flatMap((item) => {
      const pin = callerPin(item.ends);
      if (!pin) return [];
      const where = `${cellOf(pin.instanceId)}'s symbol moves ${pinText(pin)} in ${parent.name}`;
      return [
        item.clearPath
          ? `${where}, and every clear path for its wire would join another Net (as stretched: ${item.conflict}). Move the parts apart, or disconnect ${pinText(pin)} first. ${nothing}`
          : `${where}, and its wire has no clear path (as stretched: ${item.conflict}). Move the parts apart, or disconnect ${pinText(pin)} first. ${nothing}`,
      ];
    });
  if (!after) return blocked[0] ?? null;
  const joinsKept = sameCommonPinJoins(parent, after.document);
  const undrawn = joinsKept
    ? findUndrawnCallerJoin(before, after, callerIds)
    : null;
  if (joinsKept && !undrawn) return null;
  if (blocked[0]) return blocked[0];
  if (undrawn) {
    const pin = undrawn.pin as Extract<RouteEndpoint, { kind: "terminal" }>;
    return `${cellOf(pin.instanceId)}'s symbol moves ${pinText(pin)} in ${parent.name} away from ${pinText(undrawn.other)}, which touched it, and no wire could be drawn between them. Draw a wire between them first. ${nothing}`;
  }
  // Which caller pin's Net mates changed, as joined or parted.
  const mates = (document: SchematicDocument) =>
    new Map(
      document.nets.flatMap((net) => {
        const pins = net.terminals.map(
          (terminal) => `${terminal.instanceId}.${terminal.pinName}`,
        );
        return pins.map((pin) => [pin, new Set(pins)] as const);
      }),
    );
  const was = mates(parent);
  const now = mates(after.document);
  for (const net of parent.nets)
    for (const terminal of net.terminals) {
      if (!callerIds.has(terminal.instanceId)) continue;
      const key = `${terminal.instanceId}.${terminal.pinName}`;
      const left = was.get(key)!;
      const right = now.get(key);
      if (!right) continue;
      const text = (pin: string) => {
        const [instanceId, ...name] = pin.split(".");
        return pinText({
          kind: "terminal",
          instanceId: instanceId!,
          pinName: name.join("."),
        });
      };
      const joined = [...right].filter((pin) => !left.has(pin) && was.has(pin));
      const parted = [...left].filter((pin) => !right.has(pin) && now.has(pin));
      const self = text(key);
      if (joined.length)
        return `${cellOf(terminal.instanceId)}'s symbol change would join ${self} in ${parent.name} to ${joined.map(text).join(", ")}, of another Net. ${nothing}`;
      if (parted.length)
        return `${cellOf(terminal.instanceId)}'s symbol change would part ${self} in ${parent.name} from ${parted.map(text).join(", ")}, on its Net. ${nothing}`;
    }
  return `The symbol change would change which pins are joined in ${parent.name}. ${nothing}`;
}
