import {
  freezeSnapshot,
  isFrozenSnapshot,
  shareEqualDocumentStructure,
  type SchematicDocument,
} from "@icm/model";
import { EditTransactionSchema, type EditTransaction } from "./edit-schema.js";
import { executeTransaction } from "./transaction.js";
import type {
  AppliedTransaction,
  EditExecutionContext,
  EditTransactionResult,
} from "./transaction-result.js";

/** An engine-owned calculation, never a persisted or Agent protocol value. */
export interface PreparedTransaction {
  readonly documentId: string;
  readonly revision: number;
}

interface Preparation {
  source: string;
  edits: string;
  symbols: readonly (readonly [string, string | undefined])[];
  context: string;
  result: AppliedTransaction;
}

const preparations = new WeakMap<PreparedTransaction, Preparation>();
const latestPreparation = new WeakMap<SchematicDocument, PreparedTransaction>();

function symbolDependencies(
  transaction: EditTransaction,
  ...documents: SchematicDocument[]
) {
  const dependencies = new Map<string, readonly [string, string | undefined]>();
  for (const document of documents) {
    for (const instance of document.instances) {
      const key = [instance.symbolId, instance.symbolVariantId] as const;
      dependencies.set(JSON.stringify(key), key);
    }
    for (const object of document.drafting?.objects ?? []) {
      if (object.kind !== "floating-symbol") continue;
      const key = [object.symbolId, undefined] as const;
      dependencies.set(JSON.stringify(key), key);
    }
  }
  // A symbol can be consulted and removed again inside one atomic batch.
  for (const edit of transaction.edits) {
    let key: readonly [string, string | undefined] | undefined;
    if (edit.kind === "add_instance")
      key = [edit.instance.symbolId, edit.instance.symbolVariantId];
    else if (edit.kind === "set_instance_symbol")
      key = [edit.symbolId, edit.symbolVariantId ?? undefined];
    else if (
      edit.kind === "upsert_drafting_object" &&
      edit.object.kind === "floating-symbol"
    )
      key = [edit.object.symbolId, undefined];
    if (key) dependencies.set(JSON.stringify(key), key);
  }
  return [...dependencies.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right), "en"),
  );
}

function executionContextKey(
  context: EditExecutionContext,
  symbols: Preparation["symbols"],
): string {
  return JSON.stringify({
    symbols: symbols.map(
      ([id, variant]) => context.symbolResolver?.resolve(id, variant) ?? null,
    ),
    externalDefinitions: context.externalSubcircuitDefinitions ?? [],
    movedPins: [...(context.pinsMovedInstanceIds ?? [])].sort(),
  });
}

/** Prepare through the same atomic executor used by GUI, Agent and Project edits. */
export function prepareTransaction(
  document: SchematicDocument,
  input: EditTransaction | unknown,
  context: EditExecutionContext = {},
): {
  result: EditTransactionResult;
  prepared?: PreparedTransaction;
} {
  const result = executeTransaction(document, input, context);
  if (!result.ok) return { result };
  const transaction = EditTransactionSchema.parse(input);
  const symbols = symbolDependencies(transaction, document, result.document);
  const prepared = Object.freeze({
    documentId: document.id,
    revision: document.revision,
  });
  // Exposed previews cannot alter the validated result later adopted by a
  // commit. Keep the mutable Map private, and copy it for each consumer.
  const { coalescedEndpoints, ...content } = result;
  const detached = structuredClone(content);
  if (isFrozenSnapshot(document))
    detached.document = shareEqualDocumentStructure(
      document,
      detached.document,
    );
  const owned = freezeSnapshot(detached);
  preparations.set(prepared, {
    source: JSON.stringify(document),
    edits: JSON.stringify(transaction.edits),
    symbols,
    context: executionContextKey(context, symbols),
    result: {
      ...owned,
      ...(coalescedEndpoints
        ? { coalescedEndpoints: new Map(coalescedEndpoints) }
        : {}),
    },
  });
  latestPreparation.set(document, prepared);
  return { result, prepared };
}

/** @internal Only registered, matching calculations can bypass repeated work. */
export function reusePreparedTransaction(
  document: SchematicDocument,
  transaction: EditTransaction,
  context: EditExecutionContext,
): AppliedTransaction | undefined {
  let source: string | undefined;
  let edits: string | undefined;
  const latest = latestPreparation.get(document);
  const candidates = context.preparedTransactions ?? (latest ? [latest] : []);
  for (const token of candidates) {
    const preparation = preparations.get(token);
    if (
      !preparation ||
      token.documentId !== document.id ||
      token.revision !== document.revision
    )
      continue;
    if (
      preparation.edits !== (edits ??= JSON.stringify(transaction.edits)) ||
      preparation.source !== (source ??= JSON.stringify(document)) ||
      preparation.context !== executionContextKey(context, preparation.symbols)
    )
      continue;
    const result = preparation.result;
    return {
      ...structuredClone(result),
      applied: transaction.dryRun !== true,
      revision:
        transaction.dryRun === true
          ? document.revision
          : result.proposedRevision,
      ...(result.coalescedEndpoints
        ? { coalescedEndpoints: new Map(result.coalescedEndpoints) }
        : {}),
    };
  }
  return undefined;
}
