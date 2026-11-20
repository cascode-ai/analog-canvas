import type { SchematicEdit } from "@icm/edit-engine";
import {
  foldNetName,
  type GridRect,
  type InstanceGroup,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveDocumentStyleProfile,
  type ResolvedDocumentLogicalNets,
} from "@icm/derived";
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

export function instanceGroupNetNames(
  document: SchematicDocument,
  logical: ResolvedDocumentLogicalNets,
): ReadonlyMap<string, string> {
  const hints = new Map<string, Map<string, string>>();
  for (const item of document.connectivityEvidence) {
    if (item.kind !== "net-name-hint") continue;
    const id = logical.byBaseNetId.get(item.netId)?.id;
    if (!id) continue;
    const spellings = hints.get(id) ?? new Map<string, string>();
    spellings.set(foldNetName(item.sourceName), item.sourceName);
    hints.set(id, spellings);
  }
  return new Map(
    logical.groups.map((net) => {
      const hint = hints.get(net.id);
      return [
        net.id,
        net.name ??
          (hint?.size === 1 ? hint.values().next().value : undefined) ??
          net.id,
      ];
    }),
  );
}
