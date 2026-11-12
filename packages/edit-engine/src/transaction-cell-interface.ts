import { renamedLabelFormat, richTextPresentsIdentifier } from "@icm/model";
import { CellNetlistTerminalSchema, projectCellInterface } from "@icm/model";
import type { CellSymbolPresentation, SchematicDocument } from "@icm/model";

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
  const artwork = draft.presentation.cellSymbol?.artwork;
  const before = projectCellInterface(draft.netlist).ports;
  const outcome = mutateCellInterface(edit, context);
  if (!outcome.ok || (!placements?.length && !artwork)) return outcome;

  // Layout belongs to the effective interface, not whichever marker happens
  // to represent it. Existing names win merges; a split leaves the old layout
  // with the surviving interface. Only a one-to-one rename follows identity.
  const after = projectCellInterface(draft.netlist).ports;
  const afterKeys = new Set(after.map((port) => port.key));
  const previousOf = (port: (typeof after)[number]) =>
    before.find((candidate) => candidate.key === port.key) ??
    before.find(
      (candidate) =>
        !afterKeys.has(candidate.key) &&
        candidate.terminalIds.some((id) => port.terminalIds.includes(id)),
    );
  if (placements?.length) {
    const retained = after.flatMap((port) => {
      const previous = previousOf(port);
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
  }
  if (artwork) {
    // Custom artwork follows the same identity. A departing Pin takes its
    // graphical pin with it, as a source-backed removal forks only its
    // contacts; a new Pin stays unmapped and the result refuses until the
    // author maps it or resets the symbol to automatic.
    const mapped = after.flatMap((port) => {
      const previous = previousOf(port);
      const mapping =
        previous &&
        artwork.terminals.find((item) => item.terminalId === previous.id);
      return mapping ? [{ ...mapping, terminalId: port.id }] : [];
    });
    const departed = new Set(
      artwork.terminals.flatMap((mapping) =>
        "pinName" in mapping &&
        !mapped.some(
          (item) => "pinName" in item && item.pinName === mapping.pinName,
        )
          ? [mapping.pinName]
          : [],
      ),
    );
    if (JSON.stringify(artwork.terminals) !== JSON.stringify(mapped)) {
      draft.presentation.cellSymbol!.artwork = {
        symbol: departed.size
          ? withoutSymbolPins(artwork.symbol, departed)
          : artwork.symbol,
        terminals: mapped,
      };
      changedObjectIds.add(draft.id);
    }
  }
  return outcome;
}

/** Artwork with some graphical pins gone, from its variants too. */
function withoutSymbolPins(
  symbol: NonNullable<CellSymbolPresentation["artwork"]>["symbol"],
  names: ReadonlySet<string>,
): NonNullable<CellSymbolPresentation["artwork"]>["symbol"] {
  const pins = symbol.pins.filter((pin) => !names.has(pin.name));
  return {
    ...symbol,
    pins,
    variants: symbol.variants.map((variant) => ({
      ...variant,
      hiddenPinNames: variant.hiddenPinNames.filter((name) => !names.has(name)),
      ...(variant.auxiliaryPins
        ? {
            auxiliaryPins: variant.auxiliaryPins.filter(
              (pin) => !names.has(pin.name),
            ),
          }
        : {}),
    })),
    ...(pins.length === 0 ? { hierarchicalBlock: true as const } : {}),
  };
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
      const changesSignal =
        (terminal.signal || edit.signal) &&
        ((edit.name !== undefined && edit.name !== terminal.name) ||
          (edit.signal !== undefined &&
            JSON.stringify(edit.signal) !== JSON.stringify(terminal.signal)));
      const nextMember = edit.signal?.members[0];
      const preservesScalarIdentity =
        (terminal.signal?.members.length ?? 1) === 1 &&
        (edit.signal?.members.length ?? 1) === 1 &&
        (!nextMember ||
          (nextMember.netId === terminal.netId &&
            nextMember.id ===
              (terminal.signal?.members[0]?.id ?? terminal.id)));
      const signalNets = new Set(
        terminal.signal?.members.map((member) => member.netId) ?? [
          terminal.netId,
        ],
      );
      const preservesMembers =
        terminal.signal &&
        edit.signal &&
        terminal.signal.members.length === edit.signal.members.length &&
        terminal.signal.members.every((member) =>
          edit.signal!.members.some(
            (next) => next.id === member.id && next.netId === member.netId,
          ),
        );
      if (
        changesSignal &&
        !preservesScalarIdentity &&
        !preservesMembers &&
        (draft.routes.some(
          (route) =>
            signalNets.has(route.netId) ||
            route.members?.some((member) => signalNets.has(member.netId)),
        ) ||
          draft.nets.some(
            (net) =>
              signalNets.has(net.id) &&
              net.terminals.some(
                (endpoint) =>
                  !terminal.interfaceInstanceIds.includes(endpoint.instanceId),
              ),
          ))
      ) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Connected signal interface changes require an explicit migration",
            [],
            [terminal.id],
          ),
        };
      }
      if (edit.name !== undefined) {
        const previousName = terminal.name;
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
            const format = renamedLabelFormat(
              annotation,
              previousName,
              edit.name,
              draft.presentation,
            );
            if (format) annotation.formatOverride = format;
            else delete annotation.formatOverride;
            changedObjectIds.add(annotation.id);
          }
        }
      }
      if (edit.direction !== undefined) terminal.direction = edit.direction;
      if (edit.signal !== undefined) {
        terminal.signal = structuredClone(edit.signal);
        terminal.netId = edit.signal.members[0]!.netId;
      }
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
