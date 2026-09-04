import {
  referencePolicyForInstance,
  referenceSuffixForPolicy,
  type ReferencePolicy,
} from "@icm/devices";
import type { CircuitProject, Instance } from "@icm/model";

import type { ProjectStructureEdit } from "./project-transaction.js";

export interface ReferenceRenumberTarget {
  readonly documentId: string;
  readonly instanceId: string;
}

export interface ReferenceRenumberOptions {
  readonly policy: "fill-gaps" | "continuous";
  readonly startAt?: number;
}

export interface ReferenceRenumberPreview {
  readonly reassigned: readonly (ReferenceRenumberTarget & {
    readonly previous: string;
    readonly reference: string;
  })[];
  readonly preserved: readonly (ReferenceRenumberTarget & {
    readonly reference: string;
  })[];
  readonly skipped: readonly (ReferenceRenumberTarget & {
    readonly reason: string;
  })[];
  readonly edits: readonly ProjectStructureEdit[];
}

function orderedInstances(instances: readonly Instance[]): Instance[] {
  return [...instances].sort((left, right) => {
    const leftPlacement = left.placement;
    const rightPlacement = right.placement;
    if (leftPlacement && rightPlacement) {
      return (
        leftPlacement.position.y - rightPlacement.position.y ||
        leftPlacement.position.x - rightPlacement.position.x ||
        left.id.localeCompare(right.id, "en")
      );
    }
    if (leftPlacement) return -1;
    if (rightPlacement) return 1;
    return left.id.localeCompare(right.id, "en");
  });
}

function folded(reference: string): string {
  return reference.toLowerCase();
}

function nextAvailableReference(
  policy: Extract<ReferencePolicy, { kind: "required" }>,
  occupied: ReadonlySet<string>,
  startAt: number,
): string | null {
  let suffix = Math.max(1, startAt);
  while (occupied.has(folded(`${policy.prefix}${suffix}`))) {
    suffix += 1;
    // Past 2^53 the float increment no-ops, so the same occupied candidate
    // would repeat forever. Runs during render — it must terminate.
    if (!Number.isSafeInteger(suffix)) return null;
  }
  return `${policy.prefix}${suffix}`;
}

function targetKey(target: ReferenceRenumberTarget): string {
  return `${target.documentId}\u0000${target.instanceId}`;
}

/**
 * Plans deterministic per-definition reference repair/renumbering. Its output
 * is deliberately a project edit (one bounded bulk edit per Cell), so callers
 * cannot accidentally turn a project command into many history entries.
 */
export function planReferenceRenumber(
  project: CircuitProject,
  targets: readonly ReferenceRenumberTarget[],
  options: ReferenceRenumberOptions,
): ReferenceRenumberPreview {
  const selected = new Set(targets.map(targetKey));
  const reassigned: Array<
    ReferenceRenumberTarget & {
      previous: string;
      reference: string;
    }
  > = [];
  const preserved: Array<ReferenceRenumberTarget & { reference: string }> = [];
  const skipped: Array<ReferenceRenumberTarget & { reason: string }> = [];
  const edits: ProjectStructureEdit[] = [];

  for (const document of project.documents) {
    const selectedInstances = document.instances.filter((instance) =>
      selected.has(
        targetKey({ documentId: document.id, instanceId: instance.id }),
      ),
    );
    if (selectedInstances.length === 0) continue;
    const selectedIds = new Set(
      selectedInstances.map((instance) => instance.id),
    );
    const occupied = new Set(
      document.instances
        .filter((instance) => !selectedIds.has(instance.id))
        .flatMap((instance) =>
          instance.reference ? [folded(instance.reference)] : [],
        ),
    );
    const groups = new Map<
      string,
      { policy: ReferencePolicy; instances: Instance[] }
    >();
    for (const instance of selectedInstances) {
      const target = { documentId: document.id, instanceId: instance.id };
      const policy = referencePolicyForInstance(instance);
      if (policy.kind === "none") {
        skipped.push({ ...target, reason: "Symbol does not emit a reference" });
        continue;
      }
      if (!instance.netlist) {
        skipped.push({ ...target, reason: "Instance has no netlist record" });
        continue;
      }
      const group = groups.get(policy.prefix) ?? { policy, instances: [] };
      group.instances.push(instance);
      groups.set(policy.prefix, group);
    }
    const assignments: Array<{ instanceId: string; reference: string }> = [];
    for (const { policy, instances } of groups.values()) {
      if (policy.kind === "none") continue;
      const ordered = orderedInstances(instances);
      let nextSuffix = Math.max(1, options.startAt ?? 1);
      const retained = new Set<string>();
      for (const instance of ordered) {
        const current = instance.reference!;
        const target = { documentId: document.id, instanceId: instance.id };
        const validCurrent =
          options.policy === "fill-gaps" &&
          referenceSuffixForPolicy(current, policy) !== null &&
          !occupied.has(folded(current)) &&
          !retained.has(folded(current));
        const reference = validCurrent
          ? current
          : nextAvailableReference(policy, occupied, nextSuffix);
        if (reference === null) {
          skipped.push({
            ...target,
            reason: "Reference numbering space is exhausted",
          });
          continue;
        }
        occupied.add(folded(reference));
        retained.add(folded(reference));
        const suffix = referenceSuffixForPolicy(reference, policy);
        if (suffix !== null && Number.isSafeInteger(suffix + 1)) {
          nextSuffix = suffix + 1;
        }
        if (reference === current) {
          preserved.push({ ...target, reference });
          continue;
        }
        assignments.push({ instanceId: instance.id, reference });
        reassigned.push({ ...target, previous: current, reference });
      }
    }
    if (assignments.length > 0) {
      edits.push({
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [{ kind: "bulk_patch_instance_netlist", assignments }],
      });
    }
  }
  return { reassigned, preserved, skipped, edits };
}
