// The name of the Cell or external definition a Library part is bound to,
// shown on the drawing as a placed Cell shows its own (#2348).
import {
  defaultInstanceLabelPlacement,
  instanceGroupLabel,
  instanceLabelGroupSeat,
  objectStyleProfile,
  resolveDocumentStyleProfile,
  seatedInstanceLabelGroup,
  type InstanceLabelPlacement,
} from "@icm/derived";
import {
  flattenRichText,
  plainNameDocument,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { DocumentEdits } from "./cell-document-edits.js";

type Instance = SchematicDocument["instances"][number];

/** The label a placed Cell's name, or a bound part's master, stands in. */
const masterLabelId = (instanceId: string) => `instance-master-${instanceId}`;

function masterLabel(
  document: SchematicDocument,
  instanceId: string,
): Annotation | undefined {
  return document.annotations.find(
    (annotation) =>
      annotation.id === masterLabelId(instanceId) &&
      annotation.kind === "instance-value" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instanceId,
  );
}

/** The part's shown name label, Reference or display alias. */
function shownNameLabel(
  document: SchematicDocument,
  instanceId: string,
): Annotation | undefined {
  return document.annotations.find(
    (annotation) =>
      annotation.kind === "instance-label" &&
      annotation.visible !== false &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instanceId,
  );
}

const anchoredAt = (
  annotation: Annotation,
  instance: Instance,
  placement: InstanceLabelPlacement,
): Annotation => ({
  ...annotation,
  alignment: placement.alignment,
  anchor: {
    kind: "object",
    objectId: instance.id,
    localOffset: {
      x: placement.position.x - instance.placement!.position.x,
      y: placement.position.y - instance.placement!.position.y,
    },
    fallbackPosition: placement.position,
  },
});

/**
 * A new master label for `instance`, under its shown name as a value stands,
 * with the name moved a row out where the two stand above the part (#1384);
 * in the name's slot when no name shows, as a placed Cell's.
 */
function newMasterLabelEdits(
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  name: string,
): DocumentEdits {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  const origin = instance.placement?.position;
  if (!resolved || !origin) return [];
  const profile = objectStyleProfile(
    resolveDocumentStyleProfile(document.presentation),
    instance,
  );
  const grid = document.presentation.grid;
  const shownName = shownNameLabel(document, instance.id);
  const slot = defaultInstanceLabelPlacement(
    instance,
    resolved,
    profile,
    grid,
    shownName ? "value" : "reference",
  );
  if (!slot) return [];
  const master = anchoredAt(
    {
      id: masterLabelId(instance.id),
      kind: "instance-value",
      content: plainNameDocument(name),
      anchor: {
        kind: "object",
        objectId: instance.id,
        localOffset: { x: 0, y: 0 },
        fallbackPosition: origin,
      },
      alignment: slot.alignment,
      rotation: 0,
      locked: false,
      ...(instance.documentStyle
        ? { documentStyle: structuredClone(instance.documentStyle) }
        : {}),
    },
    instance,
    slot,
  );
  const nameLabel =
    shownName?.rotation === 0
      ? instanceGroupLabel(document, shownName, origin)
      : null;
  const masterLabel = instanceGroupLabel(document, master, origin);
  // The name where its rules put it, read with a value not shown yet.
  const seat =
    nameLabel &&
    masterLabel &&
    instanceLabelGroupSeat(instance, resolved, grid, nameLabel, {
      ...masterLabel,
      position: nameLabel.position,
      alignment: nameLabel.alignment,
      shows: false,
    });
  const seated =
    seat &&
    seatedInstanceLabelGroup(
      instance,
      resolved,
      grid,
      seat,
      nameLabel,
      masterLabel,
    );
  if (!seated || !shownName)
    return [{ kind: "upsert_schematic_annotation", annotation: master }];
  return [
    {
      kind: "upsert_schematic_annotation",
      annotation: anchoredAt(shownName, instance, seated.name),
    },
    {
      kind: "upsert_schematic_annotation",
      annotation: anchoredAt(master, instance, seated.value),
    },
  ];
}

/**
 * The edits that show on a Library part the name of the Cell or external
 * definition it is now bound to, `name`, or take away the one it was bound
 * to, `previous`, when it calls none (#2348). A label its author rewrote is
 * left as it is.
 */
export function boundMasterNameEdits(
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  name: string | undefined,
  previous: string | undefined,
): DocumentEdits {
  const existing = masterLabel(document, instance.id);
  const reads = existing?.content
    ? flattenRichText(existing.content)
    : undefined;
  if (!name)
    return existing && previous !== undefined && reads === previous
      ? [{ kind: "remove_schematic_annotation", annotationId: existing.id }]
      : [];
  if (!existing) return newMasterLabelEdits(document, instance, resolver, name);
  return reads !== name && reads === previous
    ? [
        {
          kind: "upsert_schematic_annotation",
          annotation: { ...existing, content: plainNameDocument(name) },
        },
      ]
    : [];
}
