import {
  CircuitProjectSchema,
  LegacyProjectSimulationSetupSchema,
} from "@icm/model";
import { migrateSimulationSetupToSource } from "@icm/netlist";
import { ProjectMigrationError } from "./project.js";
import { repairBoundFormatOverrides } from "./bound-format-override.js";
import { repairLegacyReviewedExternalReferences } from "./reviewed-external-reference.js";

/** One-way, offline migration. Source bytes become the only saved authority. */
export function upgradeSchema48To49WithReport(raw: Record<string, unknown>) {
  // Existing repairable annotations/references must not become a migration barrier.
  raw = repairLegacyReviewedExternalReferences(
    repairBoundFormatOverrides(raw),
  ).project;
  const candidate = CircuitProjectSchema.safeParse({
    ...raw,
    schemaVersion: 49,
    simulationSetups: [],
  });
  if (!candidate.success) {
    const issue = candidate.error.issues[0]!;
    throw new ProjectMigrationError(
      issue.path.map((key) => (typeof key === "symbol" ? String(key) : key)),
      issue.message,
    );
  }
  if (!Array.isArray(raw.simulationSetups))
    throw new ProjectMigrationError(
      ["simulationSetups"],
      "Expected an array of saved simulation setups",
    );
  const project = candidate.data;
  const warnings: string[] = [];
  for (const [index, value] of raw.simulationSetups.entries()) {
    const legacy = LegacyProjectSimulationSetupSchema.safeParse(value);
    if (!legacy.success)
      throw new ProjectMigrationError(
        ["simulationSetups", index],
        legacy.error.issues[0]!.message,
      );
    const migrated = migrateSimulationSetupToSource(project, legacy.data);
    project.simulationSetups.push(migrated.setup);
    warnings.push(...migrated.warnings);
  }
  return {
    project,
    report: { migratedSetups: project.simulationSetups.length, warnings },
  };
}

export function upgradeSchema48To49(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema48To49WithReport(raw).project;
}
