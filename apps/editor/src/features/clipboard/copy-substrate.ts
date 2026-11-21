import type { SchematicEdit } from "@icm/edit-engine";
import { reviewedExternalDefinitionBinding } from "@icm/devices";
import {
  endpointKey,
  pdkSubstrateDefaultNet,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { CircuitProject, Net, SchematicDocument } from "@icm/model";
import type { SchematicClipboard } from "./clipboard";

type Definitions = CircuitProject["externalSubcircuitDefinitions"];

const terminalKey = (terminal: Net["terminals"][number]) =>
  endpointKey({ kind: "terminal", ...terminal });

function unboundSubstrates(
  clipboard: SchematicClipboard,
  definitions: Definitions,
) {
  if (!definitions.length) return [];
  const byId = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const carried = new Set(
    clipboard.nets.flatMap((net) => net.terminals.map(terminalKey)),
  );
  return clipboard.instances.flatMap((instance) => {
    const binding = instance.netlist?.binding;
    if (binding?.kind !== "external-subcircuit") return [];
    const reviewed = reviewedExternalDefinitionBinding(
      byId.get(binding.definitionId),
      instance.symbolId,
    );
    return (reviewed?.terminals ?? [])
      .filter(
        (pin) => pin.interaction === "property" && pin.role === "substrate",
      )
      .map(({ pinName }) => ({ instanceId: instance.id, pinName }))
      .filter((terminal) => !carried.has(terminalKey(terminal)));
  });
}

export function captureDefaultSubstrateTerminals(
  document: SchematicDocument,
  clipboard: SchematicClipboard,
  definitions: Definitions,
) {
  const candidates = unboundSubstrates(clipboard, definitions);
  if (!candidates.length) return [];

  const logical = resolveDocumentLogicalNets(document);
  const defaultNet = pdkSubstrateDefaultNet(document, logical);
  const group = defaultNet && logical.byBaseNetId.get(defaultNet.id);
  if (!group) return [];
  const baseNetIds = new Set(group.baseNetIds);
  const followers = new Set(
    document.nets
      .filter((net) => baseNetIds.has(net.id))
      .flatMap((net) => net.terminals.map(terminalKey)),
  );
  return candidates.filter((terminal) => followers.has(terminalKey(terminal)));
}

/** Recheck native clipboard hints against the copied models and memberships. */
export function validatedDefaultSubstrateTerminals(
  clipboard: SchematicClipboard,
  definitions: Definitions,
) {
  const defaults = new Set(
    clipboard.defaultSubstrateTerminals?.map(terminalKey),
  );
  return unboundSubstrates(clipboard, definitions).filter((terminal) =>
    defaults.has(terminalKey(terminal)),
  );
}

export function planCopiedSubstrateDefaults(
  document: SchematicDocument,
  terminals: SchematicClipboard["defaultSubstrateTerminals"],
  instanceIds: Readonly<Record<string, string>>,
): SchematicEdit[] {
  if (!terminals?.length) return [];
  const net = pdkSubstrateDefaultNet(document);
  if (!net) return [];
  return terminals.flatMap((terminal): SchematicEdit[] => {
    const instanceId = instanceIds[terminal.instanceId];
    return instanceId
      ? [
          {
            kind: "set_property_terminal_net",
            instanceId,
            pinName: terminal.pinName,
            netId: net.id,
          },
        ]
      : [];
  });
}
