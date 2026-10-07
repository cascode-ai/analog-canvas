import { agentToolHelp } from "./guidance.generated.js";
import { compareExpectedNetlist } from "./netlist-comparison.js";
import { z } from "zod";
import { downloadSimulationArtifact } from "./artifact-download.js";
import { LocalWorkspace, defaultWorkspacePath } from "./local-workspace.js";
import { workspaceTransfer } from "./workspace-transfer.js";
import {
  savedWorkspacePath,
  rememberWorkspacePath,
} from "./workspace-location.js";
import { join } from "node:path";
import { simulationAuthoringTools } from "./simulation-authoring-tools.js";
import { PreparePlotSchema, preparePlot } from "./prepare-plot.js";
import { workspaceSyncReceipt } from "./workspace-receipt.js";
import { preparedSummary } from "./prepared-summary.js";
import {
  SimulationOperationSchema,
  ArtifactRefSchema,
  simulationSpecAnnotationDiagnostics,
} from "@icm/simulation-service/contract";
import {
  SimulationFileOperationSchema,
  type SimulationFileOwner,
} from "@icm/simulation-service/files";
import {
  AGENT_API_VERSION,
  AGENT_MCP_VERSION,
  AgentFileDownloadOptionsSchema,
  AgentGalleryEntryFields,
  AgentWorkspaceActionSchema,
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
} from "@icm/agent-client";
import type { AgentRequestTiming } from "@icm/agent-client";
import type { OperationSession } from "./operation-session.js";
import type { ContractTool } from "./tool-contracts.js";
import {
  diagnosticsCompact,
  compactActionReport,
  inspectConnectivity,
  inspectDocument,
  inspectObject,
  searchSnapshot,
  verifyInformation,
  type SearchKind,
} from "./results.js";
import { exportFile, importFile, openGalleryEntry } from "./file-operations.js";
import { compactSchema } from "./compact-schema.js";
import { waitForSimulation } from "./simulation-wait.js";
import {
  ContractQueryError,
  DescribeToolArgs,
  ToolContractRegistry,
} from "./tool-contracts.js";
import { editContract } from "./edit-contracts.js";
import { focusedTools, FOCUSED_TOOLS } from "./focused-tools.js";
import { simulationArguments } from "./operation-arguments.js";
import {
  inputIssues,
  inputIssueDetails,
  lazyContract,
} from "./input-contract.js";

/**
 * The default MCP tool surface (Agent rationale) stays compact. The full
 * typed edit union is deliberately NOT injected into tool descriptions; it is
 * available through `advanced_transact`; its full contract is an on-demand
 * resource, not a session permission gate.
 */
type ToolSessionState = OperationSession;

const ConnectArgs = z.strictObject({
  claimCode: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Claim code from the editor connect panel. Omit to resume the browser-approved connector saved for this MCP host.",
    ),
});
const SimulationArgs = z
  .strictObject({
    request: SimulationOperationSchema,
    requestId: z.string().min(1).optional(),
    detail: z
      .enum(["summary", "full"])
      .optional()
      .describe(
        "Summary keeps launch/status/diagnostics and directory references. Full includes preparation mappings and run file metadata. Run samples always use files.",
      ),
    waitMs: z
      .number()
      .int()
      .min(0)
      .max(20_000)
      .optional()
      .describe(
        "For run/start/read: hold the same Agent request for up to 20 seconds and return its latest run receipt. Resume a running receipt with read, never another submission.",
      ),
  })
  .superRefine((value, context) => {
    if (
      value.waitMs &&
      !["run", "start", "read"].includes(
        (value.request as { operation?: string }).operation ??
          (value.request as { action?: string }).action ??
          "",
      )
    )
      context.addIssue({
        code: "custom",
        path: ["waitMs"],
        message: "waitMs is supported by run/start/read only",
      });
  });
const ProjectCellsArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("bind-workspace"),
    workspaceId: z.string().min(1).max(256).nullable(),
  }),
  z.strictObject({
    action: z.literal("workspace"),
    request: AgentWorkspaceActionSchema,
  }),
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
    action: z.literal("insert"),
    galleryEntryId: z.string().min(1).max(256),
    sourceDocumentId: z.string().min(1).max(256).optional(),
    targetDocumentId: z.string().min(1).max(256),
    position: z.strictObject({
      x: z.number().finite(),
      y: z.number().finite(),
    }),
    expectedRevision: z.number().int().nonnegative().optional(),
    expectedStructureRevision: z.number().int().nonnegative().optional(),
  }),
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
    render: z
      .enum(["svg", "png"])
      .optional()
      .describe("Also return the top Cell's figure as an image."),
  }),
  z.strictObject({
    action: z.literal("open"),
    galleryEntryId: z.string().min(1),
    background: z.boolean().optional(),
  }),
  z.strictObject({
    action: z.literal("read-many"),
    galleryEntryIds: z.array(z.string().min(1)).min(1).max(12),
    netlistFormat: z.enum(["spice", "spectre"]).nullable().optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    portCase: z.enum(["lower", "upper"]).optional(),
  }),
  z.strictObject({
    action: z.literal("publish"),
    ...AgentGalleryEntryFields,
  }),
  z.strictObject({
    action: z.literal("update"),
    galleryEntryId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Defaults to the entry the working copy was published as or opened from.",
      ),
    ...AgentGalleryEntryFields,
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
    documentId: z.string().min(1).optional(),
    rootDocumentId: z.string().min(1).optional(),
  }),
  z.strictObject({
    action: z.literal("replace"),
    netlist: z.string().max(2_200_000),
    expectedStructureRevision: z.number().int().nonnegative().optional(),
    format: z.enum(["spice", "spectre"]).optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    portCase: z.enum(["lower", "upper"]).optional(),
    documentId: z.string().min(1).optional(),
    rootDocumentId: z.string().min(1).optional(),
  }),
]);
const SimulationFilesArgs = z.strictObject({
  request: z.union([
    PreparePlotSchema,
    SimulationFileOperationSchema,
    z.strictObject({ action: z.literal("workspace") }),
    z.strictObject({
      action: z.literal("sync"),
      runId: z.string().min(1),
      fileIds: z.array(z.string().min(1)).optional(),
      analysisIndex: z.number().int().nonnegative().optional(),
      roles: z.array(ArtifactRefSchema.shape.role.unwrap()).min(1).optional(),
    }),
  ]),
  requestId: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  basePath: z.string().min(1).optional(),
  detail: z
    .enum(["summary", "full"])
    .optional()
    .describe(
      "Sync defaults to paths/counts/timing; full includes each file identity. The local index always retains complete metadata.",
    ),
  refresh: z
    .boolean()
    .optional()
    .describe(
      "Refresh the result directory instead of reusing a complete directory fetched within 30 seconds.",
    ),
});

// Read the authoritative Zod envelope once, without building JSON discovery
// schemas on the hot path. Both entry points normalize here before routing.
const simulationEnvelopeFields = new Set(Object.keys(SimulationArgs.shape));
const fileEnvelopeFields = new Set(Object.keys(SimulationFilesArgs.shape));

/**
 * The text a save left in a source file, read back page by page. Undefined
 * when a read is refused or fails, or when the file no longer holds the text
 * the save left (`textDigest`), so a later edit is never checked as this one.
 */
async function savedSourceText(
  session: ToolSessionState,
  owner: SimulationFileOwner,
  path: string,
  textDigest: string | undefined,
): Promise<string | undefined> {
  let text = "";
  try {
    for (let offset: number | null = 0; offset !== null;) {
      const response = await session.client.fileResource({
        apiVersion: AGENT_API_VERSION,
        requestId: crypto.randomUUID(),
        operation: "simulation-input",
        input: {
          action: "read",
          owner,
          path,
          offset,
          maxChars: 65536,
          detail: "text",
        },
      });
      if (
        !response.ok ||
        response.operation !== "simulation-input" ||
        !response.result.ok ||
        !("textDigest" in response.result) ||
        (textDigest !== undefined && response.result.textDigest !== textDigest)
      )
        return undefined;
      text += response.result.text;
      offset = response.result.nextOffset;
    }
  } catch {
    // The save stands; a check that cannot read it back stays silent.
    return undefined;
  }
  return text;
}

async function localWorkspace(session: ToolSessionState, basePath?: string) {
  const status = await session.client.status();
  if (!status.sessionId)
    throw new Error("Connect before creating or syncing a local workspace");
  // Project.id is not an open-workspace identity: legacy drafts may still use
  // project-main. Resolve the browser's active copy before selecting a disk base.
  const response = await session.client.projectResource({
    apiVersion: AGENT_API_VERSION,
    requestId: crypto.randomUUID(),
    operation: "workspace",
    request: { action: "list" },
  });
  if (!response.ok || response.operation !== "workspace")
    throw new Error(
      response.ok ? "WORKSPACE_IDENTITY_UNAVAILABLE" : response.error.code,
    );
  if (response.result.action !== "list")
    throw new Error("WORKSPACE_IDENTITY_UNAVAILABLE");
  const { activeWorkspaceId, projects } = response.result;
  const selectedWorkspaceId = session.client.workspaceId ?? activeWorkspaceId;
  const active = projects.find(
    (project) => project.workspaceId === selectedWorkspaceId,
  );
  if (!active) throw new Error("WORKSPACE_IDENTITY_UNAVAILABLE");
  const scope = {
    serverUrl: session.client.apiBaseUrl,
    projectId: active.projectId,
    projectIdentity: active.cloudProjectId
      ? `cloud:${active.cloudProjectId}`
      : `draft:${active.workspaceId}`,
    sessionId: status.sessionId,
  };
  const key = `${new URL(scope.serverUrl).origin}\0${scope.projectIdentity}`;
  const defaultPath = defaultWorkspacePath(scope, session.workspaceRoot);
  const selectedPath =
    basePath ??
    session.workspaceBases?.get(key) ??
    (await savedWorkspacePath(defaultPath)) ??
    (session.taskDirectory
      ? defaultWorkspacePath(
          scope,
          join(session.taskDirectory, ".analog-canvas"),
        )
      : defaultPath);
  const workspace = await LocalWorkspace.open(scope, selectedPath);
  await rememberWorkspacePath(defaultPath, workspace.basePath);
  session.workspaceBases ??= new Map();
  session.workspaceBases.set(key, workspace.basePath);
  session.workspaceBase = workspace.basePath;
  return workspace;
}
const ExportFileArgs = AgentFileDownloadOptionsSchema.safeExtend({
  outputPath: z.string().min(1),
});

const ImportFileArgs = z
  .strictObject({
    action: z.enum([
      "stage-project",
      "stage-spice",
      "import-cell",
      "inspect",
      "discard",
      "request-approval",
      "open",
    ]),
    path: z.string().min(1).optional(),
    rootPath: z.string().min(1).optional(),
    entryPath: z.string().min(1).optional(),
    includePaths: z.array(z.string().min(1)).max(23).optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    candidateId: z.string().min(1).optional(),
    background: z.boolean().optional(),
    documentId: z
      .string()
      .min(1)
      .optional()
      .describe("For inspect, return this staged Cell as documentCode."),
    sourceDocumentId: z.string().min(1).optional(),
    targetDocumentId: z.string().min(1).optional(),
    mode: z.enum(["replace-body", "append"]).optional(),
    expectedStructureRevision: z.number().int().nonnegative().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, context) => {
    const required =
      value.action === "stage-project"
        ? (["path"] as const)
        : value.action === "stage-spice"
          ? (["rootPath", "entryPath"] as const)
          : value.action === "import-cell"
            ? ([
                "candidateId",
                "sourceDocumentId",
                "targetDocumentId",
                "mode",
              ] as const)
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
const VerifyArgs = DocumentArgs.extend({
  expectedNetlist: z
    .strictObject({
      text: z
        .string()
        .min(1)
        .max(2_200_000)
        .describe(
          "Structural SPICE reference, not a simulator deck. Comparison is read-only and optional.",
        ),
      cell: z
        .string()
        .min(1)
        .optional()
        .describe("Reference root Cell if more than one is present."),
      compare: z
        .strictObject({
          portOrder: z.boolean().optional(),
          parameters: z.boolean().optional(),
          bindings: z.boolean().optional(),
          declarations: z.boolean().optional(),
        })
        .optional()
        .describe(
          "Checks besides topology, each on unless false; topology is always compared.",
        ),
    })
    .optional(),
  details: z
    .boolean()
    .optional()
    .describe(
      "Include up to 200 endpoint/device differences; default returns counts and inconclusive reasons.",
    ),
});

const InspectArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  refresh: z
    .boolean()
    .optional()
    .describe(
      "Default: reuse clean Snapshot. True: reread after external edits or to reconcile.",
    ),
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
    z.strictObject({
      kind: z.literal("pins"),
      instanceIds: z.array(z.string().min(1)).min(1).max(64),
    }),
    z.strictObject({
      kind: z.literal("geometry"),
      objectIds: z.array(z.string().min(1)).min(1).max(64),
      textBounds: z
        .boolean()
        .optional()
        .describe(
          "Also measure each annotation's drawn text: text.position (where its alignment end stands) and text.bounds",
        ),
    }),
    z.strictObject({ kind: z.literal("activity") }),
    z.strictObject({
      kind: z.literal("trace"),
      ...AgentSnapshotRequestSchema.shape.traceNet.unwrap().shape,
    }),
  ]),
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      "Document targets only: compact summary (default) or full Snapshot.",
    ),
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
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      "Default compact: counts, sampled warnings, all errors; full: all.",
    ),
  documentId: z.string().min(1).optional(),
  actions: z.array(AuthoringActionSchema).min(1).max(256),
});

const AdvancedTransactArgs = z.strictObject({
  detail: z.enum(["compact", "full"]).optional(),
  documentId: z.string().min(1).optional(),
  edits: z
    .array(z.unknown())
    .min(1)
    .max(256)
    .optional()
    .describe(
      "Typed edits; exact fields: analog-canvas://contract/edits/{kind}.",
    ),
  structureEdits: z.array(z.unknown()).min(1).max(256).optional(),
  wireIntent: z
    .union([
      AgentWireIntentSchema,
      z.array(AgentWireIntentSchema).min(1).max(64),
    ])
    .optional(),
  semanticIntent: AgentSemanticIntentSchema.optional(),
  command: AgentAuthoringCommandSchema.optional(),
  dryRun: z
    .boolean()
    .optional()
    .describe("Validate/plan only; no commit or revision change."),
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
  definition: ContractTool;
  handle: (args: unknown, session: ToolSessionState) => Promise<unknown>;
}

export function operationError(error: unknown, input?: unknown): unknown {
  if (error instanceof ContractQueryError)
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        recovery: "fix-input",
      },
    };
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: {
        code: "INVALID_TOOL_INPUT",
        message: "Tool arguments do not match the input contract.",
        recovery: "fix-input",
        issues: inputIssues(error.issues, input),
        details: inputIssueDetails(error.issues, input),
      },
    };
  }
  if (error instanceof AgentSessionError) {
    return {
      ok: false,
      error: error.toJSON(),
      hint:
        error.category === "unrecoverable-credential"
          ? "call connect with a fresh claim code from the editor"
          : error.category === "editor-offline"
            ? "the authorized browser editor is not attached; ask the human to reopen the project"
            : undefined,
    };
  }
  return {
    ok: false,
    error: {
      code: "TOOL_FAILURE",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

const ORIGINAL_TOOLS: readonly ToolEntry[] = [
  {
    definition: {
      name: "describe_tool",
      description: agentToolHelp["describe_tool"],
      get inputSchema() {
        return lazyContract(DescribeToolArgs);
      },
    },
    handle: async (args) => {
      const query = DescribeToolArgs.parse(args);
      return query.editKind
        ? {
            contractVersion: AGENT_MCP_VERSION,
            editKind: query.editKind,
            inputSchema: editContract(query.editKind),
          }
        : describeToolContract(query);
    },
  },
  {
    definition: {
      name: "connect",
      description: agentToolHelp["connect"],
      get inputSchema() {
        return lazyContract(ConnectArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = ConnectArgs.parse(args ?? {});
      const report = await session.client.connect(parsed.claimCode);
      const unsupportedEditKinds = report.capabilities.editKinds.filter(
        (kind) => {
          if (kind === "wire") return false;
          try {
            editContract(kind);
            return false;
          } catch (error) {
            if (
              error instanceof ContractQueryError &&
              error.code === "UNKNOWN_EDIT_CONTRACT"
            )
              return true;
            throw error;
          }
        },
      );
      return {
        ok: true,
        mode: report.mode,
        projectId: report.projectId,
        documentIds: report.documentIds,
        tokenExpiresAt: report.tokenExpiresAt,
        capabilities: report.capabilities,
        compatibility: {
          adapterVersion: AGENT_MCP_VERSION,
          status: unsupportedEditKinds.length ? "partial" : "compatible",
          unsupportedEditKinds,
          ...(unsupportedEditKinds.length
            ? {
                message:
                  "The Editor advertises edits absent from this adapter. Upgrade using this origin's /api/agent/mcp-manifest.json before using those edits; supported operations remain available.",
              }
            : {}),
        },
        context: report.context,
        timing: report.timing,
      };
    },
  },
  {
    definition: {
      name: "disconnect",
      description: agentToolHelp["disconnect"],
      get inputSchema() {
        return lazyContract(z.strictObject({}));
      },
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
      get inputSchema() {
        return lazyContract(
          z.strictObject({ refresh: z.boolean().optional() }),
        );
      },
    },
    handle: async (args, session) => {
      const { refresh = true } = z
        .strictObject({ refresh: z.boolean().optional() })
        .parse(args);
      // This process's last requests, hop by hop, before the status read.
      const recent = session.client
        .timingsSince(Math.max(0, session.client.timingMark() - 5))
        .map(({ startedAtMs: _startedAtMs, ...request }) => request);
      return {
        ...(await session.client.status({ refresh })),
        runtime: {
          version: AGENT_MCP_VERSION,
          apiBaseUrl: session.client.apiBaseUrl,
        },
        ...(recent.length ? { recentRequests: recent } : {}),
      };
    },
  },
  {
    definition: {
      name: "project_cells",
      description: agentToolHelp["project_cells"],
      get inputSchema() {
        return lazyContract(ProjectCellsArgs, true);
      },
    },
    handle: async (args, session) => {
      const parsed = ProjectCellsArgs.parse(args);
      if (parsed.action === "bind-workspace")
        return session.client.bindWorkspace(parsed.workspaceId);
      if (parsed.action === "workspace")
        return session.client.projectResource({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          operation: "workspace",
          request: parsed.request,
        });
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
      get inputSchema() {
        return lazyContract(GalleryCircuitsArgs, true);
      },
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
      if (parsed.action === "open")
        return openGalleryEntry(
          session.client,
          parsed.galleryEntryId,
          parsed.background === true,
        );
      if (parsed.action === "publish" || parsed.action === "update") {
        const { action, ...fields } = parsed;
        return session.client.projectResource({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          ...(action === "publish"
            ? { operation: "publish-gallery-entry", ...fields }
            : { operation: "update-gallery-entry", ...fields }),
        });
      }
      if (parsed.action === "insert") {
        const current =
          parsed.expectedRevision === undefined ||
          parsed.expectedStructureRevision === undefined
            ? (
                await session.client.snapshot(parsed.targetDocumentId, {
                  refresh: true,
                })
              ).snapshot
            : null;
        return session.client.projectResource({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          operation: "insert-gallery-entry",
          galleryEntryId: parsed.galleryEntryId,
          ...(parsed.sourceDocumentId
            ? { sourceDocumentId: parsed.sourceDocumentId }
            : {}),
          targetDocumentId: parsed.targetDocumentId,
          position: parsed.position,
          expectedRevision:
            parsed.expectedRevision ?? current!.document.revision,
          expectedStructureRevision:
            parsed.expectedStructureRevision ??
            current!.project.structureRevision,
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
            ...(parsed.render ? { render: parsed.render } : {}),
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
      get inputSchema() {
        return lazyContract(ProjectCodeArgs, true);
      },
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
      get inputSchema() {
        return lazyContract(NetlistCodeArgs, true);
      },
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
          ...((parsed.documentId ?? parsed.rootDocumentId)
            ? { documentId: parsed.documentId ?? parsed.rootDocumentId }
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
        ...((parsed.documentId ?? parsed.rootDocumentId)
          ? { documentId: parsed.documentId ?? parsed.rootDocumentId }
          : {}),
      });
    },
  },
  {
    definition: {
      name: "simulation",
      description: agentToolHelp["simulation"],
      get inputSchema() {
        return lazyContract(SimulationArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = SimulationArgs.parse(args);
      const { request, requestId, waitMs = 0, detail = "summary" } = parsed;
      const effectiveRequestId = requestId ?? crypto.randomUUID();
      let runId = "runId" in request ? request.runId : undefined;
      let waiting = false;
      try {
        const waitStarted = Date.now();
        const response = await session.client.simulationResource({
          ...request,
          ...(request.operation === "capabilities"
            ? { detail: request.detail ?? "summary" }
            : {}),
          ...(waitMs > 0 && ["run", "start", "read"].includes(request.operation)
            ? { waitMs }
            : {}),
          apiVersion: AGENT_API_VERSION,
          requestId: effectiveRequestId,
        });
        if (response.ok && "run" in response) runId = response.run.id;
        waiting = waitMs > 0 && response.ok && "run" in response;
        const remainingWaitMs = Math.max(
          0,
          waitMs - (Date.now() - waitStarted),
        );
        const result = remainingWaitMs
          ? await waitForSimulation(session.client, response, remainingWaitMs)
          : response;
        if (detail === "summary" && result.ok && "prepared" in result) {
          return { ...result, prepared: preparedSummary(result.prepared) };
        }
        if (detail === "summary" && result.ok && "batch" in result) {
          return {
            ...result,
            batch: {
              ...result.batch,
              items: result.batch.items.map((item) => ({
                ...item,
                prepared: preparedSummary(item.prepared),
              })),
            },
          };
        }
        if (
          detail === "summary" &&
          result.ok &&
          "run" in result &&
          result.run.details?.collection === "complete"
        ) {
          const { artifacts, catalog: _catalog, ...run } = result.run;
          return {
            ...result,
            runId,
            run: {
              ...run,
              projection: "summary",
              artifactCount: artifacts.length,
              fileMetadata: { operation: "catalog", runId: run.id },
            },
          };
        }
        return { ...result, ...(runId ? { runId } : {}) };
      } catch (error) {
        if (!(error instanceof AgentSessionError)) throw error;
        return {
          ok: false,
          requestId: effectiveRequestId,
          ...(runId ? { runId } : {}),
          ...(waiting && runId
            ? { nextRequest: { operation: "read", runId } }
            : {}),
          error: {
            code: error.code,
            message: error.message,
            stage: waiting ? "read" : request.operation,
            ...(error.httpStatus === undefined
              ? {}
              : { httpStatus: error.httpStatus }),
            recovery:
              error.category === "unrecoverable-credential"
                ? "reauthorize"
                : waiting
                  ? "read-run"
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
      get inputSchema() {
        return lazyContract(SimulationFilesArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = SimulationFilesArgs.parse(args);
      const { request, requestId, outputPath, basePath, detail, refresh } =
        parsed;
      if (request.action === "workspace") {
        // status() is a cached local observation, not a network lease refresh.
        const status = await session.client.status();
        if (status.sessionId && status.projectId) {
          try {
            return (await localWorkspace(session, basePath)).describe();
          } catch (error) {
            // Explicit old indexes are still inspectable, never writable or
            // silently attached to an identity they did not record.
            if (
              !basePath ||
              !(error instanceof Error) ||
              error.message !== "WORKSPACE_LEGACY_INDEX_READ_ONLY"
            )
              throw error;
            const legacy = await LocalWorkspace.inspect(basePath);
            if (legacy.projectIdentity !== null) throw error;
            return { ...legacy, legacyReadOnly: true };
          }
        }
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
      if (request.action === "sync" || request.action === "prepare-plot") {
        const response = await session.client.simulationMetadataResource(
          {
            apiVersion: AGENT_API_VERSION,
            requestId: requestId ?? crypto.randomUUID(),
            operation: "catalog",
            runId: request.runId,
          },
          { refresh },
        );
        if (!response.ok || !("catalog" in response)) return response;
        const workspace = await localWorkspace(session, basePath);
        if (request.action === "prepare-plot")
          return preparePlot(
            workspace,
            response.catalog,
            request,
            workspaceTransfer(session.client),
          );
        const result = await workspace.sync(
          response.catalog,
          workspaceTransfer(session.client),
          request.fileIds,
          { analysisIndex: request.analysisIndex, roles: request.roles },
        );
        if (detail === "full") return result;
        return workspaceSyncReceipt(result);
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
      if (
        request.action === "update" &&
        response.result.ok &&
        "source" in response.result
      ) {
        // The editor's receipt is a strict published schema, so the client
        // checks what it saved, with the parser a run uses (#1398): a file
        // written whole from the request, a file an edit changed read back
        // once. A warning, not a refusal: the file is saved and the run
        // proceeds.
        const saved = new Map(
          request.writes.map(({ path, text }) => [path, text]),
        );
        for (const file of response.result.update?.files ?? []) {
          if (file.action === "removed" || saved.has(file.path)) continue;
          const text = await savedSourceText(
            session,
            request.owner,
            file.path,
            file.textDigest,
          );
          if (text !== undefined) saved.set(file.path, text);
        }
        const specWarnings = [...saved].flatMap(([path, text]) =>
          simulationSpecAnnotationDiagnostics(path, text).map(
            ({ sourceRef, message }) => ({
              path,
              line: sourceRef.start.line,
              message,
            }),
          ),
        );
        if (specWarnings.length) return { ...response.result, specWarnings };
      }
      return response.result;
    },
  },
  {
    definition: {
      name: "export_file",
      description: agentToolHelp["export_file"],
      get inputSchema() {
        return lazyContract(ExportFileArgs);
      },
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
      get inputSchema() {
        return lazyContract(ImportFileArgs);
      },
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
            : parsed.action === "import-cell"
              ? {
                  action: parsed.action,
                  candidateId: parsed.candidateId!,
                  sourceDocumentId: parsed.sourceDocumentId!,
                  targetDocumentId: parsed.targetDocumentId!,
                  mode: parsed.mode!,
                  ...(parsed.expectedStructureRevision === undefined
                    ? {}
                    : {
                        expectedStructureRevision:
                          parsed.expectedStructureRevision,
                      }),
                  ...(parsed.expectedRevision === undefined
                    ? {}
                    : { expectedRevision: parsed.expectedRevision }),
                }
              : {
                  action: parsed.action,
                  candidateId: parsed.candidateId!,
                  ...(parsed.documentId
                    ? { documentId: parsed.documentId }
                    : {}),
                  ...(parsed.background === undefined
                    ? {}
                    : { background: parsed.background }),
                },
      );
    },
  },
  {
    definition: {
      name: "get_context",
      description: agentToolHelp["get_context"],
      get inputSchema() {
        return lazyContract(DocumentArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = DocumentArgs.parse(args ?? {});
      const state = await session.client.documentState(parsed.documentId, {
        refresh: parsed.refresh ?? false,
      });
      return {
        projectId: state.projectId,
        documentId: state.documentId,
        documentName: state.documentName,
        revision: state.revision,
        instanceCount: state.instanceCount,
        netCount: state.netCount,
        errors: state.counts.errors,
        warnings: state.counts.warnings,
        connection: session.client.connection.snapshot.state,
        fetchedAt: Date.now(),
      };
    },
  },
  {
    definition: {
      name: "inspect",
      description: agentToolHelp["inspect"],
      get inputSchema() {
        return lazyContract(InspectArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = InspectArgs.parse(args);
      if (parsed.target.kind === "activity") {
        // The relay's record spans every process of the session; this
        // process's receipts add the edits it made itself.
        const relay = await session.client
          .relayActivity()
          .then((operations) => ({ operations }))
          .catch((error: unknown) => ({
            unavailable: error instanceof Error ? error.message : "unknown",
          }));
        return {
          session: relay,
          transactions: session.client.recentTransactions(),
          scope: "current-mcp-process",
        };
      }
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
      if (parsed.target.kind === "pins")
        return session.client.pinsSnapshot(
          parsed.target.instanceIds,
          parsed.documentId,
        );
      if (parsed.target.kind === "geometry")
        return session.client.geometrySnapshot(
          parsed.target.objectIds,
          parsed.documentId,
          parsed.target.textBounds ? { textBounds: true } : {},
        );
      if (parsed.target.kind === "diagnostics") {
        const state = await session.client.documentState(parsed.documentId, {
          refresh: parsed.refresh ?? false,
          diagnostics: "items",
        });
        return {
          revision: state.revision,
          counts: state.counts,
          items: state.diagnostics ?? [],
        };
      }
      const entry = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? false,
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
      }
    },
  },
  {
    definition: {
      name: "search",
      description: agentToolHelp["search"],
      get inputSchema() {
        return lazyContract(SearchArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = SearchArgs.parse(args);
      const entry = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? false,
      });
      const limit = parsed.limit ?? 20;
      const entries = [entry];
      if (parsed.scope === "project") {
        const allowed = new Set((await session.client.status()).documentIds);
        const otherDocuments = entry.snapshot.project.documents.filter(
          (document) =>
            document.id !== entry.documentId && allowed.has(document.id),
        );
        entries.push(
          ...(await Promise.all(
            otherDocuments.map((document) =>
              session.client.snapshot(document.id, {
                refresh: parsed.refresh ?? false,
              }),
            ),
          )),
        );
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
      get inputSchema() {
        return lazyContract(ApplyActionsArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = ApplyActionsArgs.parse(args);
      const report = await session.client.applyActions(parsed.actions, {
        diagnosticDeltaDetail: parsed.detail ?? "compact",
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
      });
      return parsed.detail === "full" ? report : compactActionReport(report);
    },
  },
  {
    definition: {
      name: "advanced_transact",
      description: agentToolHelp["advanced_transact"],
      get inputSchema() {
        return lazyContract(AdvancedTransactArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = AdvancedTransactArgs.parse(args);
      const {
        documentId: _documentId,
        dryRun: _dryRun,
        detail: _detail,
        ...payload
      } = parsed;
      const report = await session.client.advancedTransact(payload, {
        diagnosticDeltaDetail: parsed.detail ?? "compact",
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
        ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
      });
      return parsed.detail === "full" ? report : compactActionReport(report);
    },
  },
  {
    definition: {
      name: "verify",
      description: agentToolHelp["verify"],
      get inputSchema() {
        return lazyContract(VerifyArgs);
      },
    },
    handle: async (args, session) => {
      const client = session.client;
      const parsed = VerifyArgs.parse(args ?? {});
      const documentId = parsed.documentId;
      const before = client.cachedSnapshot(documentId);
      const fresh = await client.refreshSnapshot(documentId);
      const changed =
        before && before.documentId === fresh.documentId
          ? changedObjectIds(before.snapshot, fresh.snapshot)
          : [];
      const counts = diagnosticsCompact(fresh).counts;
      const { information, omitted } = verifyInformation(fresh);
      return {
        revision: fresh.revision,
        ...counts,
        ...(information.length ? { information } : {}),
        ...(omitted ? { informationOmitted: omitted } : {}),
        changedObjectIds: changed,
        ...(parsed.expectedNetlist
          ? {
              comparison: await compareExpectedNetlist(
                client,
                fresh.documentId,
                parsed.expectedNetlist,
                parsed.details,
              ),
            }
          : {}),
      };
    },
  },
  {
    definition: {
      name: "render",
      description: agentToolHelp["render"],
      get inputSchema() {
        return lazyContract(RenderArgs);
      },
    },
    handle: async (args, session) => {
      const parsed = RenderArgs.parse(args);
      const response = await session.client.render({
        ...(parsed.mode ? { mode: parsed.mode } : {}),
        ...(parsed.bounds ? { bounds: parsed.bounds } : {}),
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
      });
      return response;
    },
  },
];

const TOOLS: readonly ToolEntry[] = [
  ...ORIGINAL_TOOLS,
  ...focusedTools(ORIGINAL_TOOLS, (name) => agentToolHelp[name]),
];

export function operationDefinitions(): ContractTool[] {
  return TOOLS.map(({ definition }) => structuredClone(definition));
}

let contractRegistry: ToolContractRegistry | undefined;
export function describeToolContract(query: {
  tool?: string | undefined;
  operations?: string[] | undefined;
  field?: string | undefined;
}) {
  DescribeToolArgs.parse(query);
  contractRegistry ??= new ToolContractRegistry(
    TOOLS.map((t) => t.definition),
    AGENT_MCP_VERSION,
  );
  return contractRegistry.describe(query);
}

/** On-demand complete input contract; dispatch still parses the original schema. */
export function toolInputSchema(
  name: string,
): Record<string, unknown> | undefined {
  const schema = TOOLS.find((tool) => tool.definition.name === name)?.definition
    .inputSchema;
  if (!schema) return undefined;
  const compact = compactSchema(schema);
  return JSON.stringify(compact).length < JSON.stringify(schema).length
    ? compact
    : schema;
}

/** Marker for a tool that completed with a structured failure payload. */
export class ToolFailure {
  constructor(readonly value: unknown) {}
}

/** One execution boundary for both adapters. Results contain no protocol blocks. */
export async function executeOperation(
  name: string,
  args: unknown,
  session: OperationSession,
  options: { reportStartup?: boolean } = {},
): Promise<unknown> {
  const tool = TOOLS.find((entry) => entry.definition.name === name);
  if (!tool)
    return { ok: false, error: { code: "UNKNOWN_TOOL", message: name } };
  const started = performance.now();
  // A session without a network client (offline discovery) has no hops.
  const mark = session.client?.timingMark?.();
  let result: unknown;
  let input: unknown = args ?? {};
  try {
    const source =
      FOCUSED_TOOLS.find((tool) => tool.name === name)?.source ?? name;
    if (source === "simulation" || source === "simulation_files")
      input = simulationArguments(
        input,
        source === "simulation" ? simulationEnvelopeFields : fileEnvelopeFields,
        source === "simulation" ? "operation" : "action",
      );
    result = await tool.handle(input, session);
  } catch (error) {
    result = operationError(error, input);
  }
  return withTiming(
    result,
    performance.now() - started,
    mark === undefined ? [] : session.client.timingsSince(mark),
    options.reportStartup === true,
    name,
  );
}

/** Legacy relay segment threshold; it includes completion, not only editor work. */
const SLOW_EDITOR_MS = 5000;

/**
 * Where a call's time went (#1227): the whole call, each request hop by hop
 * (relay forward, editor work and its tab's visibility), and for a one-shot
 * CLI process its startup before the first request, which a CPU-starved
 * host stretches. Visibility is an observation; latency warnings remain
 * neutral until the phase measurements identify a cause.
 */
export function withTiming(
  result: unknown,
  totalMs: number,
  requests: readonly AgentRequestTiming[],
  reportStartup: boolean,
  operation?: string,
): unknown {
  if (
    !requests.length ||
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result)
  )
    return result;
  const hidden = requests.some(
    (request) => request.editorVisibility === "hidden",
  );
  const slowest = Math.max(...requests.map((request) => request.relayMs ?? 0));
  return {
    ...result,
    timing: {
      totalMs: Math.round(totalMs),
      ...(operation ? { operation } : {}),
      ...(reportStartup && requests.length
        ? { startupMs: requests[0]!.startedAtMs }
        : {}),
      ...(requests.length > 8
        ? {
            requestCount: requests.length,
            requestsOmitted: requests.length - 8,
          }
        : {}),
      requests: requests
        .slice(-8)
        .map(({ startedAtMs: _startedAtMs, ...request }) => request),
      ...(hidden || slowest > SLOW_EDITOR_MS
        ? {
            warning: {
              code:
                slowest > SLOW_EDITOR_MS ? "SLOW_RELAY" : "EDITOR_BACKGROUND",
              message:
                slowest > SLOW_EDITOR_MS
                  ? `Relay forwarding and completion took ${Math.round(slowest / 1000)} s; inspect the phase timings to locate the delay. Tab visibility alone does not establish its cause.`
                  : "The Analog Canvas tab reported hidden while answering. This is a visibility observation, not a latency diagnosis.",
            },
          }
        : {}),
    },
  };
}
