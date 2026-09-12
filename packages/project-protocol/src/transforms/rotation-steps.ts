/**
 * Schema 53 expands persisted rotations from quarter turns to 45-degree
 * steps. Existing schema-52 projects already contain valid schema-53 values,
 * so the migration only advances the explicit compatibility boundary.
 */
export function upgradeSchema52To53(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return { ...structuredClone(raw), schemaVersion: 53 };
}
