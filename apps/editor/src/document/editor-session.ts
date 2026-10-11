import { parseProjectSnapshot } from "@icm/edit-engine";
import {
  CircuitProjectSchema,
  freezeSnapshot,
  isFrozenSnapshot,
} from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";

/** Replace one validated Document without allowing callers to patch Project. */
export function replaceProjectDocument(
  project: CircuitProject,
  document: SchematicDocument,
): CircuitProject {
  const candidate = {
    ...project,
    documents: project.documents.map((candidate) =>
      candidate.id === document.id ? document : candidate,
    ),
  };
  if (isFrozenSnapshot(project) && isFrozenSnapshot(document))
    return parseProjectSnapshot(candidate, freezeSnapshot(candidate));
  const parsed = CircuitProjectSchema.parse(candidate);
  return {
    ...parsed,
    documents: parsed.documents.map((item) =>
      item.id === document.id
        ? item
        : (project.documents.find((previous) => previous.id === item.id) ??
          item),
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
