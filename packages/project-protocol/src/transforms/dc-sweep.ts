export interface Schema40To41MigrationReport {
  readonly changed: false;
}

export interface Schema40To41MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema40To41MigrationReport;
}

/** Schema 41 adds structured DC-sweep intent; existing Projects need no rewrite. */
export function upgradeSchema40To41WithReport(
  raw: Record<string, unknown>,
): Schema40To41MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = 41;
  return { project, report: { changed: false } };
}

export function upgradeSchema40To41(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema40To41WithReport(raw).project;
}
