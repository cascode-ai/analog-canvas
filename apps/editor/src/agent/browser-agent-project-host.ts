import {
  AGENT_API_VERSION,
  base64EncodeBytes,
  type AgentGalleryEntryRead,
  type AgentGalleryFigure,
  type AgentGalleryEntrySummary,
  type AgentNetlistCellRead,
  type AgentNetlistRead,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type {
  ProjectStructureEdit,
  ProjectTransactionResult,
  ProjectTransactionOptions,
} from "@icm/edit-engine";
import { planProjectCellImport } from "@icm/edit-engine";
import { createBrowserFormalExportSource } from "@icm/exporters";
import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import {
  listCloudProjects,
  type CloudProjectListOutcome,
} from "../features/editor-shell/cloud-projects";
import {
  loadCloudProjectForCellImport,
  type CloudCellImportLoadResult,
} from "../features/hierarchy/cloud-cell-import";
import { GALLERY_SIGN_IN_REQUIRED, loadGalleryFeed } from "../gallery-client";
import { planNetlistCodeEdit } from "../features/netlist-export/netlist-code-edit";
import { importChunk } from "../components/chunk-import";
import { prepareDocumentFormulaArtifacts } from "../features/text-editing/formula-artifacts";
import { captureGalleryDrawing } from "../features/editor-shell/gallery-import";
import {
  planProjectCopyPlacement,
  applyProjectCopyPlacement,
} from "../features/clipboard/project-copy";

/** Signed out, the Gallery answers nothing, the Agent included. */
const GALLERY_SIGN_IN_MESSAGE =
  "The Community Gallery is for signed-in members; sign in to the Editor first";

export interface BrowserAgentProjectHostOptions {
  projectTransactionOptions?: ProjectTransactionOptions;
  isProjectAvailable?: () => boolean;
  loadProjectCode?: () => Promise<
    typeof import("../features/project-code/project-code")
  >;
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
    let projectCode:
      typeof import("../features/project-code/project-code") | null = null;
    if (
      request.operation === "read-project-code" ||
      request.operation === "replace-project-code"
    ) {
      try {
        projectCode = await importChunk(
          "Project Code",
          this.options.loadProjectCode ??
            (() => import("../features/project-code/project-code")),
        );
      } catch {
        // importChunk retains the original cause in the browser console. A load
        // failure is not proof of a stale deployment, nor a failed code commit.
        return this.error(
          request,
          "PROJECT_FEATURE_LOAD_FAILED",
          "Project Code could not load; no edit was attempted. Check connectivity and save work before refreshing the Editor page. Repeating this tool call may not recover a stale page. The browser console contains the load cause; the Agent session remains usable.",
          "refresh",
        );
      }
    }
    // Load before checking session/revision, so a change during the deferred
    // import cannot apply an old request to a replacement Project.
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
      if (page === GALLERY_SIGN_IN_REQUIRED) {
        return this.error(
          request,
          "SIGN_IN_REQUIRED",
          GALLERY_SIGN_IN_MESSAGE,
          "sign-in",
        );
      }
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
    if (
      request.operation === "read-gallery-entry" ||
      request.operation === "insert-gallery-entry"
    ) {
      return this.handleGalleryEntry(request);
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
        projectCode: projectCode!.formatProjectCode(project),
        structureRevision: project.structureRevision,
      };
    }
    if (request.operation === "replace-project-code") {
      const current = this.options.getProject();
      if (current.structureRevision !== request.expectedStructureRevision) {
        return this.stale(request, current.structureRevision);
      }
      const plan = projectCode!.planProjectCodeCommit(
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
      const rootDocumentId = request.documentId ?? request.rootDocumentId;
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        structureRevision: project.structureRevision,
        netlist: this.readNetlist(project, {
          ...request,
          ...(rootDocumentId ? { rootDocumentId } : {}),
        }),
        cells: project.documents.map((document) =>
          this.readNetlistCell(project, document.id, request),
        ),
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

  private async handleGalleryEntry(
    request: Extract<
      AgentProjectResourceRequest,
      { operation: "read-gallery-entry" | "insert-gallery-entry" }
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
          : response.status === 401
            ? "SIGN_IN_REQUIRED"
            : "GALLERY_UNAVAILABLE",
        response.status === 404
          ? "The Gallery entry does not exist"
          : response.status === 401
            ? GALLERY_SIGN_IN_MESSAGE
            : `The Gallery entry could not be read (${response.status})`,
        response.status === 404
          ? "fix-input"
          : response.status === 401
            ? "sign-in"
            : "retry",
      );
    }
    let payload: {
      entry?: Partial<AgentGalleryEntrySummary>;
      projectText?: unknown;
    };
    try {
      payload = await response.json();
    } catch {
      return this.error(
        request,
        "GALLERY_ENTRY_INVALID",
        "The Gallery entry is not valid JSON",
        "fix-input",
      );
    }
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
    if (request.operation === "insert-gallery-entry") {
      return this.insertGalleryDrawing(request, project);
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
    let figure: AgentGalleryFigure | undefined;
    if (request.render) {
      try {
        figure = await this.galleryFigure(project, request.render);
      } catch (error) {
        return this.error(
          request,
          "GALLERY_RENDER_FAILED",
          error instanceof Error
            ? error.message
            : "The figure could not be drawn",
          "retry",
        );
      }
    }
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      entry,
      ...(figure ? { figure } : {}),
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

  private insertGalleryDrawing(
    request: Extract<
      AgentProjectResourceRequest,
      { operation: "insert-gallery-entry" }
    >,
    imported: CircuitProject,
  ): AgentProjectResourceResponse {
    // The Gallery download must not retarget a write to a replacement Project.
    if (
      this.options.isProjectAvailable?.() === false ||
      this.options.getProjectSessionId() !== this.boundProjectSessionId
    )
      return this.error(
        request,
        "PROJECT_REPLACED",
        "The target Project was replaced or closed while reading the Gallery",
        "refresh",
      );
    const before = this.options.getProject();
    const target = before.documents.find(
      (item) => item.id === request.targetDocumentId,
    );
    if (!target)
      return this.error(
        request,
        "TARGET_CELL_NOT_FOUND",
        "The target Cell no longer exists",
        "refresh",
      );
    if (
      before.structureRevision !== request.expectedStructureRevision ||
      target.revision !== request.expectedRevision
    )
      return this.error(
        request,
        "PROJECT_CONTEXT_STALE",
        "The target changed while reading the Gallery; inspect it and re-plan the insert",
        "refresh",
      );
    try {
      const drawing = captureGalleryDrawing(imported, request.sourceDocumentId);
      if (!drawing)
        return this.error(
          request,
          "COPY_EMPTY",
          "The Gallery Cell has no placeable drawing; nothing inserted",
          "fix-input",
        );
      const plan = planProjectCopyPlacement(
        before,
        target,
        drawing.clipboard,
        {
          x: request.position.x - drawing.anchor.x,
          y: request.position.y - drawing.anchor.y,
        },
        1,
      );
      const next = applyProjectCopyPlacement(
        plan,
        { kind: "agent", id: "gallery-insert" },
        this.options.projectTransactionOptions,
      );
      try {
        this.options.commitProjectStructure(
          next,
          this.options.getActiveDocumentId(),
        );
      } catch (error) {
        // A notification can fail after the controller has committed. Inspect
        // current state before deciding whether a new insert is necessary.
        return this.error(
          request,
          "GALLERY_INSERT_COMMIT_FAILED",
          `Insert commit could not be confirmed; refresh the target before retrying: ${error instanceof Error ? error.message : String(error)}`,
          "refresh",
        );
      }
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        galleryEntryId: request.galleryEntryId,
        sourceDocumentId: drawing.sourceDocumentId,
        targetDocumentId: target.id,
        structureRevision: next.structureRevision,
        revision: next.documents.find((item) => item.id === target.id)!
          .revision,
        instanceIds: [...plan.instanceIds],
        mapping: plan.mapping,
        importedDocumentIds: next.documents
          .filter((item) => !before.documents.some((old) => old.id === item.id))
          .map((item) => item.id),
        importedFileIds: next.source.files
          .filter(
            (item) => !before.source.files.some((old) => old.id === item.id),
          )
          .map((item) => item.id),
      };
    } catch (error) {
      return this.error(
        request,
        "GALLERY_INSERT_FAILED",
        error instanceof Error ? error.message : String(error),
        "fix-input",
      );
    }
  }

  /** The top Cell, drawn by the same formal exporter as a file export. */
  private async galleryFigure(
    project: CircuitProject,
    render: "svg" | "png",
  ): Promise<AgentGalleryFigure> {
    const document =
      project.documents.find((item) => item.id === project.topDocumentId) ??
      project.documents[0]!;
    const prepared = await prepareDocumentFormulaArtifacts(document);
    let source: Awaited<ReturnType<typeof createBrowserFormalExportSource>>;
    try {
      source = await createBrowserFormalExportSource(
        document,
        createProjectSymbolResolver(project, builtInSymbols),
        { title: project.name },
      );
    } finally {
      prepared.release();
    }
    const bytes =
      render === "svg"
        ? new TextEncoder().encode(source.svg)
        : (
            await (
              await importChunk(
                "PNG export",
                () => import("@icm/exporters/browser-raster"),
              )
            ).rasterizeFormalSvgInBrowser(source)
          ).bytes;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(bytes).buffer,
    );
    return {
      documentId: document.id,
      mediaType: render === "svg" ? "image/svg+xml" : "image/png",
      encoding: "base64",
      data: base64EncodeBytes(bytes),
      byteLength: bytes.byteLength,
      sha256: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
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
        this.handleGalleryEntry({
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
    const rootDocumentId = request.documentId ?? request.rootDocumentId;
    const baseline = createDesignNetlistExport(project, {
      format: request.format ?? "spice",
      namingProfile: request.namingProfile ?? "native",
      ...(request.portCase ? { portCase: request.portCase } : {}),
      includeLocations: true,
      ...(rootDocumentId ? { rootDocumentId } : {}),
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
      ...(options.portCase ? { portCase: options.portCase } : {}),
      ...(options.rootDocumentId
        ? { rootDocumentId: options.rootDocumentId }
        : {}),
    });
    return {
      documentId: options.rootDocumentId ?? project.topDocumentId,
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

  private readNetlistCell(
    project: CircuitProject,
    documentId: string,
    options: {
      format?: "spice" | "spectre" | undefined;
      namingProfile?: "native" | "cadence-bang" | undefined;
      portCase?: "lower" | "upper" | undefined;
    },
  ): AgentNetlistCellRead {
    const netlist = this.readNetlist(project, {
      ...options,
      rootDocumentId: documentId,
    });
    return { ...netlist, documentId };
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
