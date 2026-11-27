import type { CircuitProject } from "@icm/model";
import type { ProjectTransaction } from "./project-transaction.js";

/** A newly installed model with no callers has no existing symbols to rewrite. */
export function isUnusedExternalDefinition(
  project: CircuitProject,
  id: string,
): boolean {
  return (
    !project.externalSubcircuitDefinitions.some((item) => item.id === id) &&
    !project.documents.some((doc) =>
      doc.instances.some((instance) => {
        const binding = instance.netlist?.binding;
        return (
          binding?.kind === "external-subcircuit" && binding.definitionId === id
        );
      }),
    )
  );
}

/** The ordinary executor replaces one Cell and may append a fresh definition.
 * All other edit families retain their fully detached structural draft. */
export function createPlacementProjectDraft(
  project: CircuitProject,
  transaction: ProjectTransaction,
): CircuitProject | undefined {
  const edits = transaction.edits;
  const placement = edits.at(-1);
  if (
    transaction.dryRun ||
    placement?.kind !== "transact_document" ||
    !placement.edits.some(
      (edit) =>
        edit.kind === "add_instance" &&
        (edit.instance.symbolId === "nmos" ||
          edit.instance.symbolId === "pmos"),
    ) ||
    !placement.edits.every(
      (edit) =>
        edit.kind === "add_instance" ||
        edit.kind === "set_instance_netlist" ||
        edit.kind === "bulk_patch_instance_netlist" ||
        edit.kind === "upsert_schematic_annotation",
    )
  )
    return;
  if (edits.length > 1) {
    const definition = edits[0];
    if (
      edits.length !== 2 ||
      definition?.kind !== "upsert_external_subcircuit_definition" ||
      !isUnusedExternalDefinition(project, definition.definition.id)
    )
      return;
  }
  return {
    ...project,
    documents: [...project.documents],
    externalSubcircuitDefinitions: [...project.externalSubcircuitDefinitions],
  };
}
