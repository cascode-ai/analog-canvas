export interface Schema45To46MigrationReport {
  readonly changed: false;
}

export interface Schema45To46MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema45To46MigrationReport;
}

/**
 * Schema 46 permits structured Noise analyses. Existing Projects carry no
 * implicit Noise intent, so migration advances only the protocol version.
 */
export function upgradeSchema45To46WithReport(
  raw: Record<string, unknown>,
): Schema45To46MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = 46;
  return { project, report: { changed: false } };
}

export function upgradeSchema45To46(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema45To46WithReport(raw).project;
}
