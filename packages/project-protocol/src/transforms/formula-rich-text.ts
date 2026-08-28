import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

export interface Schema29To30MigrationReport {
  /**
   * Schema 30 adds an optional atomic formula run to RichText. Existing
   * schema-29 data is already valid and is not rewritten.
   */
  readonly changed: false;
}

export interface Schema29To30MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema29To30MigrationReport;
}

export function upgradeSchema29To30WithReport(
  raw: Record<string, unknown>,
): Schema29To30MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;
  return { project, report: { changed: false } };
}

export function upgradeSchema29To30(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema29To30WithReport(raw).project;
}
