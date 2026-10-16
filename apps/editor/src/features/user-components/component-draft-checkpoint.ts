import type { CircuitProject } from "@icm/model";

/** Read the committed checkpoint; it is compared, never compiled or replayed. */
export function componentDraftCheckpoint(
  project: CircuitProject,
  definitionId: string | undefined,
): string {
  const sourceId = project.externalSubcircuitDefinitions.find(
    (owner) => owner.id === definitionId,
  )?.implementation?.sourceId;
  return JSON.stringify(
    project.modelSources?.find((source) => source.id === sourceId)?.draft ??
      null,
  );
}
