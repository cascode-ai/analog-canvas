export interface Schema46To47MigrationReport {
  readonly changed: false;
}

export interface Schema46To47MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema46To47MigrationReport;
}

/**
 * Schema 47 permits selected MOS operating-point detail requests. Existing
 * Projects carry no implicit selection, so migration advances only the
 * protocol version.
 */
export function upgradeSchema46To47WithReport(
  raw: Record<string, unknown>,
): Schema46To47MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = 47;
  return { project, report: { changed: false } };
}

export function upgradeSchema46To47(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema46To47WithReport(raw).project;
}
