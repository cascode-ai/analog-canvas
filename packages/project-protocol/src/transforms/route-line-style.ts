/** Schema 56 adds optional electrical Route line styling. Existing Routes
 * preserve their geometry, connectivity, color, arrow and bulk presentation. */
export function upgradeSchema55To56(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return { ...raw, schemaVersion: 56 };
}
