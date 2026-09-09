export interface Schema47To48MigrationReport {
  readonly migratedSetups: number;
}

export interface Schema47To48MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema47To48MigrationReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Schema 48 gives every structured Setup an explicit variable table and saved
 * Run Plan. Existing Setups retain their exact nominal behaviour.
 */
export function upgradeSchema47To48WithReport(
  raw: Record<string, unknown>,
): Schema47To48MigrationResult {
  const project = structuredClone(raw);
  let migratedSetups = 0;
  if (Array.isArray(project.simulationSetups)) {
    for (const setup of project.simulationSetups) {
      if (!isRecord(setup)) continue;
      setup.version = 3;
      if (!isRecord(setup.input) || setup.input.kind !== "structured") continue;
      setup.input.designVariables = [];
      setup.input.runPlan = { mode: "nominal" };
      migratedSetups += 1;
    }
  }
  project.schemaVersion = 48;
  return { project, report: { migratedSetups } };
}

export function upgradeSchema47To48(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema47To48WithReport(raw).project;
}
