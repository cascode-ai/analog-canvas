/**
 * Reads and browser-hosted resources over the session transport:
 * capabilities, Snapshots through the cache, renders, and the file,
 * simulation and Project resources with the workspace binding.
 */
import {
  parseAgentCircuitRequest,
  AgentBootstrapSnapshotResponseSchema,
  AgentDocumentStateResponseSchema,
  AgentFolderDirectoryResponseSchema,
  AgentGeometrySnapshotResponseSchema,
  AgentPinsSnapshotResponseSchema,
  AgentCapabilitiesResponseSchema,
  AgentRenderResponseSchema,
  AGENT_API_VERSION,
  type AgentCircuitResponse,
  type AgentBootstrapSnapshot,
  type AgentSnapshotRequest,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
  type AgentSimulationResourceRequest,
  type AgentSimulationResourceResponse,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import { z } from "zod";
import { AgentSessionError } from "./errors.js";
import {
  countDiagnostics,
  type CachedSnapshot,
  type SnapshotSummary,
} from "./snapshot-cache.js";
import {
  AgentSessionTransport,
  baseRequest,
  type AgentCapabilitiesResponse,
} from "./session-transport.js";

type AgentRenderResponse = z.infer<typeof AgentRenderResponseSchema>;

export abstract class AgentSessionResources extends AgentSessionTransport {
  private metadataKey(request: AgentSimulationResourceRequest): string {
    const { requestId: _id, ...selection } = request;
    return JSON.stringify([
      this.session?.sessionId,
      this.session?.projectId,
      this.http.workspaceId,
      this.http.contextRevision,
      Object.entries(selection).sort(([a], [b]) => a.localeCompare(b)),
    ]);
  }

  /** Internal convenience reads only. Explicit resource calls always refresh.
   * Short reuse never turns availability, execution or input status into authority. */
  async simulationMetadataResource(
    request: AgentSimulationResourceRequest,
    options: { refresh?: boolean | undefined } = {},
  ): Promise<AgentSimulationResourceResponse> {
    await this.ensureSession();
    const cached = this.simulationMetadata.get(this.metadataKey(request));
    if (!options.refresh && cached && this.now() - cached.at < 30_000)
      return {
        ...structuredClone(cached.response),
        requestId: request.requestId,
      };
    return this.simulationResource(request);
  }

  /** Canonical HTTP requests retain caller-owned IDs through every retry. */
  async request(input: unknown): Promise<AgentCircuitResponse> {
    const parsed = parseAgentCircuitRequest(input);
    if (!parsed.success)
      throw new Error(
        "Invalid Agent Circuit request; consult the published OpenAPI schema",
      );
    const request = parsed.data;
    try {
      return await this.send(request);
    } finally {
      if (request.operation === "transact") {
        this.cache.clear();
        this.knownRevisions.clear();
      }
    }
  }

  /** Invoke the canonical browser-hosted file-resource contract. */
  async fileResource(
    request: AgentFileResourceRequest,
  ): Promise<AgentFileResourceResponse> {
    request = structuredClone(request);
    const changesProject =
      request.operation === "open" ||
      request.operation === "import-cell" ||
      (request.operation === "simulation-input" &&
        request.input.action === "update" &&
        request.input.owner.kind === "project-folder");
    try {
      const response = await this.resourceRequest(
        "files",
        request,
        (session, attempts) =>
          this.http.files(
            session.sessionId,
            session.agentToken,
            request,
            attempts,
          ),
      );
      if (response.ok && response.operation === "open")
        await this.status({ refresh: true }).catch(() => {});
      return response;
    } finally {
      // A lost response can still have committed source or circuit edits.
      // Folder files share the Project revision used by cached Snapshots.
      if (changesProject) {
        this.cache.clear();
        this.knownRevisions.clear();
      }
    }
  }

  /** Publication progresses independently of short relay RPCs. Poll metadata only. */
  async prepareArtifactDownload(
    artifactId: string,
    requestId = this.newRequestId(),
    options: { waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<AgentFileResourceResponse> {
    const deadline =
      Date.now() + Math.max(0, Math.min(options.waitMs ?? 120_000, 120_000));
    const pause =
      options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt++) {
      const response = await this.fileResource({
        apiVersion: AGENT_API_VERSION,
        requestId: attempt ? this.newRequestId() : requestId,
        operation: "simulation-input",
        input: { action: "download", artifactId },
      });
      if (
        !response.ok ||
        response.operation !== "simulation-input" ||
        response.result.ok ||
        response.result.error.code !== "ARTIFACT_TRANSFER_PENDING" ||
        Date.now() >= deadline ||
        attempt >= 60
      )
        return response;
      await pause(
        Math.min(
          Math.max(response.result.error.retryAfterMs ?? 2000, 500),
          5000,
          deadline - Date.now(),
        ),
      );
    }
  }

  /** Invoke the canonical browser-hosted simulation-resource contract. */
  async downloadArtifact(
    path: string,
    offset = 0,
    digest?: string,
  ): Promise<Response> {
    return this.withAuthorization((session) =>
      this.http.downloadArtifact(
        session.sessionId,
        session.agentToken,
        path,
        offset,
        digest,
      ),
    );
  }

  /** Invoke the canonical browser-hosted simulation-resource contract. */
  async simulationResource(
    request: AgentSimulationResourceRequest,
  ): Promise<AgentSimulationResourceResponse> {
    request = structuredClone(request);
    const key = this.metadataKey(request);
    this.simulationMetadata.delete(key);
    // Export can repair publication; do not keep a prior directory after it.
    if (request.operation === "export") this.simulationMetadata.clear();
    const response = await this.resourceRequest(
      "simulation",
      request,
      (session, attempts) =>
        this.http.simulation(
          session.sessionId,
          session.agentToken,
          request,
          attempts,
        ),
    );
    const reusable =
      response.ok &&
      ((request.operation === "capabilities" && "capabilities" in response) ||
        (request.operation === "catalog" &&
          "catalog" in response &&
          response.catalog.execution !== "pending" &&
          response.catalog.collection === "complete"));
    this.simulationMetadata.delete(key);
    if (reusable && key === this.metadataKey(request)) {
      if (this.simulationMetadata.size >= 32)
        this.simulationMetadata.delete(
          this.simulationMetadata.keys().next().value!,
        );
      this.simulationMetadata.set(key, {
        at: this.now(),
        response: structuredClone(response),
      });
    }
    return response;
  }

  /** Discover and import reusable Cells through the browser's Cloud authority. */
  async projectResource(
    request: AgentProjectResourceRequest,
  ): Promise<AgentProjectResourceResponse> {
    request = structuredClone(request);
    const changesProject =
      request.operation === "import-cell" ||
      request.operation === "insert-gallery-entry" ||
      request.operation === "replace-project-code" ||
      request.operation === "replace-netlist" ||
      (request.operation === "workspace" && request.request.action !== "list");
    try {
      return await this.resourceRequest(
        "projects",
        request,
        (session, attempts) =>
          this.http.projects(
            session.sessionId,
            session.agentToken,
            request,
            attempts,
          ),
      );
    } finally {
      // A lost reply may follow a committed edit or workspace switch.
      if (changesProject) {
        this.cache.clear();
        this.knownRevisions.clear();
      }
    }
  }

  /** Bind this client to an open working copy without selecting its UI tab. */
  async bindWorkspace(workspaceId: string | null): Promise<{
    workspaceId: string | null;
    projectId: string | null;
    name: string | null;
  }> {
    if (
      workspaceId !== null &&
      this.requireDurableWorkspaceBinding &&
      !this.workspaceBindingStore
    )
      throw new AgentSessionError(
        "WORKSPACE_TASK_REQUIRED",
        "CLI workspace binding needs ANALOG_CANVAS_TASK_DIR, an absolute task directory shared by subsequent commands",
        "request-rejected",
      );
    if (this.inflight.size)
      throw new AgentSessionError(
        "WORKSPACE_BUSY",
        "Wait for in-flight Agent requests before changing the target",
        "request-rejected",
      );
    if (workspaceId === null) {
      await this.workspaceBindingStore?.clear();
      this.http.workspaceId = undefined;
      this.boundWorkspace = null;
      this.cache.clear();
      this.knownRevisions.clear();
      this.simulationMetadata.clear();
      await this.status({ refresh: true });
      return { workspaceId: null, projectId: null, name: null };
    }
    const response = await this.projectResource({
      apiVersion: AGENT_API_VERSION,
      requestId: this.newRequestId(),
      operation: "workspace",
      request: { action: "list" },
    });
    if (
      !response.ok ||
      response.operation !== "workspace" ||
      response.result.action !== "list"
    )
      throw new AgentSessionError(
        "WORKSPACE_IDENTITY_UNAVAILABLE",
        "Cannot list open working copies",
        "request-rejected",
      );
    const target = response.result.projects.find(
      (item) => item.workspaceId === workspaceId,
    );
    if (!target)
      throw new AgentSessionError(
        "WORKSPACE_NOT_FOUND",
        "Working copy is no longer open",
        "request-rejected",
      );
    if (this.inflight.size)
      throw new AgentSessionError(
        "WORKSPACE_BUSY",
        "Wait for in-flight Agent requests before changing the target",
        "request-rejected",
      );
    if (this.workspaceBindingStore) {
      await this.workspaceBindingStore.save({
        version: 1,
        apiBaseUrl: this.http.baseUrl,
        sessionId: this.session!.sessionId,
        workspaceId,
        projectId: target.projectId,
      });
    }
    this.http.workspaceId = workspaceId;
    this.boundWorkspace = {
      projectId: target.projectId,
      documentIds: target.cells.map((cell) => cell.documentId),
    };
    if (this.session) {
      this.session.projectId = target.projectId;
      this.session.documentIds = [...this.boundWorkspace.documentIds];
    }
    this.cache.clear();
    this.knownRevisions.clear();
    this.simulationMetadata.clear();
    return { workspaceId, projectId: target.projectId, name: target.name };
  }

  get workspaceId(): string | null {
    return this.http.workspaceId ?? null;
  }

  async capabilities(
    options: { force?: boolean } = {},
  ): Promise<AgentCapabilitiesResponse> {
    if (this.capabilitiesCache && !options.force) return this.capabilitiesCache;
    const response = await this.send({
      ...baseRequest(this.newRequestId()),
      operation: "capabilities",
    });
    const parsed = AgentCapabilitiesResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new AgentSessionError(
        "INVALID_RESPONSE",
        "capabilities response failed schema validation",
        "request-rejected",
      );
    }
    this.capabilitiesCache = parsed.data;
    return parsed.data;
  }

  /** Cached Snapshot for a document, fetching a fresh one when absent/dirty. */
  async snapshot(
    documentId?: string,
    options: { refresh?: boolean } = {},
  ): Promise<CachedSnapshot> {
    const target = await this.resolveDocumentId(documentId);
    const cached = this.cache.get(target);
    if (cached && !cached.dirty && !options.refresh) return cached;
    return this.refreshSnapshot(target);
  }

  async refreshSnapshot(documentId?: string): Promise<CachedSnapshot> {
    let target = await this.resolveDocumentId(documentId);
    const request = (id: string) =>
      this.send({
        ...baseRequest(this.newRequestId()),
        operation: "snapshot",
        documentId: id,
      });
    const contextBefore = this.http.contextRevision;
    let response;
    try {
      response = await request(target);
    } catch (error) {
      if (
        documentId !== undefined ||
        !(error instanceof AgentSessionError) ||
        !["PROJECT_CONTEXT_STALE", "DOCUMENT_NOT_FOUND"].includes(error.code)
      )
        throw error;
      await this.status({ refresh: true });
      const current = await this.resolveDocumentId();
      if (current === target && this.http.contextRevision === contextBefore)
        throw error;
      target = current;
      response = await request(target);
    }
    if (
      documentId === undefined &&
      !response.ok &&
      ["PROJECT_CONTEXT_STALE", "DOCUMENT_NOT_FOUND"].includes(
        response.error.code,
      )
    ) {
      await this.status({ refresh: true });
      const current = await this.resolveDocumentId();
      if (current !== target || this.http.contextRevision !== contextBefore) {
        target = current;
        response = await request(target);
      }
    }
    if (
      !response.ok ||
      response.operation !== "snapshot" ||
      !("snapshot" in response)
    ) {
      throw new AgentSessionError(
        response.ok ? "INVALID_RESPONSE" : response.error.code,
        response.ok
          ? "unexpected operation for snapshot"
          : response.error.message,
        "request-rejected",
      );
    }
    const snapshotResponse = response;
    if (this.session)
      this.session.projectId = snapshotResponse.snapshot.project.id;
    this.updateDocumentRoster(
      snapshotResponse.snapshot.project.documents.map(
        (document) => document.id,
      ),
      snapshotResponse.snapshot.project.topDocumentId,
    );
    const entry: CachedSnapshot = {
      documentId: target,
      revision: snapshotResponse.revision,
      snapshot: snapshotResponse.snapshot,
      diagnostics: [...snapshotResponse.diagnostics],
      fetchedAt: this.now(),
      requestId: response.requestId,
      dirty: false,
    };
    this.cache.set(entry);
    this.rememberRevision({
      documentId: target,
      revision: entry.revision,
      structureRevision: entry.snapshot.project.structureRevision,
      projectId: entry.snapshot.project.id,
    });
    return entry;
  }

  /** Small connection projection. Full topology remains lazy and independently cached. */
  async bootstrapSnapshot(
    documentId?: string,
  ): Promise<AgentBootstrapSnapshot> {
    const target = await this.resolveDocumentId(documentId);
    const response = await this.send({
      ...baseRequest(this.newRequestId()),
      operation: "snapshot",
      documentId: target,
      projection: "bootstrap",
    });
    const parsed = AgentBootstrapSnapshotResponseSchema.safeParse(response);
    if (!parsed.success) {
      if (!response.ok) {
        throw new AgentSessionError(
          response.error.code,
          response.error.message,
          "request-rejected",
        );
      }
      throw new AgentSessionError(
        "INVALID_RESPONSE",
        "bootstrap snapshot response failed schema validation",
        "request-rejected",
      );
    }
    const context = parsed.data.context;
    this.rememberRevision({
      documentId: target,
      revision: context.document.revision,
      structureRevision: context.project.structureRevision,
      projectId: context.project.id,
    });
    this.updateDocumentRoster(
      context.project.documents.map((document) => document.id),
      context.project.topDocumentId,
    );
    return context;
  }

  private async lightweightSnapshot(
    documentId: string | undefined,
    projection: "state" | "folder-directory",
    diagnosticDetail?: "counts" | "items",
  ): Promise<{ documentId: string; response: AgentCircuitResponse }> {
    let target = await this.resolveDocumentId(documentId);
    const contextBefore = this.http.contextRevision;
    const request = (id: string) =>
      this.send({
        ...baseRequest(this.newRequestId()),
        operation: "snapshot",
        documentId: id,
        projection,
        ...(diagnosticDetail ? { diagnosticDetail } : {}),
      });
    let response: AgentCircuitResponse;
    try {
      response = await request(target);
    } catch (error) {
      if (
        documentId !== undefined ||
        !(error instanceof AgentSessionError) ||
        !["PROJECT_CONTEXT_STALE", "DOCUMENT_NOT_FOUND"].includes(error.code)
      )
        throw error;
      await this.status({ refresh: true });
      const current = await this.resolveDocumentId();
      if (current === target && this.http.contextRevision === contextBefore)
        throw error;
      target = current;
      response = await request(target);
    }
    if (
      documentId === undefined &&
      !response.ok &&
      ["PROJECT_CONTEXT_STALE", "DOCUMENT_NOT_FOUND"].includes(
        response.error.code,
      )
    ) {
      await this.status({ refresh: true });
      const current = await this.resolveDocumentId();
      if (current !== target || this.http.contextRevision !== contextBefore) {
        target = current;
        response = await request(target);
      }
    }
    return { documentId: target, response };
  }

  private observeLightweightSnapshot(
    documentId: string,
    projectId: string,
    structureRevision: number,
    revision: number,
  ): void {
    const cached = this.cache.get(documentId);
    if (
      cached &&
      (cached.snapshot.project.id !== projectId ||
        cached.snapshot.project.structureRevision !== structureRevision)
    ) {
      this.cache.clear();
      this.knownRevisions.clear();
    } else if (cached && cached.revision !== revision) {
      this.cache.markDirty(documentId, revision);
    }
    if (this.session && !this.boundWorkspace)
      this.session.projectId = projectId;
    this.rememberRevision({
      documentId,
      revision,
      structureRevision,
      projectId,
    });
  }

  /** Current revision and diagnostics without serializing a full Project. */
  async documentState(
    documentId?: string,
    options: { refresh?: boolean; diagnostics?: "counts" | "items" } = {},
  ): Promise<z.infer<typeof AgentDocumentStateResponseSchema>> {
    const target = await this.resolveDocumentId(documentId);
    const fromCache = (entry: CachedSnapshot) => {
      const counts = countDiagnostics(entry.diagnostics);
      return AgentDocumentStateResponseSchema.parse({
        ...baseRequest(this.newRequestId()),
        operation: "snapshot",
        ok: true,
        projection: "state",
        projectId: entry.snapshot.project.id,
        structureRevision: entry.snapshot.project.structureRevision,
        documentId: entry.documentId,
        documentName: entry.snapshot.document.name,
        revision: entry.revision,
        instanceCount: entry.snapshot.document.instances.length,
        netCount: entry.snapshot.document.nets.length,
        counts: { ...counts, total: entry.diagnostics.length },
        ...(options.diagnostics === "items"
          ? { diagnostics: entry.diagnostics }
          : {}),
      });
    };
    const cached = this.cache.get(target);
    if (cached && !cached.dirty && !options.refresh) return fromCache(cached);
    const read = await this.lightweightSnapshot(
      documentId,
      "state",
      options.diagnostics ?? "counts",
    );
    const parsed = AgentDocumentStateResponseSchema.safeParse(read.response);
    if (!parsed.success)
      throw new AgentSessionError(
        read.response.ok ? "INVALID_RESPONSE" : read.response.error.code,
        read.response.ok
          ? "state snapshot response failed schema validation"
          : read.response.error.message,
        "request-rejected",
      );
    this.observeLightweightSnapshot(
      read.documentId,
      parsed.data.projectId,
      parsed.data.structureRevision,
      parsed.data.revision,
    );
    return parsed.data;
  }

  /** Saved experiment names and bindings, never their authored source bodies. */
  async simulationFolderDirectory(
    documentId?: string,
    options: { refresh?: boolean } = {},
  ): Promise<z.infer<typeof AgentFolderDirectoryResponseSchema>> {
    const target = await this.resolveDocumentId(documentId);
    const fromCache = (entry: CachedSnapshot) =>
      AgentFolderDirectoryResponseSchema.parse({
        ...baseRequest(this.newRequestId()),
        operation: "snapshot",
        ok: true,
        projection: "folder-directory",
        projectId: entry.snapshot.project.id,
        structureRevision: entry.snapshot.project.structureRevision,
        documentId: entry.documentId,
        revision: entry.revision,
        folders: entry.snapshot.project.simulationFolders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          entry: folder.input.entry,
          circuitBindings: folder.input.circuitBindings,
        })),
      });
    const cached = this.cache.get(target);
    if (cached && !cached.dirty && !options.refresh) return fromCache(cached);
    const read = await this.lightweightSnapshot(documentId, "folder-directory");
    const parsed = AgentFolderDirectoryResponseSchema.safeParse(read.response);
    if (!parsed.success)
      throw new AgentSessionError(
        read.response.ok ? "INVALID_RESPONSE" : read.response.error.code,
        read.response.ok
          ? "folder directory response failed schema validation"
          : read.response.error.message,
        "request-rejected",
      );
    this.observeLightweightSnapshot(
      read.documentId,
      parsed.data.projectId,
      parsed.data.structureRevision,
      parsed.data.revision,
    );
    return parsed.data;
  }

  /** Read selected authored geometry without resolving topology or diagnostics. */
  async geometrySnapshot(
    objectIds: readonly string[],
    documentId?: string,
    /** Measure each annotation's drawn text too (an editor with #1414). */
    options: { textBounds?: boolean } = {},
  ): Promise<z.infer<typeof AgentGeometrySnapshotResponseSchema>> {
    if (objectIds.length < 1 || objectIds.length > 64)
      throw new AgentSessionError(
        "INVALID_REQUEST",
        "geometry read requires 1–64 object IDs",
        "request-rejected",
      );
    const ids = [...new Set(objectIds)];
    const target = await this.resolveDocumentId(documentId);
    const response = await this.send({
      ...baseRequest(this.newRequestId()),
      operation: "snapshot",
      documentId: target,
      projection: "geometry",
      geometryIds: ids,
      ...(options.textBounds ? { textBounds: true } : {}),
    });
    if (!response.ok)
      throw new AgentSessionError(
        response.error.code,
        response.error.message,
        "request-rejected",
      );
    const parsed = AgentGeometrySnapshotResponseSchema.safeParse(response);
    if (!parsed.success)
      throw new AgentSessionError(
        "INVALID_RESPONSE",
        "geometry snapshot response failed schema validation",
        "request-rejected",
      );
    const cached = this.cache.get(target);
    if (
      cached &&
      (cached.snapshot.project.id !== parsed.data.projectId ||
        cached.snapshot.project.structureRevision !==
          parsed.data.structureRevision)
    ) {
      this.cache.clear();
      this.knownRevisions.clear();
    } else if (cached && cached.revision !== parsed.data.revision) {
      this.cache.markDirty(target, parsed.data.revision);
    }
    this.rememberRevision({
      documentId: target,
      revision: parsed.data.revision,
      structureRevision: parsed.data.structureRevision,
      projectId: parsed.data.projectId,
    });
    return parsed.data;
  }

  async pinsSnapshot(
    instanceIds: readonly string[],
    documentId?: string,
    /** List each part's labels too (an editor with #1518). */
    options: { instanceLabels?: boolean } = {},
  ) {
    if (instanceIds.length < 1 || instanceIds.length > 64)
      throw new AgentSessionError(
        "INVALID_REQUEST",
        "pins read requires 1–64 instance IDs",
        "request-rejected",
      );
    const target = await this.resolveDocumentId(documentId);
    const response = await this.send({
      ...baseRequest(this.newRequestId()),
      operation: "snapshot",
      documentId: target,
      projection: "pins",
      instanceIds: [...instanceIds],
      ...(options.instanceLabels ? { instanceLabels: true } : {}),
    });
    if (!response.ok)
      throw new AgentSessionError(
        response.error.code,
        response.error.message,
        "request-rejected",
      );
    const parsed = AgentPinsSnapshotResponseSchema.parse(response);
    this.observeLightweightSnapshot(
      target,
      parsed.projectId,
      parsed.structureRevision,
      parsed.revision,
    );
    return parsed;
  }

  summary(documentId?: string): SnapshotSummary | null {
    const target = documentId ?? this.defaultDocumentId();
    return this.cache.summary(target);
  }

  async traceNet(
    traceNet: NonNullable<AgentSnapshotRequest["traceNet"]>,
    documentId?: string,
  ) {
    const response = await this.send({
      ...baseRequest(this.newRequestId()),
      operation: "snapshot",
      documentId: await this.resolveDocumentId(documentId),
      traceNet,
    });
    if (
      !response.ok ||
      response.operation !== "snapshot" ||
      !("snapshot" in response)
    )
      throw new AgentSessionError(
        response.ok ? "INVALID_RESPONSE" : response.error.code,
        response.ok ? "Expected a Snapshot trace" : response.error.message,
        "request-rejected",
      );
    return { revision: response.revision, trace: response.trace ?? null };
  }

  cachedSnapshot(documentId?: string): CachedSnapshot | null {
    // A cache probe must stay local and may precede connector recovery in a
    // fresh CLI process. The subsequent remote read resolves authorization.
    const target =
      documentId ??
      this.boundWorkspace?.documentIds[0] ??
      this.session?.documentIds[0];
    return target ? this.cache.get(target) : null;
  }

  async render(
    options: {
      documentId?: string;
      mode?: "formal" | "diagnostics";
      bounds?: { x: number; y: number; width: number; height: number };
    } = {},
  ): Promise<AgentRenderResponse> {
    const documentId = await this.resolveDocumentId(options.documentId);
    const response = await this.send({
      ...baseRequest(this.newRequestId()),
      operation: "render",
      documentId,
      mode: options.mode ?? "formal",
      ...(options.bounds ? { bounds: options.bounds } : {}),
    });
    if (!response.ok || response.operation !== "render") {
      throw new AgentSessionError(
        response.ok ? "INVALID_RESPONSE" : response.error.code,
        response.ok
          ? "unexpected operation for render"
          : response.error.message,
        "request-rejected",
      );
    }
    return response;
  }
}
