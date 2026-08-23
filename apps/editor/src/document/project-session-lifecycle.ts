import type { CircuitProject } from "@icm/model";

/**
 * A compact change token for the complete editable Project. Project structure
 * edits advance `structureRevision`; Document edits advance their owning
 * revision. Sorting makes the token independent of array presentation order.
 */
export function projectChangeToken(project: CircuitProject): string {
  const documentRevisions = project.documents
    .map((document) => `${document.id}:${document.revision}`)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("|");
  return `${project.id}:${project.structureRevision}|${documentRevisions}`;
}
