import type { Instance, SchematicDocument } from "@icm/model";

import { deviceDescriptor } from "./registry.js";

export type ReferencePolicy =
  | { readonly kind: "none" }
  | { readonly kind: "required"; readonly prefix: string };

export const hierarchyReferencePolicy: ReferencePolicy = {
  kind: "required",
  prefix: "X",
};

export interface ReferenceIssue {
  readonly code:
    "MISSING_REFERENCE" | "WRONG_REFERENCE_PREFIX" | "DUPLICATE_REFERENCE";
  readonly instanceId: string;
  readonly reference?: string;
  readonly otherInstanceId?: string;
}

export interface ReferenceIndex {
  readonly byReference: ReadonlyMap<string, readonly string[]>;
  readonly occupiedSuffixesByPrefix: ReadonlyMap<string, ReadonlySet<number>>;
  readonly policyByInstanceId: ReadonlyMap<string, ReferencePolicy>;
  readonly issues: readonly ReferenceIssue[];
}

export interface ReferenceAllocationOptions {
  /** First suffix considered; defaults to the lowest legal suffix (1). */
  readonly startAt?: number;
  /** References reserved by a multi-instance plan that is not yet in the Cell. */
  readonly reservedReferences?: ReadonlySet<string>;
}

export function referencePolicyForInstance(
  instance: Instance,
): ReferencePolicy {
  const binding = instance.netlist?.binding;
  if (
    binding?.kind === "subcircuit" ||
    binding?.kind === "external-subcircuit" ||
    binding?.kind === "unresolved-subcircuit"
  ) {
    return hierarchyReferencePolicy;
  }
  const prefix = deviceDescriptor(instance.symbolId)?.referencePrefix;
  return prefix ? { kind: "required", prefix } : { kind: "none" };
}

export function referencePolicyForSymbol(symbolId: string): ReferencePolicy {
  const prefix = deviceDescriptor(symbolId)?.referencePrefix;
  return prefix ? { kind: "required", prefix } : { kind: "none" };
}

export function referenceSuffixForPolicy(
  reference: string,
  policy: ReferencePolicy,
): number | null {
  if (policy.kind === "none") return null;
  return suffixForPrefix(reference, policy.prefix);
}

function suffixForPrefix(reference: string, prefix: string): number | null {
  const match = new RegExp(`^${prefix}(\\d+)$`, "iu").exec(reference);
  if (!match) return null;
  const suffix = Number(match[1]);
  return Number.isSafeInteger(suffix) && suffix > 0 ? suffix : null;
}

/** One per-Cell, case-folded reference authority for allocation and diagnosis. */
export function createReferenceIndex(
  document: SchematicDocument,
): ReferenceIndex {
  const policyByInstanceId = new Map<string, ReferencePolicy>();
  const byReference = new Map<string, string[]>();
  const occupiedSuffixesByPrefix = new Map<string, Set<number>>();
  const issues: ReferenceIssue[] = [];
  for (const instance of document.instances) {
    const policy = referencePolicyForInstance(instance);
    policyByInstanceId.set(instance.id, policy);
    const reference = instance.reference;
    if (reference) {
      const foldedReference = reference.toLowerCase();
      const instances = byReference.get(foldedReference) ?? [];
      instances.push(instance.id);
      byReference.set(foldedReference, instances);
    }
    if (policy.kind === "none") {
      continue;
    }
    if (!reference) {
      issues.push({ code: "MISSING_REFERENCE", instanceId: instance.id });
      continue;
    }
    if (!reference.toUpperCase().startsWith(policy.prefix.toUpperCase())) {
      issues.push({
        code: "WRONG_REFERENCE_PREFIX",
        instanceId: instance.id,
        reference,
      });
    }
    const suffix = suffixForPrefix(reference, policy.prefix);
    if (suffix !== null) {
      const occupied = occupiedSuffixesByPrefix.get(policy.prefix) ?? new Set();
      occupied.add(suffix);
      occupiedSuffixesByPrefix.set(policy.prefix, occupied);
    }
  }
  for (const [foldedReference, instances] of byReference) {
    if (instances.length < 2) continue;
    for (const instanceId of instances) {
      const otherInstanceId = instances.find(
        (candidate) => candidate !== instanceId,
      );
      issues.push({
        code: "DUPLICATE_REFERENCE",
        instanceId,
        reference: foldedReference,
        ...(otherInstanceId ? { otherInstanceId } : {}),
      });
    }
  }
  return { byReference, occupiedSuffixesByPrefix, policyByInstanceId, issues };
}

export function nextReference(
  index: ReferenceIndex,
  policy: ReferencePolicy,
  options: ReferenceAllocationOptions = {},
): string | undefined {
  if (policy.kind === "none") return undefined;
  const occupied = index.occupiedSuffixesByPrefix.get(policy.prefix);
  const reserved = options.reservedReferences;
  let suffix = Math.max(1, options.startAt ?? 1);
  while (
    occupied?.has(suffix) ||
    index.byReference.has(`${policy.prefix}${suffix}`.toLowerCase()) ||
    reserved?.has(`${policy.prefix}${suffix}`.toLowerCase())
  ) {
    suffix += 1;
  }
  return `${policy.prefix}${suffix}`;
}

export function referenceIssuesForInstance(
  index: ReferenceIndex,
  instanceId: string,
): readonly ReferenceIssue[] {
  return index.issues.filter((issue) => issue.instanceId === instanceId);
}
