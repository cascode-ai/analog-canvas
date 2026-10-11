import {
  parseSharedComponentPayload,
  type SharedDefinitionPayload,
} from "./component-library-contract";
import {
  publishSharedComponent,
  readSharedComponent,
  ComponentLibraryError,
  type ComponentPublicationReceipt,
  publicationAccount,
} from "./component-library-client";
export { publicationAccount } from "./component-library-client";
import { componentPublicationContent } from "./component-publication-content";

import {
  publicationOperations,
  publicationRequest,
  rememberPublication,
  type PublicationOperation,
} from "./component-publication-journal";

async function recordPublicationReceipt(
  operation: PublicationOperation,
  receipt: ComponentPublicationReceipt,
): Promise<void> {
  operation.pending = false;
  operation.receipt = receipt;
  // Cloud success stays truthful when its local receipt cannot be saved.
  try {
    await rememberPublication(operation);
  } catch {
    /* The persisted original snapshot can recover the server result. */
  }
}

/** Private journal is independent of Project undo; retries send original bytes. */
export async function executeComponentPublication(input: {
  componentId: string;
  revision: number;
  payload: SharedDefinitionPayload;
  idempotencyKey?: string;
  fetch?: typeof fetch;
}): Promise<ComponentPublicationReceipt & { recovered: boolean }> {
  const fetchLike = input.fetch ?? fetch;
  const user = await publicationAccount(fetchLike);
  if (!user) throw new ComponentLibraryError("Sign in to publish.", 401);
  const known = await publicationOperations(input.componentId);
  const keyed = input.idempotencyKey
    ? await publicationRequest(user.id, input.idempotencyKey)
    : undefined;
  const previous =
    keyed ??
    known.find((operation) =>
      input.idempotencyKey
        ? operation.idempotencyKey === input.idempotencyKey
        : operation.componentId === input.componentId && operation.pending,
    );
  if (
    previous &&
    (previous.accountId !== user.id ||
      previous.componentId !== input.componentId ||
      previous.revision !== input.revision)
  )
    throw Error(
      "Resolve the original publication with its original account and destination before starting another write.",
    );
  const operation: PublicationOperation = previous ?? {
    version: 1,
    accountId: user.id,
    componentId: input.componentId,
    revision: input.revision,
    idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
    payload: structuredClone(parseSharedComponentPayload(input.payload)),
    pending: true,
  };
  await rememberPublication(operation);
  try {
    const receipt = await publishSharedComponent(
      operation.componentId,
      operation.revision,
      operation.payload.definition,
      operation.payload.circuit,
      { fetch: fetchLike, idempotencyKey: operation.idempotencyKey },
    );
    await recordPublicationReceipt(operation, receipt);
    return { ...receipt, recovered: !!previous };
  } catch (error) {
    if (
      previous &&
      (previous.pending || previous.receipt) &&
      error instanceof ComponentLibraryError &&
      error.status === 409 &&
      error.code !== "COMPONENT_ALREADY_PUBLISHED"
    ) {
      const current = await readSharedComponent(
        operation.componentId,
        fetchLike,
      );
      if (
        current.status !== "deleted" &&
        (user.isAdmin ||
          (current.authorId === user.id && current.status === "shared")) &&
        (operation.receipt
          ? current.revision === operation.receipt.entry.revision
          : current.revision === operation.revision + 1 ||
            (operation.revision > 0 &&
              current.revision === operation.revision)) &&
        componentPublicationContent(current) ===
          componentPublicationContent(operation.payload)
      ) {
        const receipt = operation.receipt ?? {
          entry: current,
          outcome:
            operation.revision === 0
              ? ("created" as const)
              : current.revision === operation.revision
                ? ("unchanged" as const)
                : ("updated" as const),
        };
        await recordPublicationReceipt(operation, receipt);
        return { ...receipt, recovered: true };
      }
    }
    if (error instanceof ComponentLibraryError && !error.outcomeUnknown) {
      operation.pending = false;
      await rememberPublication(operation);
    }
    throw error;
  }
}

export async function componentPublicationSnapshot(
  componentId: string,
  key: string,
): Promise<SharedDefinitionPayload | undefined> {
  const operation = (await publicationOperations(componentId)).find(
    (operation) =>
      operation.idempotencyKey === key && operation.componentId === componentId,
  );
  return operation ? structuredClone(operation.payload) : undefined;
}
