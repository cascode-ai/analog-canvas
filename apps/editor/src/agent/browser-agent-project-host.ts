import {
  AGENT_API_VERSION,
  type AgentGalleryEntryRead,
  type AgentGalleryEntrySummary,
  type AgentNetlistRead,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type {
  ProjectStructureEdit,
  ProjectTransactionResult,
} from "@icm/edit-engine";
import { planProjectCellImport } from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";

import {
  listCloudProjects,
  type CloudProjectListOutcome,
} from "../features/editor-shell/cloud-projects";
import {
  loadCloudProjectForCellImport,
  type CloudCellImportLoadResult,
} from "../features/hierarchy/cloud-cell-import";
import { loadGalleryFeed } from "../gallery-client";
import {
  formatProjectCode,
  planProjectCodeCommit,
} from "../features/project-code/project-code";
import { planNetlistCodeEdit } from "../features/netlist-export/netlist-code-edit";

export interface BrowserAgentProjectHostOptions {
  workspace?: (
    request: Extract<AgentProjectResourceRequest, { operation: "workspace" }>,
  ) => Promise<AgentProjectResourceResponse>;
  getProjectSessionId: () => string;
  getProject: () => CircuitProject;
  getActiveDocumentId: () => string;
  commitProjectStructure: (
    project: CircuitProject,
    activeDocumentId: string,
  ) => void;
  fetch?: typeof fetch;
  listProjects?: () => Promise<CloudProjectListOutcome>;
  loadProject?: (cloudProjectId: string) => Promise<CloudCellImportLoadResult>;
  dispatchProjectTransaction: (request: {
    transactionId: string;
    projectId: string;
    expectedStructureRevision: number;
    actor: { kind: "agent"; id: string };
    edits: ProjectStructureEdit[];
  }) => ProjectTransactionResult;
}

/** Browser authority for the signed-in Cloud Project shelf and live Project. */
export class BrowserAgentProjectHost {
  private readonly boundProjectSessionId: string;

  constructor(private readonly options: BrowserAgentProjectHostOptions) {
    this.boundProjectSessionId = options.getProjectSessionId();
  }

  async handle(
    request: AgentProjectResourceRequest,
  ): Promise<AgentProjectResourceResponse> {
    if (request.operation === "workspace") {
      return this.options.workspace
        ? this.options.workspace(request)
        : this.error(
            request,
            "WORKSPACE_UNAVAILABLE",
            "Open the Editor to access its workspace",
            "retry",
          );
    }
    if (this.options.getProjectSessionId() !== this.boundProjectSessionId) {
      return this.error(
        request,
        "PROJECT_REPLACED",
        "The Agent session is bound to a Project that has been replaced",
        "refresh",
      );
    }
    if (request.operation === "list-gallery") {
      const page = await loadGalleryFeed(this.options.fetch ?? fetch, {
        ...(request.cursor ? { cursor: request.cursor } : {}),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      if (!page) {
        return this.error(
          request,
          "GALLERY_UNAVAILABLE",
          "The public Gallery could not be read",
          "retry",
        );
      }
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        entries: page.entries.map((entry) => this.gallerySummary(entry)),
        nextCursor: page.nextCursor,
        total: page.total,
      };
    }
    if (request.operation === "read-gallery-entry") {
      return this.readGalleryEntry(request);
    }
    if (request.operation === "read-gallery-entries") {
      return this.readGalleryEntries(request);
    }
    if (request.operation === "read-project-code") {
      const project = this.options.getProject();
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        projectCode: formatProjectCode(project),
        structureRevision: project.structureRevision,
      };
    }
    if (request.operation === "replace-project-code") {
      const current = this.options.getProject();
      if (current.structureRevision !== request.expectedStructureRevision) {
        return this.stale(request, current.structureRevision);
      }
      const plan = planProjectCodeCommit(
        current,
        request.projectCode,
        this.options.getActiveDocumentId(),
      );
      if (!plan.ok) {
        return this.error(
          request,
          "PROJECT_CODE_INVALID",
          plan.message,
          "fix-input",
        );
      }
      if (plan.changed) {
        try {
          this.options.commitProjectStructure(
            plan.project,
            plan.activeDocumentId,
          );
        } catch (error) {
          return this.error(
            request,
            "PROJECT_CODE_COMMIT_FAILED",
            error instanceof Error ? error.message : String(error),
            "refresh",
          );
        }
      }
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        applied: plan.changed,
        structureRevision: this.options.getProject().structureRevision,
        activeDocumentId: plan.activeDocumentId,
      };
    }
    if (request.operation === "read-netlist") {
      const project = this.options.getProject();
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        structureRevision: project.structureRevision,
        netlist: this.readNetlist(project, request),
      };
    }
    if (request.operation === "replace-netlist") {
      return this.replaceNetlist(request);
    }
    if (request.operation === "list-projects") {
      const listed = await (this.options.listProjects ?? listCloudProjects)();
      if (listed.status !== "listed") {
        return this.error(
          request,
          listed.status === "signed-out"
            ? "SIGN_IN_REQUIRED"
            : "CLOUD_UNAVAILABLE",
          listed.status === "signed-out"
            ? "Sign in to inspect Cloud Project Cells"
            : listed.message,
          listed.status === "signed-out" ? "sign-in" : "retry",
        );
      }
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        projects: listed.projects.map((project) => ({ ...project })),
      };
    }

    const loaded = await (
      this.options.loadProject ?? loadCloudProjectForCellImport
    )(request.cloudProjectId);
    if (!loaded.ok) {
      return this.error(
        request,
        "SOURCE_PROJECT_UNAVAILABLE",
        loaded.message,
        loaded.message.includes("Sign in") ? "sign-in" : "retry",
      );
    }
    if (request.operation === "list-cells") {
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        project: {
          id: request.cloudProjectId,
          name: loaded.project.name,
        },
        cells: loaded.project.documents.map((document) => ({
          documentId: document.id,
          name: document.name,
          netlistName: document.netlist?.name ?? null,
          formalPorts:
            document.netlist?.terminals.map(({ name, direction }) => ({
              name,
              direction,
            })) ?? [],
        })),
      };
    }

    const destination = this.options.getProject();
    if (destination.structureRevision !== request.expectedStructureRevision) {
      return this.error(
        request,
        "STALE_STRUCTURE_REVISION",
        `Expected Project structure revision ${request.expectedStructureRevision}, current revision is ${destination.structureRevision}`,
        "refresh",
      );
    }
    const plan = planProjectCellImport(
      destination,
      loaded.project,
      request.sourceDocumentId,
    );
    if (!plan.ok) {
      return this.error(request, plan.code, plan.message, "fix-input");
    }
    if (plan.status === "already-imported") {
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        status: plan.status,
        rootDocumentId: plan.rootDocumentId,
        importedDocumentIds: [...plan.importedDocumentIds],
        structureRevision: destination.structureRevision,
      };
    }
    const result = this.options.dispatchProjectTransaction({
      transactionId: `agent-import-cell-${request.requestId}`,
      projectId: destination.id,
      expectedStructureRevision: request.expectedStructureRevision,
      actor: { kind: "agent", id: "project-resource" },
      edits: [...plan.edits],
    });
    if (!result.ok) {
      return this.error(
        request,
        result.error.code,
        result.diagnostics[0]?.message ?? result.error.message,
        result.error.code.includes("STALE") ? "refresh" : "fix-input",
      );
    }
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      status: "imported",
      rootDocumentId: plan.rootDocumentId,
      importedDocumentIds: [...plan.importedDocumentIds],
      structureRevision: result.structureRevision,
    };
  }

  private async readGalleryEntry(
    request: Extract<
      AgentProjectResourceRequest,
      { operation: "read-gallery-entry" }
    >,
  ): Promise<AgentProjectResourceResponse> {
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        `/api/gallery/${encodeURIComponent(request.galleryEntryId)}`,
        { credentials: "same-origin" },
      );
    } catch {
      return this.error(
        request,
        "GALLERY_UNAVAILABLE",
        "The public Gallery entry could not be read",
        "retry",
      );
    }
    if (!response.ok) {
      return this.error(
        request,
        response.status === 404
          ? "GALLERY_ENTRY_NOT_FOUND"
          : "GALLERY_UNAVAILABLE",
        response.status === 404
          ? "The Gallery entry does not exist"
          : `The Gallery entry could not be read (${response.status})`,
        response.status === 404 ? "fix-input" : "retry",
      );
    }
    const payload = (await response.json()) as {
      entry?: Partial<AgentGalleryEntrySummary>;
      projectText?: unknown;
    };
    if (typeof payload.projectText !== "string") {
      return this.error(
        request,
        "GALLERY_ENTRY_INVALID",
        "The Gallery entry does not contain Project Code",
        "retry",
      );
    }
    let project: CircuitProject;
    try {
      project = parseProject(payload.projectText);
    } catch (error) {
      return this.error(
        request,
        "GALLERY_PROJECT_INVALID",
        error instanceof Error ? error.message : String(error),
        "retry",
      );
    }
    const entry = this.gallerySummary({
      id: request.galleryEntryId,
      name: project.name,
      author: "",
      description: "",
      createdAt: "",
      schemaVersion: project.schemaVersion,
      tags: [],
      ...payload.entry,
    });
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      entry,
      projectCode: payload.projectText,
      netlist:
        request.netlistFormat === null
          ? null
          : this.readNetlist(project, {
              format: request.netlistFormat ?? "spice",
              namingProfile: request.namingProfile,
              portCase: request.portCase,
            }),
    };
  }

  private async readGalleryEntries(
    request: Extract<
      AgentProjectResourceRequest,
      { operation: "read-gallery-entries" }
    >,
  ): Promise<AgentProjectResourceResponse> {
    const results = await Promise.all(
      request.galleryEntryIds.map((galleryEntryId, index) =>
        this.readGalleryEntry({
          apiVersion: AGENT_API_VERSION,
          requestId: `${request.requestId}-${index + 1}`,
          operation: "read-gallery-entry",
          galleryEntryId,
          ...(request.netlistFormat === undefined
            ? {}
            : { netlistFormat: request.netlistFormat }),
          ...(request.namingProfile
            ? { namingProfile: request.namingProfile }
            : {}),
          ...(request.portCase ? { portCase: request.portCase } : {}),
        }),
      ),
    );
    const entries: AgentGalleryEntryRead[] = [];
    let byteLength = 0;
    for (const [index, result] of results.entries()) {
      if (!result.ok) {
        return this.error(
          request,
          result.error.code,
          result.error.message,
          result.error.recovery,
        );
      }
      if (result.operation !== "read-gallery-entry") {
        return this.error(
          request,
          "GALLERY_ENTRY_INVALID",
          "The Gallery batch returned an unexpected result",
          "retry",
        );
      }
      const entry: AgentGalleryEntryRead = {
        entry: result.entry,
        projectCode: result.projectCode,
        netlist: result.netlist,
      };
      const entryBytes = new TextEncoder().encode(
        JSON.stringify(entry),
      ).byteLength;
      // Keep the relay envelope comfortably below its 6 MB ceiling. A single
      // large entry is still returned because the one-entry operation already
      // guarantees that same payload contract.
      if (entries.length > 0 && byteLength + entryBytes > 4_500_000) {
        return {
          apiVersion: AGENT_API_VERSION,
          requestId: request.requestId,
          operation: request.operation,
          ok: true,
          entries,
          remainingEntryIds: request.galleryEntryIds.slice(index),
        };
      }
      entries.push(entry);
      byteLength += entryBytes;
    }
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      entries,
      remainingEntryIds: [],
    };
  }

  private replaceNetlist(
    request: Extract<
      AgentProjectResourceRequest,
      { operation: "replace-netlist" }
    >,
  ): AgentProjectResourceResponse {
    const project = this.options.getProject();
    if (project.structureRevision !== request.expectedStructureRevision) {
      return this.stale(request, project.structureRevision);
    }
    const baseline = createDesignNetlistExport(project, {
      format: request.format ?? "spice",
      namingProfile: request.namingProfile ?? "native",
      portCase: request.portCase ?? "upper",
      includeLocations: true,
      ...(request.rootDocumentId
        ? { rootDocumentId: request.rootDocumentId }
        : {}),
    });
    if (baseline.status !== "ready") {
      return this.error(
        request,
        "NETLIST_BLOCKED",
        baseline.diagnostics[0]?.message ??
          "The current Project cannot generate an editable netlist",
        "fix-input",
      );
    }
    const plan = planNetlistCodeEdit(project, baseline, request.netlist);
    if (!plan.ok) {
      return this.error(
        request,
        "NETLIST_EDIT_INVALID",
        plan.message,
        "fix-input",
      );
    }
    if (!plan.edits.length) {
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        applied: false,
        structureRevision: project.structureRevision,
      };
    }
    const result = this.options.dispatchProjectTransaction({
      transactionId: `agent-replace-netlist-${request.requestId}`,
      projectId: project.id,
      expectedStructureRevision: request.expectedStructureRevision,
      actor: { kind: "agent", id: "project-resource" },
      edits: plan.edits,
    });
    if (!result.ok) {
      return this.error(
        request,
        result.error.code,
        result.diagnostics[0]?.message ?? result.error.message,
        result.error.code.includes("STALE") ? "refresh" : "fix-input",
      );
    }
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      applied: result.applied,
      structureRevision: result.structureRevision,
    };
  }

  private readNetlist(
    project: CircuitProject,
    options: {
      format?: "spice" | "spectre" | undefined;
      namingProfile?: "native" | "cadence-bang" | undefined;
      portCase?: "lower" | "upper" | undefined;
      rootDocumentId?: string | undefined;
    },
  ): AgentNetlistRead {
    const format = options.format ?? "spice";
    const result = createDesignNetlistExport(project, {
      format,
      namingProfile: options.namingProfile ?? "native",
      portCase: options.portCase ?? "upper",
      ...(options.rootDocumentId
        ? { rootDocumentId: options.rootDocumentId }
        : {}),
    });
    return {
      format,
      status: result.status,
      text: result.status === "ready" ? result.file.text : null,
      diagnostics: result.diagnostics.map(
        ({ severity, code, message, objectIds }) => ({
          severity,
          code,
          message,
          objectIds: [...objectIds],
        }),
      ),
    };
  }

  private gallerySummary(entry: {
    id: string;
    name: string;
    author: string;
    description: string;
    createdAt: string;
    schemaVersion: number;
    tags?: readonly string[] | undefined;
    netlistable?: boolean | undefined;
    likes?: number | undefined;
  }): AgentGalleryEntrySummary {
    return {
      id: entry.id,
      name: entry.name,
      author: entry.author,
      description: entry.description,
      createdAt: entry.createdAt,
      schemaVersion: entry.schemaVersion,
      tags: [...(entry.tags ?? [])],
      ...(entry.netlistable === undefined
        ? {}
        : { netlistable: entry.netlistable }),
      ...(entry.likes === undefined ? {} : { likes: entry.likes }),
    };
  }

  private stale(
    request: AgentProjectResourceRequest,
    currentRevision: number,
  ): AgentProjectResourceResponse {
    return this.error(
      request,
      "STALE_STRUCTURE_REVISION",
      `Expected Project structure revision ${"expectedStructureRevision" in request ? request.expectedStructureRevision : "unknown"}, current revision is ${currentRevision}`,
      "refresh",
    );
  }

  private error(
    request: AgentProjectResourceRequest,
    code: string,
    message: string,
    recovery: "sign-in" | "refresh" | "fix-input" | "retry",
  ): AgentProjectResourceResponse {
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: false,
      error: { code, message, recovery },
    };
  }
}
