import { semanticTextDocument } from "@icm/model";
import type {
  Annotation,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";

import { displayableInstanceValue } from "./instance-value.js";
import { resolveDocumentLogicalNets } from "./logical-net.js";

const EMPTY_TEXT: RichTextDocument = { runs: [{ kind: "line-break" }] };

/**
 * Resolve one Annotation's sole text source. Bound annotations intentionally
 * never consult a copied rich-text payload: their visible content is a pure
 * projection of the instance, Net, or Cell interface fact they identify.
 */
export function resolveAnnotationText(
  document: SchematicDocument,
  annotation: Annotation,
): RichTextDocument {
  const binding = annotation.binding;
  if (!binding) return annotation.content ?? EMPTY_TEXT;
  if (
    annotation.formatOverride &&
    (binding.kind === "instance-reference" ||
      binding.kind === "net-name" ||
      binding.kind === "cell-terminal-name")
  ) {
    return annotation.formatOverride;
  }
  switch (binding.kind) {
    case "instance-reference": {
      const instance = document.instances.find(
        (candidate) => candidate.id === binding.instanceId,
      );
      return semanticTextDocument(instance?.reference ?? "", "instance-label");
    }
    case "instance-value": {
      const instance = document.instances.find(
        (candidate) => candidate.id === binding.instanceId,
      );
      if (!instance) return EMPTY_TEXT;
      const display = displayableInstanceValue(instance);
      return display.kind === "displayable" ? display.content : EMPTY_TEXT;
    }
    case "net-name": {
      const ownerClaim = document.connectivityEvidence.find(
        (evidence) =>
          evidence.kind === "name-claim" &&
          evidence.netId === binding.netId &&
          ((evidence.owner.kind === "net-label" &&
            evidence.owner.annotationId === annotation.id) ||
            (annotation.anchor.kind === "object" &&
              evidence.owner.kind === "power-marker" &&
              evidence.owner.objectId === annotation.anchor.objectId)),
      );
      const logicalName = resolveDocumentLogicalNets(document).byBaseNetId.get(
        binding.netId,
      )?.name;
      const ownerClaimName =
        ownerClaim?.kind === "name-claim" ? ownerClaim.name : undefined;
      return semanticTextDocument(
        ownerClaimName ?? logicalName ?? "",
        annotation.kind === "power-label" ? "power-label" : "net-label",
      );
    }
    case "cell-terminal-name": {
      const terminal = document.netlist?.terminals.find(
        (candidate) => candidate.id === binding.terminalId,
      );
      return semanticTextDocument(terminal?.name ?? "", "formal-port");
    }
  }
}

/** Route operations use this instead of a copied annotation netId. */
export function annotationBoundNetId(
  annotation: Annotation,
): string | undefined {
  return annotation.binding?.kind === "net-name"
    ? annotation.binding.netId
    : annotation.netId;
}

export function annotationAllowsMultiline(annotation: Annotation): boolean {
  return annotation.binding === undefined;
}
