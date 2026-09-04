import { referencePolicyForInstance } from "@icm/devices";
import { instanceReferenceAnnotation } from "@icm/derived";
import type { Annotation, CircuitProject } from "@icm/model";

import type { ProjectStructureEdit } from "./project-transaction.js";

export interface ReferencePrefixDisplayTarget {
  readonly documentId: string;
  readonly instanceId: string;
}

export interface ReferencePrefixDisplayPreview {
  readonly applicable: readonly ReferencePrefixDisplayTarget[];
  readonly unchanged: readonly ReferencePrefixDisplayTarget[];
  readonly incompatible: readonly (ReferencePrefixDisplayTarget & {
    readonly reason: string;
  })[];
  readonly blocked: readonly (ReferencePrefixDisplayTarget & {
    readonly reason: string;
  })[];
  readonly edits: readonly ProjectStructureEdit[];
}

/**
 * The same Annotation drawn with or without its device Reference prefix. The
 * flag is presentation-only and absent by default, so turning the display back
 * on removes the key rather than persisting `false`.
 */
export function annotationWithReferencePrefixHidden(
  annotation: Annotation,
  hidden: boolean,
): Annotation {
  const { referencePrefixHidden: _current, ...rest } = annotation;
  return hidden ? { ...rest, referencePrefixHidden: true } : rest;
}

/**
 * Plan the Reference-prefix display switch for an explicit set of components.
 *
 * A hidden prefix changes nothing electrical: the Instance keeps the whole
 * authored Reference, so allocation, uniqueness, the device prefix policy, and
 * every exported netlist are untouched. Only the label on the sheet is
 * shortened — which is how a resistor authored as `RG1` can present itself as
 * the conductance `G1` without inventing a second naming authority.
 */
export function planReferencePrefixDisplay(
  project: CircuitProject,
  targets: readonly ReferencePrefixDisplayTarget[],
  hidden: boolean,
): ReferencePrefixDisplayPreview {
  const applicable: ReferencePrefixDisplayTarget[] = [];
  const unchanged: ReferencePrefixDisplayTarget[] = [];
  const incompatible: Array<ReferencePrefixDisplayTarget & { reason: string }> =
    [];
  const blocked: Array<ReferencePrefixDisplayTarget & { reason: string }> = [];
  const annotationsByDocument = new Map<string, Annotation[]>();
  for (const target of targets) {
    const document = project.documents.find(
      (candidate) => candidate.id === target.documentId,
    );
    const instance = document?.instances.find(
      (candidate) => candidate.id === target.instanceId,
    );
    if (!document || !instance) {
      blocked.push({ ...target, reason: "Instance no longer exists" });
      continue;
    }
    if (referencePolicyForInstance(instance).kind !== "required") {
      incompatible.push({
        ...target,
        reason: "Symbol carries no reference prefix",
      });
      continue;
    }
    const annotation = instanceReferenceAnnotation(document, instance.id);
    if (!annotation) {
      incompatible.push({ ...target, reason: "Component shows no reference" });
      continue;
    }
    if ((annotation.referencePrefixHidden === true) === hidden) {
      unchanged.push(target);
      continue;
    }
    applicable.push(target);
    const pending = annotationsByDocument.get(document.id) ?? [];
    pending.push(annotationWithReferencePrefixHidden(annotation, hidden));
    annotationsByDocument.set(document.id, pending);
  }
  const edits: ProjectStructureEdit[] = [
    ...annotationsByDocument.entries(),
  ].map(([documentId, annotations]) => {
    const document = project.documents.find((item) => item.id === documentId)!;
    return {
      kind: "transact_document",
      documentId,
      expectedRevision: document.revision,
      edits: annotations.map((annotation) => ({
        kind: "upsert_schematic_annotation" as const,
        annotation,
      })),
    };
  });
  return { applicable, unchanged, incompatible, blocked, edits };
}
