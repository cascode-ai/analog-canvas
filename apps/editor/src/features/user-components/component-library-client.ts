import type { ComponentDefinition } from "@icm/model";
import {
  ComponentLibrarySummarySchema,
  type ComponentLibrarySummary,
} from "@icm/agent-adapter";
import { SymbolDefinitionSchema } from "@icm/symbols";
import {
  parseSharedComponentPayload,
  type SharedDefinitionPayload,
  type ComponentLibraryPage,
  type ComponentLibraryStatus,
  type SharedComponent,
  type RejectedSharedComponent,
  type ComponentLibrarySummaryPage,
  summarizeSharedComponent,
} from "./component-library-contract";
import { definitionError } from "./component-definition-error";

export class ComponentLibraryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly outcomeUnknown = false,
  ) {
    super(message);
  }
}
async function responseJson(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ComponentLibraryError(
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Component library unavailable (${response.status})`,
      response.status,
    );
  if (!isRecord(payload))
    throw new Error("Component library unavailable: invalid response");
  return payload;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Bound fetch and body reads together; a write timeout has an unknown outcome. */
async function libraryJson(
  url: string,
  init: RequestInit,
  fetchLibrary: typeof fetch,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let rejectWait!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectWait = reject;
  });
  const abort = () => {
    controller.abort();
    rejectWait(signal?.reason);
  };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectWait(
      new ComponentLibraryError(
        init.method === "PUT" || init.method === "PATCH"
          ? "Publication outcome is unknown. Retry the same operation before editing again."
          : "Component library timed out. Try again.",
        408,
        init.method === "PUT" || init.method === "PATCH",
      ),
    );
  }, 10_000);
  try {
    return await Promise.race([
      fetchLibrary(url, {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
        signal: controller.signal,
      }).then(responseJson),
      interrupted,
    ]);
  } catch (error) {
    if (
      !(error instanceof ComponentLibraryError) &&
      (init.method === "PUT" || init.method === "PATCH")
    )
      throw new ComponentLibraryError(
        "Publication outcome is unknown. Retry the same operation before editing again.",
        503,
        true,
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function loadSharedComponentSummaries(
  query: string,
  cursor: string | null,
  deleted = false,
  signal?: AbortSignal,
  fetchLibrary: typeof fetch = fetch,
): Promise<ComponentLibrarySummaryPage> {
  const params = new URLSearchParams({
    q: query,
    limit: "20",
    view: "summary",
  });
  if (cursor) params.set("cursor", cursor);
  if (deleted) params.set("status", "deleted");
  const payload = await libraryJson(
    `/api/components?${params}`,
    {},
    fetchLibrary,
    signal,
  );
  if (
    !Array.isArray(payload.entries) ||
    (payload.nextCursor !== null && typeof payload.nextCursor !== "string")
  )
    throw Error("Component library unavailable: invalid page");
  return {
    entries: payload.entries.map((value): ComponentLibrarySummary => {
      // An older service can still return its complete record during staged deployment.
      const metadata = parseSharedComponentMetadata(value);
      if (isRecord(value) && "definition" in value)
        return summarizeSharedComponent({
          ...metadata,
          definition: value.definition,
          circuit: value.circuit,
        } as SharedComponent);
      return ComponentLibrarySummarySchema.parse(value);
    }),
    nextCursor: payload.nextCursor,
  };
}

export async function readSharedComponentPreview(
  entry: ComponentLibrarySummary,
  signal?: AbortSignal,
) {
  const payload = await libraryJson(
    `/api/components/${encodeURIComponent(entry.id)}?view=preview&revision=${entry.revision}${entry.status === "deleted" ? "&status=deleted" : ""}`,
    {},
    fetch,
    signal,
  );
  if (payload.entry) {
    const full = parseSharedComponentEntry(payload.entry);
    if (full.id !== entry.id || full.revision !== entry.revision)
      throw new ComponentLibraryError(
        "This component changed. Refresh before selecting it.",
        409,
      );
    return full.definition.symbol;
  }
  if (payload.id !== entry.id || payload.revision !== entry.revision)
    throw new ComponentLibraryError(
      "This component changed. Refresh before selecting it.",
      409,
    );
  return SymbolDefinitionSchema.parse(payload.symbol);
}

export async function readSharedComponentRecord(
  entry: Pick<ComponentLibrarySummary, "id" | "revision" | "status">,
  signal?: AbortSignal,
) {
  const payload = await libraryJson(
    `/api/components/${encodeURIComponent(entry.id)}${entry.status === "deleted" ? "?status=deleted" : ""}`,
    {},
    fetch,
    signal,
  );
  const metadata = parseSharedComponentMetadata(payload.entry);
  if (metadata.id !== entry.id || metadata.revision !== entry.revision)
    throw new ComponentLibraryError(
      "This component changed. Refresh before selecting it.",
      409,
    );
  return payload.entry as Record<string, unknown>;
}
/** Lightweight revision/permission check before reusing a cached public detail. */
export async function checkSharedComponentRevision(
  entry: Pick<ComponentLibrarySummary, "id" | "revision" | "status">,
  signal?: AbortSignal,
) {
  await libraryJson(
    `/api/components/${encodeURIComponent(entry.id)}?view=identity&revision=${entry.revision}${entry.status === "deleted" ? "&status=deleted" : ""}`,
    {},
    fetch,
    signal,
  ).then((payload) => {
    const identity = payload.entry
      ? parseSharedComponentMetadata(payload.entry)
      : payload;
    if (
      identity.id !== entry.id ||
      identity.revision !== entry.revision ||
      identity.status !== entry.status
    )
      throw new ComponentLibraryError(
        "This component changed. Refresh before selecting it.",
        409,
      );
  });
}
function parseSharedComponentMetadata(
  value: unknown,
): Omit<SharedComponent, "definition" | "circuit"> {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.authorId !== "string" ||
    typeof value.author !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    (value.status !== "shared" &&
      value.status !== "official" &&
      value.status !== "deleted")
  )
    throw new Error("Component library unavailable: invalid entry");
  return {
    id: value.id,
    revision: value.revision,
    authorId: value.authorId,
    author: value.author,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    status: value.status,
  };
}
export function parseSharedComponentEntry(value: unknown): SharedComponent {
  const metadata = parseSharedComponentMetadata(value);
  const record = value as Record<string, unknown>;
  return {
    ...metadata,
    ...parseSharedComponentPayload({
      definition: record.definition,
      ...(record.circuit === undefined ? {} : { circuit: record.circuit }),
    }),
  };
}
export async function loadSharedComponents(
  query: string,
  cursor: string | null,
  deleted = false,
  signal?: AbortSignal,
  fetchLibrary: typeof fetch = fetch,
): Promise<ComponentLibraryPage> {
  const params = new URLSearchParams({ q: query, limit: "20" });
  if (cursor) params.set("cursor", cursor);
  if (deleted) params.set("status", "deleted");
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, 10_000);
  try {
    const payload = await responseJson(
      await fetchLibrary(`/api/components?${params}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      }),
    );
    if (
      !Array.isArray(payload.entries) ||
      (payload.nextCursor !== null && typeof payload.nextCursor !== "string")
    )
      throw new Error("Component library unavailable: invalid page");
    const entries: SharedComponent[] = [];
    const rejected: RejectedSharedComponent[] = [];
    for (const value of payload.entries) {
      const metadata = parseSharedComponentMetadata(value);
      try {
        entries.push(parseSharedComponentEntry(value));
      } catch (error) {
        const record = value as Record<string, unknown>;
        const symbol = isRecord(record.definition) && record.definition.symbol;
        rejected.push({
          id: metadata.id,
          author: metadata.author,
          name:
            isRecord(symbol) && typeof symbol.name === "string"
              ? symbol.name
              : metadata.id,
          message: definitionError(error),
          record,
        });
      }
    }
    return {
      entries,
      nextCursor: payload.nextCursor,
      ...(rejected.length ? { rejected } : {}),
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (timedOut)
      throw new ComponentLibraryError(
        "Component library timed out. Try again.",
        408,
      );
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
export async function readSharedComponent(
  id: string,
  fetchLibrary: typeof fetch = fetch,
): Promise<SharedComponent> {
  const payload = await libraryJson(
    `/api/components/${encodeURIComponent(id)}`,
    {},
    fetchLibrary,
  );
  return parseSharedComponentEntry(payload.entry);
}
export async function saveSharedComponent(
  id: string,
  revision: number,
  definition: ComponentDefinition,
  circuit?: SharedDefinitionPayload["circuit"],
  options: { idempotencyKey?: string; fetch?: typeof fetch } = {},
): Promise<SharedComponent> {
  const payload = await libraryJson(
    `/api/components/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        revision,
        definition,
        ...(options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
        ...(circuit ? { circuit } : {}),
      }),
    },
    options.fetch ?? fetch,
  );
  return parseSharedComponentEntry(payload.entry);
}
export async function manageSharedComponent(
  entry: SharedComponent,
  status: ComponentLibraryStatus,
): Promise<SharedComponent> {
  const payload = await libraryJson(
    `/api/components/${encodeURIComponent(entry.id)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: entry.revision, status }),
    },
    fetch,
  );
  return parseSharedComponentEntry(payload.entry);
}
