// One Cell's edits, and the Project structure edit that applies them at its
// current revision: the plumbing the hierarchy planners share.
import type { CircuitProject } from "@icm/model";
import type { ProjectStructureEdit } from "./project-transaction.js";

export type DocumentEdits = Extract<
  ProjectStructureEdit,
  { kind: "transact_document" }
>["edits"];

export function requireDocument(project: CircuitProject, documentId: string) {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error(`Document does not exist: ${documentId}`);
  return document;
}

export function transactDocument(
  project: CircuitProject,
  documentId: string,
  edits: DocumentEdits,
): ProjectStructureEdit {
  const document = requireDocument(project, documentId);
  return {
    kind: "transact_document",
    documentId,
    expectedRevision: document.revision,
    edits,
  };
}
