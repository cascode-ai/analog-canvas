import { referencePolicyForInstance } from "@icm/devices";
import { rewriteRichTextPlainText, semanticTextDocument } from "@icm/model";
import type {
  Annotation,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";

import { displayableInstanceValue } from "./instance-value.js";
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
      const logicalName = (
        logicalNets ?? resolveDocumentLogicalNets(document)
      ).byBaseNetId.get(binding.netId)?.name;
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

/**
 * The Annotation that draws one Instance's Reference, if the Instance has one.
 * Reference display state lives on that Annotation, so every writer and every
 * inspector has to agree on which object it is.
 */
export function instanceReferenceAnnotation(
  document: SchematicDocument,
  instanceId: string,
): Annotation | undefined {
  return document.annotations.find(
    (annotation) =>
      annotation.binding?.kind === "instance-reference" &&
      annotation.binding.instanceId === instanceId,
  );
}

/**
 * The Reference an Annotation actually draws, once a hidden device prefix is
 * taken off. Null means the Annotation shows its whole bound Reference.
 *
 * Hiding is refused when it would leave nothing to draw: an empty projection
 * is how the canvas decides a label is not there at all, so `R` with its `R`
 * hidden would silently delete the label rather than shorten it.
 */
function displayedInstanceReference(
  document: SchematicDocument,
  annotation: Annotation,
): string | null {
  if (annotation.referencePrefixHidden !== true) return null;
  const binding = annotation.binding;
  if (binding?.kind !== "instance-reference") return null;
  const instance = document.instances.find(
    (candidate) => candidate.id === binding.instanceId,
  );
  const reference = instance?.reference;
  if (!instance || !reference) return null;
  const policy = referencePolicyForInstance(instance);
  if (policy.kind !== "required") return null;
  const prefix = reference.slice(0, policy.prefix.length);
  if (prefix.toUpperCase() !== policy.prefix.toUpperCase()) return null;
  const remainder = reference.slice(policy.prefix.length);
  return remainder.length > 0 ? remainder : null;
}

/**
 * The text a renderer paints, which differs from the annotation's semantic
 * text only by a hidden Reference prefix. Everything that reads a name as a
 * fact — connectivity, netlist export, name editing — keeps calling
 * `resolveAnnotationText`, because the Reference is still the whole `RG1`.
 *
 * Without an authored format override the shortened Reference is recompiled
 * to house style, so `RG1` reads as symbol `G` with subscript `1` rather than
 * as the leftover subscript of the original spelling. With one, the author's
 * own formatting is retained for every character that survives.
 */
export function resolveAnnotationDisplayText(
  document: SchematicDocument,
  annotation: Annotation,
  logicalNets?: ResolvedDocumentLogicalNets,
): RichTextDocument {
  const text = resolveAnnotationText(document, annotation, logicalNets);
  const displayed = displayedInstanceReference(document, annotation);
  if (displayed === null) return text;
  return annotation.formatOverride
    ? rewriteRichTextPlainText(text, displayed)
    : semanticTextDocument(displayed, "instance-label");
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
