import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

export interface Schema26To27MigrationReport {
  /** Schema 27 only widens drafting style capacity; nothing migrates. */
  readonly changed: false;
}

export interface Schema26To27MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema26To27MigrationReport;
}

/**
 * Upgrade schema 26 to 27. Schema 27 widens the drafting per-object
 * strokeScale from the fixed four-step ladder to a bounded free multiplier
 * and adds an optional explicit stroke color; every schema-26 value is
 * already valid schema-27 data, so the upgrade is a version stamp.
 */
export function upgradeSchema26To27WithReport(
  raw: Record<string, unknown>,
): Schema26To27MigrationResult {
  const project = structuredClone(raw);
  project.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;
  return { project, report: { changed: false } };
}

export function upgradeSchema26To27(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema26To27WithReport(raw).project;
}
