export interface Schema41To42MigrationReport {
  readonly changed: boolean;
  readonly migratedSetupCount: number;
}

export interface Schema41To42MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema41To42MigrationReport;
}

/** Schema 42 replaces the optional singleton setup with a named collection. */
export function upgradeSchema41To42WithReport(
  raw: Record<string, unknown>,
): Schema41To42MigrationResult {
  const project = structuredClone(raw);
  const legacy = project.simulation;
  delete project.simulation;
  project.simulationSetups =
    typeof legacy === "object" && legacy !== null && !Array.isArray(legacy)
      ? [
          {
            id: "simulation-setup-1",
            name: "Setup 1",
            ...(legacy as Record<string, unknown>),
          },
        ]
      : [];
  project.schemaVersion = 42;
  return {
    project,
    report: {
      changed: legacy !== undefined,
      migratedSetupCount: legacy === undefined ? 0 : 1,
    },
  };
}

export function upgradeSchema41To42(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema41To42WithReport(raw).project;
}
