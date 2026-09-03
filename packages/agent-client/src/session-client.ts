import {
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
  ok: boolean;
  stage: "compile" | "dry-run" | "commit" | "done";
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
 * Unified Agent-side Helper (ADR 0020). Owns claim/resume, token and session
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
  private readonly tokenExpiryGraceMs: number;
  private readonly connectorStore: ConnectorStore | undefined;
  private readonly inflight = new Map<string, Promise<AgentCircuitResponse>>();
  private session: ActiveSession | null = null;
  private capabilitiesCache: AgentCapabilitiesResponse | null = null;
  private resumePromise: Promise<ActiveSession | null> | null = null;

  constructor(options: AgentSessionClientOptions) {
    this.http = options.http;
    this.now = options.now ?? (() => Date.now());
    this.newRequestId =
      options.newRequestId ?? (() => `req-${crypto.randomUUID()}`);
    this.networkRetryAttempts = options.networkRetryAttempts ?? 1;
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
    if (options.refresh && this.session) {
      try {
        await this.capabilities({ force: true });
      } catch (error) {
        if (!(error instanceof AgentSessionError)) throw error;
        // dispatch already records offline/revoked. Other failed probes must
        // not leave a stale green status (nor destroy a usable credential).
        if (
          error.category !== "editor-offline" &&
          error.category !== "unrecoverable-credential"
        )
          this.connection.apply("transport-interrupted", error.code);
      }
    }
    return {
      ...this.connection.snapshot,
      sessionId: this.session?.sessionId ?? null,
      projectId: this.session?.projectId ?? null,
      documentIds: [...(this.session?.documentIds ?? [])],
      tokenExpiresAt: this.session?.tokenExpiresAt ?? null,
      tokenValid: this.session ? this.tokenValid(this.session) : false,
      cachedDocuments: [...this.cache.documents()],
    };
  }

  /** Invoke the canonical browser-hosted file-resource contract. */
  async fileResource(
    request: AgentFileResourceRequest,
  ): Promise<AgentFileResourceResponse> {
    return this.withAuthorization((session) =>
      this.http.files(session.sessionId, session.agentToken, request),
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
    const target = documentId ?? this.defaultDocumentId();
    const cached = this.cache.get(target);
    if (cached && !cached.dirty && !options.refresh) return cached;
    return this.refreshSnapshot(target);
  }

  async refreshSnapshot(documentId?: string): Promise<CachedSnapshot> {
    const target = documentId ?? this.defaultDocumentId();
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
      documentId: documentId ?? this.defaultDocumentId(),
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
    const documentId = options.documentId ?? this.defaultDocumentId();
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
   * transaction, dry-run it, then commit it. A concurrent human edit surfaces
   * as `STATE_CHANGED` with the objects that moved, never as a blind overwrite.
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
      preview: true,
    });
  }

  /** Same four-operation API; the helper only supplies identity and revisions. */
  async advancedTransact(
    payload: unknown,
    options: { documentId?: string; dryRun?: boolean } = {},
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
    const entry = await this.snapshot(options.documentId, { refresh: true });
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
    options: { dryRun?: boolean; preview?: boolean },
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
    if (options.preview && !options.dryRun && !parsed.data.semanticIntent) {
      const preview = await this.send(request(true));
      if (!preview.ok) {
        if (
          preview.error.code === "STALE_REVISION" ||
          preview.error.code === "STALE_STRUCTURE_REVISION"
        )
          return this.stateChangedReport(entry, preview.error.message);
        return {
          ok: false,
          stage: "dry-run",
          code: preview.error.code,
          message: preview.error.message,
          diagnostics: preview.diagnostics,
          revision: entry.revision,
        };
      }
    }
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
    const existing = this.inflight.get(request.requestId);
    if (existing) return existing;
    const pending = this.dispatch(request);
    this.inflight.set(request.requestId, pending);
    try {
      return await pending;
    } finally {
      this.inflight.delete(request.requestId);
    }
  }

  private async dispatch(
    request: AgentCircuitRequest,
  ): Promise<AgentCircuitResponse> {
    let attempts = 0;
    for (;;) {
      try {
        const response = await this.withAuthorization((session) =>
          this.http.circuit(session.sessionId, session.agentToken, request),
        );
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
    if (
      !stored ||
      stored.apiBaseUrl !== this.http.baseUrl ||
      this.now() >= stored.connectorExpiresAt
    ) {
      if (stored) await this.connectorStore?.clear();
      return null;
    }
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
