import { resolveEndpointConnection } from "@icm/derived";
import {
  snapGridPoint,
  type Instance,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

type Placement = NonNullable<Instance["placement"]>;

/** Solve a placement from the routing landing, not the artwork pin contact. */
export function pinAnchoredPlacement(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: Instance,
  anchor: { pinName: string; position: Point },
): Placement {
  if (!instance.placement)
    throw new Error("Pin anchoring requires an orientation");
  const endpoint = {
    kind: "terminal" as const,
    instanceId: instance.id,
    pinName: anchor.pinName,
  };
  const resolveAt = (placement: Placement) =>
    resolveEndpointConnection(
      {
        ...document,
        instances: [
          ...document.instances.filter((item) => item.id !== instance.id),
          { ...instance, placement },
        ],
      },
      resolver,
      endpoint,
    );
  const orientation = { ...instance.placement, position: { x: 0, y: 0 } };
  const origin = resolveAt(orientation);
  if (!origin)
    throw new Error(
      `Cannot resolve routing landing for ${instance.id}.${anchor.pinName}`,
    );
  const placement = {
    ...orientation,
    position: snapGridPoint(
      {
        x: anchor.position.x - origin.gridLanding.x,
        y: anchor.position.y - origin.gridLanding.y,
      },
      document.presentation.grid,
    ),
  };
  const actual = resolveAt(placement)?.gridLanding;
  if (
    !actual ||
    actual.x !== anchor.position.x ||
    actual.y !== anchor.position.y
  ) {
    throw new Error(
      `Pin anchor ${instance.id}.${anchor.pinName} cannot land at (${anchor.position.x}, ${anchor.position.y}) on placement grid ${document.presentation.grid}${actual ? `; nearest reachable landing is (${actual.x}, ${actual.y})` : ""}`,
    );
  }
  return placement;
}
