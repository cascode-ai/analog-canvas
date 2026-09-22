import {
  boundAnnotationName,
  flattenRichText,
  labelTextDocument,
} from "@icm/model";
import type {
  Annotation,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";

import {
  displayableInstanceParameter,
  displayableInstanceValue,
} from "./instance-value.js";
import {
  resolveDocumentLogicalNets,
  type ResolvedDocumentLogicalNets,
} from "./logical-net.js";

const EMPTY_TEXT: RichTextDocument = { runs: [{ kind: "line-break" }] };

/**
 * Resolve one Annotation's sole text source. Bound annotations intentionally
 * never consult a copied rich-text payload: their visible content is a pure
 * projection of the instance, Net, or Cell interface fact they identify.
 */
export function resolveAnnotationText(
  document: SchematicDocument,
  annotation: Annotation,
  logicalNets?: ResolvedDocumentLogicalNets,
): RichTextDocument {
  const semanticLabel = (name: string): RichTextDocument =>
    labelTextDocument(name, document.presentation);
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
      return semanticLabel(instance?.reference ?? "");
    }
    case "instance-value": {
      const instance = document.instances.find(
        (candidate) => candidate.id === binding.instanceId,
      );
      if (!instance) return EMPTY_TEXT;
      const display = binding.parameter
        ? displayableInstanceParameter(
            instance,
            binding.parameter,
            binding.showValue === false ? { showValue: false } : {},
          )
        : displayableInstanceValue(instance);
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
      const logicalName = (
        logicalNets ?? resolveDocumentLogicalNets(document)
      ).byBaseNetId.get(binding.netId)?.name;
      const ownerClaimName =
        ownerClaim?.kind === "name-claim" ? ownerClaim.name : undefined;
      return semanticLabel(ownerClaimName ?? logicalName ?? "");
    }
    case "cell-terminal-name": {
      const terminal = document.netlist?.terminals.find(
        (candidate) => candidate.id === binding.terminalId,
      );
      return semanticLabel(terminal?.name ?? "");
    }
  }
}

/** Electrical names must never be inferred from a lossy rendered string. */
export function resolveAnnotationName(
  document: SchematicDocument,
  annotation: Annotation,
  logicalNets?: ResolvedDocumentLogicalNets,
): string {
  const name = boundAnnotationName(document, annotation);
  if (annotation.binding?.kind === "net-name")
    return (
      name ||
      (logicalNets ?? resolveDocumentLogicalNets(document)).byBaseNetId.get(
        annotation.binding.netId,
      )?.name ||
      ""
    );
  return (
    name ??
    flattenRichText(resolveAnnotationText(document, annotation, logicalNets))
  );
}
