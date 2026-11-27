import type { CircuitProject } from "@icm/model";
import type { SchematicEdit } from "./edit-schema.js";
import type { ProjectTransaction } from "./project-transaction.js";

const CELL_INTERFACE_OR_SYMBOL_EDITS: ReadonlySet<SchematicEdit["kind"]> =
  new Set([
    "create_cell_interface",
    "add_cell_terminal",
    "update_cell_terminal",
    "remove_cell_terminal",
    "reorder_cell_terminals",
    "set_cell_formal_parameters",
    "set_cell_symbol_presentation",
    "clear_cell_drawing",
    "reset_cell_placement",
    "reset_cell_body",
  ]);

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

/**
 * The ordinary executor replaces one Cell (and optionally appends one fresh
 * external definition for a MOS placement) without touching peer Cells or
 * cross-Cell symbol definitions. All other edit families retain their fully
 * detached structural draft.
 */
export function createPlacementProjectDraft(
  project: CircuitProject,
  transaction: ProjectTransaction,
): CircuitProject | undefined {
  const edits = transaction.edits;
  if (transaction.dryRun || edits.length === 0) return;
  const placement = edits.at(-1);
  if (placement?.kind !== "transact_document") return;

  if (edits.length === 1) {
    if (
      placement.edits.some((edit) =>
        CELL_INTERFACE_OR_SYMBOL_EDITS.has(edit.kind),
      )
    )
      return;
  } else {
    const definition = edits[0];
    if (
      edits.length !== 2 ||
      definition?.kind !== "upsert_external_subcircuit_definition" ||
      !isUnusedExternalDefinition(project, definition.definition.id) ||
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
  }
  return {
    ...project,
    documents: [...project.documents],
    externalSubcircuitDefinitions: [...project.externalSubcircuitDefinitions],
  };
}
