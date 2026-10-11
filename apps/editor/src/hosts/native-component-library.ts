import type { ComponentDefinition } from "@icm/model";
import { parseSharedComponentEntry } from "../features/user-components/component-library-entry";
import { ComponentLibraryError } from "../features/user-components/component-library-error";
import type {
  SharedComponent,
  SharedDefinitionPayload,
} from "../features/user-components/component-library-contract";

async function request(action: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(`/desktop/components/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const value: unknown = await response.json();
  if (!value || typeof value !== "object")
    throw Error("Invalid local component response");
  const payload = value as Record<string, unknown>;
  if (!response.ok)
    throw new ComponentLibraryError(
      typeof payload.error === "string"
        ? payload.error
        : "Local components unavailable",
      response.status,
    );
  return payload;
}
export async function listNativeComponents(
  signal?: AbortSignal,
): Promise<SharedComponent[]> {
  const value = await request("list", {}, signal);
  if (!Array.isArray(value.entries))
    throw Error("Invalid local component list");
  return value.entries
    .map(parseSharedComponentEntry)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function readNativeComponent(
  id: string,
): Promise<SharedComponent> {
  return parseSharedComponentEntry((await request("read", { id })).entry);
}
export async function saveNativeComponent(
  id: string,
  revision: number,
  definition: ComponentDefinition,
  circuit?: SharedDefinitionPayload["circuit"],
  options: { idempotencyKey?: string } = {},
): Promise<SharedComponent> {
  return parseSharedComponentEntry(
    (
      await request("save", {
        id,
        revision,
        definition,
        ...(circuit ? { circuit } : {}),
        ...options,
      })
    ).entry,
  );
}
export async function checkNativeComponentRevision(
  entry: Pick<SharedComponent, "id" | "revision">,
) {
  await request("check", entry);
}
export async function manageNativeComponent(
  entry: SharedComponent,
  status: "deleted" | "shared",
) {
  return parseSharedComponentEntry(
    (
      await request(status === "deleted" ? "delete" : "restore", {
        id: entry.id,
        revision: entry.revision,
      })
    ).entry,
  );
}
