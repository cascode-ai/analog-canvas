import {
  parseAgentCircuitRequest,
  AgentCapabilitiesResponseSchema,
  AgentRenderResponseSchema,
  AgentTransactionPayloadSchema,
  AgentTransactSuccessResponseSchema,
  AGENT_API_VERSION,
  type AgentCircuitRequest,
  type AgentCircuitResponse,
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
  changedObjectIds,
  snapshotSummary,
  type CachedSnapshot,
  type SnapshotSummary,
} from "./snapshot-cache.js";
import {
  ActionCompileError,
  compileActions,
  type CompiledTransaction,
} from "./authoring-helper.js";

interface ActiveSession {
  sessionId: string;
  agentToken: string;
  tokenExpiresAt: number;
  scopes: string[];
  projectId: string;
  documentIds: string[];
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
  context: SnapshotSummary | null;
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
    if (claimCode === undefined || claimCode.trim() === "") {
      const resumed = await this.tryResume();
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
      this.receipts.length = 0;
      this.capabilitiesCache = null;
      this.observation = null;
      this.session = this.activeSession(claim);
      await this.persistConnector(claim);
      return await this.establishContext("claimed");
    } catch (error) {
      if (!this.session) this.connection.apply("reset");
      throw error;
    }
  }

  private async tryResume(): Promise<ConnectReport | null> {
    let stored = this.session;
    if (!stored || !this.tokenValid(stored)) {
      stored = await this.resumeConnector();
    }
    if (!stored) return null;
    this.connection.apply("resume-started");
    try {
      return await this.establishContext("resumed");
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
  ): Promise<ConnectReport> {
    const capabilities = await this.capabilities({ force: true });
    let context: SnapshotSummary | null = null;
    let editorOffline = false;
    const documentId = this.session?.documentIds[0];
    if (documentId) {
      try {
        context = snapshotSummary(await this.snapshot(documentId));
      } catch (error) {
        // An offline editor still leaves a paired, resumable session; the
        // host will see editor-offline through connection_status.
        if (
          error instanceof AgentSessionError &&
          (error.category === "editor-offline" || error.category === "network")
        ) {
          editorOffline = true;
        } else {
          throw error;
        }
      }
    }
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
    };
  }

  async status(options: { refresh?: boolean } = {}): Promise<StatusReport> {
    if (options.refresh && (this.session || this.connectorStore)) {
      try {
        this.observation = await this.withAuthorization((session) =>
          this.http.status(session.sessionId, session.agentToken),
        );
        this.connection.observe(this.observation);
        this.updateDocumentRoster(this.observation.documentIds);
      } catch (error) {
        if (!(error instanceof AgentSessionError)) throw error;
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
      if (request.operation === "transact") this.cache.clear();
    }
  }

  /** Invoke the canonical browser-hosted file-resource contract. */
  async fileResource(
    request: AgentFileResourceRequest,
  ): Promise<AgentFileResourceResponse> {
    request = structuredClone(request);
    return this.resourceRequest("files", request, (session) =>
      this.http.files(session.sessionId, session.agentToken, request),
    );
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
    return this.resourceRequest("simulation", request, (session) =>
      this.http.simulation(session.sessionId, session.agentToken, request),
    );
  }

  /** Discover and import reusable Cells through the browser's Cloud authority. */
  async projectResource(
    request: AgentProjectResourceRequest,
  ): Promise<AgentProjectResourceResponse> {
    request = structuredClone(request);
    return this.resourceRequest("projects", request, (session) =>
      this.http.projects(session.sessionId, session.agentToken, request),
    );
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
    if (!response.ok || response.operation !== "snapshot") {
      throw new AgentSessionError(
        response.ok ? "INVALID_RESPONSE" : response.error.code,
        response.ok
          ? "unexpected operation for snapshot"
          : response.error.message,
        "request-rejected",
      );
    }
    const snapshotResponse = response;
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
    return entry;
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
    if (!response.ok || response.operation !== "snapshot")
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
   * Compile high-level actions against a fresh Snapshot, require one atomic
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
    const entry = await this.snapshot(options.documentId, { refresh: true });
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
        entry,
        { wireIntent: compiled.map((item) => item.wireIntent!) },
        {
          dryRun: options.dryRunOnly ?? false,
        },
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
    return this.submitTransaction(entry, payload, {
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
    const entry =
      options.snapshot ??
      (await this.snapshot(options.documentId, { refresh: true }));
    if (
      options.snapshot &&
      (entry.dirty || entry.snapshot.project.id !== this.session?.projectId)
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
      entry.snapshot.project.structureRevision !==
        options.expectedStructureRevision
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

  private async submitTransaction(
    entry: CachedSnapshot,
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
      expectedStructureRevision: entry.snapshot.project.structureRevision,
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
      if (response.projectStructure) this.cache.clear();
      else this.cache.markDirty(entry.documentId, response.revision);
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
    entry: CachedSnapshot,
    message: string,
  ): Promise<ApplyActionsReport> {
    const fresh = await this.refreshSnapshot(entry.documentId);
    return {
      ok: false,
      stage: "commit",
      code: "STATE_CHANGED",
      message:
        message ??
        "the document revision changed; re-inspect the affected objects and retry",
      revision: fresh.revision,
      changedObjectIds: changedObjectIds(entry.snapshot, fresh.snapshot),
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
    for (;;) {
      try {
        const response = await this.withAuthorization((session) => {
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
          return operation(session);
        });
        this.connection.apply("request-succeeded");
        return response;
      } catch (error) {
        if (!(error instanceof AgentSessionError)) throw error;
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
    this.capabilitiesCache = null;
    this.cache.clear();
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
