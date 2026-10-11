import {
  parseSharedComponentPayload,
  type SharedComponent,
} from "./component-library-contract";
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseSharedComponentMetadata(
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
