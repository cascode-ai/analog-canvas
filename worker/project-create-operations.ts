import type { SqlStorage } from "./gallery-store";
import format from "./project-create-operation-format.json";
import { sha256Hex } from "@icm/derived";
import type { ProjectEvent } from "./project-sync-journal";
import {
  projectCreateBinding,
  projectCreateIntent,
  validCreateTicket,
  type ProjectCreateReceipts,
} from "./project-create-receipt";

const LEASE_MS = 30_000;
const RETENTION_MS = 7 * 86_400_000;
const PENDING_BYTES = 64 * 1024 * 1024;
type Fields = Record<string, unknown>;
type DurableGrant = {
  id: string;
  ownerUserId: string;
  reservation: string;
  event: ProjectEvent;
};
function encodeGrant({ id, ownerUserId, reservation, event }: DurableGrant) {
  const { version, origin, epoch, sequence, eventId, payload, payloadHash } =
    event;
  const value = {
    id,
    ownerUserId,
    reservation,
    event: { version, origin, epoch, sequence, eventId, payload, payloadHash },
  };
  return JSON.stringify({ value, hash: sha256Hex(JSON.stringify(value)) });
}
export interface CreateExecutor {
  operation: string;
  generation: number;
  executor: string;
}
type Row = {
  operation: string;
  owner_id: string;
  project_id: string;
  version: number;
  input_bytes: number;
  created: number;
  generation: number;
  executor: string | null;
  lease_until: number;
  next_at: number;
  handed_off: number;
  reason: string | null;
  blocked: number;
  grant_json: string | null;
};
export function createPending() {
  return Response.json(
    { error: "project-create-pending" },
    {
      status: 503,
      headers: { "retry-after": "5", "cache-control": "no-store" },
    },
  );
}
const refuse = (error: string, status = 409) =>
  Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );

/** Private input and execution ownership of unfinished domestic Project creates. */
export class ProjectCreateOperations {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS project_create_operations (
      operation TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL, version INTEGER NOT NULL,
      input_bytes INTEGER NOT NULL, input_hash TEXT NOT NULL, created INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0, executor TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL DEFAULT 0, handed_off INTEGER NOT NULL DEFAULT 0,
      reason TEXT, blocked INTEGER NOT NULL DEFAULT 0, grant_json TEXT,
      UNIQUE(owner_id,project_id)
    ) WITHOUT ROWID`);
    sql.exec(
      "CREATE INDEX IF NOT EXISTS project_create_due ON project_create_operations(blocked,next_at)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_create_attempts(ticket_hash TEXT PRIMARY KEY,operation TEXT NOT NULL) WITHOUT ROWID",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS project_create_attempt_operation ON project_create_attempts(operation)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_create_inputs(operation TEXT NOT NULL,part INTEGER NOT NULL,chunk TEXT NOT NULL,PRIMARY KEY(operation,part)) WITHOUT ROWID",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_create_intents(operation TEXT PRIMARY KEY,intent TEXT NOT NULL) WITHOUT ROWID",
    );
    sql.exec(`CREATE TABLE IF NOT EXISTS project_create_audit(ticket_hash TEXT PRIMARY KEY,operation TEXT NOT NULL,
      admission TEXT NOT NULL, handed INTEGER NOT NULL DEFAULT 0, execution_generation INTEGER,
      outcome TEXT, finished_by TEXT, finished_generation INTEGER, settled_at INTEGER) WITHOUT ROWID`);
    sql.exec(
      "CREATE INDEX IF NOT EXISTS project_create_audit_operation ON project_create_audit(operation)",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS project_create_audit_retention ON project_create_audit(settled_at)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_create_pull(singleton INTEGER PRIMARY KEY CHECK(singleton=1),token TEXT NOT NULL,until INTEGER NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_create_quota_calls(operation TEXT PRIMARY KEY,calls INTEGER NOT NULL) WITHOUT ROWID",
    );
  }

  private row(operation: string) {
    return this.sql
      .exec<Row & { input_hash: string }>(
        "SELECT * FROM project_create_operations WHERE operation=?",
        operation,
      )
      .toArray()[0];
  }

  private input(row: Row & { input_hash: string }): Fields | null {
    const json = this.sql
      .exec<{ chunk: string }>(
        "SELECT chunk FROM project_create_inputs WHERE operation=? ORDER BY part",
        row.operation,
      )
      .toArray()
      .map((r) => r.chunk)
      .join("");
    if (!json || row.input_hash !== sha256Hex(json)) return null;
    try {
      const fields = JSON.parse(json) as Fields;
      return fields.userId === row.owner_id &&
        fields.id === row.project_id &&
        projectCreateBinding(fields, projectCreateIntent(fields)) ===
          row.operation
        ? fields
        : null;
    } catch {
      return null;
    }
  }

  private grant(row: Row): { valid: boolean; value: unknown } {
    if (row.grant_json === null) return { valid: true, value: null };
    try {
      const { value, hash } = JSON.parse(row.grant_json) as {
        value: { id: string; ownerUserId: string };
        hash: string;
      };
      return {
        valid:
          value.id === row.project_id &&
          value.ownerUserId === row.owner_id &&
          sha256Hex(JSON.stringify(value)) === hash,
        value,
      };
    } catch {
      return { valid: false, value: null };
    }
  }

  /** The caller wraps admission, ticket linkage and lease selection in one transaction. */
  prepare(
    ticket: unknown,
    fields: Fields,
    receipts: ProjectCreateReceipts,
    refuseBeforeQuota: Response | null,
  ) {
    if (
      !validCreateTicket(ticket) ||
      typeof fields.userId !== "string" ||
      typeof fields.id !== "string"
    )
      return refuse("invalid-receipt", 400);
    const binding = projectCreateBinding(fields, projectCreateIntent(fields));
    if (!receipts.claim(ticket, binding))
      return refuse("create-receipt-unavailable");
    const deny = (response: Response) => {
      receipts.finish(ticket, binding, "denied");
      return response;
    };
    if (refuseBeforeQuota) return deny(refuseBeforeQuota);
    let existing = this.sql
      .exec<Row>(
        "SELECT * FROM project_create_operations WHERE owner_id=? AND project_id=?",
        fields.userId,
        fields.id,
      )
      .toArray()[0];
    if (existing && existing.operation !== binding)
      return deny(refuse("create-key-reused"));
    const admission = existing ? "joined" : "accepted";
    if (!existing) {
      const json = JSON.stringify(fields),
        bytes = new TextEncoder().encode(json).length;
      const quota = this.sql
        .exec<{ n: number; bytes: number; owner: number }>(
          "SELECT count(*) n,COALESCE(sum(input_bytes),0) bytes,COALESCE(sum(owner_id=?),0) owner FROM project_create_operations",
          fields.userId,
        )
        .one();
      if (
        quota.n >= 512 ||
        quota.owner >= 20 ||
        bytes + quota.bytes > PENDING_BYTES ||
        bytes > 8 * 1024 * 1024
      )
        return deny(refuse("create-operation-capacity", 429));
      this.sql.exec(
        "INSERT INTO project_create_operations(operation,owner_id,project_id,version,input_bytes,input_hash,created) VALUES(?,?,?,1,?,?,?)",
        binding,
        fields.userId,
        fields.id,
        bytes,
        sha256Hex(json),
        Date.now(),
      );
      this.sql.exec(
        "INSERT INTO project_create_intents VALUES(?,?)",
        binding,
        projectCreateIntent(fields),
      );
      for (let start = 0, part = 0; start < json.length; part++) {
        let end = Math.min(json.length, start + 96 * 1024);
        if (end < json.length && /[\uD800-\uDBFF]/u.test(json[end - 1]!)) end--;
        this.sql.exec(
          "INSERT INTO project_create_inputs VALUES(?,?,?)",
          binding,
          part,
          json.slice(start, end),
        );
        start = end;
      }
      existing = this.row(binding)!;
    }
    this.sql.exec(
      "INSERT INTO project_create_attempts VALUES(?,?)",
      sha256Hex(ticket),
      binding,
    );
    this.sql.exec(
      "INSERT INTO project_create_audit(ticket_hash,operation,admission) VALUES(?,?,?)",
      sha256Hex(ticket),
      binding,
      admission,
    );
    if (existing.blocked || existing.version !== format.read)
      return refuse(existing.reason ?? "unsupported-create-operation", 503);
    if (existing.handed_off) return createPending();
    return this.acquire(binding, sha256Hex(ticket));
  }

  private acquire(operation: string, ticketHash?: string) {
    const row = this.row(operation),
      now = Date.now();
    if (!row || row.version !== format.read || row.blocked)
      return refuse("create-operation-unavailable", 503);
    if (row.lease_until > now || row.next_at > now) return createPending();
    const fields = this.input(row);
    if (!fields) {
      this.block(operation, "create-input-integrity");
      return refuse("create-input-integrity", 503);
    }
    const grant = this.grant(row);
    if (!grant.valid) {
      this.block(operation, "quota-grant-integrity");
      return refuse("quota-grant-integrity", 503);
    }
    const executor = crypto.randomUUID(),
      generation = row.generation + 1;
    if (ticketHash)
      this.sql.exec(
        "UPDATE project_create_audit SET execution_generation=? WHERE ticket_hash=?",
        generation,
        ticketHash,
      );
    this.sql.exec(
      "UPDATE project_create_operations SET generation=?,executor=?,lease_until=? WHERE operation=?",
      generation,
      executor,
      now + LEASE_MS,
      operation,
    );
    return Response.json({
      lease: { operation, executor, generation },
      fields,
      grant: grant.value,
    });
  }

  next() {
    const now = Date.now(),
      row = this.sql
        .exec<{ operation: string }>(
          "SELECT operation FROM project_create_operations WHERE version=? AND blocked=0 AND lease_until<=? AND next_at<=? ORDER BY next_at,created LIMIT 1",
          format.read,
          now,
          now,
        )
        .toArray()[0];
    return row ? this.acquire(row.operation) : Response.json({ idle: true });
  }

  owns(lease: unknown): lease is CreateExecutor {
    const l = lease as Partial<CreateExecutor> | null;
    return (
      !!l &&
      typeof l.operation === "string" &&
      typeof l.executor === "string" &&
      Number.isSafeInteger(l.generation) &&
      !!this.sql
        .exec(
          "SELECT 1 FROM project_create_operations WHERE operation=? AND generation=? AND executor=? AND version=? AND blocked=0 AND lease_until>?",
          l.operation,
          l.generation,
          l.executor,
          format.read,
          Date.now(),
        )
        .toArray().length
    );
  }

  handoff(ticket: unknown) {
    if (!validCreateTicket(ticket)) return refuse("invalid-receipt", 400);
    const link = this.sql
      .exec<{ operation: string }>(
        "SELECT a.operation FROM project_create_attempts a JOIN project_create_receipts r ON a.ticket_hash=r.ticket_hash AND a.operation=r.binding WHERE a.ticket_hash=? AND r.state='claimed'",
        sha256Hex(ticket),
      )
      .toArray()[0];
    const row = link && this.row(link.operation);
    if (!row || row.version !== format.read)
      return refuse("create-handoff-unproven");
    const retained = this.sql
      .exec<{ intent: string }>(
        "SELECT intent FROM project_create_intents WHERE operation=?",
        row.operation,
      )
      .toArray()[0]?.intent;
    const scopedRefusal = [
      "gallery-link-forbidden",
      "gallery-link-owner-changed",
      "project-limit",
    ].includes(row.reason ?? "");
    const expired =
      row.blocked &&
      row.input_bytes === 0 &&
      (row.reason === "create-input-expired" || scopedRefusal) &&
      retained &&
      projectCreateBinding(
        { userId: row.owner_id, id: row.project_id },
        retained,
      ) === row.operation;
    if (
      !this.grant(row).valid ||
      (!expired && ((row.blocked && !scopedRefusal) || !this.input(row)))
    )
      return refuse("create-handoff-unproven");
    if (!row.handed_off)
      this.sql.exec(
        "UPDATE project_create_operations SET handed_off=1,generation=generation+1,executor=NULL,lease_until=0,next_at=0 WHERE operation=?",
        row.operation,
      );
    this.sql.exec(
      "UPDATE project_create_audit SET handed=1 WHERE ticket_hash=?",
      sha256Hex(ticket),
    );
    return Response.json(
      {
        version: 2,
        ticket,
        state: "handed-off",
        operationVersion: row.version,
        operation: row.operation,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  rememberGrant(lease: CreateExecutor, grant: DurableGrant) {
    const json = encodeGrant(grant),
      previous = this.row(lease.operation)?.grant_json;
    if (previous && json !== previous) {
      this.defer(lease, "quota-grant-mismatch", true);
      return false;
    }
    return (
      this.sql
        .exec(
          "UPDATE project_create_operations SET grant_json=? WHERE operation=? AND generation=? AND executor=? RETURNING operation",
          json,
          lease.operation,
          lease.generation,
          lease.executor,
        )
        .toArray().length === 1
    );
  }

  contactQuota(lease: CreateExecutor) {
    const { calls } = this.sql
      .exec<{ calls: number }>(
        "INSERT INTO project_create_quota_calls VALUES(?,1) ON CONFLICT(operation) DO UPDATE SET calls=calls+1 RETURNING calls",
        lease.operation,
      )
      .one();
    return Response.json({ first: calls === 1 });
  }

  refuseQuota(lease: CreateExecutor) {
    const proof = this.sql
      .exec(
        "SELECT 1 FROM project_create_operations o JOIN project_create_quota_calls q USING(operation) WHERE o.operation=? AND o.generation=? AND o.executor=? AND o.grant_json IS NULL AND q.calls=1",
        lease.operation,
        lease.generation,
        lease.executor,
      )
      .toArray();
    if (!proof.length) {
      this.defer(lease, "quota-outcome-unconfirmed", false);
      return createPending();
    }
    this.finish(lease.operation, "denied");
    return Response.json({ settled: true });
  }

  /** A validated ordinary pull may own the only surviving copy of the quota reply. */
  observeGrant(
    owner: string,
    id: string,
    reservation: string,
    event: ProjectEvent,
  ) {
    const row = this.sql
      .exec<{ operation: string; grant_json: string | null }>(
        "SELECT operation,grant_json FROM project_create_operations WHERE owner_id=? AND project_id=? AND version=?",
        owner,
        id,
        format.read,
      )
      .toArray()[0];
    if (!row) return;
    const json = encodeGrant({ id, ownerUserId: owner, reservation, event });
    if (row.grant_json !== null && row.grant_json !== json) {
      this.block(row.operation, "quota-grant-mismatch");
      return;
    }
    this.sql.exec(
      "UPDATE project_create_operations SET grant_json=? WHERE operation=? AND grant_json IS NULL",
      json,
      row.operation,
    );
  }

  defer(lease: CreateExecutor, reason: string, blocked: boolean) {
    this.sql.exec(
      "UPDATE project_create_operations SET executor=NULL,lease_until=0,next_at=?,reason=?,blocked=? WHERE operation=? AND generation=? AND executor=?",
      Date.now() + 5_000,
      reason,
      Number(blocked),
      lease.operation,
      lease.generation,
      lease.executor,
    );
  }

  private block(operation: string, reason: string) {
    this.sql.exec(
      "UPDATE project_create_operations SET executor=NULL,lease_until=0,blocked=1,reason=? WHERE operation=?",
      reason,
      operation,
    );
  }

  expire() {
    const cutoff = Date.now() - RETENTION_MS;
    this.sql.exec(
      "DELETE FROM project_create_audit WHERE settled_at<?",
      Date.now() - 30 * 86_400_000,
    );
    this.sql.exec(
      "DELETE FROM project_create_inputs WHERE operation IN (SELECT operation FROM project_create_operations WHERE created<? AND input_bytes>0 AND version=?)",
      cutoff,
      format.read,
    );
    this.sql.exec(
      "UPDATE project_create_operations SET input_bytes=0,executor=NULL,blocked=1,reason=CASE WHEN blocked=0 THEN 'create-input-expired' ELSE reason END WHERE created<? AND input_bytes>0 AND version=?",
      cutoff,
      format.read,
    );
  }

  finish(operation: string, state: "committed" | "denied", retired = false) {
    const row = this.row(operation);
    if (!row) return;
    const performer = this.sql
      .exec<{ ticket_hash: string }>(
        "SELECT ticket_hash FROM project_create_audit WHERE operation=? AND execution_generation=?",
        operation,
        row.generation,
      )
      .toArray()[0]?.ticket_hash;
    this.sql.exec(
      "UPDATE project_create_audit SET outcome=?,finished_generation=?,settled_at=?,finished_by=CASE WHEN ? THEN 'retirement' WHEN ticket_hash=? THEN 'self' WHEN ? IS NULL THEN 'timer' ELSE 'other-attempt' END WHERE operation=? AND outcome IS NULL",
      state,
      row.generation,
      Date.now(),
      Number(retired),
      performer ?? null,
      performer ?? null,
      operation,
    );
    this.sql.exec(
      "UPDATE project_create_receipts SET state=? WHERE state='claimed' AND binding=? AND ticket_hash IN (SELECT ticket_hash FROM project_create_attempts WHERE operation=?)",
      state,
      operation,
      operation,
    );
    this.sql.exec(
      "DELETE FROM project_create_inputs WHERE operation=?",
      operation,
    );
    this.sql.exec(
      "DELETE FROM project_create_intents WHERE operation=?",
      operation,
    );
    this.sql.exec(
      "DELETE FROM project_create_quota_calls WHERE operation=?",
      operation,
    );
    this.sql.exec(
      "DELETE FROM project_create_attempts WHERE operation=?",
      operation,
    );
    this.sql.exec(
      "DELETE FROM project_create_operations WHERE operation=?",
      operation,
    );
  }

  retire(owner: string, project?: string) {
    const rows = this.sql
      .exec<{ operation: string }>(
        "SELECT operation FROM project_create_operations WHERE owner_id=? AND (? IS NULL OR project_id=?)",
        owner,
        project ?? null,
        project ?? null,
      )
      .toArray();
    for (const { operation } of rows) this.finish(operation, "denied", true);
  }

  capabilities() {
    const pending = this.sql
      .exec(
        "SELECT version AS operationVersion, COUNT(*) AS count, SUM(blocked) AS blocked FROM project_create_operations GROUP BY version ORDER BY version",
      )
      .toArray();
    return Response.json(
      {
        version: 2,
        operationVersions: [format.read],
        writeVersion: format.write,
        pending,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  diagnostics() {
    const operations = this.sql
      .exec(
        "SELECT operation, version AS operationVersion, created AS firstSeenAt,CASE WHEN blocked THEN NULL ELSE MAX(next_at,lease_until) END AS nextAttemptAt,COALESCE(reason,'accepted') AS reason,blocked FROM project_create_operations ORDER BY blocked DESC,created LIMIT 20",
      )
      .toArray();
    return Response.json(
      { version: 2, operations },
      { headers: { "cache-control": "no-store" } },
    );
  }

  pullLock(token: unknown, release: boolean, foreground: boolean) {
    if (typeof token !== "string" || token.length > 64)
      return refuse("invalid-pull-token", 400);
    if (release) {
      this.sql.exec(
        "DELETE FROM project_create_pull WHERE singleton=1 AND token=?",
        token,
      );
      return Response.json({ released: true });
    }
    const now = Date.now();
    const rows = this.sql
      .exec(
        "INSERT INTO project_create_pull VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET token=excluded.token,until=excluded.until WHERE until<=? RETURNING singleton",
        token,
        now + (foreground ? 18_000 : 150_000),
        now,
      )
      .toArray();
    return Response.json({ acquired: rows.length === 1 });
  }
}
