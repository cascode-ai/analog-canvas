import { annotationOwningInstanceId, sameDocumentStyle } from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument, StyleOverrides } from "@icm/model";

import { STYLE_KNOBS } from "./style-knobs";

interface SelectedObjects {
  readonly instanceIds: readonly string[];
  readonly routeIds: readonly string[];
  readonly junctionIds: readonly string[];
  readonly annotationIds: readonly string[];
  readonly draftingIds: readonly string[];
}

/** Selected copies that still draw like the drawing they came from. */
export interface KeptDocumentStyle {
  readonly objectIds: readonly string[];
  /** The kept factors, e.g. "Font size 2×, Wire thickness 1.5×". */
  readonly description: string;
}

/** Name the factors a kept style changes, in the Style settings' words. */
export function describeDocumentStyle(style: StyleOverrides): string {
  const factors = STYLE_KNOBS.flatMap((knob) => {
    const value = style[knob.key] ?? 1;
    return value === 1 ? [] : [`${knob.label} ${value}×`];
  });
  return factors.length ? factors.join(", ") : "the standard style";
}

/**
 * The selected objects that keep a copy source's Document style, with the
 * labels and No Connect marks of selected parts, which draw with them.
 * Locked text and drawing objects stay as they are.
 */
export function keptDocumentStyleOfSelection(
  document: SchematicDocument,
  selection: SelectedObjects,
): KeptDocumentStyle | null {
  const instanceIds = new Set(selection.instanceIds);
  const routeIds = new Set(selection.routeIds);
  const junctionIds = new Set(selection.junctionIds);
  const annotationIds = new Set(selection.annotationIds);
  const draftingIds = new Set(selection.draftingIds);
  const kept = [
    ...document.instances.filter((instance) => instanceIds.has(instance.id)),
    ...document.routes.filter((route) => routeIds.has(route.id)),
    ...document.junctions.filter((junction) => junctionIds.has(junction.id)),
    ...document.annotations.filter(
      (annotation) =>
        !annotation.locked &&
        (annotationIds.has(annotation.id) ||
          instanceIds.has(annotationOwningInstanceId(annotation) ?? "") ||
          (annotation.anchor.kind === "object" &&
            instanceIds.has(annotation.anchor.objectId))),
    ),
    ...document.noConnects.filter((noConnect) =>
      instanceIds.has(noConnect.endpoint.instanceId),
    ),
    ...(document.drafting?.objects ?? []).filter(
      (object) => !object.locked && draftingIds.has(object.id),
    ),
  ].filter((object) => object.documentStyle);
  if (!kept.length) return null;
  const first = kept[0]!.documentStyle!;
  return {
    objectIds: kept.map((object) => object.id),
    description: kept.every((object) =>
      sameDocumentStyle(object.documentStyle, first),
    )
      ? describeDocumentStyle(first)
      : "styles of several drawings",
  };
}

/** Let kept copies follow this Document's style again. */
export function releaseKeptDocumentStyleEdit(
  kept: KeptDocumentStyle,
): SchematicEdit {
  return {
    kind: "set_object_document_style",
    objectIds: [...kept.objectIds],
    documentStyle: null,
  };
}
