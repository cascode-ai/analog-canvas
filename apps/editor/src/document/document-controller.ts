import { useRef, useState } from "react";

import {
  DEFAULT_DOCUMENT_HISTORY_LIMIT,
  DocumentHistory,
  executeProjectTransaction,
  rejectTransaction,
  diffDocumentObjectIds,
} from "@icm/edit-engine";
import type {
  EditActor,
  EditTransactionResult,
  ProjectTransaction,
  ProjectTransactionResult,
  SchematicEdit,
} from "@icm/edit-engine";
import { CircuitProjectSchema } from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import {
  replaceProjectDocument,
  resolveActiveDocument,
} from "./editor-session";

type ProjectSymbolResolver = ReturnType<typeof createProjectSymbolResolver>;

const SYMBOL_DEFINITION_EDIT_KINDS = new Set<SchematicEdit["kind"]>([
  "create_cell_interface",
  "add_cell_terminal",
  "update_cell_terminal",
  "remove_cell_terminal",
  "reorder_cell_terminals",
  "set_cell_symbol_presentation",
]);

function transactionMayChangeSymbolDefinitions(
  edits: readonly SchematicEdit[],
): boolean {
  return edits.some(
    (edit) =>
      SYMBOL_DEFINITION_EDIT_KINDS.has(edit.kind) ||
      edit.kind === "undo" ||
      edit.kind === "redo",
  );
}

function documentSymbolDefinitionChanged(
  before: SchematicDocument,
  after: SchematicDocument,
): boolean {
  return (
    before.name !== after.name ||
    JSON.stringify(before.sourceBinding) !==
      JSON.stringify(after.sourceBinding) ||
    JSON.stringify(before.netlist?.name) !==
      JSON.stringify(after.netlist?.name) ||
    JSON.stringify(before.netlist?.terminals) !==
      JSON.stringify(after.netlist?.terminals) ||
    JSON.stringify(before.presentation.cellSymbol) !==
      JSON.stringify(after.presentation.cellSymbol)
  );
}

/**
 * A complete authenticated transaction envelope accepted by
 * {@link EditorDocumentController.dispatchTransaction}. Both human and Agent
 * entry points build one of these; the actor identifies the origin. This is the
 * single write envelope that reaches `DocumentHistory`.
 */
export interface EditorTransactionRequest {
  transactionId: string;
  documentId: string;
  expectedRevision: number;
  actor: EditActor;
  dryRun?: boolean;
  edits: readonly SchematicEdit[];
}

export interface DocumentControllerSnapshot {
  project: CircuitProject;
  document: SchematicDocument;
  activeDocumentId: string;
  resolver: ProjectSymbolResolver;
  canUndo: boolean;
  canRedo: boolean;
  projectSessionId: string;
}

/**
 * Owns the editor's one mutable document-history graph. React receives only
 * immutable snapshots; all committed model changes still pass through
 * DocumentHistory and the validated Project replacement helper.
 */
export class EditorDocumentController {
  private projectValue: CircuitProject;
  private activeDocumentIdValue: string;
  private resolverValue: ProjectSymbolResolver;
  private historyValue: DocumentHistory;
  private histories: Map<string, DocumentHistory>;
  private readonly projectUndoStack: Array<{
    project: CircuitProject;
    activeDocumentId: string;
  }> = [];
  private readonly projectRedoStack: Array<{
    project: CircuitProject;
    activeDocumentId: string;
  }> = [];
  private transactionCounter = 0;
  private projectSessionCounter = 1;

  constructor(initialProject: CircuitProject) {
    this.projectValue = CircuitProjectSchema.parse(
      structuredClone(initialProject),
    );
    this.activeDocumentIdValue = this.projectValue.topDocumentId;
    this.resolverValue = createProjectSymbolResolver(
      this.projectValue,
      builtInSymbols,
    );
    const document = resolveActiveDocument(
      this.projectValue,
      this.activeDocumentIdValue,
    );
    this.historyValue = new DocumentHistory(document, {
      symbolResolver: this.resolverValue,
    });
    this.histories = new Map([[document.id, this.historyValue]]);
  }

  get project(): CircuitProject {
    return this.projectValue;
  }

  get document(): SchematicDocument {
    return resolveActiveDocument(this.projectValue, this.activeDocumentIdValue);
  }

  get activeDocumentId(): string {
    return this.activeDocumentIdValue;
  }

  get resolver(): ProjectSymbolResolver {
    return this.resolverValue;
  }

  get canUndo(): boolean {
    return this.historyValue.canUndo || this.projectUndoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.historyValue.canRedo || this.projectRedoStack.length > 0;
  }

  get transactionsIssued(): number {
    return this.transactionCounter;
  }

  get projectSessionId(): string {
    return `${this.projectValue.id}:${this.projectSessionCounter}`;
  }

  snapshot(): DocumentControllerSnapshot {
    return {
      project: this.project,
      document: this.document,
      activeDocumentId: this.activeDocumentId,
      resolver: this.resolver,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      projectSessionId: this.projectSessionId,
    };
  }

  openDocument(documentId: string): SchematicDocument | null {
    if (documentId === this.activeDocumentIdValue) return this.document;
    const document = this.projectValue.documents.find(
      (candidate) => candidate.id === documentId,
    );
    if (!document) return null;

    const existingHistory = this.histories.get(document.id);
    this.historyValue =
      existingHistory?.document.revision === document.revision
        ? existingHistory
        : new DocumentHistory(document, {
            symbolResolver: this.resolverValue,
          });
    this.histories.set(document.id, this.historyValue);
    this.activeDocumentIdValue = document.id;
    return document;
  }

  replaceProject(nextProject: CircuitProject): SchematicDocument {
    this.projectSessionCounter += 1;
    this.projectValue = CircuitProjectSchema.parse(
      structuredClone(nextProject),
    );
    this.activeDocumentIdValue = this.projectValue.topDocumentId;
    this.resolverValue = createProjectSymbolResolver(
      this.projectValue,
      builtInSymbols,
    );
    const document = this.document;
    this.historyValue = new DocumentHistory(document, {
      symbolResolver: this.resolverValue,
    });
    this.histories = new Map([[document.id, this.historyValue]]);
    this.projectUndoStack.length = 0;
    this.projectRedoStack.length = 0;
    return document;
  }

  /**
   * Commit a validated structural update within the current Project session.
   * Adding a child Document changes the symbol resolver and invalidates every
   * DocumentHistory context, so histories are deliberately rebuilt while the
   * active Document and recovery/session identity remain stable.
   */
  commitProjectStructure(
    nextProject: CircuitProject,
    activeDocumentId = this.activeDocumentIdValue,
  ): SchematicDocument {
    const parsed = CircuitProjectSchema.parse(structuredClone(nextProject));
    if (parsed.id !== this.projectValue.id) {
      throw new Error(
        `Structural commit cannot replace Project ${this.projectValue.id} with ${parsed.id}`,
      );
    }
    if (
      !parsed.documents.some((document) => document.id === activeDocumentId)
    ) {
      throw new Error(
        `Document ${activeDocumentId} is not present in the Project`,
      );
    }
    if (parsed.structureRevision !== this.projectValue.structureRevision + 1) {
      throw new Error(
        `Structural commit must advance Project revision ${this.projectValue.structureRevision} to ${this.projectValue.structureRevision + 1}`,
      );
    }
    this.projectUndoStack.push({
      project: this.projectValue,
      activeDocumentId: this.activeDocumentIdValue,
    });
    if (this.projectUndoStack.length > DEFAULT_DOCUMENT_HISTORY_LIMIT) {
      this.projectUndoStack.shift();
    }
    this.projectRedoStack.length = 0;
    this.projectValue = parsed;
    this.activeDocumentIdValue = activeDocumentId;
    this.resolverValue = createProjectSymbolResolver(
      this.projectValue,
      builtInSymbols,
    );
    this.resetHistoriesFromProject();
    return this.document;
  }

  dispatchProjectTransaction(
    request: ProjectTransaction,
    activeDocumentId = this.activeDocumentIdValue,
  ): ProjectTransactionResult {
    const result = executeProjectTransaction(this.projectValue, request);
    if (result.ok && result.applied) {
      this.commitProjectStructure(result.project, activeDocumentId);
    }
    return result;
  }

  transact(edits: readonly SchematicEdit[]): EditTransactionResult {
    this.transactionCounter += 1;
    if (
      edits.length === 1 &&
      (edits[0]?.kind === "undo" || edits[0]?.kind === "redo")
    ) {
      const kind = edits[0].kind;
      const documentHistoryAvailable =
        kind === "undo" ? this.historyValue.canUndo : this.historyValue.canRedo;
      if (!documentHistoryAvailable) {
        return this.restoreProjectHistory(kind);
      }
    }
    return this.dispatchTransaction({
      transactionId: `transaction-ui-${this.transactionCounter}`,
      documentId: this.activeDocumentIdValue,
      expectedRevision: this.historyValue.document.revision,
      actor: { kind: "human", id: "human-local" },
      edits,
    });
  }

  /**
   * The single write path for both human and Agent transactions. Selects the
   * matching per-Document history (without retargeting the active Document),
   * dispatches through {@link DocumentHistory.transact}, and on a successful
   * commit replaces the Project document. Ordinary drawing edits preserve the
   * resolver because built-in and hierarchical symbol definitions did not
   * change; definition-level edits and their undo/redo rebuild it. `dryRun`
   * mutates no history, Project, resolver, or undo state. Opening or viewing
   * another Document neither retargets nor cancels an explicit dispatch.
   *
   * Unexpected runtime exceptions from the engine or from post-commit Project
   * re-validation are converted into typed `INTERNAL_ERROR` rejections: the
   * Project and revision keep their previous values and the histories are
   * rebuilt from that unchanged Project, so a later transaction continues from
   * a consistent state.
   */
  dispatchTransaction(
    request: EditorTransactionRequest,
  ): EditTransactionResult {
    if (
      request.edits.some(
        (edit) =>
          edit.kind === "add_cell_terminal" ||
          edit.kind === "update_cell_terminal" ||
          edit.kind === "remove_cell_terminal" ||
          edit.kind === "reorder_cell_terminals",
      )
    ) {
      return rejectTransaction(
        this.document,
        "EDIT_PRECONDITION",
        "Cell interface edits require a Project structural transaction",
      );
    }
    const history = this.historyForDocument(request.documentId);
    if (!history) {
      return rejectTransaction(
        this.document,
        "OBJECT_NOT_FOUND",
        `Document ${request.documentId} is not present in the Project`,
      );
    }
    const historyEdit =
      request.edits.length === 1 ? request.edits[0] : undefined;
    if (
      historyEdit &&
      (historyEdit.kind === "undo" || historyEdit.kind === "redo") &&
      !(historyEdit.kind === "undo" ? history.canUndo : history.canRedo)
    ) {
      if (request.expectedRevision !== history.document.revision)
        return rejectTransaction(
          history.document,
          "STALE_REVISION",
          "Refresh before changing shared history",
        );
      return this.restoreProjectHistory(
        historyEdit.kind,
        request.documentId,
        request.dryRun ?? false,
      );
    }
    let result: EditTransactionResult;
    try {
      result = history.transact(request);
    } catch (error) {
      this.resetHistoriesFromProject();
      return rejectTransaction(
        this.document,
        "INTERNAL_ERROR",
        `Transaction failed with an internal error: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
      );
    }
    if (result.ok && result.applied) {
      const previousProject = this.projectValue;
      const previousDocument = previousProject.documents.find(
        (document) => document.id === request.documentId,
      )!;
      try {
        this.projectValue = replaceProjectDocument(
          this.projectValue,
          result.document,
        );
        if (
          transactionMayChangeSymbolDefinitions(request.edits) &&
          documentSymbolDefinitionChanged(previousDocument, result.document)
        ) {
          this.resolverValue = createProjectSymbolResolver(
            this.projectValue,
            builtInSymbols,
          );
        }
        if (
          !request.edits.some(
            (edit) => edit.kind === "undo" || edit.kind === "redo",
          )
        ) {
          this.projectRedoStack.length = 0;
        }
      } catch (error) {
        this.projectValue = previousProject;
        this.resetHistoriesFromProject();
        return rejectTransaction(
          this.document,
          "INTERNAL_ERROR",
          `Committed document could not be re-validated into a Project: ${
            error instanceof Error ? error.message : "unknown failure"
          }`,
        );
      }
    }
    return result;
  }

  private restoreProjectHistory(
    kind: "undo" | "redo",
    documentId = this.activeDocumentIdValue,
    dryRun = false,
  ): EditTransactionResult {
    const sourceStack =
      kind === "undo" ? this.projectUndoStack : this.projectRedoStack;
    const destinationStack =
      kind === "undo" ? this.projectRedoStack : this.projectUndoStack;
    const target = sourceStack.at(-1);
    if (!target) {
      return rejectTransaction(
        this.document,
        "HISTORY_EMPTY",
        `No ${kind} state is available`,
      );
    }

    const before = this.projectValue;
    const currentById = new Map(
      before.documents.map((document) => [document.id, document]),
    );
    const restored = CircuitProjectSchema.parse({
      ...structuredClone(target.project),
      structureRevision: before.structureRevision + 1,
      documents: target.project.documents.map((document) => {
        const current = currentById.get(document.id);
        return current
          ? { ...structuredClone(document), revision: current.revision + 1 }
          : structuredClone(document);
      }),
    });
    const proposedDocument =
      restored.documents.find((item) => item.id === documentId) ??
      restored.documents.find((item) => item.id === restored.topDocumentId)!;
    const previousDocument = before.documents.find(
      (item) => item.id === documentId,
    )!;
    const documentIds = [
      ...new Set(
        [...before.documents, ...restored.documents].map((item) => item.id),
      ),
    ];
    const changedIds = [
      ...new Set(
        documentIds.flatMap((id) =>
          diffDocumentObjectIds(
            before.documents.find((item) => item.id === id),
            restored.documents.find((item) => item.id === id),
          ),
        ),
      ),
    ];
    if (dryRun)
      return {
        ok: true,
        applied: false,
        revision: previousDocument.revision,
        proposedRevision: proposedDocument.revision,
        document: previousDocument,
        diagnostics: [],
        diff: {
          documentId,
          fromRevision: previousDocument.revision,
          toRevision: proposedDocument.revision,
          editKinds: [kind],
          changedObjectIds: changedIds,
        },
      };
    sourceStack.pop();
    destinationStack.push({
      project: before,
      activeDocumentId: this.activeDocumentIdValue,
    });
    if (destinationStack.length > DEFAULT_DOCUMENT_HISTORY_LIMIT) {
      destinationStack.shift();
    }
    this.projectValue = restored;
    this.activeDocumentIdValue = restored.documents.some(
      (document) => document.id === target.activeDocumentId,
    )
      ? target.activeDocumentId
      : restored.topDocumentId;
    this.resolverValue = createProjectSymbolResolver(restored, builtInSymbols);
    this.resetHistoriesFromProject();
    const document =
      restored.documents.find((item) => item.id === documentId) ??
      this.document;
    return {
      ok: true,
      applied: true,
      revision: document.revision,
      proposedRevision: document.revision,
      document,
      diff: {
        documentId: document.id,
        fromRevision:
          before.documents.find((candidate) => candidate.id === document.id)
            ?.revision ?? document.revision,
        toRevision: document.revision,
        editKinds: [kind],
        changedObjectIds: changedIds,
      },
      diagnostics: [],
    };
  }

  /**
   * Rebuild every history from the current (unchanged) Project after an
   * internal error. The undo history is deliberately sacrificed here: the
   * histories may hold a partially applied document, and model consistency
   * outranks undo depth on this rare path.
   */
  private resetHistoriesFromProject(): void {
    const document = this.document;
    this.historyValue = new DocumentHistory(document, {
      symbolResolver: this.resolverValue,
    });
    this.histories = new Map([[document.id, this.historyValue]]);
  }

  /**
   * Returns the per-Document history for `documentId`, creating one at the
   * Project's current revision if the Document has never been opened. Returns
   * `null` when the Document is absent so the caller can produce a typed error.
   * Never changes the active Document.
   */
  private historyForDocument(documentId: string): DocumentHistory | null {
    const existing = this.histories.get(documentId);
    if (existing) return existing;
    const document = this.projectValue.documents.find(
      (candidate) => candidate.id === documentId,
    );
    if (!document) return null;
    const history = new DocumentHistory(document, {
      symbolResolver: this.resolverValue,
    });
    this.histories.set(documentId, history);
    return history;
  }
}

export function useDocumentController(
  initialProject: CircuitProject,
  onCommittedProject: (project: CircuitProject) => void,
) {
  const controllerRef = useRef<EditorDocumentController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new EditorDocumentController(initialProject);
  }
  const controller = controllerRef.current;
  const onCommittedRef = useRef(onCommittedProject);
  onCommittedRef.current = onCommittedProject;
  const [snapshot, setSnapshot] = useState(() => controller.snapshot());
  const synchronize = () => setSnapshot(controller.snapshot());

  return {
    ...snapshot,
    controller,
    openDocument: (documentId: string) => {
      const document = controller.openDocument(documentId);
      if (document) synchronize();
      return document;
    },
    replaceProject: (project: CircuitProject) => {
      const document = controller.replaceProject(project);
      synchronize();
      return document;
    },
    commitProjectStructure: (
      project: CircuitProject,
      activeDocumentId?: string,
    ) => {
      const document = controller.commitProjectStructure(
        project,
        activeDocumentId,
      );
      synchronize();
      onCommittedRef.current(controller.project);
      return document;
    },
    transact: (edits: readonly SchematicEdit[]) => {
      const result = controller.transact(edits);
      if (result.ok && result.applied) {
        synchronize();
        onCommittedRef.current(controller.project);
      }
      return result;
    },
    dispatchTransaction: (request: EditorTransactionRequest) => {
      const result = controller.dispatchTransaction(request);
      if (result.ok && result.applied) {
        synchronize();
        onCommittedRef.current(controller.project);
      }
      return result;
    },
    dispatchProjectTransaction: (
      request: ProjectTransaction,
      activeDocumentId?: string,
    ) => {
      const result = controller.dispatchProjectTransaction(
        request,
        activeDocumentId,
      );
      if (result.ok && result.applied) {
        synchronize();
        onCommittedRef.current(controller.project);
      }
      return result;
    },
    synchronizeExternalCommit: () => {
      synchronize();
      onCommittedRef.current(controller.project);
    },
  };
}
