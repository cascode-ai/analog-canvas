import type { SubmissionGateReport } from "@icm/derived";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import type { Annotation, CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  arrangeInstanceLabels,
  partLabelOf,
} from "../instance-display/arrange-instance-labels";

/** The part or Pin a label belongs to, as arrange-labels moves it. */
function labelOwner(
  label: Annotation,
  visible: readonly Annotation[],
): string | null {
  if (label.binding?.kind === "cell-terminal-name")
    return label.anchor.kind === "object" ? label.anchor.objectId : null;
  return partLabelOf(label, visible)?.instanceId ?? null;
}

/**
 * The parts, per Cell, whose labels Publish advises on (#2619): the owners
 * of the labels a `label-clearance` finding names. Free text and Net labels
 * have no part to arrange around and are left to the author.
 */
export function advisedLabelOwners(
  project: CircuitProject,
  report: SubmissionGateReport | null,
): Map<string, string[]> {
  const owners = new Map<string, Set<string>>();
  const findings =
    report?.failures.find((failure) => failure.code === "label-clearance")
      ?.findings ?? [];
  for (const finding of findings) {
    const document = project.documents.find(
      (item) => item.id === finding.documentId,
    );
    if (!document) continue;
    const visible = document.annotations.filter((a) => a.visible !== false);
    for (const id of finding.objectIds) {
      const label = visible.find((item) => item.id === id);
      const owner = label ? labelOwner(label, visible) : null;
      if (!owner || !document.instances.some((item) => item.id === owner))
        continue;
      const set = owners.get(document.id) ?? new Set<string>();
      set.add(owner);
      owners.set(document.id, set);
    }
  }
  return new Map([...owners].map(([id, set]) => [id, [...set].sort()]));
}

/**
 * Arrange labels for the advised parts, as the Agent's `arrange-labels`
 * with `includeManual` does: a label moved by hand onto a wire is the case
 * Publish reports, so it moves too; locked and custom labels stay. One
 * Project edit per Cell, so a single transaction and one undo.
 */
export function arrangeAdvisedLabelEdits(
  project: CircuitProject,
  resolver: SymbolResolver,
  report: SubmissionGateReport | null,
): ProjectStructureEdit[] {
  const edits: ProjectStructureEdit[] = [];
  for (const [documentId, instanceIds] of advisedLabelOwners(project, report)) {
    const document = project.documents.find((item) => item.id === documentId)!;
    const documentEdits = arrangeInstanceLabels(
      document,
      resolver,
      instanceIds,
      { includeManual: true },
    );
    if (documentEdits.length)
      edits.push({
        kind: "transact_document",
        documentId,
        expectedRevision: document.revision,
        edits: documentEdits,
      });
  }
  return edits;
}
