import { defaultVddPowerLabelPlacement } from "@icm/derived";
import { supplyLabelFormat } from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import type { ResolvedSymbol } from "@icm/symbols";

/**
 * The placed VDD power port keeps the reviewed marker artwork (a filled bar
 * with a hidden default label), so its visible "VDD" text is a separate
 * power-label annotation — the same semantic typography the drawn rail uses.
 * The id prefix differs from the rail's `label-` prefix so a device and a rail
 * can never overwrite each other's label. `name` is the supply the label
 * shows; its V-italic, upright-subscript format is stored from the start.
 */
export function vddPowerLabelAnnotation(options: {
  instance: SchematicDocument["instances"][number];
  resolved: ResolvedSymbol;
  netId: string;
  grid: number;
  name: string;
}): Annotation {
  const placement = defaultVddPowerLabelPlacement(
    options.instance,
    options.resolved,
    options.grid,
  );
  if (!placement || !options.instance.placement) {
    throw new Error("VDD Port power label requires a placed VDD Port Symbol");
  }
  const position = options.instance.placement.position;
  const format = supplyLabelFormat(options.name);
  return {
    id: `power-label-${options.instance.id.toLowerCase()}`,
    kind: "power-label",
    binding: { kind: "net-name", netId: options.netId },
    ...(format ? { formatOverride: format } : {}),
    netId: options.netId,
    anchor: {
      kind: "object",
      objectId: options.instance.id,
      localOffset: {
        x: placement.position.x - position.x,
        y: placement.position.y - position.y,
      },
      fallbackPosition: placement.position,
    },
    alignment: placement.alignment,
    rotation: 0,
    locked: false,
  };
}
