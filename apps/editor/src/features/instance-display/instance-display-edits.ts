import { resolveDocumentStyleProfile } from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type { Annotation, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { instanceLabelAnnotationFor } from "./default-instance-display";
import {
  defaultInstanceLabel,
  defaultInstanceValue,
  instanceValueAnnotation,
} from "../wiring/route-interaction-geometry";

/** Shared GUI/MCP visibility policy. Reuse authored projections, including
 * older free anchors, instead of creating a second label over them. */
export function instanceDisplayEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  display: {
    showReference?: boolean | undefined;
    showValue?: boolean | undefined;
  },
): SchematicEdit[] {
  const edits: SchematicEdit[] = [];
  const style = resolveDocumentStyleProfile(document.presentation);
  for (const id of new Set(instanceIds)) {
    const instance = document.instances.find((item) => item.id === id);
    if (!instance?.placement) continue;
    for (const field of ["reference", "value"] as const) {
      const visible =
        field === "reference" ? display.showReference : display.showValue;
      if (visible === undefined) continue;
      const bindingKind =
        field === "reference" ? "instance-reference" : "instance-value";
      const existing =
        (field === "reference"
          ? instanceLabelAnnotationFor(document, id)
          : instanceValueAnnotation(document, id)) ??
        document.annotations.find(
          (item) =>
            item.binding?.kind === bindingKind &&
            "instanceId" in item.binding &&
            item.binding.instanceId === id,
        );
      let annotation: Annotation | null | undefined = existing;
      if (!annotation && visible)
        annotation =
          field === "reference"
            ? defaultInstanceLabel(document, instance, resolver, style)
            : defaultInstanceValue(document, instance, resolver, style);
      if (!annotation) continue;
      if (annotation.anchor.kind === "free") {
        const position = annotation.anchor.position;
        annotation = {
          ...annotation,
          anchor: {
            kind: "object",
            objectId: id,
            localOffset: {
              x: position.x - instance.placement.position.x,
              y: position.y - instance.placement.position.y,
            },
            fallbackPosition: position,
          },
        };
      }
      const { visible: _visible, ...rest } = annotation;
      edits.push({
        kind: "upsert_schematic_annotation",
        annotation: visible ? rest : { ...rest, visible: false },
      });
    }
  }
  return edits;
}
