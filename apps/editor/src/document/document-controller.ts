import type { ComponentDefinition } from "@icm/model";
import { useRef, useState } from "react";

import {
  DEFAULT_DOCUMENT_HISTORY_LIMIT,
  executeTransaction,
  shareEqualDocumentStructure,
  executeProjectTransaction,
  rejectTransaction,
  diffDocumentObjectIds,
} from "@icm/edit-engine";
import type {
  EditActor,
  EditTransactionResult,
  ProjectTransaction,
  ProjectTransactionOptions,
  ProjectTransactionResult,
  SchematicEdit,
} from "@icm/edit-engine";
import { CircuitProjectSchema, ComponentDefinitionSchema } from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  withProjectComponentDefinitions,
  projectCellSymbolTerminals,
} from "@icm/symbols";

import { arrangeNewlyStruckLabels } from "../features/instance-display/struck-label-arrangement";
import {
  replaceProjectDocument,
  resolveActiveDocument,
} from "./editor-session";

type ProjectSymbolResolver = ReturnType<typeof createProjectSymbolResolver>;

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
      JSON.stringify(after.presentation.cellSymbol) ||
    JSON.stringify(projectCellSymbolTerminals(before)) !==
      JSON.stringify(projectCellSymbolTerminals(after))
  );
}

/**
 * A complete authenticated transaction envelope accepted by
 * {@link EditorDocumentController.dispatchTransaction}. Both human and Agent
 * entry points build one of these; the actor identifies the origin. This is the
 * single write envelope that reaches the Edit Engine.
 */
export interface EditorTransactionRequest {
  transactionId: string;
  documentId: string;
  expectedRevision: number;
  expectedStructureRevision?: number;
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

interface ProjectHistoryEntry {
  project: CircuitProject;
  documentId: string;
  structural: boolean;
}

/**
 * One bounded chronological history per open Project working copy. Document
 * and structural transactions keep their executors, not separate undo stacks.
 */
export class EditorDocumentController {
  private projectValue: CircuitProject;
  private activeDocumentIdValue: string;
  private resolverValue: ProjectSymbolResolver;
  private readonly undoStack: ProjectHistoryEntry[] = [];
  private readonly redoStack: ProjectHistoryEntry[] = [];
  // Retain revision high-water marks for deleted/recreated Cells too.
  private readonly documentRevisions = new Map<string, number>();
  private readonly availableComponents = new Map<string, ComponentDefinition>();
  private transactionCounter = 0;
  private projectSessionCounter = 1;
  private readonly liveResolver = {
    resolve: (id: string, variant?: string) =>
      this.resolverValue.resolve(id, variant),
  };

  constructor(initialProject: CircuitProject) {
    this.projectValue = withProjectComponentDefinitions(
      CircuitProjectSchema.parse(structuredClone(initialProject)),
    );
    this.activeDocumentIdValue = this.projectValue.topDocumentId;
    this.resolverValue = this.projectResolver(this.projectValue);
    this.rememberRevisions();
  }

  /** An insertion candidate is not Project content until a real instance is placed. */
  offerComponentDefinition(value: ComponentDefinition): void {
    const definition = ComponentDefinitionSchema.parse(structuredClone(value));
    if (!definition.symbol.id.startsWith("user-"))
      throw new Error(
        "Shared component IDs must be versioned user definitions",
      );
    const existing =
      this.projectValue.componentDefinitions?.find(
        (item) => item.symbol.id === definition.symbol.id,
      ) ?? this.availableComponents.get(definition.symbol.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition))
      throw new Error("A placed component version cannot be overwritten");
    this.availableComponents.set(definition.symbol.id, definition);
    this.resolverValue = this.projectResolver(this.projectValue);
  }

  private projectResolver(project: CircuitProject): ProjectSymbolResolver {
    return createProjectSymbolResolver(project, [
      ...builtInSymbols,
      ...[...this.availableComponents.values()].map((item) => item.symbol),
    ]);
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
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
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
    const document = this.projectValue.documents.find(
      (item) => item.id === documentId,
    );
    if (!document) return null;
    this.activeDocumentIdValue = document.id;
    return document;
  }

  replaceProject(nextProject: CircuitProject): SchematicDocument {
    const parsed = withProjectComponentDefinitions(
      CircuitProjectSchema.parse(structuredClone(nextProject)),
    );
    this.projectSessionCounter += 1;
    this.availableComponents.clear();
    this.projectValue = parsed;
    this.activeDocumentIdValue = parsed.topDocumentId;
    this.resolverValue = this.projectResolver(parsed);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.documentRevisions.clear();
    this.rememberRevisions();
    return this.document;
  }

  private rememberRevisions(): void {
    for (const document of this.projectValue.documents)
      this.documentRevisions.set(
        document.id,
        Math.max(
          document.revision,
          this.documentRevisions.get(document.id) ?? 0,
        ),
      );
  }

  private record(
    project: CircuitProject,
    documentId: string,
    structural: boolean,
  ): void {
    this.undoStack.push({ project, documentId, structural });
    if (this.undoStack.length > DEFAULT_DOCUMENT_HISTORY_LIMIT)
      this.undoStack.shift();
    this.redoStack.length = 0;
    this.rememberRevisions();
  }

  /** Share immutable document objects after whole-Project validation cloned them. */
  private shareDocuments(
    before: CircuitProject,
    after: CircuitProject,
  ): CircuitProject {
    const originals = new Map(
      before.documents.map((document) => [document.id, document]),
    );
    return {
      ...after,
      documents: after.documents.map((document) => {
        const original = originals.get(document.id);
        return original
          ? shareEqualDocumentStructure(original, document)
          : document;
      }),
    };
  }

  commitProjectStructure(
    nextProject: CircuitProject,
    activeDocumentId = this.activeDocumentIdValue,
    historyDocumentId = activeDocumentId,
  ): SchematicDocument {
    const before = this.projectValue;
    const parsed = this.shareDocuments(
      before,
      withProjectComponentDefinitions(
        CircuitProjectSchema.parse(structuredClone(nextProject)),
      ),
    );
    if (parsed.id !== before.id)
      throw new Error(
        `Structural commit cannot replace Project ${before.id} with ${parsed.id}`,
      );
    if (!parsed.documents.some((document) => document.id === activeDocumentId))
      throw new Error(
        `Document ${activeDocumentId} is not present in the Project`,
      );
    if (parsed.structureRevision !== before.structureRevision + 1)
      throw new Error(
        `Structural commit must advance Project revision ${before.structureRevision} to ${before.structureRevision + 1}`,
      );
    const resolver = this.projectResolver(parsed);
    this.projectValue = parsed;
    this.activeDocumentIdValue = activeDocumentId;
    this.resolverValue = resolver;
    this.record(before, historyDocumentId, true);
    return this.document;
  }

  dispatchProjectTransaction(
    request: ProjectTransaction,
    activeDocumentId = this.activeDocumentIdValue,
    historyDocumentId = activeDocumentId,
  ): ProjectTransactionResult {
    const result = executeProjectTransaction(
      this.projectValue,
      request,
      EDITOR_PROJECT_TRANSACTION_OPTIONS,
    );
    if (result.ok && result.applied)
      this.commitProjectStructure(
        result.project,
        activeDocumentId,
        historyDocumentId,
      );
    return result;
  }

  transact(edits: readonly SchematicEdit[]): EditTransactionResult {
    this.transactionCounter += 1;
    // GUI undo follows the working copy's timeline, regardless of the viewed Cell.
    const edit = edits.length === 1 ? edits[0] : undefined;
    const entry =
      edit?.kind === "undo"
        ? this.undoStack.at(-1)
        : edit?.kind === "redo"
          ? this.redoStack.at(-1)
          : undefined;
    const document =
      this.projectValue.documents.find(
        (item) => item.id === entry?.documentId,
      ) ?? this.document;
    return this.dispatchTransaction({
      transactionId: `transaction-ui-${this.transactionCounter}`,
      documentId: document.id,
      expectedRevision: document.revision,
      expectedStructureRevision: this.projectValue.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits,
    });
  }

  /** Validate the complete candidate before either Project or history changes. */
  dispatchTransaction(
    request: EditorTransactionRequest,
  ): EditTransactionResult {
    const document = this.projectValue.documents.find(
      (item) => item.id === request.documentId,
    );
    if (!document)
      return rejectTransaction(
        this.document,
        "OBJECT_NOT_FOUND",
        `Document ${request.documentId} is not present in the Project`,
      );
    if (
      request.edits.some((edit) =>
        [
          "add_cell_terminal",
          "update_cell_terminal",
          "remove_cell_terminal",
          "reorder_cell_terminals",
        ].includes(edit.kind),
      )
    )
      return rejectTransaction(
        document,
        "EDIT_PRECONDITION",
        "Cell interface edits require a Project structural transaction",
      );
    let result: EditTransactionResult;
    try {
      // expectedStructureRevision is a controller fence, not a Document edit field.
      const { expectedStructureRevision: _, ...envelope } = request;
      result = executeTransaction(document, envelope, {
        symbolResolver: this.liveResolver,
      });
    } catch (error) {
      return rejectTransaction(
        document,
        "INTERNAL_ERROR",
        `Transaction failed with an internal error: ${error instanceof Error ? error.message : "unknown failure"}`,
      );
    }
    if (!result.ok && result.error.code === "HISTORY_CONTEXT_REQUIRED") {
      if (
        request.edits.length !== 1 ||
        (request.edits[0]?.kind !== "undo" && request.edits[0]?.kind !== "redo")
      )
        return result;
      return this.restoreHistory(request, request.edits[0].kind);
    }
    if (!result.ok || !result.applied) return result;
    if (
      JSON.stringify({ ...result.document, revision: document.revision }) ===
      JSON.stringify(document)
    )
      return {
        ...result,
        applied: false,
        revision: document.revision,
        proposedRevision: document.revision,
        document,
        diff: {
          ...result.diff,
          toRevision: document.revision,
          changedObjectIds: [],
        },
      };
    const before = this.projectValue;
    try {
      const definitions = new Map(
        (before.componentDefinitions ?? []).map((item) => [
          item.symbol.id,
          item,
        ]),
      );
      for (const [id, definition] of this.availableComponents)
        if (!definitions.has(id)) definitions.set(id, definition);
      const next = this.shareDocuments(
        before,
        withProjectComponentDefinitions(
          replaceProjectDocument(
            { ...before, componentDefinitions: [...definitions.values()] },
            result.document,
          ),
        ),
      );
      const resolver = this.needsResolver(before, next)
        ? this.projectResolver(next)
        : this.resolverValue;
      this.projectValue = next;
      this.resolverValue = resolver;
      this.record(before, request.documentId, false);
      return {
        ...result,
        document: next.documents.find(
          (item) => item.id === request.documentId,
        )!,
      };
    } catch (error) {
      return rejectTransaction(
        document,
        "INTERNAL_ERROR",
        `Committed document could not be re-validated into a Project: ${error instanceof Error ? error.message : "unknown failure"}`,
      );
    }
  }

  private needsResolver(
    before: CircuitProject,
    after: CircuitProject,
  ): boolean {
    const definitions = new Map(
      (after.componentDefinitions ?? []).map((item) => [
        item.symbol.id,
        item.symbol,
      ]),
    );
    const ids = new Set([
      ...(before.componentDefinitions ?? []).map((item) => item.symbol.id),
      ...definitions.keys(),
    ]);
    if (
      [...ids].some(
        (id) =>
          JSON.stringify(
            definitions.get(id) ??
              builtInSymbols.find((item) => item.id === id),
          ) !== JSON.stringify(this.resolverValue.resolve(id)?.definition),
      ) ||
      before.documents.length !== after.documents.length
    )
      return true;
    return after.documents.some((document) => {
      const previous = before.documents.find((item) => item.id === document.id);
      return !previous || documentSymbolDefinitionChanged(previous, document);
    });
  }

  private restoreHistory(
    request: EditorTransactionRequest,
    kind: "undo" | "redo",
  ): EditTransactionResult {
    const source = kind === "undo" ? this.undoStack : this.redoStack;
    const destination = kind === "undo" ? this.redoStack : this.undoStack;
    const entry = source.at(-1);
    const before = this.projectValue;
    const document = before.documents.find(
      (item) => item.id === request.documentId,
    )!;
    if (!entry)
      return rejectTransaction(
        document,
        "HISTORY_EMPTY",
        `No ${kind} state is available`,
      );
    // Never skip a newer entry just because the Agent targeted another Cell.
    const historyDocumentId = before.documents.some(
      (item) => item.id === entry.documentId,
    )
      ? entry.documentId
      : before.topDocumentId;
    if (
      request.actor.kind === "agent" &&
      request.documentId !== historyDocumentId
    )
      return rejectTransaction(
        document,
        "EDIT_PRECONDITION",
        `Project history is chronological; the next ${kind} belongs to Cell ${historyDocumentId}`,
      );
    if (
      entry.structural &&
      request.actor.kind === "agent" &&
      request.expectedStructureRevision !== before.structureRevision
    )
      return rejectTransaction(
        document,
        "STALE_REVISION",
        "Refresh Project structureRevision before changing structural history",
      );
    try {
      const current = new Map(before.documents.map((item) => [item.id, item]));
      const restored = this.shareDocuments(
        entry.project,
        CircuitProjectSchema.parse({
          ...entry.project,
          structureRevision:
            before.structureRevision + (entry.structural ? 1 : 0),
          documents: entry.project.documents.map((saved) => {
            const live = current.get(saved.id);
            // Revisions identify live versions, never the historical snapshot.
            const unchanged =
              live &&
              JSON.stringify({ ...live, revision: 0 }) ===
                JSON.stringify({ ...saved, revision: 0 });
            return unchanged
              ? live
              : {
                  ...saved,
                  revision:
                    Math.max(
                      saved.revision,
                      this.documentRevisions.get(saved.id) ?? 0,
                    ) + 1,
                };
          }),
        }),
      );
      const restoredDocument =
        restored.documents.find((item) => item.id === request.documentId) ??
        restored.documents.find((item) => item.id === restored.topDocumentId)!;
      const changedDocumentIds = [
        ...new Set(
          [...before.documents, ...restored.documents].map((item) => item.id),
        ),
      ].filter(
        (id) =>
          JSON.stringify(before.documents.find((item) => item.id === id)) !==
          JSON.stringify(restored.documents.find((item) => item.id === id)),
      );
      const changedObjectIds = [
        ...new Set(
          changedDocumentIds.flatMap((id) => [
            id,
            ...diffDocumentObjectIds(
              before.documents.find((item) => item.id === id),
              restored.documents.find((item) => item.id === id),
            ),
          ]),
        ),
      ];
      const diff = {
        documentId: restoredDocument.id,
        fromRevision: document.revision,
        toRevision: restoredDocument.revision,
        editKinds: [kind],
        changedObjectIds,
      };
      if (request.dryRun)
        return {
          ok: true,
          applied: false,
          revision: document.revision,
          proposedRevision: restoredDocument.revision,
          document,
          diff,
          diagnostics: [],
        };
      const resolver =
        entry.structural || this.needsResolver(before, restored)
          ? this.projectResolver(restored)
          : this.resolverValue;
      // All potentially throwing preparation precedes the history cursor change.
      this.projectValue = restored;
      this.resolverValue = resolver;
      if (
        !restored.documents.some(
          (item) => item.id === this.activeDocumentIdValue,
        )
      )
        this.activeDocumentIdValue = restored.topDocumentId;
      source.pop();
      destination.push({
        project: before,
        documentId: entry.documentId,
        structural: entry.structural,
      });
      if (destination.length > DEFAULT_DOCUMENT_HISTORY_LIMIT)
        destination.shift();
      this.rememberRevisions();
      return {
        ok: true,
        applied: true,
        revision: restoredDocument.revision,
        proposedRevision: restoredDocument.revision,
        document: restoredDocument,
        diff,
        diagnostics: [],
      };
    } catch (error) {
      return rejectTransaction(
        document,
        "INTERNAL_ERROR",
        `History restoration failed: ${error instanceof Error ? error.message : "unknown failure"}`,
      );
    }
  }
}

/**
 * How the editor runs a Project transaction, wherever it commits one: a
 * caller's labels its Cell's changed Pins newly draw a redrawn wire over, or
 * its widened block over, move clear (#1366).
 */
export const EDITOR_PROJECT_TRANSACTION_OPTIONS: ProjectTransactionOptions = {
  arrangeStruckLabels: arrangeNewlyStruckLabels,
};

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
  const synchronize = () => {
    if (controllerRef.current === controller)
      setSnapshot(controller.snapshot());
  };

  return {
    ...snapshot,
    controller,
    activateSession: (next: EditorDocumentController) => {
      controllerRef.current = next;
      setSnapshot(next.snapshot());
    },
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
      if (controllerRef.current === controller)
        onCommittedRef.current(controller.project);
      return document;
    },
    transact: (edits: readonly SchematicEdit[]) => {
      const result = controller.transact(edits);
      if (result.ok && result.applied) {
        synchronize();
        if (controllerRef.current === controller)
          onCommittedRef.current(controller.project);
      }
      return result;
    },
    dispatchTransaction: (request: EditorTransactionRequest) => {
      const result = controller.dispatchTransaction(request);
      if (result.ok && result.applied) {
        synchronize();
        if (controllerRef.current === controller)
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
        if (controllerRef.current === controller)
          onCommittedRef.current(controller.project);
      }
      return result;
    },
    synchronizeExternalCommit: () => {
      synchronize();
      if (controllerRef.current === controller)
        onCommittedRef.current(controller.project);
    },
  };
}
