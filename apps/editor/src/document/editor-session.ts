import { CircuitProjectSchema } from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";

/** Replace one validated Document without allowing callers to patch Project. */
export function replaceProjectDocument(
  project: CircuitProject,
  document: SchematicDocument,
): CircuitProject {
  const parsed = CircuitProjectSchema.parse({
    ...project,
    documents: project.documents.map((candidate) =>
      candidate.id === document.id ? document : candidate,
    ),
  });
  const previousDocuments = new Map(
    project.documents.map((candidate) => [candidate.id, candidate] as const),
  );
  return {
    ...parsed,
    // Whole-Project validation clones every Document. Restore the already
    // validated, unchanged revisions so downstream WeakMap caches and React
    // readers can retain their identity across an unrelated Document edit.
    documents: parsed.documents.map((candidate) =>
      candidate.id === document.id
        ? candidate
        : (previousDocuments.get(candidate.id) ?? candidate),
    ),
  };
}

/** Resolve the active Document, falling back deterministically to top. */
export function resolveActiveDocument(
  project: CircuitProject,
  activeDocumentId: string,
): SchematicDocument {
  return (
    project.documents.find((candidate) => candidate.id === activeDocumentId) ??
    project.documents.find(
      (candidate) => candidate.id === project.topDocumentId,
    )!
  );
}

/** Resolve a stable persisted hierarchy link to a child Document. */
export function referencedDocumentId(
  project: CircuitProject,
  instance: SchematicDocument["instances"][number],
): string | null {
  const binding = instance.netlist?.binding;
  const stableChildDocumentId =
    binding?.kind === "subcircuit" ? binding.childDocumentId : undefined;
  if (
    typeof stableChildDocumentId === "string" &&
    project.documents.some(
      (candidate) => candidate.id === stableChildDocumentId,
    )
  ) {
    return stableChildDocumentId;
  }

  return null;
}
