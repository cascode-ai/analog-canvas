import type { SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { NetLabelPlacementTarget } from "../wiring/route-interaction-geometry";
import type { SchematicClipboard } from "./clipboard";

/** Only a label copied on its own can acquire a destination wire's Net. */
export function standaloneCopiedNetLabel(clipboard: SchematicClipboard) {
  const label = clipboard.annotations[0];
  if (
    clipboard.intent !== "clone-selection" ||
    clipboard.annotations.length !== 1 ||
    clipboard.instances.length ||
    clipboard.routes.length ||
    clipboard.junctions.length ||
    clipboard.draftingObjects.length ||
    clipboard.cellTerminals.length ||
    clipboard.noConnects.length ||
    label?.kind !== "net-label" ||
    label.binding?.kind !== "net-name" ||
    !clipboard.connectivityEvidence.some(
      (evidence) =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "net-label" &&
        evidence.owner.annotationId === label.id,
    )
  )
    return null;
  return { annotation: label, netId: label.binding.netId };
}

/** Attach the already copied label, retaining its complete authored look. */
export function copiedNetLabelAttachmentEdits(
  document: SchematicDocument,
  annotationId: string,
  target: NetLabelPlacementTarget,
): SchematicEdit[] {
  const label = document.annotations.find((item) => item.id === annotationId);
  const route = document.routes.find((item) => item.id === target.routeId);
  if (!label || !route)
    throw new Error("The copied Net Label or its target wire is unavailable");
  return [
    {
      kind: "upsert_schematic_annotation",
      annotation: {
        ...label,
        netId: route.netId,
        binding: { kind: "net-name", netId: route.netId },
        anchor: {
          kind: "route",
          ...target.routeAttachment,
          orientation: "follow",
          fallbackPosition: target.labelPosition,
        },
      },
    },
    ...document.connectivityEvidence.flatMap((evidence): SchematicEdit[] =>
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "net-label" &&
      evidence.owner.annotationId === label.id
        ? [
            {
              kind: "upsert_connectivity_evidence",
              evidence: { ...evidence, netId: route.netId },
            },
          ]
        : [],
    ),
  ];
}
