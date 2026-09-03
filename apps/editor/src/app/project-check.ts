import { collectProjectDiagnosticEvidence } from "@icm/derived";
import type {
  LiveDiagnosticSnapshot,
  ProjectConnectivityIndex,
  VisualDiagnostic,
} from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { projectChangeToken } from "../document/project-session-lifecycle";

export type ProjectCheckStatus =
  "unchecked" | "checking" | "current" | "stale" | "failed";

/** UI-only identity. Never keep an old Project or connectivity index in a report. */
export interface ProjectCheckIdentity {
  sessionId: string;
  token: string;
  resolver: SymbolResolver;
}

export interface ProjectCheckResult {
  identity: ProjectCheckIdentity;
  snapshot: LiveDiagnosticSnapshot | null;
  visualByDocument: ReadonlyMap<string, readonly VisualDiagnostic[]>;
  error: string | null;
}

export function projectCheckIdentity(
  project: CircuitProject,
  sessionId: string,
  resolver: SymbolResolver,
): ProjectCheckIdentity {
  return { sessionId, token: projectChangeToken(project), resolver };
}

export function projectCheckStatus(
  result: ProjectCheckResult | null,
  current: ProjectCheckIdentity,
): ProjectCheckStatus {
  if (!result || result.identity.sessionId !== current.sessionId)
    return "unchecked";
  if (
    result.identity.token !== current.token ||
    result.identity.resolver !== current.resolver
  )
    return "stale";
  return result.error ? "failed" : "current";
}

export function runProjectCheck(
  project: CircuitProject,
  identity: ProjectCheckIdentity,
  index: ProjectConnectivityIndex,
): ProjectCheckResult {
  try {
    const evidence = collectProjectDiagnosticEvidence(
      project,
      identity.resolver,
      index,
    );
    return {
      identity,
      snapshot: {
        source: "live",
        projectId: project.id,
        documentRevisions: project.documents
          .map(({ id, revision }) => ({ documentId: id, revision }))
          .sort((a, b) => a.documentId.localeCompare(b.documentId, "en")),
        diagnostics: evidence.diagnostics,
      },
      visualByDocument: evidence.visualByDocument,
      error: null,
    };
  } catch (error) {
    return {
      identity,
      snapshot: null,
      visualByDocument: new Map(),
      error: error instanceof Error ? error.message : "Check failed",
    };
  }
}
