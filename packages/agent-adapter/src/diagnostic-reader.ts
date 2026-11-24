import {
  documentContentSource,
  isFrozenSnapshot,
  projectContentSource,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { stableResolverSource, type SymbolResolver } from "@icm/symbols";
import {
  agentProjectDiagnostics,
  agentVisualDiagnostics,
} from "./diagnostics.js";
import { retainDiagnosticReport } from "./diagnostic-report.js";
import type { AgentDiagnostic } from "./schema.js";

/** Mutable working copies and caller-owned callbacks are evaluated on every read. */
export function snapshotResolverSource(
  project: CircuitProject | undefined,
  document: SchematicDocument,
  resolver: SymbolResolver,
): object | undefined {
  if (!isFrozenSnapshot(document) || (project && !isFrozenSnapshot(project)))
    return undefined;
  return stableResolverSource(resolver);
}

/** A service keeps only the recent committed reports needed by reads and history. */
export function createDiagnosticReader() {
  const recent: {
    project: object | undefined;
    document: SchematicDocument;
    resolver: object;
    revision: number;
    diagnostics: AgentDiagnostic[];
  }[] = [];
  return (
    project: CircuitProject | undefined,
    document: SchematicDocument,
    resolver: SymbolResolver,
    retain = true,
  ): AgentDiagnostic[] => {
    const symbols = snapshotResolverSource(project, document, resolver);
    const projectSource = project && projectContentSource(project);
    const documentSource = documentContentSource(document);
    const index = symbols
      ? recent.findIndex(
          (entry) =>
            entry.project === projectSource &&
            entry.document === documentSource &&
            entry.resolver === symbols,
        )
      : -1;
    if (index >= 0) {
      const entry = recent[index]!;
      if (entry.revision !== document.revision) {
        const prior = entry.diagnostics;
        entry.diagnostics = prior.map((item) => ({
          ...item,
          revision: document.revision,
        }));
        retainDiagnosticReport(entry.diagnostics, prior);
        entry.revision = document.revision;
      }
      if (index > 0) {
        recent.splice(index, 1);
        recent.unshift(entry);
      }
      return entry.diagnostics;
    }
    const diagnostics = project
      ? agentProjectDiagnostics(
          project,
          resolver,
          document.id,
          document.revision,
        )
      : agentVisualDiagnostics(document, resolver);
    // Keep both sides of an edit and the neighboring Cell during history reads.
    // A deep Undo stack or an Agent visiting many Cells must not pin every report.
    if (symbols && retain) {
      retainDiagnosticReport(diagnostics);
      recent.unshift({
        project: projectSource,
        document: documentSource,
        resolver: symbols,
        revision: document.revision,
        diagnostics,
      });
      if (recent.length > 4) recent.pop();
    }
    return diagnostics;
  };
}
