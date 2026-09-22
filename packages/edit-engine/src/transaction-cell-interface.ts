import { labelIdentifierOptions } from "@icm/model";
import {
  richTextPresentsIdentifier,
  rewriteRichTextIdentifier,
} from "@icm/model";
import { CellNetlistTerminalSchema, projectCellInterface } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

type CellInterfaceEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind:
      | "create_cell_interface"
      | "add_cell_terminal"
      | "update_cell_terminal"
      | "remove_cell_terminal"
      | "reorder_cell_terminals"
      | "set_cell_formal_parameters";
  }
>;

export interface CellInterfaceEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  deferNetPrune(netId: string): void;
  reject: RejectEdit;
}

export type CellInterfaceEditOutcome = EditMutationOutcome;

/** Reconcile after all edits: deletion planners may remove annotations first. */
export function inheritCellPortFormatting(
  before: SchematicDocument,
  after: SchematicDocument,
  changedObjectIds: Set<string>,
): void {
  const oldPorts = projectCellInterface(before.netlist).ports;
  for (const port of projectCellInterface(after.netlist).ports) {
    const previous = oldPorts.find((item) => item.key === port.key);
    if (!previous || previous.id === port.id) continue;
    const source = before.annotations.find(
      (item) =>
        item.binding?.kind === "cell-terminal-name" &&
        item.binding.terminalId === previous.id,
    );
    const target = after.annotations.find(
      (item) =>
        item.binding?.kind === "cell-terminal-name" &&
        item.binding.terminalId === port.id,
    );
    // An authored surviving marker wins. Never change electrical spelling or
    // replace an explicit annotation edit made in this same transaction.
    if (
      !source?.formatOverride ||
      !target ||
      target.formatOverride ||
      changedObjectIds.has(target.id) ||
      !richTextPresentsIdentifier(source.formatOverride, port.name)
    )
      continue;
    target.formatOverride = structuredClone(source.formatOverride);
    changedObjectIds.add(target.id);
  }
}

export function applyCellInterfaceEdit(
  edit: CellInterfaceEdit,
  context: CellInterfaceEditContext,
): CellInterfaceEditOutcome {
  const { draft, changedObjectIds } = context;
  const placements = draft.presentation.cellSymbol?.pinPlacements;
  const before = projectCellInterface(draft.netlist).ports;
  const outcome = mutateCellInterface(edit, context);
  if (!outcome.ok || !placements?.length) return outcome;

  // Layout belongs to the effective interface, not whichever marker happens
  // to represent it. Existing names win merges; a split leaves the old layout
  // with the surviving interface. Only a one-to-one rename follows identity.
  const after = projectCellInterface(draft.netlist).ports;
  const afterKeys = new Set(after.map((port) => port.key));
  const retained = after.flatMap((port) => {
    const previous =
      before.find((candidate) => candidate.key === port.key) ??
      before.find(
        (candidate) =>
          !afterKeys.has(candidate.key) &&
          candidate.terminalIds.some((id) => port.terminalIds.includes(id)),
      );
    const placement =
      previous && placements.find((item) => item.terminalId === previous.id);
    return placement ? [{ ...placement, terminalId: port.id }] : [];
  });
  if (JSON.stringify(placements) !== JSON.stringify(retained)) {
    if (retained.length)
      draft.presentation.cellSymbol!.pinPlacements = retained;
    else delete draft.presentation.cellSymbol!.pinPlacements;
    changedObjectIds.add(draft.id);
  }
  return outcome;
}

function mutateCellInterface(
  edit: CellInterfaceEdit,
  context: CellInterfaceEditContext,
): CellInterfaceEditOutcome {
  const { draft, changedObjectIds, deferNetPrune, reject } = context;
  switch (edit.kind) {
    case "create_cell_interface": {
      if (draft.netlist) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Document already has a formal Cell interface",
          ),
        };
      }
      draft.netlist = {
        name: edit.name,
        terminals: [],
        formalParameters: [],
      };
      changedObjectIds.add(draft.id);
      return { ok: true, connectivityChanged: true };
    }
    case "add_cell_terminal": {
      if (!draft.netlist) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Document has no formal Cell interface",
          ),
        };
      }
      const terminal = CellNetlistTerminalSchema.parse(edit.terminal);
      if (
        draft.netlist.terminals.some(
          (candidate) => candidate.id === terminal.id,
        )
      ) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Cell terminal already exists: ${terminal.id}`,
          ),
        };
      }
      const index = edit.index ?? draft.netlist.terminals.length;
      if (index > draft.netlist.terminals.length) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Cell terminal index ${index} exceeds interface length ${draft.netlist.terminals.length}`,
          ),
        };
      }
      draft.netlist.terminals.splice(index, 0, terminal);
      changedObjectIds.add(terminal.id);
      return { ok: true, connectivityChanged: true };
    }
    case "update_cell_terminal": {
      const terminal = draft.netlist?.terminals.find(
        (candidate) => candidate.id === edit.terminalId,
      );
      if (!terminal) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Cell terminal does not exist: ${edit.terminalId}`,
          ),
        };
      }
      if (edit.name !== undefined) {
        terminal.name = edit.name;
        if (terminal.interfaceAnnotationId) {
          for (const evidence of draft.connectivityEvidence) {
            if (
              evidence.kind === "name-claim" &&
              evidence.netId === terminal.netId &&
              evidence.scope === "local" &&
              evidence.powerDomain === "vdd" &&
              evidence.owner.kind === "power-marker" &&
              evidence.owner.objectId === terminal.interfaceAnnotationId
            ) {
              evidence.name = edit.name;
              changedObjectIds.add(evidence.id);
            }
          }
        }
        for (const annotation of draft.annotations) {
          if (
            annotation.binding?.kind === "cell-terminal-name" &&
            annotation.binding.terminalId === terminal.id &&
            annotation.formatOverride
          ) {
            annotation.formatOverride = rewriteRichTextIdentifier(
              annotation.formatOverride,
              edit.name,
              labelIdentifierOptions(draft.presentation),
            );
            changedObjectIds.add(annotation.id);
          }
        }
      }
      if (edit.direction !== undefined) terminal.direction = edit.direction;
      changedObjectIds.add(terminal.id);
      return { ok: true, connectivityChanged: true };
    }
    case "remove_cell_terminal": {
      const index =
        draft.netlist?.terminals.findIndex(
          (candidate) => candidate.id === edit.terminalId,
        ) ?? -1;
      if (index < 0 || !draft.netlist) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Cell terminal does not exist: ${edit.terminalId}`,
          ),
        };
      }
      const [removedTerminal] = draft.netlist.terminals.splice(index, 1);
      changedObjectIds.add(edit.terminalId);
      if (removedTerminal) deferNetPrune(removedTerminal.netId);
      return { ok: true, connectivityChanged: true };
    }
    case "reorder_cell_terminals": {
      if (!draft.netlist) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Document has no formal Cell interface",
          ),
        };
      }
      const currentIds = draft.netlist.terminals.map((terminal) => terminal.id);
      if (
        edit.terminalIds.length !== currentIds.length ||
        new Set(edit.terminalIds).size !== currentIds.length ||
        currentIds.some((id) => !edit.terminalIds.includes(id))
      ) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Cell terminal order must contain every existing terminal exactly once",
          ),
        };
      }
      const terminalById = new Map(
        draft.netlist.terminals.map((terminal) => [terminal.id, terminal]),
      );
      draft.netlist.terminals = edit.terminalIds.map((id) =>
        terminalById.get(id)!,
      );
      for (const id of edit.terminalIds) changedObjectIds.add(id);
      return { ok: true, connectivityChanged: true };
    }
    case "set_cell_formal_parameters": {
      if (!draft.netlist) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Document has no formal Cell interface",
          ),
        };
      }
      const seen = new Set<string>();
      for (const parameter of edit.formalParameters) {
        const folded = parameter.name.toLowerCase();
        if (seen.has(folded)) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Cell formal parameter ${parameter.name} is duplicated under case folding`,
            ),
          };
        }
        seen.add(folded);
      }
      draft.netlist.formalParameters = structuredClone(edit.formalParameters);
      changedObjectIds.add(draft.id);
      return { ok: true, connectivityChanged: false };
    }
  }
}
