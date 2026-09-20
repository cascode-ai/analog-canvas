import type { CircuitProject } from "@icm/model";

/** Make the visible Cell the comparison root without mutating the live Project. */
export function projectWithTopologyRoot(
  project: CircuitProject,
  documentId: string,
): CircuitProject {
  return project.topDocumentId === documentId
    ? project
    : { ...project, topDocumentId: documentId };
}
