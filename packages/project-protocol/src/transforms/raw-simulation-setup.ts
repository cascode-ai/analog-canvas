export interface Schema38To39MigrationReport {
  /** Schema 39 admits raw SimulationSetup input; existing Projects need no rewrite. */
  readonly changed: false;
}

export interface Schema38To39MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema38To39MigrationReport;
}

/** Upgrade schema 38 to 39 without inventing a raw simulation draft. */
export function upgradeSchema38To39WithReport(
  raw: Record<string, unknown>,
): Schema38To39MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = 39;
  return { project, report: { changed: false } };
}

export function upgradeSchema38To39(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema38To39WithReport(raw).project;
}
