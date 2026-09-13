/** Schema 54 adds an optional named parameter to live instance-value bindings. */
export function upgradeSchema53To54(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return { ...raw, schemaVersion: 54 };
}
