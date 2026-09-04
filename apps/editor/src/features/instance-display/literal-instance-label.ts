import { referencePolicyForInstance } from "@icm/devices";
import {
  defaultInstanceLabelPlacement,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import { defaultDraftTextDocument, flattenRichText } from "@icm/model";
import type {
  Annotation,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { instanceLabelAnnotationFor } from "./default-instance-display";

type Instance = SchematicDocument["instances"][number];

/**
 * The one free-text label attached to an Instance. It is ordinary literal
 * text at a label position of the Instance: no naming, netlist, or export
 * authority (ADR 0054). That is exactly why it may read anything — a resistor
 * whose Reference has to stay `R…` for the netlist can still be labelled `gm`.
 */
export function literalInstanceLabelFor(
  document: SchematicDocument,
  instanceId: string,
): Annotation | undefined {
  return document.annotations.find(
    (annotation) =>
      annotation.kind === "instance-label" &&
      annotation.content !== undefined &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instanceId,
  );
}

/** The literal label's plain text, or "" when the Instance has none. */
export function literalInstanceLabelText(
  document: SchematicDocument,
  instanceId: string,
): string {
  const label = literalInstanceLabelFor(document, instanceId);
  return label?.content ? flattenRichText(label.content).trim() : "";
}

/**
 * A proposed Reference the device or hierarchy prefix policy refuses, with
 * the prefix it insists on. The netlist prints the Reference as the element
 * token, so the leading letter is an electrical fact rather than a style.
 */
export function referencePrefixConflict(
  instance: Instance,
  reference: string,
): { readonly prefix: string } | null {
  const policy = referencePolicyForInstance(instance);
  if (policy.kind !== "required") return null;
  const proposed = reference.trim();
  if (!proposed) return null;
  return proposed.toUpperCase().startsWith(policy.prefix.toUpperCase())
    ? null
    : { prefix: policy.prefix };
}

/**
 * The edits behind "show it as a label instead": the Reference projection is
 * hidden where it stands and the typed text takes its place as literal
 * attached text, keeping the size, alignment, and colour the person was
 * looking at. `Instance.reference` is not touched.
 */
export function literalLabelFromReferenceEdit(options: {
  readonly source: Annotation;
  readonly content: RichTextDocument;
  readonly sizeScale: number;
  readonly alignment: Annotation["alignment"];
  readonly id: string;
}): {
  readonly label: Annotation;
  readonly edits: readonly SchematicEdit[];
} | null {
  const { source, content, sizeScale, alignment, id } = options;
  if (source.binding?.kind !== "instance-reference") return null;
  if (!flattenRichText(content).trim()) return null;
  const { visible: _shown, ...projection } = source;
  const label: Annotation = {
    id,
    kind: "instance-label",
    content,
    anchor: source.anchor,
    alignment,
    rotation: source.rotation,
    locked: false,
    sizeScale,
    ...(source.textColor ? { textColor: source.textColor } : {}),
  };
  return {
    label,
    edits: [
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...projection, visible: false },
      },
      { kind: "upsert_schematic_annotation", annotation: label },
    ],
  };
}

export type LiteralInstanceLabelPlan =
  | { readonly kind: "unchanged" }
  | { readonly kind: "rejected"; readonly message: string }
  | {
      readonly kind: "created" | "updated" | "removed";
      readonly edits: readonly SchematicEdit[];
    };

/**
 * The Properties `Label` field: one literal label per Instance, created,
 * rewritten, or removed. A new label takes the place of a hidden Reference
 * projection; otherwise it goes on the next free label line below the
 * Reference so it never covers the Reference or a shown value.
 */
export function planLiteralInstanceLabel(options: {
  readonly document: SchematicDocument;
  readonly instance: Instance;
  readonly text: string;
  readonly resolver: SymbolResolver;
  readonly nextId: () => string;
}): LiteralInstanceLabelPlan {
  const { document, instance, resolver } = options;
  const text = options.text.trim();
  const existing = literalInstanceLabelFor(document, instance.id);
  if (!text) {
    return existing
      ? {
          kind: "removed",
          edits: [
            { kind: "remove_schematic_annotation", annotationId: existing.id },
          ],
        }
      : { kind: "unchanged" };
  }
  if (existing) {
    if (existing.content && flattenRichText(existing.content).trim() === text) {
      return { kind: "unchanged" };
    }
    return {
      kind: "updated",
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: { ...existing, content: defaultDraftTextDocument(text) },
        },
      ],
    };
  }
  if (!instance.placement) {
    return {
      kind: "rejected",
      message: "Place the component before giving it a label",
    };
  }
  const reference = instanceLabelAnnotationFor(document, instance.id);
  const line =
    reference && reference.visible === false
      ? {
          anchor: reference.anchor,
          alignment: reference.alignment,
          rotation: reference.rotation,
        }
      : nextFreeLabelLine(
          document,
          instance,
          resolver,
          reference !== undefined,
        );
  if (!line) {
    return {
      kind: "rejected",
      message: "This component has no label position",
    };
  }
  return {
    kind: "created",
    edits: [
      {
        kind: "upsert_schematic_annotation",
        annotation: {
          id: options.nextId(),
          kind: "instance-label",
          content: defaultDraftTextDocument(text),
          ...line,
          locked: false,
        },
      },
    ],
  };
}

function nextFreeLabelLine(
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  hasReferenceLabel: boolean,
): Pick<Annotation, "anchor" | "alignment" | "rotation"> | null {
  if (!instance.placement) return null;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return null;
  const profile = resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  const referenceLine = defaultInstanceLabelPlacement(
    instance,
    resolved,
    profile,
    grid,
    "reference",
  );
  const valueLine = defaultInstanceLabelPlacement(
    instance,
    resolved,
    profile,
    grid,
    "value",
  );
  if (!referenceLine || !valueLine) return null;
  const valueLineTaken = document.annotations.some(
    (annotation) =>
      annotation.kind === "instance-value" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instance.id &&
      annotation.visible !== false,
  );
  // Continue the label stack: the value line sits one line below the
  // Reference line, so the line after it is the same step again.
  const line = !hasReferenceLabel
    ? referenceLine
    : valueLineTaken
      ? {
          ...valueLine,
          position: {
            x: valueLine.position.x * 2 - referenceLine.position.x,
            y: valueLine.position.y * 2 - referenceLine.position.y,
          },
        }
      : valueLine;
  const origin = instance.placement.position;
  return {
    anchor: {
      kind: "object",
      objectId: instance.id,
      localOffset: {
        x: line.position.x - origin.x,
        y: line.position.y - origin.y,
      },
      fallbackPosition: line.position,
    },
    alignment: line.alignment,
    rotation: 0,
  };
}
