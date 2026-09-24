import {
  parseAgentCircuitRequest,
  AgentBootstrapSnapshotResponseSchema,
  AgentGeometrySnapshotResponseSchema,
  AgentAuthoringCommandSchema,
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
import { AgentHttpClient, type ClaimSuccess } from "./http-client.js";
import {
  type ConnectorStore,
  type StoredConnectorCredential,
} from "./connector-store.js";
import {
  SnapshotCache,
  bootstrapFromFullSnapshot,
  bootstrapSummary,
  changedObjectIds,
  type CachedSnapshot,
  type BootstrapSummary,
  type SnapshotSummary,
} from "./snapshot-cache.js";
import {
  ActionCompileError,
  compileActions,
  type CompiledTransaction,
} from "./authoring-helper.js";
import { AuthoringActionSchema } from "./authoring-actions.js";

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
  changedObjectIds?: string[];
  errors?: number;
  warnings?: number;
  dryRun?: boolean;
}

function baseRequest(requestId: string): {
  apiVersion: typeof AGENT_API_VERSION;
  requestId: string;
} {
  return { apiVersion: AGENT_API_VERSION, requestId };
}

const BATCHABLE_COMMAND_KINDS = new Set([
  "set-net-label",
  "set-model",
  "move-annotation",
]);

/**
 * Unified Agent-side Helper (Agent rationale). Owns claim/resume, token and session
 * state, capabilities/revision caches, exact-payload request-ID retry, the
 * Snapshot cache, and compilation-plus-execution of high-level actions.
 * Bearer tokens remain process-local and are sent only in Authorization
 * headers. A revocable connector credential may be persisted by M4 so a new
 * MCP process can resume without another claim-code hand-off.
 */
export class AgentSessionClient {
  readonly connection: ConnectionTracker;
  private readonly http: AgentHttpClient;
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
  private readonly inflight = new Map<
    string,
    { payload: string; promise: Promise<unknown> }
  >();
  private session: ActiveSession | null = null;
  private observation: AgentSessionStatusResponse | null = null;
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
        if (this.session) this.session.projectId = this.observation.projectId;
        this.updateDocumentRoster(this.observation.documentIds);
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
      projectId: this.session?.projectId ?? null,
      documentIds: [...(this.session?.documentIds ?? [])],
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
      request.operation === "simulation-input" &&
      request.input.action === "update" &&
      request.input.owner.kind === "project-folder";
    try {
      return await this.resourceRequest("files", request, (session) =>
        this.http.files(session.sessionId, session.agentToken, request),
      );
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
      (session) =>
        this.http.simulation(session.sessionId, session.agentToken, request),
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
      request.operation === "replace-project-code" ||
      request.operation === "replace-netlist" ||
      (request.operation === "workspace" && request.request.action !== "list");
    try {
      return await this.resourceRequest("projects", request, (session) =>
        this.http.projects(session.sessionId, session.agentToken, request),
      );
    } finally {
      // A lost reply may follow a committed edit or workspace switch.
      if (changesProject) {
        this.cache.clear();
        this.knownRevisions.clear();
      }
    }
  }

  /** Revoke the server session and forget the durable connector locally. */
  async disconnect(): Promise<void> {
    try {
      const session = await this.ensureSession();
      await this.http.disconnect(session.sessionId, session.agentToken);
    } finally {
      await this.discardCredential("DISCONNECTED");
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
    const target = await this.resolveDocumentId(documentId);
    const requestId = this.newRequestId();
    const response = await this.send({
      ...baseRequest(requestId),
      operation: "snapshot",
      documentId: target,
    });
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
      requestId,
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
      if (
        response.ok &&
        response.operation === "snapshot" &&
        "snapshot" in response
      ) {
        const entry: CachedSnapshot = {
          documentId: target,
          revision: response.revision,
          snapshot: response.snapshot,
          diagnostics: [...response.diagnostics],
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
        const fallback = bootstrapFromFullSnapshot(response.snapshot);
        this.updateDocumentRoster(
          fallback.project.documents.map((document) => document.id),
          fallback.project.topDocumentId,
        );
        return fallback;
      }
      if (!response.ok && response.error.code === "INVALID_REQUEST") {
        // During a rolling deployment an older Editor rejects the new optional
        // projection field. Fall back once to the established full request.
        const full = await this.refreshSnapshot(target);
        const fallback = bootstrapFromFullSnapshot(full.snapshot);
        return fallback;
      }
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

  /** Read selected authored geometry without resolving topology or diagnostics. */
  async geometrySnapshot(
    objectIds: readonly string[],
    documentId?: string,
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
    });
    if (!response.ok && response.error.code === "INVALID_REQUEST") {
      // An older Editor may reject the projection during a rolling deploy.
      const full = await this.refreshSnapshot(target);
      const document = full.snapshot.document;
      const objects: unknown[] = [];
      const found = new Set<string>();
      for (const id of ids) {
        const instance = document.instances.find((item) => item.id === id);
        if (instance) {
          objects.push({ kind: "instance", id, placement: instance.placement });
          found.add(id);
          continue;
        }
        const route = document.routes.find((item) => item.id === id);
        if (route) {
          objects.push({
            kind: "route",
            id,
            netId: route.netId,
            start: route.start,
            legs: route.legs,
            ...(route.presentation ? { presentation: route.presentation } : {}),
          });
          found.add(id);
          continue;
        }
        const junction = document.junctions.find((item) => item.id === id);
        if (junction) {
          objects.push({
            kind: "junction",
            id,
            netId: junction.netId,
            position: junction.position,
          });
          found.add(id);
          continue;
        }
        const annotation = document.annotations.find((item) => item.id === id);
        if (annotation) {
          objects.push({
            kind: "annotation",
            id,
            anchor: annotation.anchor,
            rotation: annotation.rotation,
            alignment: annotation.alignment,
          });
          found.add(id);
          continue;
        }
        const drafting = document.drafting.objects.find(
          (item) => item.object.id === id,
        );
        if (drafting) {
          objects.push({ kind: "drafting", id, object: drafting.object });
          found.add(id);
          continue;
        }
        const noConnect = document.noConnects.find((item) => item.id === id);
        if (noConnect) {
          objects.push({ kind: "no-connect", id, object: noConnect });
          found.add(id);
        }
      }
      return AgentGeometrySnapshotResponseSchema.parse({
        apiVersion: AGENT_API_VERSION,
        requestId: response.requestId,
        operation: "snapshot",
        ok: true,
        projection: "geometry",
        projectId: full.snapshot.project.id,
        structureRevision: full.snapshot.project.structureRevision,
        documentId: target,
        revision: full.revision,
        objects,
        missingObjectIds: ids.filter((id) => !found.has(id)),
      });
    }
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
    return this.cache.get(documentId ?? this.defaultDocumentId());
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
   * Compile high-level actions against the current clean Snapshot, require one atomic
   * transaction, then commit it in a single request. The commit validates
   * atomically, so a concurrent human edit surfaces as `STATE_CHANGED` with
   * the objects that moved, never as a blind overwrite.
   */
  async applyActions(
    actions: readonly unknown[],
    options: {
      documentId?: string;
      dryRunOnly?: boolean;
    } = {},
  ): Promise<ApplyActionsReport> {
    const parsed = z.array(AuthoringActionSchema).safeParse(actions);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        stage: "compile",
        code: "ACTION_COMPILE_FAILED",
        message: issue
          ? `${issue.path.join(".")}: ${issue.message}`
          : "invalid action",
        actionIndex: Number(issue?.path[0] ?? 0) || 0,
        actionKind: "schema",
      };
    }
    const direct = parsed.data;
    if (direct.length === 1) {
      const action = direct[0]!;
      const command = AgentAuthoringCommandSchema.safeParse(action);
      if (
        command.success ||
        action.kind === "focus" ||
        action.kind === "undo" ||
        action.kind === "redo"
      ) {
        const revision = await this.revisionFor(options.documentId);
        const payload =
          action.kind === "focus"
            ? { semanticIntent: action.intent }
            : action.kind === "undo" || action.kind === "redo"
              ? { edits: [{ kind: action.kind }] }
              : { command: command.data };
        return this.submitTransaction(revision, payload, {
          dryRun: options.dryRunOnly ?? false,
        });
      }
    }
    if (
      direct.length > 1 &&
      direct.length <= 64 &&
      direct.every((action) => BATCHABLE_COMMAND_KINDS.has(action.kind))
    ) {
      const revision = await this.revisionFor(options.documentId);
      return this.submitTransaction(
        revision,
        { command: { kind: "batch", commands: direct } },
        { dryRun: options.dryRunOnly ?? false },
      );
    }
    const entry = await this.snapshot(options.documentId);
    let compiled: CompiledTransaction[];
    try {
      compiled = compileActions(actions, {
        snapshot: entry.snapshot,
        allocateId: (prefix) => `${prefix}-${crypto.randomUUID()}`,
        maxEditsPerTransaction:
          this.capabilitiesCache?.capabilities.limits.maxTransactionEdits ?? 64,
      });
    } catch (error) {
      if (!(error instanceof ActionCompileError)) throw error;
      return {
        ok: false,
        stage: "compile",
        code: "ACTION_COMPILE_FAILED",
        message: error.message,
        actionIndex: error.index,
        actionKind: error.actionKind,
        revision: entry.revision,
      };
    }
    if (
      compiled.length > 1 &&
      compiled.every((item) => item.form === "wire-intent")
    ) {
      return this.submitTransaction(
        this.revisionFromSnapshot(entry),
        { wireIntent: compiled.map((item) => item.wireIntent!) },
        {
          dryRun: options.dryRunOnly ?? false,
        },
      );
    }
    const batchCommands = compiled.flatMap((item) =>
      item.form === "command" &&
      item.command &&
      (item.command.kind === "set-net-label" ||
        item.command.kind === "set-model" ||
        item.command.kind === "move-annotation")
        ? [item.command]
        : [],
    );
    if (
      compiled.length > 1 &&
      compiled.length <= 64 &&
      batchCommands.length === compiled.length
    ) {
      return this.submitTransaction(
        this.revisionFromSnapshot(entry),
        { command: { kind: "batch", commands: batchCommands } },
        { dryRun: options.dryRunOnly ?? false },
      );
    }
    if (compiled.length !== 1)
      return {
        ok: false,
        stage: "compile",
        code: "ACTION_BATCH_NOT_ATOMIC",
        message:
          "Split work into one edit batch, wire, command, or focus operation per call.",
        revision: entry.revision,
        transactions: compiled.length,
      };
    const transaction = compiled[0]!;
    const payload =
      transaction.form === "edits"
        ? { edits: transaction.edits }
        : transaction.form === "command"
          ? { command: transaction.command }
          : transaction.form === "semantic"
            ? { semanticIntent: transaction.semanticIntent }
            : { wireIntent: transaction.wireIntent };
    return this.submitTransaction(this.revisionFromSnapshot(entry), payload, {
      dryRun: options.dryRunOnly ?? false,
    });
  }

  /** Same four-operation API; the helper only supplies identity and revisions. */
  async advancedTransact(
    payload: unknown,
    options: {
      documentId?: string;
      dryRun?: boolean;
      expectedStructureRevision?: number;
      /** Reuse the snapshot read by this composed operation; commit still checks revisions. */
      snapshot?: CachedSnapshot;
    } = {},
  ): Promise<ApplyActionsReport> {
    const normalized = Array.isArray(payload) ? { edits: payload } : payload;
    const parsed = AgentTransactionPayloadSchema.safeParse(normalized);
    if (!parsed.success)
      return {
        ok: false,
        stage: "compile",
        code: "EDIT_SCHEMA_INVALID",
        message: parsed.error.issues[0]?.message ?? "Invalid transaction",
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
    options: { dryRun?: boolean },
  ): Promise<ApplyActionsReport> {
    const parsed = AgentTransactionPayloadSchema.safeParse(payload);
    if (!parsed.success)
      return {
        ok: false,
        stage: "compile",
        code: "EDIT_SCHEMA_INVALID",
        message: parsed.error.issues[0]?.message ?? "Invalid transaction",
      };
    const request = (dryRun: boolean): AgentCircuitRequest => ({
      ...baseRequest(this.newRequestId()),
      operation: "transact",
      documentId: entry.documentId,
      transactionId: `txn-${crypto.randomUUID()}`,
      expectedRevision: entry.revision,
      expectedStructureRevision: entry.structureRevision,
      dryRun,
      ...parsed.data,
    });
    // One request, no client-side dry-run pass: the commit validates the
    // whole transaction atomically and returns the same diagnostics a
    // dry-run would, without the extra relayed round trip per edit.
    const response = await this.send(request(options.dryRun ?? false));
    if (!response.ok) {
      if (
        response.error.code === "STALE_REVISION" ||
        response.error.code === "STALE_STRUCTURE_REVISION"
      )
        return this.stateChangedReport(entry, response.error.message);
      return {
        ok: false,
        stage: "commit",
        code: response.error.code,
        message: response.error.message,
        diagnostics: response.diagnostics,
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
    const report: ApplyActionsReport = {
      ok: true,
      stage: "done",
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
      diagnostics: response.diagnostics,
      errors: response.diagnostics.filter((item) => item.severity === "error")
        .length,
      warnings: response.diagnostics.filter(
        (item) => item.severity === "warning",
      ).length,
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
    return this.resourceRequest("circuit", request, (session) =>
      this.http.circuit(session.sessionId, session.agentToken, request),
    );
  }

  private async resourceRequest<T>(
    resource: string,
    request: { requestId: string },
    operation: (session: ActiveSession) => Promise<T>,
  ): Promise<T> {
    const existing = this.inflight.get(request.requestId);
    const payload = JSON.stringify([resource, request]);
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
    operation: (session: ActiveSession) => Promise<T>,
  ): Promise<T> {
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
          return operation(session);
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
          continue;
        }
        if (error.category === "editor-offline") {
          this.connection.apply("editor-detached", error.code);
          // OFFLINE is rejected before forwarding; DISCONNECTED is uncertain.
          // Never turn an uncertain mutation/start into a new request ID.
          const delay = this.offlineRetryDelaysMs[offlineAttempts++];
          if (error.code === "EDITOR_OFFLINE" && delay !== undefined) {
            await this.sleep(delay);
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
      this.session = this.activeSession(claim);
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
    const documentId = this.session?.documentIds[0];
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
