import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

export interface Schema27To28MigrationReport {
  /** Schema 28 adds optional polarity intent; existing projects are unchanged. */
  readonly changed: false;
}

export interface Schema27To28MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema27To28MigrationReport;
}

/**
 * Upgrade schema 27 to 28. The new DraftText polarity field is optional, so
 * every valid schema-27 project is already valid schema-28 data.
 */
export function upgradeSchema27To28WithReport(
  raw: Record<string, unknown>,
): Schema27To28MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;
  return { project, report: { changed: false } };
}

export function upgradeSchema27To28(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema27To28WithReport(raw).project;
}
