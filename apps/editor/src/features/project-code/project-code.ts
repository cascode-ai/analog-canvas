import {
  withProjectComponentDefinitions,
  createProjectSymbolResolver,
  builtInSymbols,
} from "@icm/symbols";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { CircuitProjectSchema, labelTypography } from "@icm/model";
import { applyLabelSubscriptCase } from "../text-editing/label-subscript-case";
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

function readProjectCode(
  source: string,
): { ok: true; project: CircuitProject } | { ok: false; message: string } {
  const parsed = tryParseProjectWithMetadata(source);
  if (!parsed.ok) {
    return {
      ok: false,
      message: diagnosticMessage(parsed.diagnostics[0]!),
    };
  }
  try {
    return {
      ok: true,
      project: withProjectComponentDefinitions(parsed.project),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function validateProjectCode(
  source: string,
  projectId: string,
): { ok: true; project: CircuitProject } | { ok: false; message: string } {
  const result = readProjectCode(source);
  // Pasted code owns the drawing; only the receiving session identity stays.
  return result.ok
    ? { ok: true, project: { ...result.project, id: projectId } }
    : result;
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
  const parsed = readProjectCode(source);
  if (!parsed.ok) return parsed;
  let candidate = { ...parsed.project, id: current.id };
  try {
    for (const document of parsed.project.documents) {
      // A complete drawing pasted from another Project carries its own manual
      // overrides. It is not a request to batch-format the recipient's labels.
      if (parsed.project.id !== current.id) break;
      const previous = current.documents.find(
        (item) => item.id === document.id,
      );
      if (!previous) continue;
      const settings = labelTypography(document.presentation);
      if (
        JSON.stringify(settings) ===
        JSON.stringify(labelTypography(previous.presentation))
      )
        continue;
      candidate = applyLabelSubscriptCase(
        candidate,
        document.id,
        settings.subscriptCase,
        createProjectSymbolResolver(candidate, builtInSymbols),
        [],
        settings.subscriptItalic,
        settings,
        previous.presentation,
      );
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
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
