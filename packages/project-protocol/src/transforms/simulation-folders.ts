/** Rename the existing source container once; IDs, source bytes and bindings survive. */
export function upgradeSchema49To50(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const { simulationSetups, ...project } = raw;
  return { ...project, schemaVersion: 50, simulationFolders: simulationSetups };
}
