export interface Schema28To29MigrationReport {
  /**
   * Schema 29 relaxes annotation and drafting anchors to 1-unit precision and
   * adds optional per-instance appearance overrides. Existing data is
   * unchanged because both changes are backward-compatible.
   */
  readonly changed: false;
}

export interface Schema28To29MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema28To29MigrationReport;
}

/**
 * Upgrade schema 28 to 29. Fine-grid annotation/drafting coordinates are a
 * validation relaxation, and instance appearance overrides are optional, so
 * every valid schema-28 project is already valid schema-29 data.
 */
export function upgradeSchema28To29WithReport(
  raw: Record<string, unknown>,
): Schema28To29MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = 29;
  return { project, report: { changed: false } };
}

export function upgradeSchema28To29(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema28To29WithReport(raw).project;
}
