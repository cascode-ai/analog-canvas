import { agentToolHelp } from "./guidance.generated.js";
import { z } from "zod";
import { downloadSimulationArtifact } from "./artifact-download.js";
import { LocalWorkspace, defaultWorkspacePath } from "./local-workspace.js";
import { simulationAuthoringTools } from "./simulation-authoring-tools.js";
import { SimulationOperationSchema } from "@icm/simulation-service/contract";
import { SimulationFileOperationSchema } from "@icm/simulation-service/files";
import {
  AGENT_API_VERSION,
  AGENT_MCP_VERSION,
  AgentFileDownloadOptionsSchema,
} from "@icm/agent-adapter";
import {
  AgentAuthoringCommandSchema,
  AgentSemanticIntentSchema,
  AgentWireIntentSchema,
  AgentSnapshotRequestSchema,
} from "@icm/agent-adapter";
import {
  AgentSessionError,
  AuthoringActionSchema,
  changedObjectIds,
  type AgentSessionClient,
} from "@icm/agent-client";
import type { McpToolCallResult, McpToolDefinition } from "./protocol.js";
import {
  diagnosticsCompact,
  inspectConnectivity,
  inspectDocument,
  inspectObject,
  searchSnapshot,
  type SearchKind,
} from "./results.js";
import { exportFile, importFile } from "./file-operations.js";

/**
 * The default MCP tool surface (Agent rationale) stays compact. The full
 * typed edit union is deliberately NOT injected into tool descriptions; it is
 * available through `advanced_transact`; its full contract is an on-demand
 * resource, not a session permission gate.
 */
export interface ToolSessionState {
  client: AgentSessionClient;
  workspaceBase?: string;
  workspaceBases?: Map<string, string>;
}

const ConnectArgs = z.strictObject({
  claimCode: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Claim code from the editor connect panel. Omit to resume the browser-approved connector saved for this MCP host.",
    ),
});
const SimulationArgs = z.strictObject({
  request: SimulationOperationSchema,
  requestId: z.string().min(1).optional(),
});
const ProjectCellsArgs = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list-projects") }),
  z.strictObject({
    action: z.literal("list-cells"),
    cloudProjectId: z.string().min(1),
  }),
  z.strictObject({
    action: z.literal("import-cell"),
    cloudProjectId: z.string().min(1),
    sourceDocumentId: z.string().min(1),
    expectedStructureRevision: z.number().int().nonnegative().optional(),
  }),
]);
const GalleryCircuitsArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("list"),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(60).optional(),
  }),
  z.strictObject({
    action: z.literal("read"),
    galleryEntryId: z.string().min(1),
    netlistFormat: z.enum(["spice", "spectre"]).nullable().optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    portCase: z.enum(["lower", "upper"]).optional(),
  }),
  z.strictObject({
    action: z.literal("read-many"),
    galleryEntryIds: z.array(z.string().min(1)).min(1).max(12),
    netlistFormat: z.enum(["spice", "spectre"]).nullable().optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    portCase: z.enum(["lower", "upper"]).optional(),
  }),
]);
const ProjectCodeArgs = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("read") }),
  z.strictObject({
    action: z.literal("replace"),
    projectCode: z.string().max(2_200_000),
    expectedStructureRevision: z.number().int().nonnegative().optional(),
  }),
]);
const NetlistCodeArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("read"),
    format: z.enum(["spice", "spectre"]).optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    portCase: z.enum(["lower", "upper"]).optional(),
    rootDocumentId: z.string().min(1).optional(),
  }),
  z.strictObject({
    action: z.literal("replace"),
    netlist: z.string().max(2_200_000),
    expectedStructureRevision: z.number().int().nonnegative().optional(),
    format: z.enum(["spice", "spectre"]).optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    portCase: z.enum(["lower", "upper"]).optional(),
    rootDocumentId: z.string().min(1).optional(),
  }),
]);
const SimulationFilesArgs = z.strictObject({
  request: z.union([
    SimulationFileOperationSchema,
    z.strictObject({ action: z.literal("workspace") }),
    z.strictObject({
      action: z.literal("sync"),
      runId: z.string().min(1),
      fileIds: z.array(z.string().min(1)).optional(),
    }),
  ]),
  requestId: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  basePath: z.string().min(1).optional(),
});

async function localWorkspace(session: ToolSessionState, basePath?: string) {
  const status = await session.client.status();
  if (!status.sessionId || !status.projectId)
    throw new Error("Connect before creating or syncing a local workspace");
  const scope = {
    serverUrl: session.client.apiBaseUrl,
    projectId: status.projectId,
    sessionId: status.sessionId,
  };
  const key = `${new URL(scope.serverUrl).origin}\0${scope.projectId}`;
  const workspace = await LocalWorkspace.open(
    scope,
    basePath ?? session.workspaceBases?.get(key) ?? defaultWorkspacePath(scope),
  );
  session.workspaceBases ??= new Map();
  session.workspaceBases.set(key, workspace.basePath);
  session.workspaceBase = workspace.basePath;
  return workspace;
}
async function fetchWorkspaceArtifact(
  session: ToolSessionState,
  artifactId: string,
  offset: number,
) {
  const response = await session.client.prepareArtifactDownload(artifactId);
  if (
    !response.ok ||
    response.operation !== "simulation-input" ||
    !response.result.ok ||
    !("download" in response.result)
  )
    throw new Error(JSON.stringify(response));
  return session.client.downloadArtifact(
    response.result.download.path,
    offset,
    response.result.artifact.sha256,
  );
}

const ExportFileArgs = AgentFileDownloadOptionsSchema.safeExtend({
  outputPath: z.string().min(1),
});

const ImportFileArgs = z
  .strictObject({
    action: z.enum([
      "stage-project",
      "stage-spice",
      "inspect",
      "discard",
      "request-approval",
    ]),
    path: z.string().min(1).optional(),
    rootPath: z.string().min(1).optional(),
    entryPath: z.string().min(1).optional(),
    includePaths: z.array(z.string().min(1)).max(23).optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    candidateId: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const required =
      value.action === "stage-project"
        ? (["path"] as const)
        : value.action === "stage-spice"
          ? (["rootPath", "entryPath"] as const)
          : (["candidateId"] as const);
    for (const field of required) {
      if (!value[field]) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for ${value.action}`,
        });
      }
    }
  });

const DocumentArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  refresh: z.boolean().optional(),
});

const InspectArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  refresh: z.boolean().optional(),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("document") }),
    z.strictObject({
      kind: z.literal("object"),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    }),
    z.strictObject({
      kind: z.literal("net"),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    }),
    z.strictObject({
      kind: z.literal("connectivity"),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    }),
    z.strictObject({ kind: z.literal("diagnostics") }),
    z.strictObject({ kind: z.literal("activity") }),
    z.strictObject({
      kind: z.literal("trace"),
      ...AgentSnapshotRequestSchema.shape.traceNet.unwrap().shape,
    }),
  ]),
  detail: z.enum(["compact", "full"]).optional(),
});

const SearchArgs = z.strictObject({
  scope: z.enum(["document", "project"]).optional(),
  documentId: z.string().min(1).optional(),
  refresh: z.boolean().optional(),
  query: z.string().min(1),
  kinds: z
    .array(
      z.enum([
        "instance",
        "net",
        "route",
        "junction",
        "annotation",
        "drafting",
        "property",
        "diagnostic",
      ]),
    )
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const ApplyActionsArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  actions: z.array(AuthoringActionSchema).min(1).max(256),
});

const AdvancedTransactArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  edits: z.array(z.unknown()).min(1).max(256).optional(),
  structureEdits: z.array(z.unknown()).min(1).max(256).optional(),
  wireIntent: z
    .union([
      AgentWireIntentSchema,
      z.array(AgentWireIntentSchema).min(1).max(64),
    ])
    .optional(),
  semanticIntent: AgentSemanticIntentSchema.optional(),
  command: AgentAuthoringCommandSchema.optional(),
  dryRun: z.boolean().optional(),
});

const RenderArgs = z.strictObject({
  mode: z.enum(["formal", "diagnostics"]).optional(),
  bounds: z
    .strictObject({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  documentId: z.string().min(1).optional(),
});

interface ToolEntry {
  definition: McpToolDefinition;
  handle: (args: unknown, session: ToolSessionState) => Promise<unknown>;
}

const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { target: "draft-2020-12", reused: "ref" }) as Record<
    string,
    unknown
  >;

function textResult(value: unknown, isError = false): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function toolErrorResponse(error: unknown): McpToolCallResult {
  if (error instanceof AgentSessionError) {
    return textResult(
      {
        ok: false,
        error: error.toJSON(),
        hint:
          error.category === "unrecoverable-credential"
            ? "call connect with a fresh claim code from the editor"
            : error.category === "editor-offline"
              ? "the authorized browser editor is not attached; ask the human to reopen the project"
              : undefined,
      },
      true,
    );
  }
  return textResult(
    {
      ok: false,
      error: {
        code: "TOOL_FAILURE",
        message: error instanceof Error ? error.message : String(error),
      },
    },
    true,
  );
}

const TOOLS: readonly ToolEntry[] = [
  {
    definition: {
      name: "connect",
      description: agentToolHelp["connect"],
      inputSchema: jsonSchemaOf(ConnectArgs),
    },
    handle: async (args, session) => {
      const parsed = ConnectArgs.parse(args ?? {});
      const report = await session.client.connect(parsed.claimCode);
      return {
        ok: true,
        mode: report.mode,
        projectId: report.projectId,
        documentIds: report.documentIds,
        tokenExpiresAt: report.tokenExpiresAt,
        capabilities: report.capabilities,
        context: report.context,
      };
    },
  },
  {
    definition: {
      name: "disconnect",
      description: agentToolHelp["disconnect"],
      inputSchema: jsonSchemaOf(z.strictObject({})),
    },
    handle: async (_args, session) => {
      await session.client.disconnect();
      return { ok: true, state: "revoked" };
    },
  },
  {
    definition: {
      name: "connection_status",
      description: agentToolHelp["connection_status"],
      inputSchema: jsonSchemaOf(
        z.strictObject({ refresh: z.boolean().optional() }),
      ),
    },
    handle: async (args, session) => {
      const { refresh = true } = z
        .strictObject({ refresh: z.boolean().optional() })
        .parse(args);
      return {
        ...(await session.client.status({ refresh })),
        runtime: {
          version: AGENT_MCP_VERSION,
          apiBaseUrl: session.client.apiBaseUrl,
        },
      };
    },
  },
  {
    definition: {
      name: "project_cells",
      description: agentToolHelp["project_cells"],
      inputSchema: { ...jsonSchemaOf(ProjectCellsArgs), type: "object" },
    },
    handle: async (args, session) => {
      const parsed = ProjectCellsArgs.parse(args);
      if (parsed.action === "list-projects") {
        return session.client.projectResource({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          operation: parsed.action,
        });
      }
      if (parsed.action === "list-cells") {
        return session.client.projectResource({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          operation: parsed.action,
          cloudProjectId: parsed.cloudProjectId,
        });
      }
      const expectedStructureRevision =
        parsed.expectedStructureRevision ??
        (await session.client.snapshot(undefined, { refresh: true })).snapshot
          .project.structureRevision;
      return session.client.projectResource({
        apiVersion: AGENT_API_VERSION,
        requestId: crypto.randomUUID(),
        operation: parsed.action,
        cloudProjectId: parsed.cloudProjectId,
        sourceDocumentId: parsed.sourceDocumentId,
        expectedStructureRevision,
      });
    },
  },
  {
    definition: {
      name: "gallery_circuits",
      description: agentToolHelp["gallery_circuits"],
      inputSchema: { ...jsonSchemaOf(GalleryCircuitsArgs), type: "object" },
    },
    handle: async (args, session) => {
      const parsed = GalleryCircuitsArgs.parse(args);
      if (parsed.action === "list") {
        return session.client.projectResource({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          operation: "list-gallery",
          ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
          ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
        });
      }
      const common = {
        apiVersion: AGENT_API_VERSION,
        requestId: crypto.randomUUID(),
        ...(parsed.netlistFormat === undefined
          ? {}
          : { netlistFormat: parsed.netlistFormat }),
        ...(parsed.namingProfile
          ? { namingProfile: parsed.namingProfile }
          : {}),
        ...(parsed.portCase ? { portCase: parsed.portCase } : {}),
      } as const;
      return parsed.action === "read"
        ? session.client.projectResource({
            ...common,
            operation: "read-gallery-entry",
            galleryEntryId: parsed.galleryEntryId,
          })
        : session.client.projectResource({
            ...common,
            operation: "read-gallery-entries",
            galleryEntryIds: parsed.galleryEntryIds,
          });
    },
  },
  {
    definition: {
      name: "project_code",
      description: agentToolHelp["project_code"],
      inputSchema: { ...jsonSchemaOf(ProjectCodeArgs), type: "object" },
    },
    handle: async (args, session) => {
      const parsed = ProjectCodeArgs.parse(args);
      if (parsed.action === "read") {
        return session.client.projectResource({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          operation: "read-project-code",
        });
      }
      const expectedStructureRevision =
        parsed.expectedStructureRevision ??
        (await session.client.snapshot(undefined, { refresh: true })).snapshot
          .project.structureRevision;
      return session.client.projectResource({
        apiVersion: AGENT_API_VERSION,
        requestId: crypto.randomUUID(),
        operation: "replace-project-code",
        projectCode: parsed.projectCode,
        expectedStructureRevision,
      });
    },
  },
  {
    definition: {
      name: "netlist_code",
      description: agentToolHelp["netlist_code"],
      inputSchema: { ...jsonSchemaOf(NetlistCodeArgs), type: "object" },
    },
    handle: async (args, session) => {
      const parsed = NetlistCodeArgs.parse(args);
      if (parsed.action === "read") {
        return session.client.projectResource({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          operation: "read-netlist",
          ...(parsed.format ? { format: parsed.format } : {}),
          ...(parsed.namingProfile
            ? { namingProfile: parsed.namingProfile }
            : {}),
          ...(parsed.portCase ? { portCase: parsed.portCase } : {}),
          ...(parsed.rootDocumentId
            ? { rootDocumentId: parsed.rootDocumentId }
            : {}),
        });
      }
      const expectedStructureRevision =
        parsed.expectedStructureRevision ??
        (await session.client.snapshot(undefined, { refresh: true })).snapshot
          .project.structureRevision;
      return session.client.projectResource({
        apiVersion: AGENT_API_VERSION,
        requestId: crypto.randomUUID(),
        operation: "replace-netlist",
        netlist: parsed.netlist,
        expectedStructureRevision,
        ...(parsed.format ? { format: parsed.format } : {}),
        ...(parsed.namingProfile
          ? { namingProfile: parsed.namingProfile }
          : {}),
        ...(parsed.portCase ? { portCase: parsed.portCase } : {}),
        ...(parsed.rootDocumentId
          ? { rootDocumentId: parsed.rootDocumentId }
          : {}),
      });
    },
  },
  {
    definition: {
      name: "simulation",
      description: agentToolHelp["simulation"],
      inputSchema: jsonSchemaOf(SimulationArgs),
    },
    handle: async (args, session) => {
      const { request, requestId } = SimulationArgs.parse(args);
      const effectiveRequestId = requestId ?? crypto.randomUUID();
      try {
        return await session.client.simulationResource({
          ...request,
          apiVersion: AGENT_API_VERSION,
          requestId: effectiveRequestId,
        });
      } catch (error) {
        if (!(error instanceof AgentSessionError)) throw error;
        return {
          ok: false,
          requestId: effectiveRequestId,
          error: {
            code: error.code,
            message: error.message,
            stage: request.operation,
            ...(error.httpStatus === undefined
              ? {}
              : { httpStatus: error.httpStatus }),
            recovery:
              error.category === "unrecoverable-credential"
                ? "reauthorize"
                : error.httpStatus !== undefined &&
                    (error.httpStatus >= 500 ||
                      error.httpStatus === 429 ||
                      error.httpStatus === 408)
                  ? "retry-same-request"
                  : error.category === "request-rejected" &&
                      error.code !== "INVALID_RESPONSE"
                    ? "fix-input"
                    : "retry-same-request",
          },
        };
      }
    },
  },
  ...simulationAuthoringTools,
  {
    definition: {
      name: "simulation_files",
      description: agentToolHelp["simulation_files"],
      inputSchema: jsonSchemaOf(SimulationFilesArgs),
    },
    handle: async (args, session) => {
      const { request, requestId, outputPath, basePath } =
        SimulationFilesArgs.parse(args);
      if (request.action === "workspace") {
        // status() is a cached local observation, not a network lease refresh.
        const status = await session.client.status();
        if (status.sessionId && status.projectId)
          return (await localWorkspace(session, basePath)).describe();
        const path = basePath ?? session.workspaceBase;
        if (path) {
          try {
            const result = await LocalWorkspace.inspect(path);
            session.workspaceBase = result.basePath;
            return result;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "WORKSPACE_NOT_FOUND"
            )
              throw error;
          }
        }
        return (await localWorkspace(session, basePath)).describe();
      }
      if (request.action === "sync") {
        const response = await session.client.simulationResource({
          apiVersion: AGENT_API_VERSION,
          requestId: requestId ?? crypto.randomUUID(),
          operation: "catalog",
          runId: request.runId,
        });
        if (!response.ok || !("catalog" in response)) return response;
        const workspace = await localWorkspace(session, basePath);
        return workspace.sync(
          response.catalog,
          (ref, offset) => fetchWorkspaceArtifact(session, ref.id, offset),
          request.fileIds,
        );
      }
      if (
        outputPath &&
        request.action !== "artifact" &&
        request.action !== "download"
      )
        return {
          ok: false,
          error: {
            code: "OUTPUT_REQUIRES_ARTIFACT",
            message: "outputPath is only used for artifact downloads",
            recovery: "fix-input",
          },
        };
      if (outputPath && request.action === "artifact" && request.offset !== 0)
        return {
          ok: false,
          error: {
            code: "EXPORT_REQUIRES_START",
            message: "A local export starts at offset 0",
            recovery: "fix-input",
          },
        };
      const response =
        request.action === "download" ||
        (outputPath && request.action === "artifact")
          ? await session.client.prepareArtifactDownload(
              request.artifactId,
              requestId,
            )
          : await session.client.fileResource({
              apiVersion: AGENT_API_VERSION,
              requestId: requestId ?? crypto.randomUUID(),
              operation: "simulation-input",
              input: request,
            });
      if (!response.ok || response.operation !== "simulation-input")
        return response;
      if (outputPath && response.result.ok && "download" in response.result) {
        const { artifact, download } = response.result;
        return downloadSimulationArtifact(artifact, outputPath, (offset) =>
          session.client.downloadArtifact(
            download.path,
            offset,
            artifact.sha256,
          ),
        );
      }
      if (
        !outputPath &&
        request.action === "download" &&
        response.result.ok &&
        "download" in response.result
      ) {
        const { artifact, download } = response.result;
        const workspace = await localWorkspace(session, basePath);
        return {
          ...(await workspace.download(artifact, (ref, offset) =>
            session.client.downloadArtifact(download.path, offset, ref.sha256),
          )),
          basePath: workspace.basePath,
          indexPath: workspace.indexPath,
        };
      }
      return response.result;
    },
  },
  {
    definition: {
      name: "export_file",
      description: agentToolHelp["export_file"],
      inputSchema: jsonSchemaOf(ExportFileArgs),
    },
    handle: async (args, session) =>
      (() => {
        const parsed = ExportFileArgs.parse(args);
        return exportFile(session.client, {
          artifact: parsed.artifact,
          outputPath: parsed.outputPath,
          ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
          ...(parsed.simulation ? { simulation: parsed.simulation } : {}),
        });
      })(),
  },
  {
    definition: {
      name: "import_file",
      description: agentToolHelp["import_file"],
      inputSchema: jsonSchemaOf(ImportFileArgs),
    },
    handle: async (args, session) => {
      const parsed = ImportFileArgs.parse(args);
      return importFile(
        session.client,
        parsed.action === "stage-project"
          ? { action: parsed.action, path: parsed.path! }
          : parsed.action === "stage-spice"
            ? {
                action: parsed.action,
                rootPath: parsed.rootPath!,
                entryPath: parsed.entryPath!,
                ...(parsed.namingProfile
                  ? { namingProfile: parsed.namingProfile }
                  : {}),
                ...(parsed.includePaths
                  ? { includePaths: parsed.includePaths }
                  : {}),
              }
            : { action: parsed.action, candidateId: parsed.candidateId! },
      );
    },
  },
  {
    definition: {
      name: "get_context",
      description: agentToolHelp["get_context"],
      inputSchema: jsonSchemaOf(DocumentArgs),
    },
    handle: async (args, session) => {
      const parsed = DocumentArgs.parse(args ?? {});
      const entry = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? true,
      });
      const summary = session.client.summary(entry.documentId);
      return {
        ...(summary ?? {}),
        connection: session.client.connection.snapshot.state,
        fetchedAt: entry.fetchedAt,
      };
    },
  },
  {
    definition: {
      name: "inspect",
      description: agentToolHelp["inspect"],
      inputSchema: jsonSchemaOf(InspectArgs),
    },
    handle: async (args, session) => {
      const parsed = InspectArgs.parse(args);
      if (parsed.target.kind === "activity")
        return {
          transactions: session.client.recentTransactions(),
          scope: "current-mcp-process",
        };
      if (parsed.target.kind === "trace")
        return session.client.traceNet(
          {
            netId: parsed.target.netId,
            ...(parsed.target.hierarchyPath
              ? { hierarchyPath: parsed.target.hierarchyPath }
              : {}),
          },
          parsed.documentId,
        );
      const entry = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? true,
      });
      switch (parsed.target.kind) {
        case "document":
          return inspectDocument(entry, parsed.detail ?? "compact");
        case "object":
          return inspectObject(entry, parsed.target);
        case "net":
          return inspectObject(entry, parsed.target);
        case "connectivity":
          return inspectConnectivity(entry, parsed.target);
        case "diagnostics":
          return diagnosticsCompact(entry);
      }
    },
  },
  {
    definition: {
      name: "search",
      description: agentToolHelp["search"],
      inputSchema: jsonSchemaOf(SearchArgs),
    },
    handle: async (args, session) => {
      const parsed = SearchArgs.parse(args);
      const entry = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? true,
      });
      const limit = parsed.limit ?? 20;
      const entries = [entry];
      if (parsed.scope === "project") {
        const allowed = new Set((await session.client.status()).documentIds);
        for (const document of entry.snapshot.project.documents) {
          if (document.id !== entry.documentId && allowed.has(document.id))
            entries.push(
              await session.client.snapshot(document.id, {
                refresh: parsed.refresh ?? true,
              }),
            );
        }
      }
      return {
        query: parsed.query,
        hits: entries
          .flatMap((item) =>
            searchSnapshot(
              item,
              parsed.query,
              parsed.kinds as readonly SearchKind[] | undefined,
              limit,
            ).map((hit) => ({ ...hit, documentId: item.documentId })),
          )
          .slice(0, limit),
      };
    },
  },
  {
    definition: {
      name: "apply_actions",
      description: agentToolHelp["apply_actions"],
      inputSchema: jsonSchemaOf(ApplyActionsArgs),
    },
    handle: async (args, session) => {
      const parsed = ApplyActionsArgs.parse(args);
      const report = await session.client.applyActions(parsed.actions, {
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
      });
      return report;
    },
  },
  {
    definition: {
      name: "advanced_transact",
      description: agentToolHelp["advanced_transact"],
      inputSchema: jsonSchemaOf(AdvancedTransactArgs),
    },
    handle: async (args, session) => {
      const parsed = AdvancedTransactArgs.parse(args);
      const { documentId: _documentId, dryRun: _dryRun, ...payload } = parsed;
      return session.client.advancedTransact(payload, {
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
        ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
      });
    },
  },
  {
    definition: {
      name: "verify",
      description: agentToolHelp["verify"],
      inputSchema: jsonSchemaOf(DocumentArgs),
    },
    handle: async (args, session) => {
      const client = session.client;
      const parsed = DocumentArgs.parse(args ?? {});
      const documentId = parsed.documentId;
      const before = client.cachedSnapshot(documentId);
      const fresh = await client.refreshSnapshot(documentId);
      const changed =
        before && before.documentId === fresh.documentId
          ? changedObjectIds(before.snapshot, fresh.snapshot)
          : [];
      const counts = diagnosticsCompact(fresh).counts;
      return { revision: fresh.revision, ...counts, changedObjectIds: changed };
    },
  },
  {
    definition: {
      name: "render",
      description: agentToolHelp["render"],
      inputSchema: jsonSchemaOf(RenderArgs),
    },
    handle: async (args, session) => {
      const parsed = RenderArgs.parse(args);
      const response = await session.client.render({
        ...(parsed.mode ? { mode: parsed.mode } : {}),
        ...(parsed.bounds ? { bounds: parsed.bounds } : {}),
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
      });
      return {
        __render: response,
      };
    },
  },
];

export function listToolDefinitions(): McpToolDefinition[] {
  return TOOLS.map((tool) => tool.definition);
}

/** Marker for a tool that completed with a structured failure payload. */
export class ToolFailure {
  constructor(readonly value: unknown) {}
}

export async function callTool(
  name: string,
  args: unknown,
  session: ToolSessionState,
): Promise<McpToolCallResult> {
  const tool = TOOLS.find((entry) => entry.definition.name === name);
  if (!tool) {
    return textResult(
      { ok: false, error: { code: "UNKNOWN_TOOL", message: name } },
      true,
    );
  }
  try {
    const result = await tool.handle(args ?? {}, session);
    if (result instanceof ToolFailure) {
      return textResult(result.value, true);
    }
    if (result !== null && typeof result === "object" && "__render" in result) {
      const response = (
        result as {
          __render: Awaited<ReturnType<AgentSessionClient["render"]>>;
        }
      ).__render;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                revision: response.revision,
                mode: response.artifact.mode,
                byteLength: response.artifact.byteLength,
                sha256: response.artifact.sha256,
                diagnostics: response.diagnostics.length,
              },
              null,
              2,
            ),
          },
          {
            type: "image",
            data: response.artifact.data,
            mimeType: "image/svg+xml",
          },
        ],
      };
    }
    // Structured reports carry their own `ok: false` failure state.
    const failed =
      result !== null &&
      typeof result === "object" &&
      "ok" in result &&
      (result as { ok?: unknown }).ok === false;
    return textResult(result, failed);
  } catch (error) {
    return toolErrorResponse(error);
  }
}
