// Portable Project interchange. Cloud Project owns formal Save; this module
// only imports validated files and exports/downloads canonical bytes.

import type { CircuitProject } from "@icm/model";
import {
  serializeProject,
  tryParseProjectWithMetadata,
} from "@icm/project-protocol";

export interface ProjectFileOpenDiagnostic {
  code:
    | "READ_FAILED"
    | "INVALID_JSON"
    | "INVALID_PROJECT"
    | "UNSUPPORTED_SCHEMA_VERSION"
    | "UNKNOWN_DEVICE"
    | "INVALID_DEVICE_PIN"
    | "UNRESOLVED_REFERENCE"
    | "UNSUPPORTED_SYMBOL";
  message: string;
  path?: ReadonlyArray<string | number>;
}

export type ProjectFileOpenOutcome =
  | {
      status: "opened";
      project: CircuitProject;
      fileName: string;
      topDocumentRevision: number;
      sourceSchemaVersion: number;
      migrated: boolean;
    }
  | { status: "rejected"; diagnostics: ProjectFileOpenDiagnostic[] };

interface ProjectFileAnchorLike {
  href: string;
  download: string;
  click(): void;
}

interface ProjectFileDocumentLike {
  createElement(tagName: "a"): ProjectFileAnchorLike;
}

export interface ProjectFileServiceSeams {
  getDocument?: () => ProjectFileDocumentLike | null;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  setTimeout?: (handler: () => void, ms: number) => unknown;
}

function defaultDocument(): ProjectFileDocumentLike | null {
  try {
    return (
      (globalThis as { document?: ProjectFileDocumentLike }).document ?? null
    );
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}

export function projectFileBaseName(projectName: string): string {
  const cleaned = projectName
    .trim()
    .replace(/[\\/:*?"<>|]+/gu, "-")
    .replace(/\s+/gu, " ");
  return cleaned.length > 0 ? cleaned : "project";
}

export function requestProjectDownload(
  project: CircuitProject,
  seams: ProjectFileServiceSeams = {},
) {
  let text: string;
  try {
    text = serializeProject(project);
  } catch (error) {
    return { status: "failed" as const, message: errorMessage(error) };
  }
  return downloadTextArtifact(
    text,
    `${projectFileBaseName(project.name)}.icproj.json`,
    seams,
  );
}

/** Download bytes exactly; the browser cannot confirm durable completion. */
export function downloadTextArtifact(
  text: string,
  fileName: string,
  seams: ProjectFileServiceSeams = {},
):
  | { status: "download-requested"; fileName: string; bytes: number }
  | { status: "failed"; message: string } {
  const documentLike = seams.getDocument?.() ?? defaultDocument();
  if (documentLike === null) {
    return { status: "failed", message: "no document available for download" };
  }
  const createUrl =
    seams.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeUrl =
    seams.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
  const schedule =
    seams.setTimeout ??
    ((handler: () => void, ms: number) => globalThis.setTimeout(handler, ms));
  const url = createUrl(new Blob([text], { type: "application/json" }));
  const anchor = documentLike.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  schedule(() => revokeUrl(url), 0);
  return {
    status: "download-requested",
    fileName,
    bytes: new TextEncoder().encode(text).length,
  };
}

/** Parse and validate an imported Project before replacing live editor state. */
export async function stageProjectFile(
  file: { name: string; text(): Promise<string> },
  findUnsupportedSymbols: (project: CircuitProject) => string[],
): Promise<ProjectFileOpenOutcome> {
  let serialized: string;
  try {
    serialized = await file.text();
  } catch (error) {
    return {
      status: "rejected",
      diagnostics: [{ code: "READ_FAILED", message: errorMessage(error) }],
    };
  }
  const parsedProject = tryParseProjectWithMetadata(serialized);
  if (!parsedProject.ok) {
    return {
      status: "rejected",
      diagnostics: parsedProject.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        ...(diagnostic.path.length === 0 ? {} : { path: [...diagnostic.path] }),
      })),
    };
  }
  const project = parsedProject.project;
  const unsupported = findUnsupportedSymbols(project);
  if (unsupported.length > 0) {
    return {
      status: "rejected",
      diagnostics: [
        {
          code: "UNSUPPORTED_SYMBOL",
          message: `Project uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        },
      ],
    };
  }
  const topDocument = project.documents.find(
    (candidate) => candidate.id === project.topDocumentId,
  );
  if (!topDocument) {
    return {
      status: "rejected",
      diagnostics: [
        { code: "INVALID_PROJECT", message: "top document is missing" },
      ],
    };
  }
  return {
    status: "opened",
    project,
    fileName: file.name,
    topDocumentRevision: topDocument.revision,
    sourceSchemaVersion: parsedProject.sourceSchemaVersion,
    migrated: parsedProject.migrated,
  };
}

export function formatProjectOpenDiagnostics(
  diagnostics: readonly ProjectFileOpenDiagnostic[],
): string {
  const first = diagnostics[0];
  if (!first) return "Project import failed";
  const location = first.path?.length ? ` at ${first.path.join(".")}` : "";
  return `${first.code}${location}: ${first.message}`;
}
