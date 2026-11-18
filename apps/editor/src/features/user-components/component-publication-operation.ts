import {
  parseSharedComponentPayload,
  type ComponentVisibility,
  type SharedDefinitionPayload,
} from "./component-library-contract";
import {
  publishSharedComponent,
  readSameNameComponents,
  readSharedComponent,
  ComponentLibraryError,
  type ComponentPublicationReceipt,
  type SameNameComponent,
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

/**
 * The author's own record a new save of this name becomes a version of: the
 * most recently changed one. Exact content is left to the duplicate refusal,
 * which names the existing record, as before.
 */
export async function sameNameTarget(
  payload: SharedDefinitionPayload,
  options: { publicOnly?: boolean; fetch?: typeof fetch } = {},
): Promise<SameNameComponent | undefined> {
  const fetchLike = options.fetch ?? fetch;
  const same = (
    await readSameNameComponents(
      payload.definition.symbol.name,
      undefined,
      fetchLike,
    )
  ).find((item) => !options.publicOnly || item.status === "shared");
  if (!same) return undefined;
  const current = await readSharedComponent(same.id, fetchLike);
  return componentPublicationContent(current) ===
    componentPublicationContent(payload)
    ? undefined
    : { ...same, revision: current.revision };
}

/** Private journal is independent of Project undo; retries send original bytes. */
export async function executeComponentPublication(input: {
  componentId: string;
  revision: number;
  payload: SharedDefinitionPayload;
  idempotencyKey?: string;
  fetch?: typeof fetch;
  /** Omitted: a new record is public and an existing one keeps its status. */
  visibility?: ComponentVisibility;
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
    ...(input.visibility ? { visibility: input.visibility } : {}),
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
      {
        fetch: fetchLike,
        idempotencyKey: operation.idempotencyKey,
        ...(operation.visibility ? { visibility: operation.visibility } : {}),
      },
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
          (current.authorId === user.id &&
            (current.status === "shared" || current.status === "private"))) &&
        (operation.visibility !== "public" || current.status !== "private") &&
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
