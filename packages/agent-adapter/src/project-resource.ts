import { z } from "zod";

import { AGENT_API_VERSION } from "./schema.js";

const StableIdSchema = z.string().min(1).max(256);
const ProjectRequestBaseSchema = z.strictObject({
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: StableIdSchema,
});

/**
 * Cross-Project Cell reuse stays a sibling resource because its source is the
 * signed-in user's Cloud Project shelf, not the live Circuit snapshot. The
 * imported result is still committed through the ordinary Project transaction
 * boundary and becomes an independent project-local Cell closure.
 */
export const AgentProjectResourceRequestSchema = z.discriminatedUnion(
  "operation",
  [
    ProjectRequestBaseSchema.extend({
      operation: z.literal("list-projects"),
    }),
    ProjectRequestBaseSchema.extend({
      operation: z.literal("list-cells"),
      cloudProjectId: StableIdSchema,
    }),
    ProjectRequestBaseSchema.extend({
      operation: z.literal("import-cell"),
      cloudProjectId: StableIdSchema,
      sourceDocumentId: StableIdSchema,
      expectedStructureRevision: z.number().int().nonnegative(),
    }),
  ],
);

export const AgentCloudProjectSummarySchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().min(1).max(256),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
  schemaVersion: z.number().int().positive(),
});

export const AgentReusableCellSummarySchema = z.strictObject({
  documentId: StableIdSchema,
  name: z.string().min(1).max(256),
  netlistName: z.string().min(1).max(256).nullable(),
  formalPorts: z.array(
    z.strictObject({
      name: z.string().min(1).max(128),
      direction: z.enum(["input", "output", "inout", "passive"]),
    }),
  ),
});

const ProjectResponseBaseSchema = z.strictObject({
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: StableIdSchema,
});

export const AgentProjectResourceResponseSchema = z.union([
  ProjectResponseBaseSchema.extend({
    operation: z.literal("list-projects"),
    ok: z.literal(true),
    projects: z.array(AgentCloudProjectSummarySchema),
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.literal("list-cells"),
    ok: z.literal(true),
    project: AgentCloudProjectSummarySchema.pick({
      id: true,
      name: true,
    }),
    cells: z.array(AgentReusableCellSummarySchema),
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.literal("import-cell"),
    ok: z.literal(true),
    status: z.enum(["imported", "already-imported"]),
    rootDocumentId: StableIdSchema,
    importedDocumentIds: z.array(StableIdSchema),
    structureRevision: z.number().int().nonnegative(),
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.enum(["list-projects", "list-cells", "import-cell", "error"]),
    ok: z.literal(false),
    error: z.strictObject({
      code: z.string().min(1),
      message: z.string().min(1),
      recovery: z.enum(["sign-in", "refresh", "fix-input", "retry"]),
    }),
  }),
]);

export const AgentProjectResourceRequestJsonSchema = z.toJSONSchema(
  AgentProjectResourceRequestSchema,
  { target: "draft-2020-12", reused: "ref" },
);
export const AgentProjectResourceResponseJsonSchema = z.toJSONSchema(
  AgentProjectResourceResponseSchema,
  { target: "draft-2020-12", reused: "ref" },
);

export function parseAgentProjectResourceRequest(
  input: unknown,
): { success: true; data: AgentProjectResourceRequest } | { success: false } {
  const parsed = AgentProjectResourceRequestSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false };
}

export type AgentProjectResourceRequest = z.infer<
  typeof AgentProjectResourceRequestSchema
>;
export type AgentProjectResourceResponse = z.infer<
  typeof AgentProjectResourceResponseSchema
>;
export type AgentCloudProjectSummary = z.infer<
  typeof AgentCloudProjectSummarySchema
>;
export type AgentReusableCellSummary = z.infer<
  typeof AgentReusableCellSummarySchema
>;
