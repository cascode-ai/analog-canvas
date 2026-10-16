import {
  planComponentDraftDeletion,
  type ComponentDraftTarget,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";
import {
  currentComponentAuthoring,
  ComponentAuthoringError,
} from "./component-authoring-workspace";

/** GUI and Agent use the same synchronous transaction and open-candidate guard. */
export function deleteComponentDrafts(
  project: CircuitProject,
  projectSessionId: string,
  targets: ComponentDraftTarget[],
  commit: (edits: ProjectStructureEdit[]) => string | null,
  dryRun = false,
) {
  const workspace = currentComponentAuthoring(projectSessionId);
  const snapshot = workspace?.snapshot();
  const storage = workspace?.storageIdentity;
  const affected =
    snapshot?.target.projectId === project.id &&
    targets.some((t) =>
      t.kind === "component"
        ? t.draftId === snapshot.target.draftId
        : t.sourceId === storage?.sourceId &&
          (t.kind === "source" || t.definitionId === storage?.definitionId),
    );
  const touchesOpenSource =
    snapshot?.target.projectId === project.id &&
    targets.some(
      (t) => t.kind !== "component" && t.sourceId === storage?.sourceId,
    );
  if ((affected || touchesOpenSource) && workspace?.operationPending)
    throw new ComponentAuthoringError(
      "AUTHORING_OPERATION_BUSY",
      "Wait for the current save or publication before deleting this draft.",
    );
  let plan: ReturnType<typeof planComponentDraftDeletion>;
  try {
    plan = planComponentDraftDeletion(project, targets);
  } catch (error) {
    throw new ComponentAuthoringError(
      "DRAFT_CONFLICT",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!dryRun) {
    const error = commit(plan.edits);
    if (error) throw new ComponentAuthoringError("DRAFT_CONFLICT", error);
    if (touchesOpenSource) {
      const checkpoint = plan.sourceCheckpoints.find(
        (c) => c.sourceId === storage?.sourceId,
      );
      if (checkpoint) workspace?.acknowledgeSourceCheckpoint(checkpoint);
    }
    if (affected) workspace?.forgetSaved();
  }
  return plan.reclaimBytes;
}
