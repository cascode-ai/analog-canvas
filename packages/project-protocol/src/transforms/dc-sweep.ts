/** Schema 41 adds structured DC-sweep intent; existing Projects need no rewrite. */
export function upgradeSchema40To41(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const project = structuredClone(raw);
  project.schemaVersion = 41;
  return project;
}
