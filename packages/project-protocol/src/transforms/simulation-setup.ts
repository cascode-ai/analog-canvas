export interface Schema36To37MigrationReport {
  /**
   * Schema 37 adds the optional Project `simulation` field, the persisted
   * `SimulationSetup` of ADR 0055. No schema-36 Project has authored one, and
   * an absent field is exactly what "no setup" means, so no payload field is
   * rewritten, backfilled, or inferred from the circuit.
   */
  readonly changed: false;
}

export interface Schema36To37MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema36To37MigrationReport;
}

/** Upgrade schema 36 to 37 without inventing any simulation intent. */
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
