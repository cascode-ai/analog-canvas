import { SchematicDocumentSchema } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import { shareEqualDocumentStructure } from "./document-structural-sharing.js";
import {
  EditTransactionSchema,
  executeTransaction,
  rejectTransaction,
} from "./transaction.js";
import type {
  AppliedTransaction,
  EditDiff,
  EditExecutionContext,
  EditTransaction,
  EditTransactionResult,
} from "./transaction.js";

/**
 * The editor stores immutable document snapshots for undo/redo. Keeping every
 * revision indefinitely turns a long editing session into an unbounded heap
 * retention path, so retain a deliberately modest default window. Callers
 * that need a different offline-session budget can opt in explicitly.
 */
export const DEFAULT_DOCUMENT_HISTORY_LIMIT = 64;

function collectObjects(document: SchematicDocument): Map<string, unknown> {
  return new Map(
    [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.noConnects,
      ...document.annotations,
      ...document.layoutGroups,
      ...document.constraints,
      ...(document.drafting?.objects ?? []),
    ].map((object) => [object.id, object]),
  );
}

function changedObjectIds(
  left: SchematicDocument,
  right: SchematicDocument,
): string[] {
  const leftObjects = collectObjects(left);
  const rightObjects = collectObjects(right);
  const ids = new Set([...leftObjects.keys(), ...rightObjects.keys()]);
  return [...ids]
    .filter(
      (id) =>
        JSON.stringify(leftObjects.get(id)) !==
        JSON.stringify(rightObjects.get(id)),
    )
    .sort();
}

export class DocumentHistory {
  #document: SchematicDocument;
  readonly #undoStack: SchematicDocument[] = [];
  readonly #redoStack: SchematicDocument[] = [];
  readonly #context: EditExecutionContext;
  readonly #historyLimit: number;

  constructor(
    document: SchematicDocument,
    context: EditExecutionContext = {},
    historyLimit = DEFAULT_DOCUMENT_HISTORY_LIMIT,
  ) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
      throw new Error("Document history limit must be a positive integer");
    }
    this.#document = SchematicDocumentSchema.parse(document);
    this.#context = context;
    this.#historyLimit = historyLimit;
  }

  get document(): SchematicDocument {
    return this.#document;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  reset(document: SchematicDocument): void {
    this.#document = SchematicDocumentSchema.parse(document);
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }

  transact(input: EditTransaction | unknown): EditTransactionResult {
    const parsed = EditTransactionSchema.safeParse(input);
    if (!parsed.success) {
      return executeTransaction(this.#document, input, this.#context);
    }
    const transaction = parsed.data;
    const historyEdits = transaction.edits.filter(
      (edit) => edit.kind === "undo" || edit.kind === "redo",
    );
    if (historyEdits.length === 0) {
      const before = this.#document;
      const result = executeTransaction(before, transaction, this.#context);
      if (result.ok && result.applied) {
        const document = shareEqualDocumentStructure(before, result.document);
        this.#undoStack.push(before);
        if (this.#undoStack.length > this.#historyLimit) {
          this.#undoStack.shift();
        }
        this.#redoStack.length = 0;
        this.#document = document;
        return { ...result, document };
      }
      return result;
    }

    const envelopeResult = executeTransaction(
      this.#document,
      transaction,
      this.#context,
    );
    if (
      !envelopeResult.ok &&
      envelopeResult.error.code !== "HISTORY_CONTEXT_REQUIRED"
    ) {
      return envelopeResult;
    }
    if (historyEdits.length !== 1 || transaction.edits.length !== 1) {
      return rejectTransaction(
        this.#document,
        "HISTORY_CONTEXT_REQUIRED",
        "Undo or redo must be the only edit in a transaction",
      );
    }

    const historyEdit = historyEdits[0]!;
    const sourceStack =
      historyEdit.kind === "undo" ? this.#undoStack : this.#redoStack;
    const destinationStack =
      historyEdit.kind === "undo" ? this.#redoStack : this.#undoStack;
    const target = sourceStack.at(-1);
    if (!target) {
      return rejectTransaction(
        this.#document,
        "HISTORY_EMPTY",
        `No ${historyEdit.kind} state is available`,
      );
    }

    const proposedRevision = this.#document.revision + 1;
    const parsedRestored = SchematicDocumentSchema.parse({
      ...structuredClone(target),
      revision: proposedRevision,
    });
    const restored = shareEqualDocumentStructure(target, parsedRestored);
    const diff: EditDiff = {
      documentId: this.#document.id,
      fromRevision: this.#document.revision,
      toRevision: proposedRevision,
      editKinds: [historyEdit.kind],
      changedObjectIds: changedObjectIds(this.#document, restored),
    };

    if (transaction.dryRun === true) {
      const result: AppliedTransaction = {
        ok: true,
        applied: false,
        revision: this.#document.revision,
        proposedRevision,
        document: this.#document,
        diff,
        diagnostics: [],
      };
      return result;
    }

    sourceStack.pop();
    destinationStack.push(this.#document);
    if (destinationStack.length > this.#historyLimit) {
      destinationStack.shift();
    }
    this.#document = restored;
    return {
      ok: true,
      applied: true,
      revision: proposedRevision,
      proposedRevision,
      document: restored,
      diff,
      diagnostics: [],
    };
  }
}
