import {
  parseSharedComponentEntry,
  parseSharedComponentMetadata,
} from "./component-library-entry";
import type { ComponentDefinition } from "@icm/model";
import {
  type SharedDefinitionPayload,
  type ComponentLibraryPage,
  type ComponentLibraryStatus,
  type SharedComponent,
  type RejectedSharedComponent,
} from "./component-library-contract";
import { definitionError } from "./component-definition-error";

export class ComponentLibraryError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
  const payload = await responseJson(
    await fetchLibrary(`/api/components/${encodeURIComponent(id)}`, {
      credentials: "same-origin",
      cache: "no-store",
    }),
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
  const payload = await responseJson(
    await (options.fetch ?? fetch)(
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
    ),
  );
  return parseSharedComponentEntry(payload.entry);
}
export async function manageSharedComponent(
  entry: SharedComponent,
  status: ComponentLibraryStatus,
): Promise<SharedComponent> {
  const payload = await responseJson(
    await fetch(`/api/components/${encodeURIComponent(entry.id)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: entry.revision, status }),
    }),
  );
  return parseSharedComponentEntry(payload.entry);
}
