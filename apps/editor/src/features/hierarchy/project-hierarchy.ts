import type { CircuitProject, HierarchyFrame } from "@icm/model";

export function occurrenceLabel(
  project: CircuitProject,
  rootId: string,
  path: readonly HierarchyFrame[],
) {
  const name = (id: string) =>
    project.documents.find((document) => document.id === id)?.name ?? id;
  return [
    rootId === project.topDocumentId ? "Top" : name(rootId),
    ...path.map((frame) => {
      const parent = project.documents.find(
        (document) => document.id === frame.parentDocumentId,
      );
      const reference =
        parent?.instances.find((instance) => instance.id === frame.instanceId)
          ?.reference ?? frame.instanceId;
      return `${reference}: ${name(frame.childDocumentId)}`;
    }),
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
