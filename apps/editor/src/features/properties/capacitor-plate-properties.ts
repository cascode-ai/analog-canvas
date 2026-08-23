import { deviceDescriptor } from "@icm/devices";
import type { DevicePinSemanticRole } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";

type Instance = SchematicDocument["instances"][number];

export interface CapacitorPlatePropertyRow {
  readonly role: DevicePinSemanticRole;
  readonly label: "Top plate" | "Bottom plate";
  readonly pinName: string;
  readonly sourceNodePosition: number;
  readonly netId: string | null;
  readonly netName: string | null;
}

const PLATE_ORDER: readonly DevicePinSemanticRole[] = [
  "capacitor-top-plate",
  "capacitor-bottom-plate",
];

/**
 * Read-only Properties projection of descriptor-owned capacitor terminal
 * meaning and current document connectivity. Page orientation is deliberately
 * absent: rotate/mirror never changes which stable Pin owns each plate role.
 */
export function capacitorPlatePropertyRows(
  document: SchematicDocument,
  instance: Instance,
): readonly CapacitorPlatePropertyRow[] | null {
  const descriptor = deviceDescriptor(instance.symbolId);
  if (descriptor?.deviceClass !== "capacitor") return null;

  return PLATE_ORDER.flatMap((role) => {
    const semantic = descriptor.pinSemantics?.find(
      (candidate) => candidate.role === role,
    );
    if (!semantic) return [];
    const net = document.nets.find((candidate) =>
      candidate.terminals.some(
        (terminal) =>
          terminal.instanceId === instance.id &&
          terminal.pinName === semantic.pinName,
      ),
    );
    return [
      {
        role,
        label: role === "capacitor-top-plate" ? "Top plate" : "Bottom plate",
        pinName: semantic.pinName,
        sourceNodePosition: descriptor.pinOrder.indexOf(semantic.pinName) + 1,
        netId: net?.id ?? null,
        netName: net
          ? (resolveDocumentLogicalNets(document).byBaseNetId.get(net.id)
              ?.name ?? null)
          : null,
      },
    ];
  });
}
