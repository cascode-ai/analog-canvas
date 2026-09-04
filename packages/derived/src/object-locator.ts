import type { ObjectLocator, ObjectLocatorKind } from "@icm/model";

export {
  HierarchyFrameSchema,
  ObjectLocatorKindSchema,
  ObjectLocatorSchema,
} from "@icm/model";
export type {
  HierarchyFrame,
  ObjectLocator,
  ObjectLocatorKind,
} from "@icm/model";

/** Construct an unambiguous locator for an object directly in a Document. */
export function directObjectLocator<K extends ObjectLocatorKind>(
  documentId: string,
  kind: K,
  objectId: string,
): ObjectLocator & { kind: K } {
  return { documentId, hierarchyPath: [], kind, objectId };
}
