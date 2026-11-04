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

/** Undo advances revisions but can restore the exact acknowledged content. */
export function sameProjectContent(
  left: CircuitProject,
  right: CircuitProject,
): boolean {
  if (left === right) return true;
  const content = (project: CircuitProject) => ({
    ...project,
    structureRevision: 0,
    documents: project.documents.map((document) => ({
      ...document,
      revision: 0,
    })),
  });
  return sameValue(content(left), content(right));
}

/** Compare JSON-shaped content, skipping shared immutable subtrees. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  )
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  const a = Object.entries(left).filter(([, value]) => value !== undefined);
  const b = new Map(
    Object.entries(right).filter(([, value]) => value !== undefined),
  );
  return (
    a.length === b.size &&
    a.every(([key, value]) => b.has(key) && sameValue(value, b.get(key)))
  );
}
