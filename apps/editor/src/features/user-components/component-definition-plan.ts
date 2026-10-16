import type { CircuitProject, ComponentDefinition, Instance } from "@icm/model";
import {
  executeProjectTransaction,
  planComponentArtworkApply,
} from "@icm/edit-engine";

/** The GUI uses the same validated artwork transaction as the Agent. */
export function planComponentDefinitionEdit(
  current: CircuitProject,
  documentId: string,
  instanceId: string,
  expectedInstance: Instance,
  definition: ComponentDefinition,
  scope: "instance" | "definition" = "instance",
) {
  try {
    const instance = current.documents
      .find((d) => d.id === documentId)
      ?.instances.find((i) => i.id === instanceId);
    if (JSON.stringify(instance) !== JSON.stringify(expectedInstance))
      throw Error(
        "This instance changed while its definition was being edited. Reopen it before applying.",
      );
    const edits = planComponentArtworkApply(
      current,
      documentId,
      instanceId,
      definition,
      scope,
    );
    const result = executeProjectTransaction(current, {
      projectId: current.id,
      expectedStructureRevision: current.structureRevision,
      transactionId: "component-artwork",
      actor: { kind: "human", id: "component-editor" },
      edits,
    });
    if (!result.ok)
      throw Error(result.diagnostics[0]?.message ?? result.error.message);
    return {
      ok: true as const,
      project: result.project,
      activeDocumentId: documentId,
      edits,
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
