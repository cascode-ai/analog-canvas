import {
  DEFAULT_MANAGED_RUN_POLICY,
  ManagedRunAdmissionSchema,
  ManagedRunEventSchema,
  ManagedRunRecordSchema,
  createManagedRun,
  isManagedRunTerminal,
  transitionManagedRun,
  type ManagedRunPolicy,
  type ManagedRunRecord,
} from "@icm/simulation-service";

type SqlResult<T> = { one(): T; toArray(): T[] };
type SqlStorage = {
  exec<T>(query: string, ...bindings: unknown[]): SqlResult<T>;
};
type DurableObjectStateLike = {
  storage: {
    sql: SqlStorage;
    transactionSync<T>(callback: () => T): T;
  };
};

export type SimulationControlNamespaceLike = {
  getByName(name: string): {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
};

type RunRow = { record_json: string };
type CountRow = { count: number };
type RequestRow = { request_fingerprint: string; run_id: string };
type AnonymousSessionRow = { owner_id: string };

export const SIMULATION_SESSION_COOKIE = "icm_simulation_session";
const SIMULATION_SESSION_TTL_MS = 24 * 60 * 60_000;

const json = (value: unknown, status = 200) => Response.json(value, { status });

/**
 * Small durable control plane for one release channel.
 *
 * It owns run admission, idempotency and lifecycle metadata only. Decks,
 * rawfiles and result bytes belong to the artifact store, and execution never
 * waits inside this Durable Object.
 */
export class SimulationControlDO {
  private readonly sql: SqlStorage;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly policy: ManagedRunPolicy = DEFAULT_MANAGED_RUN_POLICY,
    private readonly now: () => number = Date.now,
  ) {
    this.sql = state.storage.sql;
    this.initializeSchema();
  }

  async fetch(request: Request): Promise<Response> {
    this.pruneExpired(this.now());
    const url = new URL(request.url);
    if (url.pathname === "/anonymous-session")
      return this.anonymousSession(request);
    if (request.method === "POST" && url.pathname === "/accept")
      return this.accept(request);
    const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/u);
    if (!runMatch) return json({ error: "not-found" }, 404);
    const runId = decodeURIComponent(runMatch[1]!);
    if (request.method === "GET") return this.read(runId);
    if (request.method === "POST") return this.transition(runId, request);
    return json({ error: "method-not-allowed" }, 405);
  }

  private initializeSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS simulation_runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        finished_at INTEGER,
        record_json TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS simulation_runs_owner_state
      ON simulation_runs(owner_id, state)
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS simulation_start_requests (
        owner_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        run_id TEXT NOT NULL,
        PRIMARY KEY (owner_id, request_id)
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS simulation_anonymous_sessions (
        token_hash TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      ) WITHOUT ROWID
    `);
  }

  private async accept(request: Request): Promise<Response> {
    const parsed = ManagedRunAdmissionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return json(
        {
          error: "invalid-admission",
          message: parsed.error.issues[0]?.message ?? "Invalid run admission",
        },
        400,
      );
    const admission = parsed.data;
    const result = this.state.storage.transactionSync(() => {
      const previous = this.sql
        .exec<RequestRow>(
          `SELECT request_fingerprint, run_id
           FROM simulation_start_requests
           WHERE owner_id = ? AND request_id = ?`,
          admission.ownerId,
          admission.requestId,
        )
        .toArray()[0];
      if (previous) {
        if (previous.request_fingerprint !== admission.requestFingerprint)
          return { error: "REQUEST_ID_REUSED" } as const;
        const run = this.readRecord(previous.run_id);
        return run
          ? ({ run, accepted: false } as const)
          : ({ error: "REQUEST_ID_REUSED" } as const);
      }

      const queuedGlobal = this.count("state = 'queued'");
      if (queuedGlobal >= this.policy.maxQueuedGlobal)
        return { error: "GLOBAL_QUEUE_LIMIT", retryAfterMs: 2_000 } as const;
      const queuedOwner = this.count(
        "owner_id = ? AND state = 'queued'",
        admission.ownerId,
      );
      if (queuedOwner >= this.policy.maxQueuedPerOwner)
        return { error: "OWNER_QUEUE_LIMIT", retryAfterMs: 2_000 } as const;
      const activeOwner = this.count(
        "owner_id = ? AND state IN ('running', 'cancelling')",
        admission.ownerId,
      );
      if (activeOwner >= this.policy.maxActivePerOwner)
        return { error: "OWNER_ACTIVE_LIMIT", retryAfterMs: 2_000 } as const;

      const run = createManagedRun(crypto.randomUUID(), admission, this.now());
      this.writeRecord(run);
      this.sql.exec(
        `INSERT INTO simulation_start_requests
          (owner_id, request_id, request_fingerprint, run_id)
         VALUES (?, ?, ?, ?)`,
        admission.ownerId,
        admission.requestId,
        admission.requestFingerprint,
        run.id,
      );
      return { run, accepted: true } as const;
    });
    return "error" in result ? json(result, 409) : json(result, 201);
  }

  private read(runId: string): Response {
    const run = this.readRecord(runId);
    return run ? json({ run }) : json({ error: "RUN_NOT_FOUND" }, 404);
  }

  private async transition(runId: string, request: Request): Promise<Response> {
    const parsed = ManagedRunEventSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return json(
        {
          error: "invalid-transition",
          message: parsed.error.issues[0]?.message ?? "Invalid run transition",
        },
        400,
      );
    const result = this.state.storage.transactionSync(() => {
      const run = this.readRecord(runId);
      if (!run) return null;
      const transition = transitionManagedRun(run, parsed.data);
      if (transition.ok) this.writeRecord(transition.run);
      return transition;
    });
    if (!result) return json({ error: "RUN_NOT_FOUND" }, 404);
    return result.ok ? json(result) : json(result, 409);
  }

  private count(where: string, ...bindings: unknown[]): number {
    return this.sql
      .exec<CountRow>(
        `SELECT COUNT(*) AS count FROM simulation_runs WHERE ${where}`,
        ...bindings,
      )
      .one().count;
  }

  private readRecord(runId: string): ManagedRunRecord | null {
    const row = this.sql
      .exec<RunRow>(
        "SELECT record_json FROM simulation_runs WHERE id = ?",
        runId,
      )
      .toArray()[0];
    if (!row) return null;
    const parsed = ManagedRunRecordSchema.safeParse(
      JSON.parse(row.record_json),
    );
    return parsed.success ? parsed.data : null;
  }

  private writeRecord(run: ManagedRunRecord): void {
    this.sql.exec(
      `INSERT INTO simulation_runs
        (id, owner_id, state, created_at, updated_at, finished_at, record_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         updated_at = excluded.updated_at,
         finished_at = excluded.finished_at,
         record_json = excluded.record_json`,
      run.id,
      run.ownerId,
      run.state,
      run.createdAt,
      run.updatedAt,
      run.finishedAt ?? null,
      JSON.stringify(run),
    );
  }

  private async anonymousSession(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "POST")
      return json({ error: "method-not-allowed" }, 405);
    const token = cookieValue(
      request.headers.get("cookie"),
      SIMULATION_SESSION_COOKIE,
    );
    if (token) {
      const tokenHash = await sha256(token);
      const row = this.sql
        .exec<AnonymousSessionRow>(
          `SELECT owner_id FROM simulation_anonymous_sessions
           WHERE token_hash = ? AND expires_at > ?`,
          tokenHash,
          this.now(),
        )
        .toArray()[0];
      if (row)
        return json({
          principal: anonymousPrincipal(row.owner_id),
        });
    }
    if (request.method !== "POST")
      return json({ error: "simulation-authentication-required" }, 401);
    const issuedToken = randomToken();
    const ownerId = `anonymous-${crypto.randomUUID()}`;
    const expiresAt = this.now() + SIMULATION_SESSION_TTL_MS;
    this.sql.exec(
      `INSERT INTO simulation_anonymous_sessions
        (token_hash, owner_id, expires_at) VALUES (?, ?, ?)`,
      await sha256(issuedToken),
      ownerId,
      expiresAt,
    );
    return Response.json(
      { principal: anonymousPrincipal(ownerId) },
      {
        status: 201,
        headers: {
          "set-cookie": `${SIMULATION_SESSION_COOKIE}=${issuedToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SIMULATION_SESSION_TTL_MS / 1_000)}`,
          "cache-control": "no-store",
        },
      },
    );
  }

  private pruneExpired(now: number): void {
    this.sql.exec(
      "DELETE FROM simulation_anonymous_sessions WHERE expires_at <= ?",
      now,
    );
    const queued = this.sql
      .exec<RunRow>(
        `SELECT record_json FROM simulation_runs
         WHERE state = 'queued' AND updated_at <= ?`,
        now - this.policy.maxQueueWaitMs,
      )
      .toArray();
    for (const row of queued) {
      const parsed = ManagedRunRecordSchema.safeParse(
        JSON.parse(row.record_json),
      );
      if (!parsed.success) continue;
      const transition = transitionManagedRun(parsed.data, {
        kind: "queue-expired",
        at: now,
        error: {
          code: "QUEUE_WAIT_EXPIRED",
          message: "The run exceeded the queue wait limit.",
          stage: "start",
          recovery: "retry-after",
        },
      });
      if (transition.ok) this.writeRecord(transition.run);
    }
    const retained = this.sql
      .exec<RunRow>(
        `SELECT record_json FROM simulation_runs
         WHERE finished_at IS NOT NULL AND finished_at <= ? AND state != 'expired'`,
        now - this.policy.retentionMs,
      )
      .toArray();
    for (const row of retained) {
      const parsed = ManagedRunRecordSchema.safeParse(
        JSON.parse(row.record_json),
      );
      if (!parsed.success || !managedRunNeedsRetention(parsed.data)) continue;
      const transition = transitionManagedRun(parsed.data, {
        kind: "expired",
        at: now,
      });
      if (transition.ok) this.writeRecord(transition.run);
    }
  }
}

function cookieValue(header: string | null, name: string): string | null {
  for (const item of (header ?? "").split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name && rest.length > 0) return rest.join("=");
  }
  return null;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function anonymousPrincipal(ownerId: string) {
  return {
    id: ownerId,
    displayName: "Anonymous simulator",
    email: null,
    provider: "simulation-session",
    role: "user",
    isAdmin: false,
  };
}

export function managedRunNeedsRetention(run: ManagedRunRecord): boolean {
  return isManagedRunTerminal(run.state) && run.state !== "expired";
}
