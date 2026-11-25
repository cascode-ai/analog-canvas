import {
  freezeSnapshot,
  isFrozenSnapshot,
  shareEqualDocumentStructure,
  type SchematicDocument,
} from "@icm/model";
import {
  EditTransactionSchema,
  type EditTransaction,
  type SchematicEdit,
} from "./edit-schema.js";
import { rejectTransaction } from "./transaction-result.js";
import { executeTransaction } from "./transaction.js";
import type {
  AppliedTransaction,
  EditExecutionContext,
  RejectedTransaction,
} from "./transaction-result.js";

/** An engine-owned calculation, never a persisted or Agent protocol value. */
export interface PreparedTransaction {
  readonly documentId: string;
  readonly revision: number;
}

interface Preparation {
  source: string | SchematicDocument;
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
  routing?: {
    readMembership?: Parameters<typeof executeTransaction>[3];
    changedNetIds: Set<string>;
  },
):
  | { result: RejectedTransaction; prepared?: undefined }
  | {
      result: AppliedTransaction;
      membershipUnchanged: boolean;
      prepared: PreparedTransaction;
    } {
  const result = executeTransaction(
    document,
    input,
    context,
    routing?.readMembership,
  );
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
      routing?.changedNetIds,
    );
  const owned = freezeSnapshot(detached);
  preparations.set(prepared, {
    source: isFrozenSnapshot(document) ? document : JSON.stringify(document),
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
  return {
    result,
    prepared,
    membershipUnchanged:
      detached.document.nets === document.nets &&
      detached.document.junctions === document.junctions,
  };
}

function matchesPreparedContext(
  preparation: Preparation,
  context: EditExecutionContext,
) {
  return (
    preparation.context === executionContextKey(context, preparation.symbols)
  );
}

/** Adopt the privately owned result for one synchronous Canvas commit. */
export function adoptPreparedCanvasTransaction(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
  token: PreparedTransaction,
  context: EditExecutionContext,
): AppliedTransaction | RejectedTransaction {
  if (document.id !== token.documentId || document.revision !== token.revision)
    return rejectTransaction(
      document,
      "STALE_REVISION",
      "The Cell changed before the wiring edit was committed",
    );
  const preparation = preparations.get(token);
  const parsed = EditTransactionSchema.shape.edits.safeParse(edits);
  if (
    !preparation ||
    preparation.source !== document ||
    !parsed.success ||
    preparation.edits !== JSON.stringify(parsed.data) ||
    !matchesPreparedContext(preparation, context)
  )
    return rejectTransaction(
      document,
      "EDIT_PRECONDITION",
      "The wiring edit or its electrical context changed before commit",
    );

  const result = preparation.result;
  return {
    ...result,
    revision: result.proposedRevision,
    applied: result.proposedRevision !== document.revision,
    ...(result.coalescedEndpoints
      ? { coalescedEndpoints: new Map(result.coalescedEndpoints) }
      : {}),
  };
}

export function reusePreparedTransaction(
  document: SchematicDocument,
  transaction: EditTransaction,
  context: EditExecutionContext,
): AppliedTransaction | undefined {
  let sourceContent: string | undefined;
  function matchesSource(source: Preparation["source"]): boolean {
    // Only an engine-owned immutable source is stored by identity. Equivalent
    // independently loaded documents and mutable inputs retain content checks.
    if (source === document) return true;
    const expected =
      typeof source === "string" ? source : JSON.stringify(source);
    return expected === (sourceContent ??= JSON.stringify(document));
  }
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
      !matchesSource(preparation.source) ||
      !matchesPreparedContext(preparation, context)
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
