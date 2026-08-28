import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

export interface Schema28To29MigrationReport {
  /**
   * Schema 29 relaxes annotation and drafting anchors from Document-grid
   * alignment to 1-unit integer precision; existing data is unchanged.
   */
  readonly changed: false;
}

export interface Schema28To29MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema28To29MigrationReport;
}

/**
 * Upgrade schema 28 to 29. The change is a validation relaxation only, so
 * every valid schema-28 project is already valid schema-29 data.
 */
export function upgradeSchema28To29WithReport(
  raw: Record<string, unknown>,
): Schema28To29MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;
  return { project, report: { changed: false } };
}

export function upgradeSchema28To29(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema28To29WithReport(raw).project;
}
