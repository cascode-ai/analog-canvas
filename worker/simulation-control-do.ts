import {
  DEFAULT_MANAGED_RUN_POLICY,
  ManagedRunAdmissionSchema,
  ManagedRunEventSchema,
  ManagedRunRecordSchema,
  createManagedRun,
  isManagedRunTerminal,
  managedRunExpiration,
  transitionManagedRun,
  type ManagedRunPolicy,
  type ManagedRunRecord,
} from "@icm/simulation-service";
import {
  consumeSimulationJobs,
  type SimulationOperationsEnv,
} from "./simulation-operations";

type SqlResult<T> = { one(): T; toArray(): T[] };
type SqlStorage = {
  exec<T>(query: string, ...bindings: unknown[]): SqlResult<T>;
};
type DurableObjectStateLike = {
  storage: {
    sql: SqlStorage;
    transactionSync<T>(callback: () => T): T;
    getAlarm?(): Promise<number | null>;
    setAlarm?(time: number): Promise<void>;
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
 * It owns admission, idempotency and the single execution slot. Alarm handlers
 * drive durable work independently of the caller; bytes remain in R2. Never
 * hold a storage transaction or blockConcurrencyWhile across executor I/O.
 */
export class SimulationControlDO {
  private readonly sql: SqlStorage;
  private alarmScheduled = false;
  private executing = false;
  private readonly resultWaiters = new Map<
    string,
    Set<(run: ManagedRunRecord) => void>
  >();
  private readonly env: SimulationOperationsEnv | undefined;

  constructor(
    private readonly state: DurableObjectStateLike,
    env?: unknown,
    private readonly now: () => number = Date.now,
    private readonly policy: ManagedRunPolicy = DEFAULT_MANAGED_RUN_POLICY,
  ) {
    this.env = env as SimulationOperationsEnv | undefined;
    this.sql = state.storage.sql;
    this.initializeSchema();
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureAlarm();
    const url = new URL(request.url);
    if (url.pathname === "/anonymous-session")
      return this.anonymousSession(request);
    if (url.pathname === "/operations") return this.operations(request);
    if (request.method === "POST" && url.pathname === "/accept") {
      const response = await this.accept(request);
      if (response.ok && this.env?.SIMULATION_DISPATCH === "alarm")
        await this.wakeDispatcher();
      return response;
    }
    if (request.method === "GET" && url.pathname === "/runs")
      return this.list(url.searchParams.get("ownerId"));
    const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/u);
    if (!runMatch) return json({ error: "not-found" }, 404);
    const runId = decodeURIComponent(runMatch[1]!);
    if (request.method === "GET") {
      const waitMs = Number(url.searchParams.get("waitMs") ?? 0);
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 20_000)
        return json({ error: "invalid-wait" }, 400);
      return this.read(runId, waitMs);
    }
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
    this.sql.exec(`CREATE INDEX IF NOT EXISTS simulation_runs_state_updated
      ON simulation_runs(state, updated_at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS simulation_runs_dispatch
      ON simulation_runs(state, created_at, id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS simulation_runs_retention
      ON simulation_runs(finished_at) WHERE state != 'expired'`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS simulation_runs_lease_expiry
      ON simulation_runs(json_extract(record_json, '$.lease.expiresAt'))
      WHERE state IN ('running', 'cancelling')`);
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
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS simulation_operations (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS simulation_sessions_expiry
      ON simulation_anonymous_sessions(expires_at)`);
    this.sql.exec(
      `INSERT OR IGNORE INTO simulation_operations (key, value)
       VALUES ('accepting', 'true')`,
    );
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
      // Admission needs current slot counts, not a global history scan.
      this.pruneActive(this.now());
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

      if (!this.isAccepting())
        return { error: "SIMULATION_DRAINED", retryAfterMs: 30_000 } as const;

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

  private async read(runId: string, waitMs: number): Promise<Response> {
    const run = this.readRecord(runId);
    if (!run) return json({ error: "RUN_NOT_FOUND" }, 404);
    if (waitMs === 0 || this.resultReady(run)) return json({ run });
    const settled = await new Promise<ManagedRunRecord>((resolve) => {
      const listeners = this.resultWaiters.get(runId) ?? new Set();
      this.resultWaiters.set(runId, listeners);
      const listener = (next: ManagedRunRecord) => {
        clearTimeout(timeout);
        listeners.delete(listener);
        if (listeners.size === 0) this.resultWaiters.delete(runId);
        resolve(next);
      };
      listeners.add(listener);
      const timeout = setTimeout(() => {
        listener(this.readRecord(runId) ?? run);
      }, waitMs);
    });
    return json({ run: settled });
  }

  private resultReady(run: ManagedRunRecord): boolean {
    return (
      isManagedRunTerminal(run.state) ||
      run.artifacts.some((artifact) => artifact.name === "response.json")
    );
  }

  private list(ownerId: string | null): Response {
    if (!ownerId) return json({ error: "owner-required" }, 400);
    const runs = this.sql
      .exec<RunRow>(
        `SELECT record_json FROM simulation_runs
         WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50`,
        ownerId,
      )
      .toArray()
      .flatMap((row) => {
        const parsed = ManagedRunRecordSchema.safeParse(
          JSON.parse(row.record_json),
        );
        return parsed.success
          ? [this.expireRecord(parsed.data, this.now())]
          : [];
      });
    return json({ runs });
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
      if (parsed.data.kind === "lease-acquired") {
        this.pruneActive(this.now());
        // Both alarms and old queued deliveries acquire the SAME global slot.
        if (this.count("state IN ('running', 'cancelling')") > 0)
          return { ok: false, error: "EXECUTOR_SLOT_BUSY" } as const;
        const first = this.sql
          .exec<{ id: string }>(
            "SELECT id FROM simulation_runs WHERE state = 'queued' ORDER BY created_at, id LIMIT 1",
          )
          .toArray()[0];
        if (first?.id !== runId)
          return { ok: false, error: "EXECUTOR_QUEUE_ORDER" } as const;
      }
      const transition = transitionManagedRun(run, parsed.data);
      if (transition.ok) this.writeRecord(transition.run);
      return transition;
    });
    if (!result) return json({ error: "RUN_NOT_FOUND" }, 404);
    if (
      result.ok &&
      this.env?.SIMULATION_DISPATCH === "alarm" &&
      (isManagedRunTerminal(result.run.state) || result.run.state === "queued")
    )
      await this.wakeDispatcher();
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
    if (!parsed.success) return null;
    return this.expireRecord(parsed.data, this.now());
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
    if (this.resultReady(run))
      for (const listener of this.resultWaiters.get(run.id) ?? [])
        listener(run);
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

  private async operations(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const body = (await request.json().catch(() => null)) as {
        accepting?: unknown;
      } | null;
      if (!body || typeof body.accepting !== "boolean")
        return json({ error: "invalid-operations-command" }, 400);
      this.sql.exec(
        `UPDATE simulation_operations SET value = ? WHERE key = 'accepting'`,
        body.accepting ? "true" : "false",
      );
    } else if (request.method !== "GET") {
      return json({ error: "method-not-allowed" }, 405);
    }
    const counts = Object.fromEntries(
      this.sql
        .exec<{ state: string; count: number }>(
          `SELECT state, COUNT(*) AS count FROM simulation_runs GROUP BY state`,
        )
        .toArray()
        .map((row) => [row.state, row.count]),
    );
    return json({ accepting: this.isAccepting(), counts });
  }

  private isAccepting(): boolean {
    return (
      this.sql
        .exec<{ value: string }>(
          `SELECT value FROM simulation_operations WHERE key = 'accepting'`,
        )
        .one().value === "true"
    );
  }

  private pruneExpired(now: number): void {
    this.sql.exec(
      "DELETE FROM simulation_anonymous_sessions WHERE token_hash IN (SELECT token_hash FROM simulation_anonymous_sessions WHERE expires_at <= ? LIMIT 100)",
      now,
    );
    this.pruneActive(now);
    const retained = this.sql
      .exec<RunRow>(
        `SELECT record_json FROM simulation_runs
         WHERE finished_at IS NOT NULL AND finished_at <= ? AND state != 'expired' LIMIT 100`,
        now - this.policy.retentionMs,
      )
      .toArray();
    for (const row of retained) {
      const parsed = ManagedRunRecordSchema.safeParse(
        JSON.parse(row.record_json),
      );
      if (parsed.success) this.expireRecord(parsed.data, now);
    }
  }

  private pruneActive(now: number): void {
    const active = this.sql
      .exec<RunRow>(
        `SELECT record_json FROM simulation_runs
         WHERE (state IN ('running', 'cancelling') AND json_extract(record_json, '$.lease.expiresAt') <= ?)
           OR (state = 'queued' AND updated_at <= ?) LIMIT 100`,
        now,
        now - this.policy.maxQueueWaitMs,
      )
      .toArray();
    for (const row of active) {
      const parsed = ManagedRunRecordSchema.safeParse(
        JSON.parse(row.record_json),
      );
      if (parsed.success) this.expireRecord(parsed.data, now);
    }
  }

  private expireRecord(run: ManagedRunRecord, now: number): ManagedRunRecord {
    const event = managedRunExpiration(run, now, this.policy);
    if (!event) return run;
    const next = transitionManagedRun(run, event);
    if (!next.ok) return run;
    this.writeRecord(next.run);
    return next.run;
  }

  private async ensureAlarm(): Promise<void> {
    if (this.alarmScheduled || !this.state.storage.setAlarm) return;
    // Do not postpone an existing deadline when the object wakes in a new isolate.
    if (!(await this.state.storage.getAlarm?.()))
      await this.state.storage.setAlarm(this.now() + 30_000);
    this.alarmScheduled = true;
  }

  private async wakeDispatcher(): Promise<void> {
    // An in-flight alarm will pick up the next task itself. A future alarm is
    // persisted before acknowledging admission, so caller disconnect is harmless.
    if (this.executing) return;
    const existing = await this.state.storage.getAlarm?.();
    const soon = this.now() + 1;
    if (!existing || existing > soon) await this.state.storage.setAlarm?.(soon);
    this.alarmScheduled = true;
  }

  private async dispatch(): Promise<number> {
    if (this.env?.SIMULATION_DISPATCH !== "alarm" || this.executing)
      return 30_000;
    this.executing = true;
    let delay = 30_000;
    try {
      // Bound each invocation, then immediately re-arm for any remaining work.
      // Four 120s jobs plus lifecycle overhead remain below the alarm wall limit.
      for (let count = 0; count < 4; count++) {
        const row = this.sql
          .exec<{ id: string }>(
            `SELECT id FROM simulation_runs WHERE state IN ('running', 'cancelling', 'queued')
           ORDER BY CASE WHEN state = 'queued' THEN 1 ELSE 0 END, created_at, id LIMIT 1`,
          )
          .toArray()[0];
        if (!row) break;
        let retry = false;
        await consumeSimulationJobs(
          {
            messages: [
              {
                body: { schemaVersion: 1, runId: row.id },
                ack: () => {},
                retry: (options) => {
                  retry = true;
                  delay = (options?.delaySeconds ?? 2) * 1000;
                },
              },
            ],
          },
          {
            ...this.env,
            SIMULATION_CONTROL: {
              getByName: () => ({
                fetch: (input, init) => this.fetch(new Request(input, init)),
              }),
            },
          },
          { now: this.now, uuid: () => crypto.randomUUID() },
        );
        if (retry) break;
        delay = 1;
      }
      return delay;
    } finally {
      this.executing = false;
    }
  }

  async alarm(): Promise<void> {
    this.alarmScheduled = false;
    this.pruneExpired(this.now());
    // Schedule a recovery wake before awaiting network I/O. A restarted object
    // reconciles the same leased run; it never blindly repeats uncertain work.
    if (this.env?.SIMULATION_DISPATCH === "alarm")
      await this.state.storage.setAlarm?.(this.now() + 30_000);
    const dispatchDelay = await this.dispatch();
    // Stop background maintenance once all records are tombstones and sessions
    // have expired. The next request will schedule maintenance again.
    const remaining = this.sql
      .exec<{ present: number }>(
        `SELECT EXISTS(SELECT 1 FROM simulation_runs WHERE state != 'expired')
        OR EXISTS(SELECT 1 FROM simulation_anonymous_sessions) AS present`,
      )
      .one().present;
    if (remaining) {
      const existing = await this.state.storage.getAlarm?.();
      const next = this.now() + dispatchDelay;
      if (!existing || existing <= this.now() || existing > next)
        await this.state.storage.setAlarm?.(next);
      this.alarmScheduled = true;
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
