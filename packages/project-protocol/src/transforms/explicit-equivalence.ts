import { ProjectMigrationError } from "./project.js";

export interface Schema32To33MigrationReport {
  /**
   * Schema 33 removes ownerless `explicit-equivalence` records. A schema-32
   * Project without one already has canonical schema-33 connectivity, so the
   * version stamp is the only change.
   */
  readonly changed: false;
}

export interface Schema32To33MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema32To33MigrationReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Upgrade schema 32 to 33 without guessing what an ownerless electrical union
 * meant. Such a record cannot be converted safely into physical topology,
 * owner-addressed naming, or hierarchy, so the file boundary rejects it at
 * its exact location instead of silently changing connectivity.
 */
export function upgradeSchema32To33WithReport(
  raw: Record<string, unknown>,
): Schema32To33MigrationResult {
  const project = structuredClone(raw);
  const documents = Array.isArray(project.documents) ? project.documents : [];
  for (const [documentIndex, document] of documents.entries()) {
    if (!isRecord(document) || !Array.isArray(document.connectivityEvidence)) {
      continue;
    }
    for (const [
      evidenceIndex,
      evidence,
    ] of document.connectivityEvidence.entries()) {
      if (isRecord(evidence) && evidence.kind === "explicit-equivalence") {
        throw new ProjectMigrationError(
          ["documents", documentIndex, "connectivityEvidence", evidenceIndex],
          "Schema 32 explicit-equivalence has no authoring owner and cannot be migrated safely; replace it with physical topology, owner-addressed Net Labels, or hierarchy terminals",
        );
      }
    }
  }
  project.schemaVersion = 33;
  return { project, report: { changed: false } };
}

export function upgradeSchema32To33(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema32To33WithReport(raw).project;
}
