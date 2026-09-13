/** Schema 55 adds optional independent arrow endpoint styles. Legacy fallbacks
 * retain the exact head placement, size and outline geometry of old drawings. */
export function upgradeSchema54To55(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return { ...raw, schemaVersion: 55 };
}
