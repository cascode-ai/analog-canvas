import { z } from "zod";

import { StableIdSchema } from "./common.js";
import { RouteEndpointSchema } from "./routing.js";
import { SourceSpanSchema } from "./source.js";

/** Canonical Project-scoped object kinds used by diagnostics and navigation. */
export const ObjectLocatorKindSchema = z.enum([
  "document",
  "instance",
  "net",
  "route",
  "junction",
  "terminal",
  "annotation",
  "no-connect",
]);

/** One parent-instance step in an occurrence-aware hierarchy address. */
export const HierarchyFrameSchema = z.strictObject({
  parentDocumentId: StableIdSchema,
  instanceId: StableIdSchema,
  childDocumentId: StableIdSchema,
});

/**
 * Canonical Project-scoped object address (ADR 0015).
 *
 * A direct object in a Document has `hierarchyPath: []`; an object reached
 * through hierarchy carries the explicit parent-instance chain rather than
 * relying on a Document id alone.
 */
export const ObjectLocatorSchema = z.strictObject({
  documentId: StableIdSchema,
  hierarchyPath: z.array(HierarchyFrameSchema).max(32),
  kind: ObjectLocatorKindSchema,
  objectId: StableIdSchema,
  endpoint: RouteEndpointSchema.optional(),
  sourceRef: SourceSpanSchema.optional(),
});
