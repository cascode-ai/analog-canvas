import type { ComponentDefinition } from "@icm/model";
import { useRef, useState } from "react";

import {
  DEFAULT_DOCUMENT_HISTORY_LIMIT,
  executeTransaction,
  adoptPreparedCanvasTransaction,
  parseProjectSnapshot,
  shareProjectSnapshot,
  shareEqualDocumentStructure,
  executeProjectTransaction,
  introducedExternalCallerFailure,
  rejectTransaction,
  diffDocumentObjectIds,
  EditTransactionSchema,
} from "@icm/edit-engine";
import type {
  EditActor,
  EditTransactionResult,
  PreparedTransaction,
  ProjectTransaction,
  ProjectTransactionOptions,
  ProjectTransactionResult,
  SchematicEdit,
} from "@icm/edit-engine";
import {
  recordCommittedDocumentChanges,
  isFrozenSnapshot,
  ComponentDefinitionSchema,
  freezeSnapshot,
  restoreProjectSnapshot,
  installPreparedWireCell,
} from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { DocumentContactEvidence } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import {
  builtInSymbols,
  createSymbolCatalog,
  InMemorySymbolResolver,
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

/** Trusted editor read context; never persisted or accepted as transaction JSON. */
export interface EditorContactEvidence {
  document: SchematicDocument;
  resolver: SymbolResolver;
  evidence: DocumentContactEvidence;
}

/** Model Documents are validated JSON. Preserve serialization equality (key
 * order included), but shared subtrees need no second serialization. */
function sameDocumentJson(
  left: SchematicDocument | undefined,
  right: SchematicDocument | undefined,
  ignoreRevision = false,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = (document: SchematicDocument) =>
    Object.keys(document).filter(
      (key) => Reflect.get(document, key) !== undefined,
    );
  const leftKeys = keys(left),
    rightKeys = keys(right);
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  )
    return false;
  return leftKeys.every((key) => {
    if (ignoreRevision && key === "revision") return true;
    const before = Reflect.get(left, key),
      after = Reflect.get(right, key);
    return before === after || JSON.stringify(before) === JSON.stringify(after);
  });
}

function documentResolverContextChanged(
  before: SchematicDocument,
  after: SchematicDocument,
): boolean {
  return (
    before.name !== after.name ||
    JSON.stringify(before.sourceBinding) !==
      JSON.stringify(after.sourceBinding) ||
    JSON.stringify(before.netlist?.name) !==
      JSON.stringify(after.netlist?.name) ||
    JSON.stringify(before.netlist?.formalParameters) !==
      JSON.stringify(after.netlist?.formalParameters) ||
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

/** What {@link EditorDocumentController.beginHistoryGroup} keeps to end it. */
export interface EditorHistoryGroup {
  readonly project: CircuitProject;
  readonly activeDocumentId: string;
  readonly resolver: ProjectSymbolResolver;
  readonly undo: readonly ProjectHistoryEntry[];
  readonly redo: readonly ProjectHistoryEntry[];
  readonly agentEdited: boolean;
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
  private availableCatalog = createSymbolCatalog(builtInSymbols);
  private transactionCounter = 0;
  private projectSessionCounter = 1;
  private agentEditedValue = false;
  /** The steps recorded since {@link beginHistoryGroup}, while one is open. */
  private groupEntries: ProjectHistoryEntry[] | null = null;

  constructor(initialProject: CircuitProject) {
    this.projectValue = parseProjectSnapshot(
      withProjectComponentDefinitions(parseProjectSnapshot(initialProject)),
    );
    this.activeDocumentIdValue = this.projectValue.topDocumentId;
    this.resolverValue = this.projectResolver(this.projectValue);
    this.rememberRevisions();
  }

  /** An insertion candidate is not Project content until a real instance is placed. */
  offerComponentDefinition(value: ComponentDefinition): void {
    const definition = freezeSnapshot(ComponentDefinitionSchema.parse(value));
    if (
      !definition.symbol.id.startsWith("user-") &&
      !definition.symbol.id.startsWith("component-")
    )
      throw new Error(
        "Insertion candidates need a versioned user or independent local component identity",
      );
    const existing =
      this.projectValue.componentDefinitions?.find(
        (item) => item.symbol.id === definition.symbol.id,
      ) ?? this.availableComponents.get(definition.symbol.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition))
      throw new Error("A placed component version cannot be overwritten");
    this.availableComponents.set(definition.symbol.id, definition);
    this.availableCatalog = new InMemorySymbolResolver(
      [...this.availableComponents.values()].map((item) => item.symbol),
      createSymbolCatalog(builtInSymbols),
    );
    this.resolverValue = this.projectResolver(this.projectValue);
  }

  private projectResolver(project: CircuitProject): ProjectSymbolResolver {
    return createProjectSymbolResolver(project, this.availableCatalog);
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
  /**
   * Whether an Agent has changed this Project in this tab, or opened it from
   * a file the Agent staged. The tab keeps it across reloads, and the
   * Publish dialog notes it beside the Gallery's AI mark.
   */
  get agentEdited(): boolean {
    return this.agentEditedValue;
  }
  /** Records that an Agent worked on this Project (see {@link agentEdited}). */
  noteAgentEdit(): void {
    this.agentEditedValue = true;
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
    const parsed = parseProjectSnapshot(
      withProjectComponentDefinitions(parseProjectSnapshot(nextProject)),
    );
    this.projectSessionCounter += 1;
    this.agentEditedValue = false;
    this.availableComponents.clear();
    this.availableCatalog = createSymbolCatalog(builtInSymbols);
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
    recordCommittedDocumentChanges(project, this.projectValue);
    this.undoStack.push({ project, documentId, structural });
    this.groupEntries?.push({ project, documentId, structural });
    if (this.undoStack.length > DEFAULT_DOCUMENT_HISTORY_LIMIT)
      this.undoStack.shift();
    this.redoStack.length = 0;
    this.rememberRevisions();
  }

  /**
   * Collect the commits that follow into one history step, until
   * {@link endHistoryGroup}. Each commit still applies at once, so a later
   * one plans on the earlier ones. Groups do not nest.
   */
  beginHistoryGroup(): EditorHistoryGroup {
    if (this.groupEntries) throw new Error("A history group is already open");
    this.groupEntries = [];
    return {
      project: this.projectValue,
      activeDocumentId: this.activeDocumentIdValue,
      resolver: this.resolverValue,
      undo: [...this.undoStack],
      redo: [...this.redoStack],
      agentEdited: this.agentEditedValue,
    };
  }

  /**
   * Keep the group's commits as one Undo step, or put the Project, the
   * viewed Cell and both history stacks back exactly as the group found
   * them. Answers whether the Project changed.
   */
  endHistoryGroup(group: EditorHistoryGroup, keep: boolean): boolean {
    const entries = this.groupEntries ?? [];
    this.groupEntries = null;
    if (!keep || this.projectValue === group.project) {
      this.projectValue = group.project;
      this.activeDocumentIdValue = group.activeDocumentId;
      this.resolverValue = group.resolver;
      this.undoStack.splice(0, this.undoStack.length, ...group.undo);
      this.redoStack.splice(0, this.redoStack.length, ...group.redo);
      this.agentEditedValue = group.agentEdited;
      return false;
    }
    this.undoStack.splice(0, this.undoStack.length, ...group.undo, {
      project: group.project,
      documentId: entries[0]?.documentId ?? group.activeDocumentId,
      structural: entries.some((entry) => entry.structural),
    });
    if (this.undoStack.length > DEFAULT_DOCUMENT_HISTORY_LIMIT)
      this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  /** Share immutable document objects after whole-Project validation cloned them. */
  private shareDocuments(
    before: CircuitProject,
    after: CircuitProject,
  ): CircuitProject {
    return shareProjectSnapshot(before, after);
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
        parseProjectSnapshot(nextProject, before),
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
    resultOwnership: ProjectTransactionOptions["resultOwnership"] = "detached",
  ): ProjectTransactionResult {
    const result = executeProjectTransaction(this.projectValue, request, {
      ...EDITOR_PROJECT_TRANSACTION_OPTIONS,
      resultOwnership,
    });
    if (result.ok && result.applied)
      this.commitProjectStructure(
        result.project,
        activeDocumentId,
        historyDocumentId,
      );
    return result;
  }

  transact(
    edits: readonly SchematicEdit[],
    evidence?: EditorContactEvidence,
  ): EditTransactionResult {
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
    return this.dispatchTransaction(
      this.canvasRequest(document, edits),
      evidence,
    );
  }

  private canvasRequest(
    document: SchematicDocument,
    edits: readonly SchematicEdit[],
  ): EditorTransactionRequest {
    return {
      transactionId: `transaction-ui-${++this.transactionCounter}`,
      documentId: document.id,
      expectedRevision: document.revision,
      expectedStructureRevision: this.projectValue.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits,
    };
  }

  /** Internal Wire receipt. Its Document is the committed, immutable snapshot. */
  commitPreparedCanvasTransaction(
    edits: readonly SchematicEdit[],
    prepared: PreparedTransaction,
  ): EditTransactionResult {
    return this.applyTransaction(
      this.canvasRequest(this.document, edits),
      undefined,
      prepared,
    );
  }

  /** Validate the complete candidate before either Project or history changes. */
  dispatchTransaction(
    request: EditorTransactionRequest,
    evidence?: EditorContactEvidence,
  ): EditTransactionResult {
    const result = this.applyTransaction(request, evidence);
    return isFrozenSnapshot(result.document)
      ? { ...result, document: structuredClone(result.document) }
      : result;
  }

  private applyTransaction(
    request: EditorTransactionRequest,
    evidence?: EditorContactEvidence,
    prepared?: PreparedTransaction,
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
      const history =
        envelope.edits.length === 1 ? envelope.edits[0] : undefined;
      // History belongs to this controller. Validate the same envelope/fence
      // before restoring it, without allocating a rejected Document copy first.
      if (
        !prepared &&
        (history?.kind === "undo" || history?.kind === "redo") &&
        envelope.expectedRevision === document.revision &&
        EditTransactionSchema.safeParse(envelope).success
      )
        return this.restoreHistory(request, history.kind);
      const context = {
        symbolResolver: this.resolverValue,
        ...(evidence?.document === document &&
        evidence.resolver === this.resolverValue
          ? { beforeContactEvidence: evidence }
          : {}),
        externalSubcircuitDefinitions:
          this.projectValue.externalSubcircuitDefinitions,
      };
      result = prepared
        ? adoptPreparedCanvasTransaction(
            document,
            envelope.edits,
            prepared,
            context,
          )
        : executeTransaction(document, envelope, context);
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
    if (!result.ok) return result;
    const withExternalCallers =
      this.projectValue.externalSubcircuitDefinitions.length > 0 &&
      result.document.instances.some(
        ({ netlist }) => netlist?.binding?.kind === "external-subcircuit",
      );
    if (!result.applied && (!request.dryRun || !withExternalCallers))
      return result;
    const before = this.projectValue;
    const installed =
      prepared && installPreparedWireCell(before, document, result.document);
    if (
      installed
        ? installed === before
        : sameDocumentJson(result.document, document, true)
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
    try {
      const next =
        installed ||
        this.replaceEditedCell(
          before,
          prepared
            ? result.document
            : freezeSnapshot(
                shareEqualDocumentStructure(document, result.document),
              ),
        );
      const candidate = next.documents.find(
        ({ id }) => id === request.documentId,
      )!;
      if (withExternalCallers) {
        const failure = introducedExternalCallerFailure(
          { ...before, documents: [document] },
          { ...next, documents: [candidate] },
          [
            {
              kind: "transact_document",
              documentId: document.id,
              expectedRevision: document.revision,
              edits: [...request.edits],
            },
          ],
        );
        if (failure)
          return rejectTransaction(
            document,
            "INVALID_RESULT",
            failure.message,
            [],
            undefined,
            failure.objectIds,
          );
      }
      if (!result.applied) return result;
      const resolver =
        !installed && this.needsResolver(before, next)
          ? this.projectResolver(next)
          : this.resolverValue;
      this.projectValue = next;
      this.resolverValue = resolver;
      this.record(before, request.documentId, false);
      return {
        ...result,
        document: candidate,
      };
    } catch (error) {
      return rejectTransaction(
        document,
        "INTERNAL_ERROR",
        `Committed document could not be re-validated into a Project: ${error instanceof Error ? error.message : "unknown failure"}`,
      );
    }
  }

  private replaceEditedCell(
    before: CircuitProject,
    cell: SchematicDocument,
  ): CircuitProject {
    const definitions = new Map(
      (before.componentDefinitions ?? []).map((item) => [item.symbol.id, item]),
    );
    for (const [id, definition] of this.availableComponents)
      if (!definitions.has(id)) definitions.set(id, definition);
    return this.shareDocuments(
      before,
      withProjectComponentDefinitions(
        replaceProjectDocument(
          freezeSnapshot({
            ...before,
            componentDefinitions: [...definitions.values()],
          }),
          cell,
          before,
        ),
      ),
    );
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
      return !previous || documentResolverContextChanged(previous, document);
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
    // Like Ctrl+Z, a step takes back the newest Project change whichever Cell
    // the caller named; the result names the Cell it belonged to (#2292).
    const historyDocumentId = before.documents.some(
      (item) => item.id === entry.documentId,
    )
      ? entry.documentId
      : before.topDocumentId;
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
      const restored = restoreProjectSnapshot(
        entry.project,
        before.structureRevision + (entry.structural ? 1 : 0),
        (saved) => {
          const live = current.get(saved.id);
          // Revisions identify live versions, never the historical snapshot.
          return live && sameDocumentJson(live, saved, true)
            ? live.revision
            : Math.max(
                saved.revision,
                this.documentRevisions.get(saved.id) ?? 0,
              ) + 1;
        },
      );
      const restoredDocument =
        restored.documents.find((item) => item.id === historyDocumentId) ??
        restored.documents.find((item) => item.id === request.documentId) ??
        restored.documents.find((item) => item.id === restored.topDocumentId)!;
      const historyDocument =
        before.documents.find((item) => item.id === restoredDocument.id) ??
        document;
      const changedDocumentIds = [
        ...new Set(
          [...before.documents, ...restored.documents].map((item) => item.id),
        ),
      ].filter(
        (id) =>
          !sameDocumentJson(
            before.documents.find((item) => item.id === id),
            restored.documents.find((item) => item.id === id),
          ),
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
        fromRevision: historyDocument.revision,
        toRevision: restoredDocument.revision,
        editKinds: [kind],
        changedObjectIds,
      };
      if (request.dryRun)
        return {
          ok: true,
          applied: false,
          revision: historyDocument.revision,
          proposedRevision: restoredDocument.revision,
          document: historyDocument,
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
    transact: (
      edits: readonly SchematicEdit[],
      evidence?: EditorContactEvidence,
      prepared?: PreparedTransaction,
    ) => {
      const result = prepared
        ? controller.commitPreparedCanvasTransaction(edits, prepared)
        : controller.transact(edits, evidence);
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
      resultOwnership?: ProjectTransactionOptions["resultOwnership"],
    ) => {
      const result = controller.dispatchProjectTransaction(
        request,
        activeDocumentId,
        activeDocumentId,
        resultOwnership,
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
