import { resolveDocumentLogicalNets } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";

export interface LogicalNetChoice {
  /** Revision-scoped representative Base-Net ID used by editor commands. */
  readonly netId: string;
  readonly label: string;
  readonly baseNetIds: readonly string[];
}

/**
 * Project the electrical Logical Nets into a single, deterministic UI list.
 * Repeated power markers and same-name labels may own separate Base Nets, but
 * they are one electrical choice and must never leak out as duplicate rows.
 */
export function logicalNetChoices(
  document: SchematicDocument,
): readonly LogicalNetChoice[] {
  const groups = resolveDocumentLogicalNets(document).groups;
  const baseLabels = groups.map((group) => group.name ?? group.id);
  const labelCounts = new Map<string, number>();
  for (const label of baseLabels) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const scopedLabels = groups.map((group, index) => {
    const label = baseLabels[index]!;
    return (labelCounts.get(label) ?? 0) > 1
      ? `${label} · ${group.scope ?? "local"}`
      : label;
  });
  const scopedCounts = new Map<string, number>();
  for (const label of scopedLabels) {
    scopedCounts.set(label, (scopedCounts.get(label) ?? 0) + 1);
  }
  return groups.map((group, index) => {
    const scopedLabel = scopedLabels[index]!;
    return {
      netId: group.baseNetIds[0]!,
      label:
        (scopedCounts.get(scopedLabel) ?? 0) > 1
          ? `${scopedLabel} · ${group.baseNetIds[0]}`
          : scopedLabel,
      baseNetIds: group.baseNetIds,
    };
  });
}

/** Resolve a persisted/current Base-Net ID to this revision's UI choice. */
export function logicalNetChoiceForNet(
  choices: readonly LogicalNetChoice[],
  netId: string | null | undefined,
): LogicalNetChoice | undefined {
  return netId
    ? choices.find((choice) => choice.baseNetIds.includes(netId))
    : undefined;
}
