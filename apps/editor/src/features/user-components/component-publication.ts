import {
  COMPONENT_LIBRARY_ID,
  type SharedComponent,
} from "./component-library-contract";
import type { ComponentDefinition } from "@icm/model";

/** A draft's destination is explicit; a later login must not turn a copy into an update. */
export interface ComponentPublication {
  kind: "new" | "update";
  componentId: string;
  expectedLibraryRevision?: number;
}

/** Origin is only a hint; the freshly read record supplies ownership. Explicit new wins. */
export function publicationFromOrigin(
  origin: NonNullable<ComponentDefinition["libraryOrigin"]>,
  entry: SharedComponent,
  account: { id: string; isAdmin: boolean },
  explicit?: ComponentPublication,
): ComponentPublication {
  if (explicit) return explicit;
  if (entry.id !== origin.componentId)
    throw Error("Publication origin does not match the selected record.");
  return entry.authorId === account.id || account.isAdmin
    ? {
        kind: "update",
        componentId: entry.id,
        expectedLibraryRevision: origin.revision,
      }
    : { kind: "new", componentId: crypto.randomUUID() };
}

export function readComponentPublication(
  value: unknown,
  entry?: SharedComponent,
): ComponentPublication | undefined {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    !("componentId" in value) ||
    (value.kind !== "new" && value.kind !== "update") ||
    typeof value.componentId !== "string" ||
    !COMPONENT_LIBRARY_ID.test(value.componentId) ||
    (value.kind === "update"
      ? value.componentId !== entry?.id
      : value.componentId === entry?.id)
  )
    throw Error("Invalid library publication destination.");
  const revision =
    "expectedLibraryRevision" in value
      ? value.expectedLibraryRevision
      : entry?.revision;
  if (
    value.kind === "update" &&
    (!Number.isInteger(revision) || Number(revision) < 1)
  )
    throw Error("Invalid publication baseline revision.");
  return {
    kind: value.kind,
    componentId: value.componentId,
    ...(value.kind === "update"
      ? { expectedLibraryRevision: Number(revision) }
      : {}),
  };
}
