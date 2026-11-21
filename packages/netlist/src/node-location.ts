import { resolveCommittedDocumentLogicalNets } from "@icm/derived";
import {
  foldNetName,
  type CircuitProject,
  type RouteEndpoint,
} from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import type { ResolvePrintedNode } from "./printed-netlist.js";

type Terminal = Extract<RouteEndpoint, { kind: "terminal" }>;

/** Read the ID carried by the allocated IR name in its Cell, not by parsing
 * the printed deck. The actual Document makes generated nodes ineligible. */
export function designNodeLocations(
  project: CircuitProject,
  ambiguousNets?: ReadonlyMap<string, ReadonlySet<string>>,
): ResolvePrintedNode {
  const documents = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const cached = new Map<string, ReturnType<typeof prepare>>();

  function prepare(cell: Parameters<ResolvePrintedNode>[0]) {
    const document = documents.get(cell.id);
    if (!document || cell.origin === "generated-model") return undefined;
    const logical = resolveCommittedDocumentLogicalNets(document);
    const ambiguous = ambiguousNets?.get(cell.id);
    const printedNets = new Map<string, string | null>();
    for (const { id, name } of cell.nets) {
      const net = logical.byId.get(id);
      printedNets.set(
        name,
        !printedNets.has(name) &&
          net &&
          !net.conflicts.length &&
          !net.baseNetIds.some((base) => ambiguous?.has(base))
          ? id
          : null,
      );
    }
    const instances = new Map(
      document.instances.map((instance) => [instance.id, instance]),
    );
    const terminalsByInstance = new Map<
      string,
      Array<{ endpoint: Terminal; netId: string; label: string }>
    >();
    for (const net of document.nets) {
      const logicalId = logical.byBaseNetId.get(net.id)?.id;
      if (!logicalId) continue;
      for (const terminal of net.terminals) {
        const instance = instances.get(terminal.instanceId);
        if (!instance) continue;
        const member = terminal.memberId
          ? resolver
              .resolve(instance.symbolId, instance.symbolVariantId)
              ?.definition.pins.find(
                (pin) =>
                  foldNetName(pin.name) === foldNetName(terminal.pinName),
              )
              ?.signalMembers?.find(({ id }) => id === terminal.memberId)
          : undefined;
        const endpoints = terminalsByInstance.get(instance.id) ?? [];
        endpoints.push({
          endpoint: { kind: "terminal", ...terminal },
          label: member?.name ?? terminal.pinName,
          netId: logicalId,
        });
        terminalsByInstance.set(instance.id, endpoints);
      }
    }
    return { instances, printedNets, terminalsByInstance, logical };
  }

  return (cell, instance, node) => {
    if (!cached.has(cell.id)) cached.set(cell.id, prepare(cell));
    const source = cached.get(cell.id);
    const part = source?.instances.get(instance.id);
    if (!source || !part) return;
    const netId = source.printedNets.get(node.netName);
    if (!netId) return;
    const control = part.netlist?.control;
    if (control?.kind === "voltage") {
      const baseNetId =
        node.pinName === "CTRL+"
          ? control.positiveNetId
          : node.pinName === "CTRL-"
            ? control.negativeNetId
            : undefined;
      if (baseNetId && source.logical.byBaseNetId.get(baseNetId)?.id !== netId)
        return;
    }
    const pin = foldNetName(node.canvasPinName ?? node.pinName);
    const authored = source.terminalsByInstance
      .get(instance.id)
      ?.filter((terminal) => foldNetName(terminal.label) === pin);
    const candidates = authored?.filter((terminal) => terminal.netId === netId);
    // Legacy extraction can print separate schematic Nets as the same token.
    // A matching terminal on a different schematic Net cannot locate this one.
    if (authored?.length && !candidates?.length) return;
    const terminal = candidates?.length === 1 ? candidates[0] : undefined;
    return {
      netId,
      ...(terminal
        ? { endpoint: terminal.endpoint, pinLabel: terminal.label }
        : {}),
    };
  };
}
