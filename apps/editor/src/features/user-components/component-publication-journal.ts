import { z } from "zod";
import { parseSharedComponentPayload } from "./component-library-contract";
import { parseSharedComponentEntry } from "./component-library-entry";

const OperationSchema = z.object({
  version: z.literal(1),
  accountId: z.string().min(1),
  componentId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/u),
  revision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1),
  payload: z
    .object({ definition: z.unknown(), circuit: z.unknown().optional() })
    .transform(parseSharedComponentPayload),
  pending: z.boolean(),
  receipt: z
    .object({
      entry: z.unknown().transform(parseSharedComponentEntry),
      outcome: z.enum(["created", "updated", "unchanged"]),
    })
    .optional(),
});
export type PublicationOperation = z.infer<typeof OperationSchema>;

const memory = new Map<string, PublicationOperation>();
const DATABASE = "analog-canvas-component-publication";
const STORE = "operations";
const key = (operation: PublicationOperation) =>
  JSON.stringify([operation.accountId, operation.idempotencyKey]);

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? Error("Publication storage aborted"));
  });
}
async function database() {
  const factory = globalThis.indexedDB;
  if (!factory) {
    // Node contract tests use memory; a browser must persist before writing.
    if (typeof window === "undefined") return undefined;
    throw Error(
      "Publication recovery storage is unavailable. No write was sent.",
    );
  }
  const request = factory.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result
      .createObjectStore(STORE)
      .createIndex("componentId", "componentId");
  };
  return new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        Error("Close other component publication sessions before retrying."),
      );
  });
}

/** Private fixed-request bodies survive Project Undo and browser reloads. */
export async function publicationOperations(
  componentId: string,
): Promise<PublicationOperation[]> {
  const db = await database();
  if (!db)
    return [...memory.values()].filter(
      (item) => item.componentId === componentId,
    );
  try {
    const transaction = db.transaction(STORE, "readonly");
    const done = completed(transaction);
    const records: unknown[] = await result(
      transaction.objectStore(STORE).index("componentId").getAll(componentId),
    );
    await done;
    return records.map((record) => OperationSchema.parse(record));
  } finally {
    db.close();
  }
}
export async function rememberPublication(
  operation: PublicationOperation,
): Promise<void> {
  const parsed = OperationSchema.parse(operation);
  const db = await database();
  if (!db) {
    memory.set(key(parsed), structuredClone(parsed));
    return;
  }
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const done = completed(transaction);
    transaction.objectStore(STORE).put(parsed, key(parsed));
    await done;
  } finally {
    db.close();
  }
}

/** A key cannot be reused for another destination in the same account. */
export async function publicationRequest(
  accountId: string,
  idempotencyKey: string,
): Promise<PublicationOperation | undefined> {
  const requestKey = JSON.stringify([accountId, idempotencyKey]);
  const db = await database();
  if (!db) return memory.get(requestKey);
  try {
    const transaction = db.transaction(STORE, "readonly");
    const done = completed(transaction);
    const record: unknown = await result(
      transaction.objectStore(STORE).get(requestKey),
    );
    await done;
    return record === undefined ? undefined : OperationSchema.parse(record);
  } finally {
    db.close();
  }
}
