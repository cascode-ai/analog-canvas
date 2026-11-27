import type { CircuitProject, Instance } from "@icm/model";

import { terminalPinKey } from "../document-read-helpers.js";
import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator, type ObjectLocator } from "../object-locator.js";

/** Device classes that force the voltage across their two pins. */
export const VOLTAGE_SOURCE_CLASSES: ReadonlySet<string> = new Set([
  "voltage-source",
  "vcvs",
  "ccvs",
]);

export function isSubcircuitBound(instance: Instance): boolean {
  const binding = instance.netlist?.binding?.kind;
  return (
    binding === "subcircuit" ||
    binding === "external-subcircuit" ||
    binding === "unresolved-subcircuit"
  );
}

export function terminalLocator(
  documentId: string,
  instanceId: string,
  pinName: string,
): ObjectLocator {
  return {
    ...directObjectLocator(documentId, "terminal", `${instanceId}:${pinName}`),
    endpoint: { kind: "terminal", instanceId, pinName },
  };
}

export function buildTerminalLogicalNetMap(
  document: CircuitProject["documents"][number],
  logicalNets: ReturnType<typeof resolveDocumentLogicalNets>,
): Map<string, string> {
  const netOfTerminal = new Map<string, string>();
  for (const net of document.nets)
    for (const terminal of net.terminals)
      netOfTerminal.set(
        terminalPinKey(terminal.instanceId, terminal.pinName),
        logicalNets.byBaseNetId.get(net.id)?.id ?? net.id,
      );
  return netOfTerminal;
}
