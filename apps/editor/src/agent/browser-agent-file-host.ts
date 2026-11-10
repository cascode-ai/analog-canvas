import {
  AGENT_API_VERSION,
  AGENT_FILE_CANDIDATE_TTL_MS,
  AGENT_FILE_RESOURCE_MAX_BYTES,
  base64DecodeBytes,
  base64EncodeBytes,
  localSourceIdentity,
  matchesAgentReviewTarget,
  type AgentFileCandidateSummary,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
  type AgentLocalProjectReceipt,
  type AgentLocalSource,
  type AgentReviewReceipt,
  type LocalReviewDelivery,
  type LocalReviewTarget,
} from "@icm/agent-adapter";
import {
  SimulationFiles,
  type ArtifactPublisher,
} from "@icm/simulation-service/files";
import type {
  ProjectTransaction,
  ProjectTransactionResult,
} from "@icm/edit-engine";
import { planProjectCellBodyImport } from "@icm/edit-engine";
import { createSimulationProjectFileHost } from "../features/simulation/project-file-host";
import { createBrowserFormalExportSource } from "@icm/exporters";
import { parseProject, serializeProject } from "@icm/project-protocol";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { RnlAppearance } from "@icm/rnl";
import { findBuiltInBodies } from "@icm/netlist";
import { importSpiceSources } from "@icm/spice";
import { withImportedInstanceDisplays } from "../features/instance-display/imported-instance-displays";
import type { SymbolResolver } from "@icm/symbols";
import { prepareDocumentFormulaArtifacts } from "../features/text-editing/formula-artifacts";
import { importChunk } from "../components/chunk-import";
import { simulationFileEngine } from "../features/simulation/file-engine";
import { createBrowserSimulationArtifactStore } from "../features/simulation/browser-simulation-artifact-store";

type StoredCandidate = {
  project: CircuitProject;
  summary: AgentFileCandidateSummary;
  rnlAppearance?: RnlAppearance;
};

export type OpenLocalProject = (request: {
  sourceVersion: string;
  background: boolean;
  rnlAppearance: RnlAppearance;
  taskRef?: string;
  candidate?: { project: CircuitProject; source: AgentLocalSource };
}) => Promise<AgentLocalProjectReceipt | "blocked" | null>;

export type AgentReviewWorkspace = Pick<
  AgentReviewReceipt,
  | "workspaceId"
  | "workspaceGeneration"
  | "sourceVersion"
  | "modified"
  | "recovered"
  | "unsaved"
>;

type LocalReviewEdit = {
  expected: LocalReviewTarget;
  projectRevision: string;
};
export type LocalReviewCommand =
  | { action: "read" }
  | Extract<
      Extract<AgentFileResourceRequest, { operation: "review" }>["input"],
      { action: "locate" }
    >
  | (LocalReviewEdit & {
      action:
        | "mark-ready"
        | "open-original"
        | "prepare-save"
        | "acknowledge-save"
        | "changes";
    });
export type LocalReviewResult =
  | LocalReviewDelivery
  | "REVIEW_WORKSPACE_REQUIRED"
  | "REVIEW_TARGET_CHANGED"
  | "REVIEW_OBJECT_UNAVAILABLE"
  | "REVIEW_NOT_READY"
  | "REVIEW_ORIGINAL_UNAVAILABLE"
  | "REVIEW_OPEN_BLOCKED";
export type LocalReviewHost = (
  command: LocalReviewCommand,
) => Promise<LocalReviewResult>;

export interface BrowserAgentFileHostOptions {
  openLocalProject?: OpenLocalProject;
  localReview?: LocalReviewHost;
  getReviewWorkspace?: () => AgentReviewWorkspace | undefined;
  getActiveDocumentId?: () => string;
  commitProjectStructure?: (
    project: CircuitProject,
    activeDocumentId: string,
  ) => void;
  loadProjectCode?: () => Promise<
    typeof import("../features/project-code/project-code")
  >;
  fetch?: typeof fetch;
  transport?: "direct" | "managed";
  getProjectSessionId: () => string;
  getProject: () => CircuitProject;
  getDocument: (documentId: string) => SchematicDocument | null;
  getResolver: () => SymbolResolver;
  onApprovalRequested: (candidate: AgentFileCandidateSummary) => void;
  openProjectInNewTab?: (
    project: CircuitProject,
    background?: boolean,
  ) => Promise<boolean>;
  /** What keeps the editor from opening another Project now, or null. */
  describeOpenBlocker?: () => string | null;
  dispatchProjectTransaction?: (
    request: ProjectTransaction,
  ) => ProjectTransactionResult;
}

/**
 * Browser-only endpoint for named File Resource requests. It owns short-lived
 * candidate bytes and parsed projects. Simulation downloads register immutable
 * byte replicas with the existing authorized relay storage.
 * A staged candidate has no authority to replace the live project by itself.
 */
export class BrowserAgentFileHost {
  readonly simulationFiles: SimulationFiles;
  private readonly candidates = new Map<string, StoredCandidate>();
  private readonly reviewSaves = new Map<
    string,
    LocalReviewEdit & { expiresAt: number }
  >();
  private readonly boundProjectSessionId: string;
  private readonly reviewGeneration = crypto.randomUUID();
  setArtifactPublisher(
    publisher: ArtifactPublisher,
    options?: { leasedDownloads?: boolean },
  ) {
    this.simulationFiles.setArtifactPublisher(publisher, options);
  }

  constructor(private readonly options: BrowserAgentFileHostOptions) {
    this.boundProjectSessionId = options.getProjectSessionId();
    this.simulationFiles = new SimulationFiles(
      Date.now,
      options.dispatchProjectTransaction
        ? createSimulationProjectFileHost({
            getProject: options.getProject,
            getProjectSessionId: options.getProjectSessionId,
            dispatch: options.dispatchProjectTransaction,
            actor: { kind: "agent", id: "simulation-file-resource" },
          })
        : undefined,
      simulationFileEngine(options),
      createBrowserSimulationArtifactStore(options.getProject().id, undefined, {
        retainSession: true,
      }),
    );
  }

  async handle(
    request: AgentFileResourceRequest,
  ): Promise<AgentFileResourceResponse> {
    if (this.options.getProjectSessionId() !== this.boundProjectSessionId) {
      return this.error(
        request,
        "PROJECT_REPLACED",
        "The Agent session is bound to a Project that has been replaced",
      );
    }
    this.removeExpired();
    switch (request.operation) {
      case "simulation-input":
        return {
          apiVersion: AGENT_API_VERSION,
          requestId: request.requestId,
          operation: request.operation,
          ok: true,
          result: await this.simulationFiles.handle(request.input),
        };
      case "download":
        return this.download(request);
      case "review":
        return this.reviewDelivery(request);
      case "stage":
        return this.stage(request);
      case "locate-local": {
        if (!this.options.openLocalProject)
          return this.error(
            request,
            "FILE_OPEN_UNAVAILABLE",
            "Local delivery needs a Canvas Web editor",
          );
        const delivery = await this.options.openLocalProject({
          sourceVersion: request.sourceVersion,
          background: request.background ?? false,
          rnlAppearance: request.rnlAppearance ?? "canvas",
          ...(request.taskRef ? { taskRef: request.taskRef } : {}),
        });
        if (delivery === "blocked") return this.openBlocked(request);
        return {
          apiVersion: AGENT_API_VERSION,
          requestId: request.requestId,
          operation: "locate-local",
          ok: true,
          delivery,
        };
      }
      case "import-cell":
        return this.importCell(request);
      case "inspect": {
        const candidate = this.candidates.get(request.candidateId);
        const document = request.documentId
          ? candidate?.project.documents.find(
              (d) => d.id === request.documentId,
            )
          : undefined;
        if (candidate && request.documentId && !document)
          return this.error(
            request,
            "DOCUMENT_NOT_FOUND",
            "Cell is not present in this staged candidate",
          );
        return candidate
          ? {
              apiVersion: AGENT_API_VERSION,
              requestId: request.requestId,
              operation: "inspect",
              ok: true,
              candidate: candidate.summary,
              ...(document ? { documentCode: JSON.stringify(document) } : {}),
            }
          : this.error(
              request,
              "FILE_CANDIDATE_NOT_FOUND",
              "Candidate is unavailable or expired",
            );
      }
      case "discard": {
        const existed = this.candidates.delete(request.candidateId);
        return existed
          ? {
              apiVersion: AGENT_API_VERSION,
              requestId: request.requestId,
              operation: "discard",
              ok: true,
              discarded: true,
            }
          : this.error(
              request,
              "FILE_CANDIDATE_NOT_FOUND",
              "Candidate is unavailable or expired",
            );
      }
      case "request-approval": {
        const candidate = this.candidates.get(request.candidateId);
        if (!candidate)
          return this.error(
            request,
            "FILE_CANDIDATE_NOT_FOUND",
            "Candidate is unavailable or expired",
          );
        this.options.onApprovalRequested(candidate.summary);
        return {
          apiVersion: AGENT_API_VERSION,
          requestId: request.requestId,
          operation: "request-approval",
          ok: true,
          candidate: candidate.summary,
          approval: "pending-human",
        };
      }
      case "open": {
        const candidate = this.candidates.get(request.candidateId);
        if (!candidate)
          return this.error(
            request,
            "FILE_CANDIDATE_NOT_FOUND",
            "Candidate is unavailable or expired",
          );
        if (candidate.summary.source) {
          if (!this.options.openLocalProject)
            return this.error(
              request,
              "FILE_OPEN_UNAVAILABLE",
              "Local delivery needs a Canvas Web editor",
            );
          const { source } = candidate.summary;
          const delivery = await this.options.openLocalProject({
            sourceVersion: source.version,
            background: request.background ?? false,
            rnlAppearance: candidate.rnlAppearance ?? "canvas",
            ...(request.taskRef ? { taskRef: request.taskRef } : {}),
            candidate: { project: candidate.project, source },
          });
          if (delivery === "blocked") return this.openBlocked(request);
          if (!delivery)
            return this.error(
              request,
              "FILE_LOAD_UNCONFIRMED",
              "The editor could not confirm the imported Project tab",
            );
          this.candidates.delete(request.candidateId);
          return {
            apiVersion: AGENT_API_VERSION,
            requestId: request.requestId,
            operation: "open",
            ok: true,
            delivery,
          };
        }
        if (!this.options.openProjectInNewTab)
          return this.error(
            request,
            "FILE_OPEN_UNAVAILABLE",
            "Opening a new Project tab is unavailable in this editor",
          );
        if (
          !(await this.options.openProjectInNewTab(
            candidate.project,
            request.background,
          ))
        )
          return this.openBlocked(request);
        this.candidates.delete(request.candidateId);
        return {
          apiVersion: AGENT_API_VERSION,
          requestId: request.requestId,
          operation: "open",
          ok: true,
        };
      }
    }
  }

  private openBlocked(
    request: AgentFileResourceRequest,
  ): AgentFileResourceResponse {
    return this.error(
      request,
      "FILE_OPEN_BLOCKED",
      `Can't open the imported Project yet: ${this.options.describeOpenBlocker?.() ?? "another Project operation is running"}`,
    );
  }

  /** Called only by a visible browser confirmation. */
  consumeApproved(candidateId: string): CircuitProject | null {
    this.removeExpired();
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return null;
    this.candidates.delete(candidateId);
    return candidate.project;
  }

  discard(candidateId: string): void {
    this.candidates.delete(candidateId);
  }

  clear(): void {
    this.simulationFiles.clear();
    this.candidates.clear();
  }

  private async importCell(
    request: Extract<AgentFileResourceRequest, { operation: "import-cell" }>,
  ): Promise<AgentFileResourceResponse> {
    if (!this.options.commitProjectStructure)
      return this.error(
        request,
        "FILE_IMPORT_UNAVAILABLE",
        "This Editor cannot commit a staged Cell",
      );
    let code: typeof import("../features/project-code/project-code");
    try {
      code = await importChunk(
        "Project Code",
        this.options.loadProjectCode ??
          (() => import("../features/project-code/project-code")),
      );
    } catch {
      return this.error(
        request,
        "PROJECT_FEATURE_LOAD_FAILED",
        "Project Code could not load; no edit was attempted. Check connectivity and save before refreshing the Editor.",
      );
    }
    // The lazy import may yield while the human replaces/edits the Project.
    if (this.options.getProjectSessionId() !== this.boundProjectSessionId)
      return this.error(
        request,
        "PROJECT_REPLACED",
        "The bound Project was replaced before Cell import",
      );
    this.removeExpired();
    const candidate = this.candidates.get(request.candidateId);
    if (!candidate)
      return this.error(
        request,
        "FILE_CANDIDATE_NOT_FOUND",
        "Candidate is unavailable or expired",
      );
    const current = this.options.getProject();
    if (current.structureRevision !== request.expectedStructureRevision)
      return this.error(
        request,
        "STALE_STRUCTURE_REVISION",
        "Project changed; inspect the target and submit a new request",
      );
    const target = current.documents.find(
      (d) => d.id === request.targetDocumentId,
    );
    if (!target)
      return this.error(
        request,
        "DOCUMENT_NOT_FOUND",
        "Target Cell is not present in this Project",
      );
    if (target.revision !== request.expectedRevision)
      return this.error(
        request,
        "STALE_REVISION",
        "Target Cell changed; inspect it and submit a new request",
      );
    try {
      const composed = planProjectCellBodyImport(
        current,
        candidate.project,
        request.sourceDocumentId,
        request.targetDocumentId,
        request.mode,
        request.candidateId,
      );
      const active =
        this.options.getActiveDocumentId?.() ?? current.topDocumentId;
      const planned = code.planProjectCodeCommit(
        current,
        code.formatProjectCode(composed.project),
        active,
      );
      if (!planned.ok)
        return this.error(request, "CELL_IMPORT_INVALID", planned.message);
      this.options.commitProjectStructure(
        planned.project,
        planned.activeDocumentId,
      );
      this.candidates.delete(request.candidateId);
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: "import-cell",
        ok: true,
        targetDocumentId: request.targetDocumentId,
        importedDocumentIds: composed.importedDocumentIds,
        structureRevision: planned.project.structureRevision,
        revision: planned.project.documents.find(
          (d) => d.id === request.targetDocumentId,
        )!.revision,
      };
    } catch (error) {
      return this.error(
        request,
        "CELL_IMPORT_REJECTED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async reviewDelivery(
    request: Extract<AgentFileResourceRequest, { operation: "review" }>,
  ): Promise<AgentFileResourceResponse> {
    const host = this.options.localReview;
    if (!host)
      return this.error(
        request,
        "REVIEW_WORKSPACE_REQUIRED",
        "Open the working copy in Canvas Web",
      );
    const { input } = request;
    const response = {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: "review" as const,
      ok: true as const,
    };
    if (input.action === "finish-save") {
      const save = this.reviewSaves.get(input.saveId);
      this.reviewSaves.delete(input.saveId);
      const delivered =
        save &&
        (await host({
          action: "acknowledge-save",
          expected: save.expected,
          projectRevision: save.projectRevision,
        }));
      return {
        ...response,
        result: {
          action: input.action,
          canvasSaved: Boolean(delivered && typeof delivered !== "string"),
        },
      };
    }
    const project = this.options.getProject();
    const delivery = await host(input);
    if (typeof delivery === "string") {
      const messages: Record<
        Exclude<LocalReviewResult, LocalReviewDelivery>,
        string
      > = {
        REVIEW_WORKSPACE_REQUIRED: "Activate the delivered working copy",
        REVIEW_TARGET_CHANGED: "The active Project or Cell revision changed",
        REVIEW_OBJECT_UNAVAILABLE:
          "The reviewed object or hierarchy path is no longer available",
        REVIEW_NOT_READY:
          "Confirm that the schematic is complete before delivery",
        REVIEW_ORIGINAL_UNAVAILABLE:
          "The first review-ready snapshot is unavailable",
        REVIEW_OPEN_BLOCKED: "Canvas is holding the current tab open",
      };
      return this.error(request, delivery, messages[delivery]);
    }
    if (input.action === "changes") {
      const { embeddedReviewBundle } = await import("./embedded-review-source");
      let source;
      if (input.reference) {
        const decoded = await this.decodeFiles(input.reference);
        if (!decoded.ok)
          return this.error(request, decoded.code, decoded.message);
        source = {
          entryPath: input.reference.entryPath,
          files: decoded.files.map(({ name, bytes }) => ({
            path: name,
            bytes,
          })),
          version: await sha256(
            new TextEncoder().encode(
              localSourceIdentity(
                input.reference.entryPath,
                input.reference.files,
              ),
            ),
          ),
        };
      } else {
        source = await embeddedReviewBundle(project.source);
        if (
          !source ||
          source.version !==
            (delivery.embeddedSource?.version ?? delivery.target.sourceVersion)
        )
          return this.error(
            request,
            "REVIEW_SOURCE_UNAVAILABLE",
            "The delivered original netlist and dependencies could not be verified",
          );
      }
      const { compareReviewSource } =
        await import("./review-source-comparison");
      const comparison = await compareReviewSource(
        project,
        delivery.target.documentId,
        source,
      );
      if (
        project !== this.options.getProject() ||
        typeof (await host(input)) === "string"
      )
        return this.error(
          request,
          "REVIEW_TARGET_CHANGED",
          "The active Project or Cell revision changed during comparison",
        );
      return {
        ...response,
        result: { action: input.action, delivery, comparison },
      };
    }
    if (input.action !== "prepare-save")
      return { ...response, result: { action: input.action, delivery } };
    if (
      project !== this.options.getProject() ||
      delivery.projectRevision !== input.projectRevision ||
      !matchesAgentReviewTarget(delivery.target, input.expected)
    )
      return this.error(
        request,
        "REVIEW_TARGET_CHANGED",
        "The active Project or Cell revision changed",
      );
    if (delivery.status !== "ready")
      return this.error(
        request,
        "REVIEW_NOT_READY",
        "Confirm that the schematic is complete before delivery",
      );
    const bytes = new TextEncoder().encode(serializeProject(project));
    if (bytes.byteLength > AGENT_FILE_RESOURCE_MAX_BYTES)
      return this.error(
        request,
        "FILE_TOO_LARGE",
        "Project exceeds the File Resource limit",
      );
    const artifact = await fileArtifact(
      "project.icproj.json",
      "application/json",
      bytes,
    );
    if (this.reviewSaves.size >= 16)
      return this.error(
        request,
        "REVIEW_SAVE_BUSY",
        "Pending review saves must finish or expire",
      );
    const saveId = crypto.randomUUID();
    this.reviewSaves.set(saveId, {
      expected: input.expected,
      projectRevision: input.projectRevision,
      expiresAt: Date.now() + AGENT_FILE_CANDIDATE_TTL_MS,
    });
    return {
      ...response,
      result: { action: input.action, delivery, saveId, artifact },
    };
  }

  private async download(
    request: Extract<AgentFileResourceRequest, { operation: "download" }>,
  ): Promise<AgentFileResourceResponse> {
    try {
      if (request.artifact === "simulation-plot") {
        return this.error(
          request,
          "SIMULATION_PLOT_RETIRED",
          "Built-in simulation plots are retired. Read raw/CSV artifacts through simulation_files and plot externally.",
        );
      }
      const project = this.options.getProject();
      if (request.artifact === "project") {
        const bytes = new TextEncoder().encode(serializeProject(project));
        return this.artifactResponse(
          request,
          "project.icproj.json",
          "application/json",
          bytes,
        );
      }
      const document = request.documentId
        ? this.options.getDocument(request.documentId)
        : null;
      if (!document)
        return this.error(
          request,
          request.expected ? "REVIEW_TARGET_CHANGED" : "DOCUMENT_NOT_FOUND",
          "Document is not present in this Project",
        );
      const wantsReview =
        request.includeReview || request.expected || request.bounds;
      const workspace = wantsReview
        ? this.options.getReviewWorkspace?.()
        : undefined;
      const review: AgentReviewReceipt | undefined = wantsReview
        ? {
            ...workspace,
            workspaceGeneration:
              workspace?.workspaceGeneration ?? this.reviewGeneration,
            projectId: project.id,
            structureRevision: project.structureRevision,
            documentId: document.id,
            revision: document.revision,
            sourceStatus: document.sourceStatus,
            unplacedInstances: document.instances.filter(
              (item) => !item.placement,
            ).length,
            ...(request.bounds ? { bounds: request.bounds } : {}),
          }
        : undefined;
      if (
        request.expected &&
        (!review || !matchesAgentReviewTarget(review, request.expected))
      )
        return this.error(
          request,
          "REVIEW_TARGET_CHANGED",
          "The Canvas no longer shows the requested revision. Read the live Project before taking a new image.",
        );
      const resolver = this.options.getResolver();
      const prepared = await prepareDocumentFormulaArtifacts(document);
      const source = await (async () => {
        try {
          return await createBrowserFormalExportSource(document, resolver, {
            title: project.name,
            ...(request.bounds ? { bounds: request.bounds } : {}),
          });
        } finally {
          prepared.release();
        }
      })();
      let artifact: { name: string; mediaType: string; bytes: Uint8Array };
      if (request.artifact === "svg") {
        artifact = {
          name: "schematic.svg",
          mediaType: "image/svg+xml",
          bytes: new TextEncoder().encode(source.svg),
        };
      } else if (request.artifact === "png") {
        const { rasterizeFormalSvgInBrowser } = await importChunk(
          "PNG export",
          () => import("@icm/exporters/browser-raster"),
        );
        const png = await rasterizeFormalSvgInBrowser(source);
        artifact = {
          name: "schematic.png",
          mediaType: png.mediaType,
          bytes: png.bytes,
        };
      } else {
        const { vectorizeFormalSvgInBrowser } = await importChunk(
          "PDF export",
          () => import("@icm/exporters/browser-pdf"),
        );
        artifact = {
          name: "schematic.pdf",
          mediaType: "application/pdf",
          bytes: await vectorizeFormalSvgInBrowser(source),
        };
      }
      const response = await this.artifactResponse(
        request,
        artifact.name,
        artifact.mediaType,
        artifact.bytes,
        review,
      );
      if (
        review &&
        (this.options.getProjectSessionId() !== this.boundProjectSessionId ||
          this.options.getProject() !== project ||
          this.options.getReviewWorkspace?.()?.workspaceGeneration !==
            workspace?.workspaceGeneration)
      )
        return this.error(
          request,
          "REVIEW_TARGET_CHANGED",
          "The live Canvas changed while exporting. Read its current revision before retrying.",
        );
      return response;
    } catch (error) {
      return this.error(
        request,
        "FILE_EXPORT_FAILED",
        error instanceof Error ? error.message : "Formal export failed",
      );
    }
  }

  private async stage(
    request: Extract<AgentFileResourceRequest, { operation: "stage" }>,
  ): Promise<AgentFileResourceResponse> {
    const decoded = await this.decodeFiles(request);
    if (!decoded.ok) return this.error(request, decoded.code, decoded.message);
    if (request.entryPath && !isVirtualSourcePath(request.entryPath)) {
      return this.error(
        request,
        "FILE_CONTENT_INVALID",
        "entryPath is not a safe virtual source path",
      );
    }
    try {
      let project: CircuitProject | null = null;
      let diagnostics: AgentFileCandidateSummary["diagnostics"] = [];
      let local: { source: AgentLocalSource; importMs: number } | undefined;
      if (request.kind === "local-circuit") {
        const entryPath = request.entryPath;
        if (!entryPath)
          return this.error(
            request,
            "FILE_CONTENT_INVALID",
            "Local delivery requires entryPath",
          );
        const inputs = decoded.files.map(({ name, bytes }, index) => ({
          path: name,
          bytes,
          sha256: request.files[index]!.sha256,
        }));
        const start = performance.now();
        const { importLocalCircuit } = await import("./import-local-circuit");
        const imported = await importLocalCircuit(inputs, entryPath, {
          ...(request.rnlAppearance
            ? { appearance: request.rnlAppearance }
            : {}),
          ...(request.modelTypes ? { modelTypes: request.modelTypes } : {}),
        });
        project = imported.project;
        diagnostics = imported.diagnostics;
        const identityFiles =
          imported.format === "project"
            ? request.files
            : project.source.files.flatMap(({ path, hash }) =>
                hash.startsWith("sha256:")
                  ? [{ name: path, sha256: hash.slice(7) }]
                  : [],
              );
        local = {
          importMs: performance.now() - start,
          source: {
            version: await sha256(
              new TextEncoder().encode(
                localSourceIdentity(entryPath, identityFiles),
              ),
            ),
            entryPath,
            files: request.files.map(({ name, sha256, byteLength }) => ({
              path: name,
              sha256,
              byteLength,
            })),
            format: imported.format,
            drawing: imported.drawing,
            electrical: imported.electrical,
            diagnostics,
          },
        };
      } else if (request.kind === "project") {
        if (decoded.files.length !== 1)
          return this.error(
            request,
            "FILE_CONTENT_INVALID",
            "Project stage accepts exactly one .icproj.json file",
          );
        project = parseProject(
          new TextDecoder().decode(decoded.files[0]!.bytes),
        );
      } else {
        const entries = decoded.files.filter((file) =>
          /\.(?:cir|sp|spi)$/iu.test(file.name),
        );
        const entryPath =
          request.entryPath ?? (entries.length === 1 ? entries[0]!.name : null);
        if (!entryPath)
          return this.error(
            request,
            "FILE_CONTENT_INVALID",
            "Structural SPICE requires entryPath or exactly one .cir/.sp/.spi source",
          );
        const inputs = decoded.files.map((file) => ({
          path: file.name,
          bytes: file.bytes,
        }));
        const result = await importSpiceSources(
          inputs,
          entryPath,
          {},
          {
            namingProfile: request.namingProfile ?? "native",
            builtInBodies: inputs.flatMap(
              (input) =>
                findBuiltInBodies(
                  new TextDecoder().decode(input.bytes),
                  "spice",
                  input.path,
                ).bodies,
            ),
          },
        );
        diagnostics = result.diagnostics.flatMap((item) =>
          item.severity === "warning" || item.severity === "error"
            ? [{ severity: item.severity, message: item.message }]
            : [],
        );
        if (!result.successful || !result.project) {
          return this.error(
            request,
            "FILE_IMPORT_FAILED",
            diagnostics[0]?.message ?? "Structural SPICE import failed",
          );
        }
        project = withImportedInstanceDisplays(result.project);
      }
      const candidateId = `candidate-${crypto.randomUUID()}`;
      const expiresAt = new Date(
        Date.now() + AGENT_FILE_CANDIDATE_TTL_MS,
      ).toISOString();
      const summary: AgentFileCandidateSummary = {
        candidateId,
        kind: request.kind,
        expiresAt,
        projectName: project.name,
        documentCount: project.documents.length,
        instanceCount: project.documents.reduce(
          (total, document) => total + document.instances.length,
          0,
        ),
        documents: project.documents.map((d) => ({
          id: d.id,
          name: d.name,
          instanceCount: d.instances.length,
          terminalNames: d.netlist?.terminals.map((t) => t.name) ?? [],
        })),
        diagnostics,
        ...local,
      };
      this.candidates.set(candidateId, {
        project,
        summary,
        ...(local?.source.format === "rnl"
          ? { rnlAppearance: request.rnlAppearance ?? "canvas" }
          : {}),
      });
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: "stage",
        ok: true,
        candidate: summary,
      };
    } catch (error) {
      return this.error(
        request,
        request.kind === "local-circuit"
          ? "FILE_IMPORT_FAILED"
          : "FILE_CONTENT_INVALID",
        error instanceof Error ? error.message : "File content is invalid",
      );
    }
  }

  private async decodeFiles(
    request: Pick<
      Extract<AgentFileResourceRequest, { operation: "stage" }>,
      "files"
    >,
  ): Promise<
    | { ok: true; files: { name: string; bytes: Uint8Array }[] }
    | { ok: false; code: string; message: string }
  > {
    let total = 0;
    const files: { name: string; bytes: Uint8Array }[] = [];
    const names = new Set<string>();
    for (const file of request.files) {
      if (!isVirtualSourcePath(file.name)) {
        return {
          ok: false,
          code: "FILE_CONTENT_INVALID",
          message: `File name is not a safe virtual source path: ${file.name}`,
        };
      }
      if (names.has(file.name)) {
        return {
          ok: false,
          code: "FILE_CONTENT_INVALID",
          message: `Duplicate virtual source path: ${file.name}`,
        };
      }
      names.add(file.name);
      const bytes = base64DecodeBytes(file.data);
      if (!bytes || bytes.byteLength !== file.byteLength)
        return {
          ok: false,
          code: "FILE_CONTENT_INVALID",
          message: `Invalid base64 or byteLength for ${file.name}`,
        };
      total += bytes.byteLength;
      if (total > AGENT_FILE_RESOURCE_MAX_BYTES)
        return {
          ok: false,
          code: "FILE_TOO_LARGE",
          message: "Combined staged files exceed the File Resource limit",
        };
      if ((await sha256(bytes)) !== file.sha256)
        return {
          ok: false,
          code: "FILE_INTEGRITY_MISMATCH",
          message: `sha256 mismatch for ${file.name}`,
        };
      files.push({ name: file.name, bytes });
    }
    return { ok: true, files };
  }

  private async artifactResponse(
    request: Extract<AgentFileResourceRequest, { operation: "download" }>,
    name: string,
    mediaType: string,
    bytes: Uint8Array,
    review?: AgentReviewReceipt,
  ): Promise<AgentFileResourceResponse> {
    if (bytes.byteLength > AGENT_FILE_RESOURCE_MAX_BYTES)
      return this.error(
        request,
        "FILE_TOO_LARGE",
        "Formal artifact exceeds the File Resource limit",
      );
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: "download",
      ok: true,
      ...(review ? { review } : {}),
      artifact: await fileArtifact(name, mediaType, bytes),
    };
  }

  private error(
    request: AgentFileResourceRequest,
    code: string,
    message: string,
  ): AgentFileResourceResponse {
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: false,
      error: { code, message },
    };
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [id, candidate] of this.candidates) {
      if (Date.parse(candidate.summary.expiresAt) <= now)
        this.candidates.delete(id);
    }
    for (const [id, save] of this.reviewSaves) {
      if (save.expiresAt <= now) this.reviewSaves.delete(id);
    }
  }
}

function isVirtualSourcePath(value: string): boolean {
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(value)
  )
    return false;
  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

async function fileArtifact(
  name: string,
  mediaType: string,
  bytes: Uint8Array,
) {
  return {
    name,
    mediaType,
    encoding: "base64" as const,
    data: base64EncodeBytes(bytes),
    byteLength: bytes.byteLength,
    sha256: await sha256(bytes),
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
