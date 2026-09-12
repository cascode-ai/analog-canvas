import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import legacyFiveTransistorOta from "./five-transistor-ota-sky130.icproj.json";

export { legacyFiveTransistorOta };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOrientation(value: unknown): void {
  if (!isRecord(value) || value.mirror !== "x") return;
  value.mirror =
    value.rotation === 90 || value.rotation === 270 ? "vertical" : "horizontal";
}

/**
 * Simulation tests retain the schema-48 OTA source so they can exercise the
 * legacy setup migration. When they test current-schema circuit behavior,
 * upgrade only the placement vocabulary instead of relabeling old bytes as a
 * current Project.
 */
export function currentFiveTransistorOtaCircuitSource(): Record<
  string,
  unknown
> {
  const project = structuredClone(legacyFiveTransistorOta) as unknown as Record<
    string,
    unknown
  >;
  if (Array.isArray(project.documents)) {
    for (const document of project.documents) {
      if (!isRecord(document) || !Array.isArray(document.instances)) continue;
      for (const instance of document.instances) {
        if (isRecord(instance)) normalizeOrientation(instance.placement);
      }
    }
  }
  const { simulationSetups: _legacySetups, ...circuit } = project;
  return {
    ...circuit,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    simulationFolders: [],
  };
}
