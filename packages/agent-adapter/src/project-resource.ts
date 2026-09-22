import { z } from "zod";

import { AGENT_API_VERSION } from "./schema.js";

const StableIdSchema = z.string().min(1).max(256);
const ProjectRequestBaseSchema = z.strictObject({
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: StableIdSchema,
});
// Matches the Gallery's 2 MiB byte ceiling while allowing its complete UTF-8
// Project Code to cross this character-counted schema boundary.
const ProjectTextSchema = z.string().max(2_200_000);
const NetlistFormatSchema = z.enum(["spice", "spectre"]);
const NetlistNamingProfileSchema = z.enum(["native", "cadence-bang"]);
const NetlistPortCaseSchema = z.enum(["lower", "upper"]);

export const AgentWorkspaceActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({
    action: z.literal("activate"),
    workspaceId: StableIdSchema,
  }),
  z.strictObject({ action: z.literal("open"), cloudProjectId: StableIdSchema }),
  z.strictObject({ action: z.literal("save"), asNew: z.boolean().optional() }),
  z.strictObject({
    action: z.literal("copy"),
    sourceWorkspaceId: StableIdSchema,
    sourceDocumentId: StableIdSchema,
    sourceRevision: z.number().int().nonnegative(),
    sourceStructureRevision: z.number().int().nonnegative(),
    targetWorkspaceId: StableIdSchema,
    targetDocumentId: StableIdSchema,
    expectedStructureRevision: z.number().int().nonnegative(),
    expectedRevision: z.number().int().nonnegative(),
    offset: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
    selection: z
      .strictObject({
        instanceIds: z.array(StableIdSchema),
        draftingIds: z.array(StableIdSchema),
        routeIds: z.array(StableIdSchema),
        junctionIds: z.array(StableIdSchema),
        annotationIds: z.array(StableIdSchema),
      })
      .optional(),
  }),
]);
export type AgentWorkspaceAction = z.infer<typeof AgentWorkspaceActionSchema>;

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
      operation: z.literal("workspace"),
      request: AgentWorkspaceActionSchema,
    }),
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
    ProjectRequestBaseSchema.extend({
      operation: z.literal("list-gallery"),
      cursor: z.string().min(1).max(2_048).optional(),
      limit: z.number().int().min(1).max(60).optional(),
    }),
    ProjectRequestBaseSchema.extend({
      operation: z.literal("read-gallery-entry"),
      galleryEntryId: StableIdSchema,
      netlistFormat: NetlistFormatSchema.nullable().optional(),
      namingProfile: NetlistNamingProfileSchema.optional(),
      portCase: NetlistPortCaseSchema.optional(),
    }),
    ProjectRequestBaseSchema.extend({
      operation: z.literal("read-gallery-entries"),
      galleryEntryIds: z.array(StableIdSchema).min(1).max(12),
      netlistFormat: NetlistFormatSchema.nullable().optional(),
      namingProfile: NetlistNamingProfileSchema.optional(),
      portCase: NetlistPortCaseSchema.optional(),
    }),
    ProjectRequestBaseSchema.extend({
      operation: z.literal("read-project-code"),
    }),
    ProjectRequestBaseSchema.extend({
      operation: z.literal("replace-project-code"),
      projectCode: ProjectTextSchema,
      expectedStructureRevision: z.number().int().nonnegative(),
    }),
    ProjectRequestBaseSchema.extend({
      operation: z.literal("read-netlist"),
      format: NetlistFormatSchema.optional(),
      namingProfile: NetlistNamingProfileSchema.optional(),
      portCase: NetlistPortCaseSchema.optional(),
      rootDocumentId: StableIdSchema.optional(),
    }),
    ProjectRequestBaseSchema.extend({
      operation: z.literal("replace-netlist"),
      netlist: ProjectTextSchema,
      expectedStructureRevision: z.number().int().nonnegative(),
      format: NetlistFormatSchema.optional(),
      namingProfile: NetlistNamingProfileSchema.optional(),
      portCase: NetlistPortCaseSchema.optional(),
      rootDocumentId: StableIdSchema.optional(),
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

export const AgentGalleryEntrySummarySchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().min(1),
  author: z.string(),
  description: z.string(),
  createdAt: z.string(),
  schemaVersion: z.number().int().positive(),
  tags: z.array(z.string()),
  netlistable: z.boolean().optional(),
  likes: z.number().int().nonnegative().optional(),
});

export const AgentNetlistDiagnosticSchema = z.strictObject({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string().min(1),
  message: z.string().min(1),
  objectIds: z.array(StableIdSchema),
});

export const AgentNetlistReadSchema = z.strictObject({
  format: NetlistFormatSchema,
  status: z.enum(["ready", "blocked"]),
  text: z.string().nullable(),
  diagnostics: z.array(AgentNetlistDiagnosticSchema),
});

export const AgentGalleryEntryReadSchema = z.strictObject({
  entry: AgentGalleryEntrySummarySchema,
  projectCode: ProjectTextSchema,
  netlist: AgentNetlistReadSchema.nullable(),
});

const ProjectResponseBaseSchema = z.strictObject({
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: StableIdSchema,
});

export const AgentProjectResourceResponseSchema = z.union([
  ProjectResponseBaseSchema.extend({
    operation: z.literal("workspace"),
    ok: z.literal(true),
    result: z.union([
      z.strictObject({
        action: z.literal("list"),
        activeWorkspaceId: StableIdSchema,
        projects: z.array(
          z.strictObject({
            workspaceId: StableIdSchema,
            projectId: StableIdSchema,
            name: z.string(),
            cloudProjectId: StableIdSchema.nullable(),
            dirty: z.boolean(),
            structureRevision: z.number().int(),
            cells: z.array(
              z.strictObject({
                documentId: StableIdSchema,
                name: z.string(),
                revision: z.number().int(),
              }),
            ),
          }),
        ),
      }),
      z.strictObject({
        action: z.enum(["open", "activate"]),
        applied: z.boolean(),
      }),
      z.strictObject({
        action: z.literal("save"),
        project: AgentCloudProjectSummarySchema,
      }),
      z.strictObject({
        action: z.literal("copy"),
        structureRevision: z.number().int(),
        revision: z.number().int(),
        instanceIds: z.array(StableIdSchema),
        importedDocumentIds: z.array(StableIdSchema),
        importedFileIds: z.array(StableIdSchema),
        mapping: z.strictObject({
          objects: z.record(z.string(), z.record(z.string(), z.string())),
          cells: z.record(z.string(), z.string()),
          files: z.record(z.string(), z.string()),
        }),
      }),
    ]),
  }),
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
    operation: z.literal("list-gallery"),
    ok: z.literal(true),
    entries: z.array(AgentGalleryEntrySummarySchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative().nullable(),
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.literal("read-gallery-entry"),
    ok: z.literal(true),
    ...AgentGalleryEntryReadSchema.shape,
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.literal("read-gallery-entries"),
    ok: z.literal(true),
    entries: z.array(AgentGalleryEntryReadSchema),
    remainingEntryIds: z.array(StableIdSchema),
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.literal("read-project-code"),
    ok: z.literal(true),
    projectCode: ProjectTextSchema,
    structureRevision: z.number().int().nonnegative(),
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.literal("replace-project-code"),
    ok: z.literal(true),
    applied: z.boolean(),
    structureRevision: z.number().int().nonnegative(),
    activeDocumentId: StableIdSchema,
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.literal("read-netlist"),
    ok: z.literal(true),
    structureRevision: z.number().int().nonnegative(),
    netlist: AgentNetlistReadSchema,
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.literal("replace-netlist"),
    ok: z.literal(true),
    applied: z.boolean(),
    structureRevision: z.number().int().nonnegative(),
  }),
  ProjectResponseBaseSchema.extend({
    operation: z.enum([
      "workspace",
      "list-projects",
      "list-cells",
      "import-cell",
      "list-gallery",
      "read-gallery-entry",
      "read-gallery-entries",
      "read-project-code",
      "replace-project-code",
      "read-netlist",
      "replace-netlist",
      "error",
    ]),
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
export type AgentGalleryEntrySummary = z.infer<
  typeof AgentGalleryEntrySummarySchema
>;
export type AgentGalleryEntryRead = z.infer<typeof AgentGalleryEntryReadSchema>;
export type AgentNetlistRead = z.infer<typeof AgentNetlistReadSchema>;
