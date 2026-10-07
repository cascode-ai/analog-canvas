import {
  parseAgentCircuitRequest,
  AgentBootstrapSnapshotResponseSchema,
  AgentDocumentStateResponseSchema,
  AgentFolderDirectoryResponseSchema,
  AgentGeometrySnapshotResponseSchema,
  AgentPinsSnapshotResponseSchema,
  AgentCapabilitiesResponseSchema,
  AgentRenderResponseSchema,
  AgentTransactionPayloadSchema,
  AgentTransactSuccessResponseSchema,
  AGENT_API_VERSION,
  type AgentCircuitRequest,
  type AgentCircuitResponse,
  type AgentBootstrapSnapshot,
  type AgentSnapshotRequest,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
  type AgentSimulationResourceRequest,
  type AgentSimulationResourceResponse,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
  type AgentSessionStatusResponse,
} from "@icm/agent-adapter";
import { z } from "zod";
import {
  ConnectionTracker,
  type ConnectionSnapshot,
} from "./connection-state.js";

type AgentCapabilitiesResponse = z.infer<
  typeof AgentCapabilitiesResponseSchema
>;
type AgentRenderResponse = z.infer<typeof AgentRenderResponseSchema>;
type AgentTransactResponse = z.infer<typeof AgentTransactSuccessResponseSchema>;
import { AgentSessionError } from "./errors.js";
import {
  AgentHttpClient,
  type AgentHttpAttempts,
  type AgentRelayOperation,
  type AgentRequestTiming,
  type ClaimSuccess,
} from "./http-client.js";
import {
  type ConnectorStore,
  type StoredConnectorCredential,
} from "./connector-store.js";
import {
  SnapshotCache,
  bootstrapSummary,
  changedObjectIds,
  countDiagnostics,
  type CachedSnapshot,
  type BootstrapSummary,
  type SnapshotSummary,
} from "./snapshot-cache.js";
import type { ActionCall } from "@icm/agent-adapter/authoring";
import type { WorkspaceBindingStore } from "./workspace-binding-store.js";

interface ActiveSession {
  sessionId: string;
  agentToken: string;
  tokenExpiresAt: number;
  scopes: string[];
  projectId: string;
  documentIds: string[];
}

interface KnownRevision {
  documentId: string;
  revision: number;
  structureRevision: number;
  projectId: string;
  sessionId: string;
  contextRevision: string | undefined;
}

export interface AgentSessionClientOptions {
  http: AgentHttpClient;
  now?: () => number;
  newRequestId?: () => string;
  /** Automatic exact-payload retry attempts after a local network failure. */
  networkRetryAttempts?: number;
  /** Bounded recovery of a relay rejection that guarantees no dispatch. */
  offlineRetryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  tokenExpiryGraceMs?: number;
  connectorStore?: ConnectorStore;
  workspaceBindingStore?: WorkspaceBindingStore;
  /** A one-command process cannot honor an in-memory-only bind. */
  requireDurableWorkspaceBinding?: boolean;
}

export interface ConnectReport {
  mode: "claimed" | "resumed";
  projectId: string;
  documentIds: string[];
  tokenExpiresAt: number;
  capabilities: {
    operations: string[];
    editKinds: string[];
    permissions: Record<string, unknown>;
    limits: Record<string, number>;
  };
  context: BootstrapSummary | null;
  timing: {
    credentialMs: number;
    capabilitiesMs: number;
    bootstrapSnapshotMs: number;
    totalMs: number;
  };
}

export interface StatusReport extends ConnectionSnapshot {
  observation: AgentSessionStatusResponse | null;
  sessionId: string | null;
  projectId: string | null;
  documentIds: string[];
  tokenExpiresAt: number | null;
  tokenValid: boolean;
  cachedDocuments: string[];
}

export interface ApplyActionsReport {
  projectId?: string;
  workspaceId?: string | null;
  documentId?: string;
  requestId?: string;
  applied?: boolean;
  proposedRevision?: number;
  editKinds?: string[];
  diagnostics?: AgentTransactResponse["diagnostics"];
  diagnosticDelta?: AgentTransactResponse["diagnosticDelta"];
  projectStructure?: AgentTransactResponse["projectStructure"];
  semantic?: AgentTransactResponse["semantic"];
  resolvedRoutes?: AgentTransactResponse["resolvedRoutes"];
  terminalConnectivityChanged?: boolean;
  ok: boolean;
  stage: "compile" | "commit" | "done";
  /** Machine code for a failure (`STATE_CHANGED`, engine code, ...). */
  code?: string;
  message?: string;
  actionIndex?: number;
  actionKind?: string;
  revision?: number;
  transactions?: number;
  /** ACTION_BATCH_NOT_ATOMIC: the calls to send instead, in order. */
  calls?: ActionCall[];
  changedObjectIds?: string[];
  errors?: number;
  /** How many of `errors` are pins not wired yet (MISSING_PIN_NET). */
  unwiredPins?: number;
  warnings?: number;
  dryRun?: boolean;
}

function baseRequest(requestId: string): {
  apiVersion: typeof AGENT_API_VERSION;
  requestId: string;
} {
  return { apiVersion: AGENT_API_VERSION, requestId };
}

/** The action an editor's refusal of an action list names, if it does. */
function refusedAction(error: {
  actionIndex?: number | undefined;
  actionKind?: string | undefined;
}): { actionIndex?: number; actionKind?: string } {
  return error.actionIndex === undefined
    ? {}
    : {
        actionIndex: error.actionIndex,
        ...(error.actionKind ? { actionKind: error.actionKind } : {}),
      };
}

/**
 * Unified Agent-side Helper (Agent rationale). Owns claim/resume, token and session
 * state, capabilities/revision caches, exact-payload request-ID retry, the
 * Snapshot cache, and sending high-level actions for the editor to plan.
 * Bearer tokens remain process-local and are sent only in Authorization
 * headers. A revocable connector credential may be persisted by M4 so a new
 * MCP process can resume without another claim-code hand-off.
 */
export class AgentSessionClient {
  readonly connection: ConnectionTracker;
  private readonly http: AgentHttpClient;

  /** See AgentHttpClient.requestTimings (#1227). */
  timingMark(): number {
    return this.http.timingMark();
  }

  timingsSince(mark: number): AgentRequestTiming[] {
    return this.http.timingsSince(mark);
  }
  private readonly cache = new SnapshotCache();
  /** Revisions are authority hints only; every write is still checked by the Editor. */
  private readonly knownRevisions = new Map<string, KnownRevision>();
  private readonly now: () => number;
  private readonly newRequestId: () => string;
  private readonly networkRetryAttempts: number;
  private readonly offlineRetryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly tokenExpiryGraceMs: number;
  private readonly connectorStore: ConnectorStore | undefined;
  private readonly workspaceBindingStore: WorkspaceBindingStore | undefined;
  private readonly requireDurableWorkspaceBinding: boolean;
  private readonly inflight = new Map<
    string,
    { payload: string; promise: Promise<unknown> }
  >();
  private session: ActiveSession | null = null;
  private observation: AgentSessionStatusResponse | null = null;
  private boundWorkspace: { projectId: string; documentIds: string[] } | null =
    null;
  private capabilitiesCache: AgentCapabilitiesResponse | null = null;
  private resumePromise: Promise<ActiveSession | null> | null = null;
  private simulationMetadata = new Map<
    string,
    {
      at: number;
      response: AgentSimulationResourceResponse;
    }
  >();

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

  get apiBaseUrl(): string {
    return this.http.baseUrl;
  }

  constructor(options: AgentSessionClientOptions) {
    this.http = options.http;
    this.now = options.now ?? (() => Date.now());
    this.newRequestId =
      options.newRequestId ?? (() => `req-${crypto.randomUUID()}`);
    this.networkRetryAttempts = options.networkRetryAttempts ?? 1;
    this.offlineRetryDelaysMs = options.offlineRetryDelaysMs ?? [
      500, 1000, 2000,
    ];
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tokenExpiryGraceMs = options.tokenExpiryGraceMs ?? 30_000;
    this.connectorStore = options.connectorStore;
    this.workspaceBindingStore = options.workspaceBindingStore;
    this.requireDurableWorkspaceBinding =
      options.requireDurableWorkspaceBinding ?? false;
    this.connection = new ConnectionTracker(this.now);
  }

  /**
   * Pair or re-check the current session. With a claim code, redeem it and
   * replace prior local state. Without one, reuse the in-memory bearer or
   * resume the persisted connector.
   */
  async connect(claimCode?: string): Promise<ConnectReport> {
    const startedAt = this.now();
    if (claimCode === undefined || claimCode.trim() === "") {
      const resumed = await this.tryResume(startedAt);
      if (resumed === null) {
        throw new AgentSessionError(
          "CLAIM_REQUIRED",
          "no valid saved connector; pass a claim code from the editor's connect panel",
          "unrecoverable-credential",
        );
      }
      return resumed;
    }
    this.connection.apply("claim-started");
    try {
      const claim: ClaimSuccess = await this.http.claim(claimCode.trim());
      await this.workspaceBindingStore?.clear();
      this.http.workspaceId = undefined;
      this.boundWorkspace = null;
      this.cache.clear();
      this.knownRevisions.clear();
      this.receipts.length = 0;
      this.capabilitiesCache = null;
      this.simulationMetadata.clear();
      this.observation = null;
      this.session = this.activeSession(claim);
      await this.persistConnector(claim);
      return await this.establishContext(
        "claimed",
        startedAt,
        this.elapsedSince(startedAt),
      );
    } catch (error) {
      if (!this.session) this.connection.apply("reset");
      throw error;
    }
  }

  private async tryResume(startedAt: number): Promise<ConnectReport | null> {
    let stored = this.session;
    if (!stored || !this.tokenValid(stored)) {
      stored = await this.resumeConnector();
    }
    if (!stored) return null;
    this.connection.apply("resume-started");
    try {
      await this.status({ refresh: true });
      return await this.establishContext(
        "resumed",
        startedAt,
        this.elapsedSince(startedAt),
      );
    } catch (error) {
      if (
        error instanceof AgentSessionError &&
        error.category === "unrecoverable-credential"
      ) {
        await this.discardCredential(error.code);
      }
      throw error;
    }
  }

  private async establishContext(
    mode: "claimed" | "resumed",
    startedAt: number,
    credentialMs: number,
  ): Promise<ConnectReport> {
    const documentId = this.session?.documentIds[0];
    let capabilitiesMs = 0;
    let bootstrapSnapshotMs = 0;
    const capabilitiesTask = (async () => {
      const stageStartedAt = this.now();
      try {
        // A same-process resume can reuse the version-bound capability result.
        return await this.capabilities();
      } finally {
        capabilitiesMs = this.elapsedSince(stageStartedAt);
      }
    })();
    const contextTask = (async (): Promise<{
      context: BootstrapSummary | null;
      editorOffline: boolean;
    }> => {
      if (!documentId) return { context: null, editorOffline: false };
      const stageStartedAt = this.now();
      try {
        return {
          context: bootstrapSummary(await this.bootstrapSnapshot(documentId)),
          editorOffline: false,
        };
      } catch (error) {
        // An offline editor still leaves a paired, resumable session; the
        // host will see editor-offline through connection_status.
        if (
          error instanceof AgentSessionError &&
          (error.category === "editor-offline" || error.category === "network")
        ) {
          return { context: null, editorOffline: true };
        }
        throw error;
      } finally {
        bootstrapSnapshotMs = this.elapsedSince(stageStartedAt);
      }
    })();
    const [capabilities, contextResult] = await Promise.all([
      capabilitiesTask,
      contextTask,
    ]);
    const { context, editorOffline } = contextResult;
    if (!editorOffline) {
      this.connection.apply("request-succeeded");
    }
    return {
      mode,
      projectId: this.session?.projectId ?? "",
      documentIds: [...(this.session?.documentIds ?? [])],
      tokenExpiresAt: this.session?.tokenExpiresAt ?? 0,
      capabilities: {
        operations: [...capabilities.capabilities.operations],
        editKinds: [...capabilities.capabilities.editKinds],
        permissions: capabilities.capabilities.permissions as unknown as Record<
          string,
          unknown
        >,
        limits: capabilities.capabilities.limits as unknown as Record<
          string,
          number
        >,
      },
      context,
      timing: {
        credentialMs,
        capabilitiesMs,
        bootstrapSnapshotMs,
        totalMs: this.elapsedSince(startedAt),
      },
    };
  }

  private elapsedSince(startedAt: number): number {
    return Math.max(0, this.now() - startedAt);
  }

  async status(options: { refresh?: boolean } = {}): Promise<StatusReport> {
    if (options.refresh && (this.session || this.connectorStore)) {
      try {
        const previousContext = this.http.contextRevision;
        this.observation = await this.withAuthorization((session) =>
          this.http.status(session.sessionId, session.agentToken),
        );
        this.connection.observe(this.observation);
        if (previousContext !== this.http.contextRevision) {
          this.cache.clear();
          this.knownRevisions.clear();
          this.capabilitiesCache = null;
        }
        if (!this.boundWorkspace) {
          if (this.session) this.session.projectId = this.observation.projectId;
          this.updateDocumentRoster(this.observation.documentIds);
        }
      } catch (error) {
        if (!(error instanceof AgentSessionError)) throw error;
        if (
          error.code === "PROJECT_CONTEXT_STALE" ||
          error.code === "NO_ACTIVE_PROJECT"
        ) {
          this.cache.clear();
          this.knownRevisions.clear();
          this.connection.observe(null, error.code);
          throw error;
        }
        // A failed observation is not proof of a detached browser. Preserve
        // the last timestamped evidence and let only authorization failures
        // discard a pairing.
        if (error.category !== "unrecoverable-credential")
          this.connection.observe(null, error.code);
      }
    }
    return {
      ...this.connection.snapshot,
      observation: this.observation,
      sessionId: this.session?.sessionId ?? null,
      projectId:
        this.boundWorkspace?.projectId ?? this.session?.projectId ?? null,
      documentIds: [
        ...(this.boundWorkspace?.documentIds ??
          this.session?.documentIds ??
          []),
      ],
      tokenExpiresAt: this.session?.tokenExpiresAt ?? null,
      tokenValid: this.session ? this.tokenValid(this.session) : false,
      cachedDocuments: [...this.cache.documents()],
    };
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

  /** Revoke the server session and forget the durable connector locally. */
  async disconnect(): Promise<void> {
    try {
      const session = await this.ensureSession();
      await this.http.disconnect(session.sessionId, session.agentToken);
    } finally {
      await this.discardCredential("DISCONNECTED");
      await this.workspaceBindingStore?.clear();
    }
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

  async pinsSnapshot(instanceIds: readonly string[], documentId?: string) {
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

  /**
   * Send high-level actions for the editor to plan and commit as one atomic
   * transaction, in a single request. The editor plans them against the
   * Document it holds. Target-resolving actions plan on its current state;
   * raw transactions, pass-through actions and undo/redo retain their revision
   * guards. A human edit does not universally imply STATE_CHANGED. A page too old to
   * plan them is asked to reload; nothing is sent.
   */
  async applyActions(
    actions: readonly unknown[],
    options: {
      documentId?: string;
      dryRunOnly?: boolean;
      diagnosticDeltaDetail?: "full" | "compact";
    } = {},
  ): Promise<ApplyActionsReport> {
    // A page that could not plan them may have been reloaded since: ask again.
    const plansActions = async (force: boolean) =>
      (
        await this.capabilities({ force })
      ).capabilities.transactionForms?.includes("actions") ?? false;
    if (!(await plansActions(false)) && !(await plansActions(true)))
      return {
        ok: false,
        stage: "compile",
        code: "EDITOR_OUTDATED",
        message:
          "The open editor page runs an older version that cannot plan action lists. Reload the editor page, then retry.",
      };
    return this.submitTransaction(
      await this.revisionFor(options.documentId),
      { actions },
      {
        dryRun: options.dryRunOnly ?? false,
        diagnosticDeltaDetail: options.diagnosticDeltaDetail ?? "full",
      },
    );
  }

  /** Same four-operation API; the helper only supplies identity and revisions. */
  async advancedTransact(
    payload: unknown,
    options: {
      documentId?: string;
      dryRun?: boolean;
      expectedStructureRevision?: number;
      diagnosticDeltaDetail?: "full" | "compact";
      /** Reuse the snapshot read by this composed operation; commit still checks revisions. */
      snapshot?: CachedSnapshot;
    } = {},
  ): Promise<ApplyActionsReport> {
    const normalized = Array.isArray(payload) ? { edits: payload } : payload;
    const parsed = AgentTransactionPayloadSchema.safeParse(
      await this.withNestedRevisions(normalized),
    );
    if (!parsed.success)
      return {
        ok: false,
        stage: "compile",
        code: "EDIT_SCHEMA_INVALID",
        message: schemaIssueText(parsed.error.issues[0]),
      };
    const entry = options.snapshot
      ? this.revisionFromSnapshot(options.snapshot)
      : await this.revisionFor(options.documentId);
    if (
      options.snapshot &&
      (options.snapshot.dirty || entry.projectId !== this.session?.projectId)
    )
      return this.stateChangedReport(
        entry,
        "Snapshot is stale or belongs to another Project",
      );
    if (options.documentId && entry.documentId !== options.documentId)
      return this.stateChangedReport(
        entry,
        "Snapshot belongs to another Document",
      );
    if (
      options.expectedStructureRevision !== undefined &&
      entry.structureRevision !== options.expectedStructureRevision
    )
      return this.stateChangedReport(
        entry,
        "The Project changed after this edit was authored; read it and apply the edit again",
      );
    return this.submitTransaction(entry, parsed.data, options);
  }

  recentTransactions(): readonly ApplyActionsReport[] {
    return this.receipts.map((item) => structuredClone(item));
  }

  /**
   * The session's last answered requests from the relay, whichever process
   * made them (#1227): one CLI process per call never saw the others.
   */
  async relayActivity(): Promise<AgentRelayOperation[]> {
    const session = await this.ensureSession();
    return this.http.activity(session.sessionId, session.agentToken);
  }

  private readonly receipts: ApplyActionsReport[] = [];

  private updateDocumentRoster(
    ids: readonly string[],
    topDocumentId?: string,
  ): void {
    if (!this.session) return;
    const previous = this.session.documentIds[0];
    const preferred =
      previous && ids.includes(previous) ? previous : topDocumentId;
    this.session.documentIds =
      preferred && ids.includes(preferred)
        ? [preferred, ...ids.filter((id) => id !== preferred)]
        : [...ids];
    if (this.boundWorkspace)
      this.boundWorkspace.documentIds = [...this.session.documentIds];
  }

  private rememberRevision(
    value: Omit<KnownRevision, "sessionId" | "contextRevision">,
  ): void {
    if (!this.session || value.projectId !== this.session.projectId) return;
    this.knownRevisions.set(value.documentId, {
      ...value,
      sessionId: this.session.sessionId,
      contextRevision: this.http.contextRevision,
    });
  }

  /**
   * A nested `transact_document` left without `expectedRevision` takes its
   * Document's current revision, as the top-level transaction does: the
   * helper supplies revisions, and the MCP schema does not describe nested
   * entries, so leaving it out used to fail with no field named.
   */
  private async withNestedRevisions(payload: unknown): Promise<unknown> {
    if (!payload || typeof payload !== "object") return payload;
    const structureEdits = (payload as { structureEdits?: unknown })
      .structureEdits;
    if (!Array.isArray(structureEdits)) return payload;
    const filled: unknown[] = [];
    for (const edit of structureEdits) {
      const entry = edit as {
        kind?: unknown;
        documentId?: unknown;
        expectedRevision?: unknown;
      } | null;
      filled.push(
        entry?.kind === "transact_document" &&
          entry.expectedRevision === undefined &&
          typeof entry.documentId === "string"
          ? {
              ...entry,
              expectedRevision: (await this.revisionFor(entry.documentId))
                .revision,
            }
          : edit,
      );
    }
    return { ...payload, structureEdits: filled };
  }

  private async revisionFor(documentId?: string): Promise<KnownRevision> {
    const target = await this.resolveDocumentId(documentId);
    const known = this.knownRevisions.get(target);
    if (
      known &&
      known.sessionId === this.session?.sessionId &&
      known.projectId === this.session.projectId &&
      known.contextRevision === this.http.contextRevision
    )
      return known;
    await this.bootstrapSnapshot(target);
    const refreshed = this.knownRevisions.get(target);
    if (!refreshed) {
      throw new AgentSessionError(
        "INVALID_RESPONSE",
        "bootstrap did not establish the selected Document revision",
        "request-rejected",
      );
    }
    return refreshed;
  }

  private revisionFromSnapshot(entry: CachedSnapshot): KnownRevision {
    return {
      documentId: entry.documentId,
      revision: entry.revision,
      structureRevision: entry.snapshot.project.structureRevision,
      projectId: entry.snapshot.project.id,
      sessionId: this.session?.sessionId ?? "",
      contextRevision: this.http.contextRevision,
    };
  }

  private async submitTransaction(
    entry: KnownRevision,
    payload: unknown,
    options: { dryRun?: boolean; diagnosticDeltaDetail?: "full" | "compact" },
  ): Promise<ApplyActionsReport> {
    const parsed = AgentTransactionPayloadSchema.safeParse(payload);
    if (!parsed.success)
      return {
        ok: false,
        stage: "compile",
        code: "EDIT_SCHEMA_INVALID",
        message: schemaIssueText(parsed.error.issues[0]),
      };
    const request = (dryRun: boolean): AgentCircuitRequest => ({
      ...baseRequest(this.newRequestId()),
      operation: "transact",
      documentId: entry.documentId,
      transactionId: `txn-${crypto.randomUUID()}`,
      expectedRevision: entry.revision,
      expectedStructureRevision: entry.structureRevision,
      dryRun,
      ...(options.diagnosticDeltaDetail === "compact"
        ? { diagnosticDeltaDetail: "compact" as const }
        : {}),
      ...parsed.data,
    });
    // One request, no client-side dry-run pass: the commit validates the
    // whole transaction atomically and returns the same diagnostics a
    // dry-run would, without the extra relayed round trip per edit.
    const submit = async (value: AgentCircuitRequest) => {
      try {
        return await this.send(value);
      } catch (error) {
        if (!options.dryRun) {
          // No authoritative receipt: the write may already be committed.
          // Retain the pairing and exact in-flight retry identity, but never
          // let the next operation reuse pre-write revisions. A command may
          // also have changed shared definitions/Project structure.
          this.cache.clear();
          this.knownRevisions.clear();
        }
        throw error;
      }
    };
    let response = await submit(request(options.dryRun ?? false));
    if (!response.ok) {
      if (
        response.error.code === "STALE_REVISION" ||
        response.error.code === "STALE_STRUCTURE_REVISION"
      )
        return {
          ...(await this.stateChangedReport(entry, response.error.message)),
          ...refusedAction(response.error),
        };
      if (
        response.error.code === "ACTION_COMPILE_FAILED" ||
        response.error.code === "ACTION_BATCH_NOT_ATOMIC"
      )
        // The editor refused the list while planning it: reported as when
        // the client compiles the list itself.
        return {
          ok: false,
          stage: "compile",
          code: response.error.code,
          message: response.error.message,
          ...refusedAction(response.error),
          ...(response.revision !== undefined
            ? { revision: response.revision }
            : {}),
          ...(response.error.transactions !== undefined
            ? { transactions: response.error.transactions }
            : {}),
          ...(response.error.calls ? { calls: response.error.calls } : {}),
        };
      return {
        ok: false,
        stage: "commit",
        code: response.error.code,
        message: response.error.message,
        diagnostics: response.diagnostics,
        ...(() => {
          // The editor names the refused action of a list it planned.
          if (response.error.actionIndex !== undefined)
            return refusedAction(response.error);
          const actionIndex = response.diagnostics.find(
            (item) => typeof item.parameters?.actionIndex === "number",
          )?.parameters?.actionIndex;
          return typeof actionIndex === "number" ? { actionIndex } : {};
        })(),
        revision: entry.revision,
        requestId: response.requestId,
      };
    }
    if (response.operation !== "transact")
      return {
        ok: false,
        stage: "commit",
        code: "INVALID_RESPONSE",
        message: "Expected a transact response",
      };
    if (response.applied) {
      if (response.projectStructure?.documentIds)
        this.updateDocumentRoster(
          response.projectStructure.documentIds,
          response.projectStructure.topDocumentId,
        );
      if (response.projectStructure) {
        this.cache.clear();
        this.knownRevisions.clear();
      } else {
        this.cache.markDirty(entry.documentId, response.revision);
        if (
          entry.sessionId === this.session?.sessionId &&
          entry.contextRevision === this.http.contextRevision
        ) {
          this.rememberRevision({
            documentId: entry.documentId,
            revision: response.revision,
            structureRevision: entry.structureRevision,
            projectId: entry.projectId,
          });
        }
      }
    }
    // Mid-drawing, nearly every error is a pin not wired yet (#1301): say how
    // many, so the errors that are something else stand out.
    const unwiredPins = response.diagnostics.filter(
      (item) => item.code === "MISSING_PIN_NET",
    ).length;
    // A change to the Project's structure alone, such as a new Cell, leaves
    // the open Cell as it was: its findings are not this change's. A new
    // Cell's receipt read as three errors of an unrelated Cell. A Project
    // transaction that edits a Cell (placing a Cell Pin) keeps them.
    const structureOnly =
      response.diff.editKinds.length > 0 &&
      response.diff.editKinds.every(
        (kind) =>
          kind.startsWith("project:") && kind !== "project:transact_document",
      );
    const report: ApplyActionsReport = {
      ok: true,
      stage: "done",
      projectId: entry.projectId,
      workspaceId: this.workspaceId,
      documentId: response.diff.documentId,
      transactions: 1,
      revision: response.revision,
      applied: response.applied,
      requestId: response.requestId,
      proposedRevision: response.proposedRevision,
      dryRun: options.dryRun ?? false,
      changedObjectIds: response.diff.changedObjectIds,
      ...(response.terminalConnectivityChanged !== undefined
        ? { terminalConnectivityChanged: response.terminalConnectivityChanged }
        : {}),
      editKinds: response.diff.editKinds,
      ...(structureOnly
        ? {}
        : {
            diagnostics: response.diagnostics,
            errors: response.diagnostics.filter(
              (item) => item.severity === "error",
            ).length,
            ...(unwiredPins ? { unwiredPins } : {}),
            warnings: response.diagnostics.filter(
              (item) => item.severity === "warning",
            ).length,
          }),
      ...(response.diagnosticDelta
        ? { diagnosticDelta: response.diagnosticDelta }
        : {}),
      ...(response.projectStructure
        ? { projectStructure: response.projectStructure }
        : {}),
      ...(response.semantic ? { semantic: response.semantic } : {}),
      ...(response.resolvedRoutes
        ? { resolvedRoutes: response.resolvedRoutes }
        : {}),
    };
    if (!options.dryRun) {
      this.receipts.push(report);
      if (this.receipts.length > 32) this.receipts.shift();
    }
    return report;
  }
  private async stateChangedReport(
    entry: KnownRevision,
    message: string,
  ): Promise<ApplyActionsReport> {
    const before = this.cache.get(entry.documentId);
    const fresh = await this.refreshSnapshot(entry.documentId);
    return {
      ok: false,
      stage: "commit",
      code: "STATE_CHANGED",
      message:
        message ??
        "the document revision changed; re-inspect the affected objects and retry",
      revision: fresh.revision,
      changedObjectIds:
        before && !before.dirty && before.revision === entry.revision
          ? changedObjectIds(before.snapshot, fresh.snapshot)
          : [],
    };
  }

  private async send(
    request: AgentCircuitRequest,
  ): Promise<AgentCircuitResponse> {
    request = structuredClone(request);
    return this.resourceRequest("circuit", request, (session, attempts) =>
      this.http.circuit(
        session.sessionId,
        session.agentToken,
        request,
        attempts,
      ),
    );
  }

  private async resourceRequest<T>(
    resource: string,
    request: { requestId: string },
    operation: (
      session: ActiveSession,
      attempts: AgentHttpAttempts,
    ) => Promise<T>,
  ): Promise<T> {
    const existing = this.inflight.get(request.requestId);
    const payload = JSON.stringify([resource, this.http.workspaceId, request]);
    if (existing) {
      if (existing.payload !== payload)
        throw new Error(
          "Request ID already in flight with a different payload",
        );
      return existing.promise as Promise<T>;
    }
    const pending = this.dispatch(operation);
    this.inflight.set(request.requestId, { payload, promise: pending });
    try {
      return await pending;
    } finally {
      this.inflight.delete(request.requestId);
    }
  }

  private async dispatch<T>(
    operation: (
      session: ActiveSession,
      attempts: AgentHttpAttempts,
    ) => Promise<T>,
  ): Promise<T> {
    const httpAttempts: AgentHttpAttempts = { count: 0 };
    let attempts = 0;
    let offlineAttempts = 0;
    let ownerSessionId: string | undefined;
    let ownerContext = this.http.contextRevision;
    for (;;) {
      try {
        const response = await this.withAuthorization((session) => {
          if (
            ownerContext !== undefined &&
            ownerContext !== this.http.contextRevision
          )
            throw new AgentSessionError(
              "PROJECT_CONTEXT_STALE",
              "The request belongs to a previous browser context",
              "request-rejected",
            );
          if (
            ownerSessionId !== undefined &&
            ownerSessionId !== session.sessionId
          )
            throw new AgentSessionError(
              "SESSION_CHANGED",
              "The request belongs to the previous pairing",
              "request-rejected",
            );
          ownerSessionId = session.sessionId;
          ownerContext = this.http.contextRevision;
          return operation(session, httpAttempts);
        });
        const failure = response as { ok?: boolean; error?: { code?: string } };
        if (ownerContext !== this.http.contextRevision) {
          this.cache.clear();
          this.knownRevisions.clear();
          this.capabilitiesCache = null;
        }
        if (
          failure.ok === false &&
          [
            "PROJECT_CONTEXT_STALE",
            "NO_ACTIVE_PROJECT",
            "DOCUMENT_NOT_FOUND",
          ].includes(failure.error?.code ?? "")
        ) {
          this.cache.clear();
          this.knownRevisions.clear();
          this.connection.observe(null, failure.error?.code);
          await this.status({ refresh: true }).catch(() => {});
        } else this.connection.apply("request-succeeded");
        return response;
      } catch (error) {
        if (!(error instanceof AgentSessionError)) throw error;
        if (
          error.code === "PROJECT_CONTEXT_STALE" ||
          error.code === "NO_ACTIVE_PROJECT"
        ) {
          this.cache.clear();
          this.knownRevisions.clear();
          this.connection.observe(null, error.code);
          await this.status({ refresh: true }).catch(() => {});
          throw error;
        }
        if (
          error.category === "network" &&
          attempts < this.networkRetryAttempts
        ) {
          attempts += 1;
          this.connection.apply("transport-interrupted", error.code);
          if (httpAttempts.last) httpAttempts.last.retryDelayMs = 0;
          continue;
        }
        if (error.category === "editor-offline") {
          this.connection.apply("editor-detached", error.code);
          // OFFLINE is rejected before forwarding; DISCONNECTED is uncertain.
          // Never turn an uncertain mutation/start into a new request ID.
          const delay = this.offlineRetryDelaysMs[offlineAttempts++];
          if (error.code === "EDITOR_OFFLINE" && delay !== undefined) {
            const timing = httpAttempts.last;
            const started = performance.now();
            await this.sleep(delay);
            if (timing)
              timing.retryDelayMs = Math.round(performance.now() - started);
            continue;
          }
          throw error;
        }
        if (error.category === "unrecoverable-credential") {
          await this.discardCredential(error.code);
          throw error;
        }
        throw error;
      }
    }
  }

  private async discardCredential(code: string): Promise<void> {
    this.observation = null;
    this.connection.apply("credential-revoked", code);
    this.session = null;
    this.boundWorkspace = null;
    this.http.workspaceId = undefined;
    this.simulationMetadata.clear();
    this.capabilitiesCache = null;
    this.cache.clear();
    this.knownRevisions.clear();
    this.receipts.length = 0;
    await this.connectorStore?.clear();
  }

  private async ensureSession(): Promise<ActiveSession> {
    if (this.session && this.tokenValid(this.session)) return this.session;
    const resumed = await this.resumeConnector();
    if (!resumed) {
      throw new AgentSessionError(
        this.session ? "TOKEN_EXPIRED" : "NOT_CONNECTED",
        "no valid connector pairing; call connect with a claim code",
        "unrecoverable-credential",
      );
    }
    return resumed;
  }

  private async withAuthorization<T>(
    operation: (session: ActiveSession) => Promise<T>,
  ): Promise<T> {
    let session = await this.ensureSession();
    try {
      return await operation(session);
    } catch (error) {
      if (
        error instanceof AgentSessionError &&
        (error.code === "TOKEN_INVALID" || error.code === "TOKEN_EXPIRED")
      ) {
        this.session = null;
        session = await this.ensureSession();
        try {
          return await operation(session);
        } catch (retryError) {
          if (
            retryError instanceof AgentSessionError &&
            retryError.category === "unrecoverable-credential"
          ) {
            await this.discardCredential(retryError.code);
          }
          throw retryError;
        }
      }
      if (
        error instanceof AgentSessionError &&
        error.category === "unrecoverable-credential"
      ) {
        await this.discardCredential(error.code);
      }
      throw error;
    }
  }

  private async resumeConnector(): Promise<ActiveSession | null> {
    if (!this.connectorStore) return null;
    if (this.resumePromise) return this.resumePromise;
    this.resumePromise = this.resumeConnectorOnce();
    try {
      return await this.resumePromise;
    } finally {
      this.resumePromise = null;
    }
  }

  private async resumeConnectorOnce(): Promise<ActiveSession | null> {
    const stored = await this.connectorStore?.load();
    if (!stored || stored.apiBaseUrl !== this.http.baseUrl) {
      return null;
    }
    // Other Agent operations or manual edits can renew the session after this
    // credential was saved. Only the server can decide whether it expired.
    this.connection.apply("resume-started");
    try {
      const claim = await this.http.resumeConnector(
        stored.sessionId,
        stored.connectorToken,
      );
      const resumed = this.activeSession(claim);
      const saved = this.boundWorkspace
        ? null
        : await this.workspaceBindingStore?.load();
      if (!this.boundWorkspace && saved) {
        if (
          saved.apiBaseUrl !== this.http.baseUrl ||
          saved.sessionId !== claim.sessionId
        )
          throw new AgentSessionError(
            "WORKSPACE_BINDING_STALE",
            "The task target belongs to another session; clear it with bind-workspace workspaceId:null before rebinding",
            "request-rejected",
          );
        // One roster check per new client, not one extra round trip per action.
        const response = await this.http.projects(
          claim.sessionId,
          claim.agentToken,
          {
            apiVersion: AGENT_API_VERSION,
            requestId: this.newRequestId(),
            operation: "workspace",
            request: { action: "list" },
          },
        );
        const target =
          response.ok &&
          response.operation === "workspace" &&
          response.result.action === "list"
            ? response.result.projects.find(
                (item) => item.workspaceId === saved.workspaceId,
              )
            : undefined;
        if (!target || target.projectId !== saved.projectId)
          throw new AgentSessionError(
            "WORKSPACE_NOT_FOUND",
            "The bound working copy is closed or replaced; clear it with bind-workspace workspaceId:null before rebinding",
            "request-rejected",
          );
        this.http.workspaceId = saved.workspaceId;
        this.boundWorkspace = {
          projectId: target.projectId,
          documentIds: target.cells.map((cell) => cell.documentId),
        };
      }
      if (this.boundWorkspace && claim.sessionId !== stored.sessionId)
        throw new AgentSessionError(
          "WORKSPACE_BINDING_STALE",
          "The bound working copy belongs to another session; explicitly clear the binding",
          "request-rejected",
        );
      this.session = resumed;
      if (this.boundWorkspace && claim.sessionId === stored.sessionId) {
        this.session.projectId = this.boundWorkspace.projectId;
        this.session.documentIds = [...this.boundWorkspace.documentIds];
      } else if (this.boundWorkspace) {
        this.boundWorkspace = null;
        this.http.workspaceId = undefined;
      }
      await this.persistConnector(claim);
      return this.session;
    } catch (error) {
      if (
        error instanceof AgentSessionError &&
        error.category === "unrecoverable-credential"
      ) {
        await this.discardCredential(error.code);
      }
      throw error;
    }
  }

  private activeSession(claim: ClaimSuccess): ActiveSession {
    return {
      sessionId: claim.sessionId,
      agentToken: claim.agentToken,
      tokenExpiresAt: claim.tokenExpiresAt,
      scopes: [...claim.scopes],
      projectId: claim.projectId,
      documentIds: [...claim.documentIds],
    };
  }

  private async persistConnector(claim: ClaimSuccess): Promise<void> {
    if (!this.connectorStore) return;
    const credential: StoredConnectorCredential = {
      version: 1,
      apiBaseUrl: this.http.baseUrl,
      sessionId: claim.sessionId,
      connectorToken: claim.connectorToken,
      connectorExpiresAt: claim.connectorExpiresAt,
      storedAt: this.now(),
    };
    await this.connectorStore.save(credential);
  }

  private tokenValid(session: { tokenExpiresAt: number }): boolean {
    return this.now() < session.tokenExpiresAt - this.tokenExpiryGraceMs;
  }

  private async resolveDocumentId(documentId?: string): Promise<string> {
    // A fresh HTTP command has a persisted connector but no in-memory roster.
    // Restore authorization before choosing a default, just as send() does.
    try {
      await this.ensureSession();
    } catch (error) {
      if (
        error instanceof AgentSessionError &&
        error.category === "unrecoverable-credential"
      ) {
        await this.discardCredential(error.code);
      }
      throw error;
    }
    return documentId ?? this.defaultDocumentId();
  }

  private defaultDocumentId(): string {
    const documentId =
      this.boundWorkspace?.documentIds[0] ?? this.session?.documentIds[0];
    if (!documentId) {
      throw new AgentSessionError(
        "NOT_CONNECTED",
        "no authorized document; call connect first",
        "unrecoverable-credential",
      );
    }
    return documentId;
  }
}

/**
 * A refused report that names the action it refused, by index and kind
 * (#1231), when `indexOf` can tell which one it was.
 */
/** A schema refusal that names the field, as `structureEdits[0].edits[1].kind: …`. */
function schemaIssueText(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "Invalid transaction";
  const path = issue.path
    .map((part, index) =>
      typeof part === "number"
        ? `[${part}]`
        : `${index === 0 ? "" : "."}${String(part)}`,
    )
    .join("");
  return path ? `${path}: ${issue.message}` : issue.message;
}
