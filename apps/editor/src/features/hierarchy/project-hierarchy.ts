import type { CircuitProject, HierarchyFrame } from "@icm/model";

/** The instance reference a frame enters through, else its instance id. */
export function frameReference(
  project: CircuitProject,
  frame: Pick<HierarchyFrame, "parentDocumentId" | "instanceId">,
): string {
  return (
    project.documents
      .find((document) => document.id === frame.parentDocumentId)
      ?.instances.find((instance) => instance.id === frame.instanceId)
      ?.reference ?? frame.instanceId
  );
}

export function occurrenceLabel(
  project: CircuitProject,
  rootId: string,
  path: readonly HierarchyFrame[],
) {
  const name = (id: string) =>
    project.documents.find((document) => document.id === id)?.name ?? id;
  return [
    rootId === project.topDocumentId ? "Top" : name(rootId),
    ...path.map(
      (frame) =>
        `${frameReference(project, frame)}: ${name(frame.childDocumentId)}`,
    ),
  ].join(" / ");
}

export function hierarchyPathKey(
  rootDocumentId: string,
  path: readonly HierarchyFrame[],
): string {
  return JSON.stringify([
    rootDocumentId,
    ...path.map((frame) => frame.instanceId),
  ]);
}

/**
 * Roots in the order the tree lists them: those already listed keep their
 * places, so switching Top or reshaping the hierarchy moves no row, and a
 * Cell that becomes a root, as one a refactor leaves unused, joins at the
 * end. `roots` comes from the hierarchy, Top first.
 */
export function stableRootOrder(
  previous: readonly string[],
  roots: readonly string[],
): string[] {
  const kept = previous.filter((id) => roots.includes(id));
  return [...kept, ...roots.filter((id) => !kept.includes(id))];
}
