export interface Schema36To37MigrationReport {
  /**
   * Schema 37 adds optional presentation-only
   * `Annotation.referencePrefixHidden`. Every existing Project already draws
   * the whole Reference, which is exactly what an absent flag means, so no
   * payload field is rewritten or backfilled.
   */
  readonly changed: false;
}

export interface Schema36To37MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema36To37MigrationReport;
}

/** Upgrade schema 36 to 37 without materializing any prefix-display intent. */
export function upgradeSchema36To37WithReport(
  raw: Record<string, unknown>,
): Schema36To37MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = 37;
  return { project, report: { changed: false } };
}

export function upgradeSchema36To37(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema36To37WithReport(raw).project;
}
