// The editor's hierarchy refactors. Each runs one plan from hierarchy-refactor
// as one Project transaction and says in the status line what changed,
// naming the shared scope when it edited a Cell with several uses.
import { buildProjectHierarchy } from "@icm/derived";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import type {
  CircuitProject,
  HierarchyFrame,
  SchematicDocument,
} from "@icm/model";

import {
  planCellFromSelection,
  planFlattenInstance,
  planMakeUniqueCell,
  planReplaceCell,
  selectionCellPins,
  type CellUse,
  type SelectionCellPin,
} from "./hierarchy-refactor";
import { frameReference } from "./project-hierarchy";

export interface CommandAction {
  enabled: boolean;
  execute(): void;
  /** Said with the command before it runs, as a shared scope it edits. */
  note?: string | undefined;
}

/**
 * What a command that edits this Cell says before it runs, when the Cell has
 * several uses; undefined when it has one.
 */
export function sharedEditNote(
  project: CircuitProject,
  documentId: string,
): string | undefined {
  const uses = buildProjectHierarchy(project).usage(documentId, 0).total;
  if (uses < 2) return undefined;
  const name =
    project.documents.find((cell) => cell.id === documentId)?.name ??
    documentId;
  return `Edits ${name}, so all ${uses} of its uses change`;
}

/** The refactors as commands on the canvas selection, for the menus. */
export interface HierarchyRefactorActions {
  fromSelection: CommandAction;
  makeUnique: CommandAction;
  replace: CommandAction;
  flatten: CommandAction;
}

/** The refactor commands in menu order, with their labels. */
export const HIERARCHY_REFACTOR_ITEMS: readonly (readonly [
  keyof HierarchyRefactorActions,
  string,
])[] = [
  ["makeUnique", "Make unique copy"],
  ["replace", "Replace Cell…"],
  ["flatten", "Flatten into this Cell"],
  ["fromSelection", "Create Cell from selection…"],
];

/** A Cell occurrence to open once a commit has rendered. */
export interface OccurrenceToOpen {
  id: string;
  path: HierarchyFrame[];
  /** Parts to select in it. */
  select?: string[];
  status?: string;
}

export interface HierarchyRefactorDependencies {
  project: CircuitProject;
  /** The open Cell. */
  document: SchematicDocument;
  createDocumentId(): string;
  nextSequence(): number;
  commitStructure(
    transactionId: string,
    edits: ProjectStructureEdit[],
  ): boolean;
  setStatus(status: string): void;
  /** The status names the shared scope, so the one-time notice is spent. */
  spendSharedEditNotice(documentId: string): void;
  openOccurrence(target: OccurrenceToOpen): void;
  selectInstances(ids: readonly string[]): void;
}

export function createHierarchyRefactorCommands({
  project,
  document,
  createDocumentId,
  nextSequence,
  commitStructure,
  setStatus,
  spendSharedEditNotice,
  openOccurrence,
  selectInstances,
}: HierarchyRefactorDependencies) {
  const name = (id: string) =>
    project.documents.find((cell) => cell.id === id)?.name ?? id;
  const reference = (use: CellUse) =>
    frameReference(project, {
      parentDocumentId: use.documentId,
      instanceId: use.instanceId,
    });
  const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  /** ", in all N uses of X" when a refactor edits a Cell with several uses. */
  const sharedScope = (documentId: string) => {
    const uses = buildProjectHierarchy(project).usage(documentId, 0).total;
    if (uses < 2) return "";
    spendSharedEditNotice(documentId);
    return `, in all ${uses} uses of ${name(documentId)}`;
  };

  return {
    /** The Pins a Cell made from these parts needs; null when refused. */
    selectionPins(instanceIds: readonly string[]): SelectionCellPin[] | null {
      try {
        return selectionCellPins(project, document.id, instanceIds);
      } catch (error) {
        setStatus(message(error));
        return null;
      }
    },

    makeUnique(use: CellUse): void {
      try {
        const plan = planMakeUniqueCell(project, use, createDocumentId());
        if (!commitStructure("make-unique-cell", plan.edits)) return;
        setStatus(
          `${reference(use)} now uses ${plan.name}, a copy of ${plan.sourceName}${sharedScope(use.documentId)} · F2 in the tree renames it`,
        );
      } catch (error) {
        setStatus(message(error));
      }
    },

    /** True once the uses switched. */
    replace(uses: readonly CellUse[], replacementId: string): boolean {
      try {
        if (
          !commitStructure(
            "replace-cell",
            planReplaceCell(project, uses, replacementId),
          )
        )
          return false;
        const [only, ...more] = uses;
        setStatus(
          only && !more.length
            ? `${reference(only)} now uses ${name(replacementId)}${sharedScope(only.documentId)}`
            : `${uses.length} instances now use ${name(replacementId)}`,
        );
        return true;
      } catch (error) {
        setStatus(message(error));
        return false;
      }
    },

    /** The parent then opens at `parentPath` with the parts selected. */
    flatten(use: CellUse, parentPath: readonly HierarchyFrame[]): void {
      try {
        const plan = planFlattenInstance(project, use, nextSequence());
        if (!commitStructure("flatten-cell-instance", plan.edits)) return;
        openOccurrence({
          id: use.documentId,
          path: [...parentPath],
          select: plan.instanceIds,
          status: `Flattened ${plan.childName} into ${name(use.documentId)}${sharedScope(use.documentId)}; its parts are selected, connected but unrouted`,
        });
      } catch (error) {
        setStatus(message(error));
      }
    },

    /**
     * Move parts of the open Cell into a new Cell named `cellName`; the
     * reason when it is refused, for the dialog to show.
     */
    fromSelection(
      instanceIds: readonly string[],
      cellName: string,
      pins: readonly SelectionCellPin[],
    ): string | undefined {
      try {
        const plan = planCellFromSelection(
          project,
          document.id,
          instanceIds,
          createDocumentId(),
          cellName,
          pins,
          nextSequence(),
        );
        if (!commitStructure("cell-from-selection", plan.edits))
          return "The Cell could not be created; see the status bar";
        selectInstances([plan.instanceId]);
        setStatus(
          `Moved ${plan.moved} part${plan.moved === 1 ? "" : "s"} into ${cellName}${sharedScope(document.id)}; its Pins are connected but unrouted`,
        );
        return undefined;
      } catch (error) {
        return message(error);
      }
    },
  };
}
