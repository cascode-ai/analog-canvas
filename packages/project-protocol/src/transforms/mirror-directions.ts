function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert the schema-51 local-X mirror bit to the equivalent independent
 * screen-space direction. A quarter turn swaps the visible reflection axis;
 * the authored rotation itself remains untouched.
 */
function migrateOrientation(value: unknown): void {
  if (!isRecord(value) || value.mirror !== "x") return;
  value.mirror =
    value.rotation === 90 || value.rotation === 270 ? "vertical" : "horizontal";
}

/** Normalize legacy mirror tokens before any current-schema validation. */
export function normalizeLegacyMirrorDirections(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const project = structuredClone(raw);
  if (Array.isArray(project.documents)) {
    for (const document of project.documents) {
      if (!isRecord(document)) continue;
      if (Array.isArray(document.instances)) {
        for (const instance of document.instances) {
          if (isRecord(instance)) migrateOrientation(instance.placement);
        }
      }
      if (!isRecord(document.drafting)) continue;
      if (!Array.isArray(document.drafting.objects)) continue;
      for (const object of document.drafting.objects) {
        if (isRecord(object) && object.kind === "floating-symbol") {
          migrateOrientation(object.transform);
        }
      }
    }
  }
  return project;
}

/** Upgrade every Instance and floating drafting Symbol from schema 51 to 52. */
export function upgradeSchema51To52(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...normalizeLegacyMirrorDirections(raw),
    schemaVersion: 52,
  };
}
