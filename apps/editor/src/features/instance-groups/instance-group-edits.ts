import type { SchematicEdit } from "@icm/edit-engine";
import type { GridRect, InstanceGroup, SchematicDocument } from "@icm/model";
import { resolveDocumentStyleProfile } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import {
  planPlaceAllUnplacedInstances,
  retainedPlacementDisplayEdits,
} from "../component-insert/placement-tray";

export function planInstanceGroupView(
  document: SchematicDocument,
  group: InstanceGroup,
  viewBox: GridRect,
  resolver: SymbolResolver,
): SchematicEdit[] {
  const placements = group.collapsed
    ? planPlaceAllUnplacedInstances(document, viewBox, new Set(group.memberIds))
    : [];
  return [
    ...placements,
    ...retainedPlacementDisplayEdits(
      document,
      resolver,
      resolveDocumentStyleProfile(document.presentation),
      placements,
    ),
    {
      kind: "set_instance_group",
      group: { ...group, collapsed: !group.collapsed },
    },
  ];
}
