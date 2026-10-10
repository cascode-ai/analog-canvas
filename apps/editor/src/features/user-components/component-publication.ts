import {
  COMPONENT_LIBRARY_ID,
  type SharedComponent,
} from "./component-library-contract";

/** A draft's destination is explicit; a later login must not turn a copy into an update. */
export interface ComponentPublication {
  kind: "new" | "update";
  componentId: string;
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
  return { kind: value.kind, componentId: value.componentId };
}
