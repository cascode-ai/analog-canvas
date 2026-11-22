import type { AgentCommandPlanNote } from "@icm/agent-adapter";
import { resolveEndpointPoint } from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

/**
 * Where a placed or turned capacitor's top plate is. A PDK MIM capacitor
 * exports its pin 1 as PLUS, yet the drawn symbol looks the same either way
 * round, so a quarter turn too many swaps the plates unseen (#2429).
 */
export function capacitorPlateNote(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instances: readonly Instance[],
): AgentCommandPlanNote | undefined {
  const drawn: SchematicDocument = {
    ...document,
    instances: [
      ...document.instances.filter(
        (item) => !instances.some((instance) => instance.id === item.id),
      ),
      ...instances,
    ],
  };
  const plates = instances.flatMap((instance) => {
    const top = deviceDescriptor(instance.symbolId)?.pinSemantics?.find(
      (semantic) => semantic.role === "capacitor-top-plate",
    );
    if (!top || !instance.placement) return [];
    const point = resolveEndpointPoint(drawn, resolver, {
      kind: "terminal",
      instanceId: instance.id,
      pinName: top.pinName,
    });
    return point
      ? [
          {
            instance,
            text: `${instance.reference ?? instance.id} pin ${top.pinName} at (${point.x}, ${point.y})`,
          },
        ]
      : [];
  });
  if (!plates.length) return undefined;
  return {
    code: "CAPACITOR_TOP_PLATE",
    message: `Top plate (PLUS of a PDK MIM capacitor): ${plates
      .map((plate) => plate.text)
      .join("; ")}.`,
    objectIds: plates.map((plate) => plate.instance.id),
  };
}
