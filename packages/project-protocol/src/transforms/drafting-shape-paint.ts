/**
 * Schema 51 adds optional rectangle/circle fill and drafting-plane fields.
 * Existing schema-50 Projects already have the complete compatible shape, so
 * the upgrade only advances the version stamp and preserves every authored
 * byte of Project content.
 */
export function upgradeSchema50To51(
  project: Record<string, unknown>,
): Record<string, unknown> {
  return { ...project, schemaVersion: 51 };
}
