import type { ComponentDefinition } from "@icm/model";
import {
  parseSharedComponentPayload,
  type SharedDefinitionPayload,
  type ComponentLibraryPage,
  type ComponentLibraryStatus,
  type SharedComponent,
} from "./component-library-contract";

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
export function parseSharedComponentEntry(value: unknown): SharedComponent {
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
    ...parseSharedComponentPayload({
      definition: value.definition,
      ...(value.circuit === undefined ? {} : { circuit: value.circuit }),
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
  const payload = await responseJson(
    await fetchLibrary(`/api/components?${params}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    }),
  );
  if (
    !Array.isArray(payload.entries) ||
    (payload.nextCursor !== null && typeof payload.nextCursor !== "string")
  )
    throw new Error("Component library unavailable: invalid page");
  return {
    entries: payload.entries.map(parseSharedComponentEntry),
    nextCursor: payload.nextCursor,
  };
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
