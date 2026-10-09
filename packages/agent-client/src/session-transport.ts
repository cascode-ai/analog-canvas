/**
 * The session client's base layer: session and connector state,
 * authorization and connector resume, canonical requests with
 * exact-payload request-ID retry, status, and the Document roster and
 * revision hints the layers above share.
 */
import {
  AgentCapabilitiesResponseSchema,
  AGENT_API_VERSION,
  type AgentCircuitRequest,
  type AgentCircuitResponse,
  type AgentSimulationResourceResponse,
  type AgentSessionStatusResponse,
} from "@icm/agent-adapter";
import { z } from "zod";
import {
  ConnectionTracker,
  type ConnectionSnapshot,
} from "./connection-state.js";
import { AgentSessionError } from "./errors.js";
import {
  AgentHttpClient,
  type AgentHttpAttempts,
  type AgentRequestTiming,
  type ClaimSuccess,
} from "./http-client.js";
import {
  type ConnectorStore,
  type StoredConnectorCredential,
} from "./connector-store.js";
import { SnapshotCache } from "./snapshot-cache.js";
import type { WorkspaceBindingStore } from "./workspace-binding-store.js";
import type { ApplyActionsReport } from "./session-receipts.js";

export type AgentCapabilitiesResponse = z.infer<
  typeof AgentCapabilitiesResponseSchema
>;

export interface ActiveSession {
  sessionId: string;
  agentToken: string;
  tokenExpiresAt: number;
  scopes: string[];
  projectId: string;
  documentIds: string[];
}

export interface KnownRevision {
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

export interface StatusReport extends ConnectionSnapshot {
  observation: AgentSessionStatusResponse | null;
  sessionId: string | null;
  projectId: string | null;
  documentIds: string[];
  tokenExpiresAt: number | null;
  tokenValid: boolean;
  cachedDocuments: string[];
}

export function baseRequest(requestId: string): {
  apiVersion: typeof AGENT_API_VERSION;
  requestId: string;
} {
  return { apiVersion: AGENT_API_VERSION, requestId };
}

export abstract class AgentSessionTransport {
  readonly connection: ConnectionTracker;
  protected readonly http: AgentHttpClient;

  /** See AgentHttpClient.requestTimings (#1227). */
  timingMark(): number {
    return this.http.timingMark();
  }

  timingsSince(mark: number): AgentRequestTiming[] {
    return this.http.timingsSince(mark);
  }
  protected readonly cache = new SnapshotCache();
  /** Revisions are authority hints only; every write is still checked by the Editor. */
  protected readonly knownRevisions = new Map<string, KnownRevision>();
  protected readonly now: () => number;
  protected readonly newRequestId: () => string;
  private readonly networkRetryAttempts: number;
  private readonly offlineRetryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly tokenExpiryGraceMs: number;
  protected readonly connectorStore: ConnectorStore | undefined;
  protected readonly workspaceBindingStore: WorkspaceBindingStore | undefined;
  protected readonly requireDurableWorkspaceBinding: boolean;
  protected readonly inflight = new Map<
    string,
    { payload: string; promise: Promise<unknown> }
  >();
  protected session: ActiveSession | null = null;
  protected observation: AgentSessionStatusResponse | null = null;
  protected boundWorkspace: {
    projectId: string;
    documentIds: string[];
  } | null = null;
  protected capabilitiesCache: AgentCapabilitiesResponse | null = null;
  private resumePromise: Promise<ActiveSession | null> | null = null;
  protected simulationMetadata = new Map<
    string,
    {
      at: number;
      response: AgentSimulationResourceResponse;
    }
  >();
  protected readonly receipts: ApplyActionsReport[] = [];

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

  protected updateDocumentRoster(
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

  protected rememberRevision(
    value: Omit<KnownRevision, "sessionId" | "contextRevision">,
  ): void {
    if (!this.session || value.projectId !== this.session.projectId) return;
    this.knownRevisions.set(value.documentId, {
      ...value,
      sessionId: this.session.sessionId,
      contextRevision: this.http.contextRevision,
    });
  }

  protected async send(
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

  protected async resourceRequest<T>(
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

  protected async discardCredential(code: string): Promise<void> {
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

  protected async ensureSession(): Promise<ActiveSession> {
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

  protected async withAuthorization<T>(
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

  protected async resumeConnector(): Promise<ActiveSession | null> {
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

  protected activeSession(claim: ClaimSuccess): ActiveSession {
    return {
      sessionId: claim.sessionId,
      agentToken: claim.agentToken,
      tokenExpiresAt: claim.tokenExpiresAt,
      scopes: [...claim.scopes],
      projectId: claim.projectId,
      documentIds: [...claim.documentIds],
    };
  }

  protected async persistConnector(claim: ClaimSuccess): Promise<void> {
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

  protected tokenValid(session: { tokenExpiresAt: number }): boolean {
    return this.now() < session.tokenExpiresAt - this.tokenExpiryGraceMs;
  }

  protected async resolveDocumentId(documentId?: string): Promise<string> {
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

  protected defaultDocumentId(): string {
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
