import type { AgentSessionScope, AgentTransportErrorCode } from "./envelope.js";
import { sha256Hex } from "@icm/derived";

/**
 * Pure, runtime-agnostic Agent session state machine (WP-WA4). All time is
 * injected (`now`, epoch ms) and all randomness is injected (`random`), so the
 * entire authorization/idempotency/expiry/limit contract is deterministic and
 * fake-time testable without the Cloudflare runtime.
 *
 * Contract source: [`docs/specs/web-agent-session.md`](../../docs/specs/web-agent-session.md).
 * The machine never inspects or persists a Project and never creates an actor or
 * edit — it only authenticates, authorizes, deduplicates, expires, and rate
 * limits. Secrets are stored as verifiers and compared in constant time.
 */

export type AgentSessionStatus = "active" | "paused" | "revoked";

export interface AgentSessionLimits {
  /** Short hand-off claim lifetime. */
  claimTtlMs: number;
  /** Capability token lifetime. */
  tokenTtlMs: number;
  /** Whole-session lifetime; the token never outlives it. */
  sessionTtlMs: number;
  /** Hard request-body ceiling before any forward. */
  maxRequestBytes: number;
  /** Hard browser relay envelope ceiling (request or response). */
  maxMessageBytes: number;
  /** Sliding request rate limit. */
  rateLimit: { windowMs: number; maxRequests: number };
  /** How long a completed requestId result is served as idempotent. */
  resultCacheTtlMs: number;
  /** Maximum count and aggregate serialized bytes retained in relay memory. */
  resultCacheMaxEntries: number;
  resultCacheMaxBytes: number;
}

export const DEFAULT_AGENT_SESSION_LIMITS: AgentSessionLimits = {
  claimTtlMs: 30 * 60 * 1000,
  tokenTtlMs: 8 * 60 * 60 * 1000,
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  maxRequestBytes: 2_000_000,
  maxMessageBytes: 6_000_000,
  rateLimit: { windowMs: 60_000, maxRequests: 60 },
  resultCacheTtlMs: 5 * 60 * 1000,
  resultCacheMaxEntries: 32,
  resultCacheMaxBytes: 16_000_000,
};

/** Secrets returned once when a session is created. */
export interface CreatedAgentSession {
  sessionId: string;
  editorSecret: string;
  claimCode: string;
  claimExpiresAt: number;
  expiresAt: number;
}

/** A successfully redeemed claim yields a bearer token, returned once. */
export interface RedeemedAgentClaim {
  agentToken: string;
  tokenExpiresAt: number;
  connectorToken: string;
  connectorExpiresAt: number;
  scopes: AgentSessionScope[];
}

export interface AuthorizedAgent {
  sessionId: string;
  scopes: AgentSessionScope[];
  expiresAt: number;
}

export type SessionAuthorizationResult =
  | { ok: true; session: AuthorizedAgent }
  | { ok: false; code: AgentTransportErrorCode };

export type RequestBeginResult =
  | { kind: "cached"; result: unknown }
  | { kind: "proceed" }
  | { kind: "rejected"; code: AgentTransportErrorCode };

interface ClaimRecord {
  codeVerifier: string;
  expiresAt: number;
  /** Retained only to distinguish an unclaimed session in persisted state. */
  used: boolean;
}

interface TokenRecord {
  verifier: string;
  scopes: AgentSessionScope[];
  expiresAt: number;
}

interface ConnectorRecord {
  verifier: string;
  expiresAt: number;
}

interface RateWindow {
  windowStart: number;
  count: number;
}

interface CachedResult {
  /** Omitted for one-shot artifacts so the relay never retains their bytes. */
  result?: unknown;
  unavailable?: true;
  completedAt: number;
  payloadHash: string;
  byteLength: number;
}

interface PendingRequest {
  payloadHash: string;
  startedAt: number;
  completedAt?: number;
}

interface SessionInternals {
  sessionId: string;
  editorSecretVerifier: string;
  projectSessionId: string;
  projectId: string;
  documentIds: Set<string>;
  scopes: AgentSessionScope[];
  status: AgentSessionStatus;
  expiresAt: number;
  claim: ClaimRecord | null;
  token: TokenRecord | null;
  connector: ConnectorRecord | null;
  rateWindow: RateWindow;
  cache: Map<string, CachedResult>;
  pending: Map<string, PendingRequest>;
}

/** Constant-time string equality for equal-length high-entropy secrets. */
export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function secretVerifier(secret: string): string {
  return sha256Hex(secret);
}

export interface PersistedAgentSessionState {
  version: 1;
  limits: AgentSessionLimits;
  sessionId: string;
  editorSecretVerifier: string;
  projectSessionId: string;
  projectId: string;
  documentIds: string[];
  scopes: AgentSessionScope[];
  status: AgentSessionStatus;
  expiresAt: number;
  claim: ClaimRecord | null;
  token: TokenRecord | null;
  /** Optional for backward-compatible restore of pre-M4 Durable Object state. */
  connector?: ConnectorRecord | null;
  rateWindow: RateWindow;
  requestLedger?: Array<[string, PendingRequest]>;
}

export interface CreateAgentSessionOptions {
  limits?: Partial<AgentSessionLimits>;
  sessionId?: string;
  projectSessionId: string;
  projectId: string;
  documentIds: readonly string[];
  scopes: readonly AgentSessionScope[];
  now: number;
  random: () => string;
}

export class AgentSessionMachine {
  private readonly activeRequests = new Set<string>();

  private constructor(
    private readonly limits: AgentSessionLimits,
    private readonly internals: SessionInternals,
    private readonly random: () => string,
  ) {}

  /**
   * Create a session bound to an immutable `projectSessionId`, a Project
   * identity, and the authorized Document set. Plaintext secrets are returned
   * once; only verifiers are retained. The granted scopes are carried into any
   * token minted at claim redemption.
   */
  static create(options: CreateAgentSessionOptions): {
    machine: AgentSessionMachine;
    session: CreatedAgentSession;
  } {
    const limits = { ...DEFAULT_AGENT_SESSION_LIMITS, ...options.limits };
    const sessionId = options.sessionId ?? options.random();
    const editorSecret = options.random();
    const claimCode = options.random();
    const claimExpiresAt = options.now + limits.claimTtlMs;
    const expiresAt = options.now + limits.sessionTtlMs;
    const machine = new AgentSessionMachine(
      limits,
      {
        sessionId,
        editorSecretVerifier: secretVerifier(editorSecret),
        projectSessionId: options.projectSessionId,
        projectId: options.projectId,
        documentIds: new Set(options.documentIds),
        scopes: [...options.scopes],
        status: "active",
        expiresAt,
        claim: {
          codeVerifier: secretVerifier(claimCode),
          expiresAt: claimExpiresAt,
          used: false,
        },
        token: null,
        connector: null,
        rateWindow: { windowStart: options.now, count: 0 },
        cache: new Map(),
        pending: new Map(),
      },
      options.random,
    );
    return {
      machine,
      session: {
        sessionId,
        editorSecret,
        claimCode,
        claimExpiresAt,
        expiresAt,
      },
    };
  }

  get sessionId(): string {
    return this.internals.sessionId;
  }

  get projectId(): string {
    return this.internals.projectId;
  }

  get projectSessionId(): string {
    return this.internals.projectSessionId;
  }

  get documentIds(): string[] {
    return [...this.internals.documentIds].sort();
  }

  get scopes(): AgentSessionScope[] {
    return [...this.internals.scopes];
  }

  get expiresAt(): number {
    return this.internals.expiresAt;
  }

  /** Whether this session currently has a live Agent capability. */
  get claimed(): boolean {
    return this.internals.claim?.used === true && this.internals.token !== null;
  }

  static restore(
    state: PersistedAgentSessionState,
    random: () => string,
  ): AgentSessionMachine {
    if (state.version !== 1) {
      throw new Error("Unsupported Agent session state version");
    }
    return new AgentSessionMachine(
      { ...DEFAULT_AGENT_SESSION_LIMITS, ...structuredClone(state.limits) },
      {
        sessionId: state.sessionId,
        editorSecretVerifier: state.editorSecretVerifier,
        projectSessionId: state.projectSessionId,
        projectId: state.projectId,
        documentIds: new Set(state.documentIds),
        scopes: [...state.scopes],
        status: state.status,
        expiresAt: state.expiresAt,
        claim: state.claim ? { ...state.claim } : null,
        token: state.token
          ? { ...state.token, scopes: [...state.token.scopes] }
          : null,
        connector: state.connector ? { ...state.connector } : null,
        rateWindow: { ...state.rateWindow },
        // Project-bearing responses remain process-local. Only request IDs,
        // payload hashes, and timestamps survive to preserve at-most-once
        // execution without retaining Snapshot/render bodies.
        cache: new Map(),
        pending: new Map(
          (state.requestLedger ?? []).map(([id, value]) => [id, { ...value }]),
        ),
      },
      random,
    );
  }

  serialize(): PersistedAgentSessionState {
    return {
      version: 1,
      limits: structuredClone(this.limits),
      sessionId: this.internals.sessionId,
      editorSecretVerifier: this.internals.editorSecretVerifier,
      projectSessionId: this.internals.projectSessionId,
      projectId: this.internals.projectId,
      documentIds: this.documentIds,
      scopes: this.scopes,
      status: this.internals.status,
      expiresAt: this.internals.expiresAt,
      claim: this.internals.claim ? { ...this.internals.claim } : null,
      token: this.internals.token
        ? { ...this.internals.token, scopes: [...this.internals.token.scopes] }
        : null,
      connector: this.internals.connector
        ? { ...this.internals.connector }
        : null,
      rateWindow: { ...this.internals.rateWindow },
      requestLedger: [...this.internals.pending.entries()].map(
        ([id, value]) => [id, { ...value }],
      ),
    };
  }

  /** Visible status at `now`, deriving `expired` from the session lifetime. */
  statusAt(now: number): AgentSessionStatus | "expired" {
    if (this.internals.status === "revoked") return "revoked";
    if (now >= this.internals.expiresAt) return "expired";
    return this.internals.status;
  }

  /** Authenticate the browser WebSocket channel with the editor secret. */
  authorizeEditor(secret: string): boolean {
    return constantTimeEqual(
      secretVerifier(secret),
      this.internals.editorSecretVerifier,
    );
  }

  /**
   * Exchange a valid hand-off claim for a scoped capability token. A retry
   * replaces the previous token because the session retains one verifier.
   */
  redeemClaim(
    code: string,
    now: number,
  ):
    | { ok: true; claim: RedeemedAgentClaim }
    | { ok: false; code: AgentTransportErrorCode } {
    const lifecycle = this.lifecycleCode(now);
    if (lifecycle) return { ok: false, code: lifecycle };
    const claim = this.internals.claim;
    if (
      !claim ||
      !constantTimeEqual(secretVerifier(code), claim.codeVerifier)
    ) {
      return { ok: false, code: "CLAIM_INVALID" };
    }
    if (now >= claim.expiresAt) return { ok: false, code: "CLAIM_EXPIRED" };

    claim.used = true;
    const connectorToken = this.random();
    const connectorExpiresAt = this.internals.expiresAt;
    this.internals.connector = {
      verifier: secretVerifier(connectorToken),
      expiresAt: connectorExpiresAt,
    };
    const bearer = this.mintBearer(now);
    return {
      ok: true,
      claim: {
        ...bearer,
        connectorToken,
        connectorExpiresAt,
      },
    };
  }

  /** Exchange a persistent connector secret for a fresh short-lived bearer. */
  resumeConnector(
    connectorToken: string,
    now: number,
  ):
    | { ok: true; claim: RedeemedAgentClaim }
    | { ok: false; code: AgentTransportErrorCode } {
    const lifecycle = this.lifecycleCode(now);
    if (lifecycle) return { ok: false, code: lifecycle };
    const connector = this.internals.connector;
    if (
      !connector ||
      !constantTimeEqual(secretVerifier(connectorToken), connector.verifier)
    ) {
      return { ok: false, code: "CONNECTOR_INVALID" };
    }
    if (now >= connector.expiresAt) {
      return { ok: false, code: "CONNECTOR_EXPIRED" };
    }
    return {
      ok: true,
      claim: {
        ...this.mintBearer(now),
        connectorToken,
        connectorExpiresAt: connector.expiresAt,
      },
    };
  }

  /** Validate an Agent bearer token and return the authorized session. */
  authorize(token: string, now: number): SessionAuthorizationResult {
    const lifecycle = this.lifecycleCode(now);
    if (lifecycle) return { ok: false, code: lifecycle };
    if (this.internals.status === "paused") {
      return { ok: false, code: "SESSION_PAUSED" };
    }
    const record = this.internals.token;
    if (!record || !constantTimeEqual(secretVerifier(token), record.verifier)) {
      return { ok: false, code: "TOKEN_INVALID" };
    }
    if (now >= record.expiresAt) return { ok: false, code: "TOKEN_EXPIRED" };
    return {
      ok: true,
      session: {
        sessionId: this.internals.sessionId,
        scopes: [...record.scopes],
        expiresAt: record.expiresAt,
      },
    };
  }

  /** Require a scope on an already-authorized session. */
  assertScope(
    scopes: readonly AgentSessionScope[],
    required: AgentSessionScope,
  ): { ok: true } | { ok: false; code: AgentTransportErrorCode } {
    return scopes.includes(required)
      ? { ok: true }
      : { ok: false, code: "TOKEN_SCOPE_INSUFFICIENT" };
  }

  assertDocument(
    projectId: string,
    documentId: string,
  ): { ok: true } | { ok: false; code: AgentTransportErrorCode } {
    return projectId === this.internals.projectId &&
      this.internals.documentIds.has(documentId)
      ? { ok: true }
      : { ok: false, code: "TOKEN_SCOPE_INSUFFICIENT" };
  }

  /** Only the trusted browser transport calls this, never an Agent request. */
  updateEditorDocuments(
    projectId: string,
    documentIds: readonly string[],
  ): boolean {
    if (projectId !== this.internals.projectId || documentIds.length === 0)
      return false;
    const next = [...new Set(documentIds)].sort();
    if (JSON.stringify(next) === JSON.stringify(this.documentIds)) return false;
    this.internals.documentIds = new Set(next);
    return true;
  }

  /**
   * Begin a forwarded request: reject on pause/revoke/expiry/rate-limit, serve a
   * cached terminal result for a repeated `requestId`, or allow the forward to
   * proceed. Never re-runs a completed request.
   */
  beginRequest(
    requestId: string,
    now: number,
    payloadHash = requestId,
  ): RequestBeginResult {
    const lifecycle = this.lifecycleCode(now);
    if (lifecycle) return { kind: "rejected", code: lifecycle };
    if (this.internals.status === "paused") {
      return { kind: "rejected", code: "SESSION_PAUSED" };
    }
    const cached = this.internals.cache.get(requestId);
    if (cached && now - cached.completedAt < this.limits.resultCacheTtlMs) {
      if (cached.unavailable) {
        return cached.payloadHash === payloadHash
          ? { kind: "rejected", code: "REQUEST_RESULT_UNAVAILABLE" }
          : { kind: "rejected", code: "REQUEST_ID_REUSED" };
      }
      return cached.payloadHash === payloadHash
        ? { kind: "cached", result: cached.result }
        : { kind: "rejected", code: "REQUEST_ID_REUSED" };
    }
    if (cached) this.internals.cache.delete(requestId);
    const pending = this.internals.pending.get(requestId);
    if (pending) {
      if (pending.payloadHash !== payloadHash) {
        return { kind: "rejected", code: "REQUEST_ID_REUSED" };
      }
      if (this.activeRequests.has(requestId)) {
        return { kind: "rejected", code: "REQUEST_IN_PROGRESS" };
      }
      this.activeRequests.add(requestId);
      return { kind: "proceed" };
    }
    const { rateLimit } = this.limits;
    const window = this.internals.rateWindow;
    if (now - window.windowStart >= rateLimit.windowMs) {
      window.windowStart = now;
      window.count = 0;
    }
    if (window.count >= rateLimit.maxRequests) {
      return { kind: "rejected", code: "RATE_LIMITED" };
    }
    window.count += 1;
    this.internals.pending.set(requestId, { payloadHash, startedAt: now });
    this.activeRequests.add(requestId);
    return { kind: "proceed" };
  }

  /** Cache a terminal forwarded result for idempotent replay. */
  completeRequest(requestId: string, result: unknown, now: number): void {
    const pending = this.internals.pending.get(requestId);
    this.activeRequests.delete(requestId);
    this.internals.pending.set(requestId, {
      payloadHash: pending?.payloadHash ?? requestId,
      startedAt: pending?.startedAt ?? now,
      completedAt: now,
    });
    const byteLength = new TextEncoder().encode(
      JSON.stringify(result),
    ).byteLength;
    if (byteLength > this.limits.resultCacheMaxBytes) return;
    this.internals.cache.set(requestId, {
      result,
      completedAt: now,
      payloadHash: pending?.payloadHash ?? requestId,
      byteLength,
    });
    let totalBytes = [...this.internals.cache.values()].reduce(
      (total, entry) => total + entry.byteLength,
      0,
    );
    while (
      this.internals.cache.size > this.limits.resultCacheMaxEntries ||
      totalBytes > this.limits.resultCacheMaxBytes
    ) {
      const oldestId = this.internals.cache.keys().next().value;
      if (oldestId === undefined) break;
      const oldest = this.internals.cache.get(oldestId);
      this.internals.cache.delete(oldestId);
      totalBytes -= oldest?.byteLength ?? 0;
    }
  }

  /**
   * Complete a request without retaining its result. Used for exported bytes:
   * a retry with the same requestId is rejected instead of replaying a stale
   * browser artifact through the Durable Object.
   */
  completeRequestWithoutResult(requestId: string, now: number): void {
    const pending = this.internals.pending.get(requestId);
    this.activeRequests.delete(requestId);
    this.internals.pending.set(requestId, {
      payloadHash: pending?.payloadHash ?? requestId,
      startedAt: pending?.startedAt ?? now,
      completedAt: now,
    });
    this.internals.cache.set(requestId, {
      unavailable: true,
      completedAt: now,
      payloadHash: pending?.payloadHash ?? requestId,
      byteLength: 0,
    });
  }

  failRequest(requestId: string, forget = true): void {
    this.activeRequests.delete(requestId);
    if (forget) this.internals.pending.delete(requestId);
  }

  /** Enforce the relay-level request-size ceiling. */
  checkSize(
    bytes: number,
  ): { ok: true } | { ok: false; code: AgentTransportErrorCode } {
    return bytes > this.limits.maxRequestBytes
      ? { ok: false, code: "REQUEST_TOO_LARGE" }
      : { ok: true };
  }

  checkMessageSize(
    bytes: number,
  ): { ok: true } | { ok: false; code: AgentTransportErrorCode } {
    return bytes > this.limits.maxMessageBytes
      ? { ok: false, code: "MESSAGE_TOO_LARGE" }
      : { ok: true };
  }

  pause(): void {
    if (this.internals.status === "active") this.internals.status = "paused";
  }

  resume(): void {
    if (this.internals.status === "paused") this.internals.status = "active";
  }

  revoke(): void {
    this.internals.status = "revoked";
  }

  /**
   * Project replacement terminates the session (document.replaced). The old token
   * can never address the new Project; the user must authorize a new session.
   */
  replaceProject(): void {
    this.internals.status = "revoked";
    this.internals.token = null;
    this.internals.connector = null;
    this.internals.claim = null;
  }

  private mintBearer(
    now: number,
  ): Pick<RedeemedAgentClaim, "agentToken" | "tokenExpiresAt" | "scopes"> {
    const agentToken = this.random();
    const tokenExpiresAt = Math.min(
      now + this.limits.tokenTtlMs,
      this.internals.expiresAt,
    );
    this.internals.token = {
      verifier: secretVerifier(agentToken),
      scopes: [...this.internals.scopes],
      expiresAt: tokenExpiresAt,
    };
    return {
      agentToken,
      tokenExpiresAt,
      scopes: [...this.internals.scopes],
    };
  }

  private lifecycleCode(now: number): AgentTransportErrorCode | null {
    if (this.internals.status === "revoked") return "SESSION_REVOKED";
    if (now >= this.internals.expiresAt) return "SESSION_EXPIRED";
    return null;
  }
}
