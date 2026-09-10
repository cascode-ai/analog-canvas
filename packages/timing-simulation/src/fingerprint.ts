import { resolveDocumentLogicalNets, sha256Hex } from "@icm/derived";
import type { Instance, SchematicDocument } from "@icm/model";

const SIMULATION_PARAMETER_NAMES: Readonly<Record<string, readonly string[]>> =
  {
    "pulse-voltage-source": [
      "period",
      "dutyCycle",
      "initial",
      "delay",
      "width",
    ],
    "d-flip-flop": ["initialQ"],
  };

function simulationParameters(
  instance: Instance,
): Record<string, string | null> {
  return Object.fromEntries(
    (SIMULATION_PARAMETER_NAMES[instance.symbolId] ?? []).map((name) => [
      name,
      instance.netlist?.parameters[name] ?? null,
    ]),
  );
}

/**
 * Hash only facts that can change digital simulation behavior or trace names.
 * Placement, Route geometry, annotations, drafting, and Document revision are
 * deliberately excluded so presentation edits do not invalidate a run.
 */
export function digitalSimulationInputFingerprint(
  document: SchematicDocument,
): string {
  const logical = resolveDocumentLogicalNets(document);
  const instances = [...document.instances]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((instance) => ({
      id: instance.id,
      symbolId: instance.symbolId,
      symbolVariantId: instance.symbolVariantId ?? null,
      parameters: simulationParameters(instance),
    }));
  const nets = [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((net) => ({
      id: net.id,
      terminals: [...net.terminals].sort((left, right) =>
        `${left.instanceId}\u0000${left.pinName}`.localeCompare(
          `${right.instanceId}\u0000${right.pinName}`,
        ),
      ),
    }));
  const logicalNets = [...logical.groups]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((net) => ({
      id: net.id,
      name: net.name ?? null,
      baseNetIds: [...net.baseNetIds],
      conflicts: [...net.conflicts],
    }));
  return sha256Hex(
    JSON.stringify({ documentId: document.id, instances, nets, logicalNets }),
  );
}
