import { withProjectComponentDefinitions } from "@icm/symbols";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { CircuitProjectSchema } from "@icm/model";
import {
  serializeProject,
  tryParseProjectWithMetadata,
  type ProjectDiagnostic,
} from "@icm/project-protocol";

export type ProjectCodePlan =
  | {
      ok: true;
      changed: boolean;
      project: CircuitProject;
      activeDocumentId: string;
    }
  | { ok: false; message: string };

export function formatProjectCode(project: CircuitProject): string {
  return serializeProject(project);
}

function diagnosticMessage(diagnostic: ProjectDiagnostic): string {
  const location = diagnostic.path.length
    ? `${diagnostic.path.join(".")}: `
    : "";
  return `${location}${diagnostic.message}`;
}

export function validateProjectCode(
  source: string,
  projectId: string,
): { ok: true; project: CircuitProject } | { ok: false; message: string } {
  const parsed = tryParseProjectWithMetadata(source);
  if (!parsed.ok) {
    return {
      ok: false,
      message: diagnosticMessage(parsed.diagnostics[0]!),
    };
  }
  // Pasted code owns the complete drawing, not the receiving editor session.
  // Keep the recipient's Project identity so cross-Project paste uses the same
  // undoable commit and connected Agent session. Drawing references stay intact.
  try {
    return {
      ok: true,
      project: withProjectComponentDefinitions({
        ...parsed.project,
        id: projectId,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function documentWithoutRevision(
  document: SchematicDocument,
): SchematicDocument {
  return { ...document, revision: 0 };
}

function projectWithoutManagedRevisions(
  project: CircuitProject,
): CircuitProject {
  return {
    ...project,
    structureRevision: 0,
    documents: project.documents.map(documentWithoutRevision),
  };
}

function sameAuthoredProject(
  left: CircuitProject,
  right: CircuitProject,
): boolean {
  return (
    serializeProject(projectWithoutManagedRevisions(left)) ===
    serializeProject(projectWithoutManagedRevisions(right))
  );
}

/**
 * Turn complete, validated Project JSON into one in-session structural commit.
 * Revisions are editor concurrency tokens, so authored changes advance them
 * while revisions typed into the source are ignored. Keeping the Project id
 * and session lets a connected Agent observe the same commit instead of being
 * disconnected by a file-style Project replacement.
 */
export function planProjectCodeCommit(
  current: CircuitProject,
  source: string,
  activeDocumentId: string,
): ProjectCodePlan {
  const parsed = validateProjectCode(source, current.id);
  if (!parsed.ok) return parsed;
  const candidate = parsed.project;
  if (sameAuthoredProject(current, candidate)) {
    return {
      ok: true,
      changed: false,
      project: current,
      activeDocumentId,
    };
  }

  const currentDocuments = new Map(
    current.documents.map((document) => [document.id, document] as const),
  );
  const documents = candidate.documents.map((document) => {
    const previous = currentDocuments.get(document.id);
    if (!previous) return { ...document, revision: 0 };
    return JSON.stringify(documentWithoutRevision(previous)) ===
      JSON.stringify(documentWithoutRevision(document))
      ? previous
      : { ...document, revision: previous.revision + 1 };
  });
  const project = CircuitProjectSchema.parse({
    ...candidate,
    structureRevision: current.structureRevision + 1,
    documents,
  });
  return {
    ok: true,
    changed: true,
    project,
    activeDocumentId: project.documents.some(
      (document) => document.id === activeDocumentId,
    )
      ? activeDocumentId
      : project.topDocumentId,
  };
}
