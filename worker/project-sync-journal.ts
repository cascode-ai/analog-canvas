import type { SqlStorage } from "./gallery-store";
import { isRecord } from "./gallery-store";
import { MAX_SYNC_BYTES, type ProjectChange } from "./project-sync-protocol";

export interface ProjectEvent {
  version: 1;
  origin: "cn" | "overseas";
  epoch: string;
  sequence: number;
  eventId: string;
  payload: string;
  payloadHash: string;
}
export interface ProjectSyncStatus {
  origin: "cn" | "overseas";
  epoch: string;
  sequence: number;
  acknowledged: number;
  journalBytes: number;
  fenced: boolean;
  pending: number;
  oldestPendingAt: string | null;
  delivery: { status: string; at: string; retries: number } | null;
  received: {
    origin: string;
    epoch: string;
    sequence: number;
    hash: string;
  } | null;
}
export class ProjectSyncCapacityError extends Error {}
export class ProjectSyncFenceError extends Error {}

export async function projectPayloadHash(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class ProjectSyncJournal {
  private fenced: boolean;
  constructor(
    private readonly sql: SqlStorage,
    private readonly origin: "cn" | "overseas",
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 1024 * 1024 * 1024
    )
      throw new Error("Invalid replication journal capacity");
    sql.exec(`CREATE TABLE IF NOT EXISTS project_sync_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch TEXT NOT NULL,
      origin TEXT NOT NULL, sequence INTEGER NOT NULL, acknowledged INTEGER NOT NULL
    )`);
    this.fenced =
      sql.exec("SELECT epoch FROM project_sync_meta").toArray().length > 0;
    sql.exec(
      "INSERT OR IGNORE INTO project_sync_meta VALUES (1, ?, ?, 0, 0)",
      crypto.randomUUID(),
      origin,
    );
    if (
      sql.exec<{ origin: string }>("SELECT origin FROM project_sync_meta").one()
        .origin !== origin
    )
      throw new Error("A state directory cannot change region");
    sql.exec(`CREATE TABLE IF NOT EXISTS project_sync_outbox (
      sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    )`);
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_sync_payloads (head TEXT NOT NULL, chunk INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(head,chunk)) WITHOUT ROWID",
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS project_sync_peer (singleton INTEGER PRIMARY KEY CHECK(singleton=1), origin TEXT NOT NULL, epoch TEXT NOT NULL, sequence INTEGER NOT NULL)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS project_sync_receipts (sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, hash TEXT NOT NULL)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS project_sync_nodes (head TEXT PRIMARY KEY, project_id TEXT NOT NULL, owner_id TEXT NOT NULL, deleted INTEGER NOT NULL, active INTEGER NOT NULL)`,
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS project_sync_nodes_project ON project_sync_nodes(project_id,active)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_quota_events (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL) WITHOUT ROWID",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_sync_delivery (singleton INTEGER PRIMARY KEY CHECK(singleton=1), status TEXT NOT NULL, at TEXT NOT NULL, retries INTEGER NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_sync_recovery_floor (singleton INTEGER PRIMARY KEY CHECK(singleton=1), sequence INTEGER NOT NULL, hash TEXT NOT NULL)",
    );
  }

  private bytes(): number {
    return this.sql
      .exec<{ bytes: number }>(
        "SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM project_sync_payloads",
      )
      .one().bytes;
  }
  private capacity(payload: string): void {
    const bytes = new TextEncoder().encode(payload).length;
    if (bytes > MAX_SYNC_BYTES || this.bytes() + bytes > this.maxBytes)
      throw new ProjectSyncCapacityError(
        "Replication journal capacity exceeded",
      );
  }

  private payload(head: string): string {
    return this.sql
      .exec<{ payload: string }>(
        "SELECT payload FROM project_sync_payloads WHERE head=? ORDER BY chunk",
        head,
      )
      .toArray()
      .map((row) => row.payload)
      .join("");
  }

  private storePayload(head: string, payload: string): void {
    this.capacity(payload);
    let chunk = 0;
    for (let start = 0; start < payload.length;) {
      let end = Math.min(start + 128 * 1024, payload.length);
      // Never split a UTF-16 surrogate pair before SQLite encodes each chunk.
      const last = payload.charCodeAt(end - 1);
      if (end < payload.length && last >= 0xd800 && last <= 0xdbff) end--;
      this.sql.exec(
        "INSERT INTO project_sync_payloads VALUES (?,?,?)",
        head,
        chunk++,
        payload.slice(start, end),
      );
      start = end;
    }
  }

  knownHead(id: string, owner: string, head: unknown): boolean {
    return (
      typeof head === "string" &&
      this.sql
        .exec(
          "SELECT head FROM project_sync_nodes WHERE head=? AND project_id=? AND owner_id=?",
          head,
          id,
          owner,
        )
        .toArray().length === 1
    );
  }

  snapshot(id: string): string {
    const project =
      this.sql
        .exec<Record<string, unknown>>(
          "SELECT * FROM cloud_projects WHERE id = ?",
          id,
        )
        .toArray()[0] ?? null;
    const versions = this.sql
      .exec<Record<string, unknown>>(
        "SELECT * FROM cloud_project_versions WHERE project_id = ? ORDER BY revision DESC",
        id,
      )
      .toArray();
    // Thumbnails are a derived cache, regenerated by the receiving region.
    return JSON.stringify({
      project: project ? { ...project, preview_svg: "" } : null,
      versions: versions.map((version) => ({ ...version, preview_svg: "" })),
    });
  }

  heads(id: string): ProjectChange[] {
    return this.sql
      .exec<{ head: string }>(
        "SELECT head FROM project_sync_nodes WHERE project_id=? AND active=1 ORDER BY head",
        id,
      )
      .toArray()
      .map((row) => JSON.parse(this.payload(row.head)) as ProjectChange);
  }

  conflicted(id: string): boolean {
    return (
      this.sql
        .exec(
          "SELECT head FROM project_sync_nodes WHERE project_id=? AND active=1 LIMIT 2",
          id,
        )
        .toArray().length > 1
    );
  }

  deleted(id: string): boolean {
    return (
      this.sql
        .exec(
          "SELECT head FROM project_sync_nodes WHERE project_id=? AND deleted=1 LIMIT 1",
          id,
        )
        .toArray().length > 0
    );
  }

  record(
    id: string,
    ownerUserId: string,
    _previousHead: string | undefined,
    snapshot: string,
  ): string {
    if (this.fenced)
      throw new ProjectSyncFenceError(
        "Peer reconciliation required after restart",
      );
    const head = `head-${crypto.randomUUID()}`;
    const state = JSON.parse(snapshot) as {
      project: unknown;
      versions: unknown[];
    };
    const payload = JSON.stringify({
      origin: this.origin,
      id,
      ownerUserId,
      head,
      parents: this.heads(id).map((node) => node.head),
      ...state,
    });
    this.storePayload(head, payload);
    this.sql.exec(
      "UPDATE project_sync_meta SET sequence = sequence + 1 WHERE singleton = 1",
    );
    const { sequence } = this.sql
      .exec<{ sequence: number }>("SELECT sequence FROM project_sync_meta")
      .one();
    this.sql.exec(
      "INSERT INTO project_sync_outbox VALUES (?, ?, ?)",
      sequence,
      head,
      new Date().toISOString(),
    );
    this.addNode(JSON.parse(payload) as ProjectChange);
    return head;
  }

  reserve(id: string, ownerUserId: string, reservation: string): number {
    if (this.fenced)
      throw new ProjectSyncFenceError("Quota authority needs reconciliation");
    const existing = this.sql
      .exec<{ sequence: number }>(
        "SELECT sequence FROM project_quota_events WHERE id=?",
        id,
      )
      .toArray()[0];
    if (existing) return existing.sequence;
    const head = `quota-${crypto.randomUUID()}`;
    const payload = JSON.stringify({
      origin: this.origin,
      kind: "quota",
      id,
      ownerUserId,
      reservation,
      head,
      parents: [],
      project: null,
      versions: [],
    });
    this.storePayload(head, payload);
    this.sql.exec(
      "UPDATE project_sync_meta SET sequence=sequence+1 WHERE singleton=1",
    );
    const { sequence } = this.sql
      .exec<{ sequence: number }>("SELECT sequence FROM project_sync_meta")
      .one();
    this.sql.exec(
      "INSERT INTO project_sync_outbox VALUES (?,?,?)",
      sequence,
      head,
      new Date().toISOString(),
    );
    this.sql.exec(
      "INSERT INTO project_quota_events VALUES (?,?)",
      id,
      sequence,
    );
    return sequence;
  }

  private addNode(change: ProjectChange): void {
    for (const parent of change.parents)
      this.sql.exec(
        "UPDATE project_sync_nodes SET active=0 WHERE head=?",
        parent,
      );
    this.sql.exec(
      "INSERT INTO project_sync_nodes VALUES (?, ?, ?, ?, 1)",
      change.head,
      change.id,
      change.ownerUserId,
      change.project === null ? 1 : 0,
    );
  }

  receive(event: ProjectEvent, change: ProjectChange): Response {
    if (event.origin === this.origin)
      return Response.json({ error: "wrong-origin" }, { status: 409 });
    const peer = this.sql
      .exec<{ epoch: string; origin: string; sequence: number }>(
        "SELECT * FROM project_sync_peer",
      )
      .toArray()[0];
    if (peer && (peer.epoch !== event.epoch || peer.origin !== event.origin))
      return Response.json({ error: "epoch-mismatch" }, { status: 409 });
    const receipt = this.sql
      .exec<{ event_id: string; hash: string }>(
        "SELECT * FROM project_sync_receipts WHERE sequence=?",
        event.sequence,
      )
      .toArray()[0];
    if (receipt)
      return receipt.event_id === event.eventId &&
        receipt.hash === event.payloadHash
        ? Response.json({ acknowledged: peer!.sequence, epoch: peer!.epoch })
        : Response.json({ error: "sequence-collision" }, { status: 409 });
    if (event.sequence !== (peer?.sequence ?? 0) + 1)
      return Response.json(
        { error: "sequence-gap", acknowledged: peer?.sequence ?? 0 },
        { status: 409 },
      );
    if (change.kind === "quota") {
      if (this.origin !== "cn")
        return Response.json({ error: "wrong-quota-target" }, { status: 409 });
      const existing = this.sql
        .exec<{ owner_id: string; token: string }>(
          "SELECT owner_id,token FROM project_quota_reservations WHERE id=?",
          change.id,
        )
        .toArray()[0];
      if (
        existing &&
        (existing.owner_id !== change.ownerUserId ||
          existing.token !== change.reservation)
      )
        return Response.json({ error: "quota-collision" }, { status: 409 });
      this.sql.exec(
        "INSERT OR IGNORE INTO project_quota_reservations VALUES (?,?,?)",
        change.id,
        change.ownerUserId,
        change.reservation,
      );
      this.sql.exec(
        "INSERT INTO project_sync_receipts VALUES (?,?,?)",
        event.sequence,
        event.eventId,
        event.payloadHash,
      );
      this.sql.exec(
        "INSERT OR REPLACE INTO project_sync_peer VALUES (1,?,?,?)",
        event.origin,
        event.epoch,
        event.sequence,
      );
      return Response.json({
        acknowledged: event.sequence,
        epoch: event.epoch,
      });
    }
    if (
      this.origin === "overseas" &&
      !change.parents.length &&
      !this.sql
        .exec(
          "SELECT id FROM project_quota_reservations WHERE id=? AND owner_id=?",
          change.id,
          change.ownerUserId,
        )
        .toArray().length
    )
      return Response.json(
        { error: "missing-quota-reservation" },
        { status: 409 },
      );
    const nodes = this.sql
      .exec<{ head: string; owner_id: string }>(
        "SELECT head,owner_id FROM project_sync_nodes WHERE project_id=?",
        change.id,
      )
      .toArray();
    if (
      nodes.some((node) => node.owner_id !== change.ownerUserId) ||
      (!change.parents.length && nodes.length)
    )
      return Response.json({ error: "resource-collision" }, { status: 409 });
    if (
      change.parents.some(
        (parent) => !nodes.some((node) => node.head === parent),
      )
    )
      return Response.json({ error: "missing-parent" }, { status: 409 });
    if (
      this.sql
        .exec("SELECT head FROM project_sync_nodes WHERE head=?", change.head)
        .toArray().length
    )
      return Response.json({ error: "head-collision" }, { status: 409 });
    this.storePayload(change.head, event.payload);
    this.addNode(change);
    this.materialize(change);
    this.sql.exec(
      "INSERT INTO project_sync_receipts VALUES (?, ?, ?)",
      event.sequence,
      event.eventId,
      event.payloadHash,
    );
    this.sql.exec(
      "INSERT OR REPLACE INTO project_sync_peer VALUES (1, ?, ?, ?)",
      event.origin,
      event.epoch,
      event.sequence,
    );
    return Response.json({ acknowledged: event.sequence, epoch: event.epoch });
  }

  private materialize(change: ProjectChange): void {
    const deleted = this.deleted(change.id);
    if (!deleted && this.heads(change.id).length > 1) return;
    this.sql.exec(
      "DELETE FROM cloud_project_versions WHERE project_id=?",
      change.id,
    );
    this.sql.exec("DELETE FROM cloud_projects WHERE id=?", change.id);
    const p = deleted ? null : change.project;
    if (p) {
      this.sql.exec(
        `INSERT INTO cloud_projects (id,user_id,name,created_at,updated_at,revision,schema_version,project_text,preview_svg,gallery_entry_id,favorite) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        p.id,
        p.user_id,
        p.name,
        p.created_at,
        p.updated_at,
        p.revision,
        p.schema_version,
        p.project_text,
        "",
        p.gallery_entry_id,
        p.favorite,
      );
      for (const v of change.versions)
        this.sql.exec(
          "INSERT INTO cloud_project_versions VALUES (?,?,?,?,?,?,?,?)",
          v.id,
          v.project_id,
          v.revision,
          v.name,
          v.saved_at,
          v.schema_version,
          v.project_text,
          "",
        );
    }
    this.sql.exec(
      "INSERT OR REPLACE INTO regional_project_heads VALUES (?, ?)",
      change.id,
      change.head,
    );
  }

  status(): ProjectSyncStatus {
    const meta = this.sql
      .exec<{ epoch: string; sequence: number; acknowledged: number }>(
        "SELECT * FROM project_sync_meta",
      )
      .one();
    const received =
      this.sql
        .exec<{
          origin: string;
          epoch: string;
          sequence: number;
          hash: string;
        }>(
          "SELECT p.origin,p.epoch,p.sequence,r.hash FROM project_sync_peer p JOIN project_sync_receipts r ON p.sequence=r.sequence",
        )
        .toArray()[0] ?? null;
    return {
      origin: this.origin,
      epoch: meta.epoch,
      sequence: meta.sequence,
      acknowledged: meta.acknowledged,
      journalBytes: this.bytes(),
      fenced: this.fenced,
      pending: meta.sequence - meta.acknowledged,
      oldestPendingAt:
        this.sql
          .exec<{ created_at: string }>(
            "SELECT created_at FROM project_sync_outbox WHERE sequence>? ORDER BY sequence LIMIT 1",
            meta.acknowledged,
          )
          .toArray()[0]?.created_at ?? null,
      delivery:
        this.sql
          .exec<{ status: string; at: string; retries: number }>(
            "SELECT status,at,retries FROM project_sync_delivery",
          )
          .toArray()[0] ?? null,
      received,
    };
  }

  delivery(status: unknown): Response {
    if (
      typeof status !== "string" ||
      !["disabled", "caught-up", "sent", "retry", "blocked"].includes(status)
    )
      return Response.json({ error: "invalid-status" }, { status: 400 });
    this.sql.exec(
      "INSERT INTO project_sync_delivery VALUES (1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET status=excluded.status,at=excluded.at,retries=CASE WHEN excluded.retries=1 THEN project_sync_delivery.retries+1 ELSE 0 END",
      status,
      new Date().toISOString(),
      status === "retry" || status === "blocked" ? 1 : 0,
    );
    return Response.json({ status });
  }

  async reconcile(peer: ProjectSyncStatus): Promise<Response> {
    if (
      !isRecord(peer) ||
      typeof peer.epoch !== "string" ||
      !peer.epoch ||
      !Number.isSafeInteger(peer.sequence) ||
      peer.sequence < 0 ||
      !(
        peer.received === null ||
        (isRecord(peer.received) && typeof peer.received.hash === "string")
      )
    ) {
      this.fenced = true;
      return Response.json({ error: "invalid-peer-status" }, { status: 409 });
    }
    const local = this.status(),
      received = peer.received;
    if (
      received &&
      received.origin === local.origin &&
      received.epoch === local.epoch &&
      Number.isSafeInteger(received.sequence) &&
      received.sequence > 0
    ) {
      this.sql.exec(
        "INSERT INTO project_sync_recovery_floor VALUES (1,?,?) ON CONFLICT(singleton) DO UPDATE SET sequence=excluded.sequence,hash=excluded.hash WHERE excluded.sequence>project_sync_recovery_floor.sequence",
        received.sequence,
        received.hash,
      );
    }
    const floor = this.sql
      .exec<{ sequence: number; hash: string }>(
        "SELECT sequence,hash FROM project_sync_recovery_floor",
      )
      .toArray()[0];
    let valid =
      ["cn", "overseas"].includes(peer.origin) &&
      peer.origin !== local.origin &&
      (!local.received || local.received.epoch === peer.epoch) &&
      (!received ||
        (received.origin === local.origin &&
          received.epoch === local.epoch &&
          Number.isSafeInteger(received.sequence) &&
          received.sequence >= 0 &&
          received.sequence <= local.sequence));
    if (valid && floor) {
      const row = this.sql
        .exec<{ event_id: string }>(
          "SELECT event_id FROM project_sync_outbox WHERE sequence=?",
          floor.sequence,
        )
        .toArray()[0];
      valid =
        !!row &&
        (await projectPayloadHash(this.payload(row.event_id))) === floor.hash;
    }
    if (valid && received && received.sequence > 0) {
      const row = this.sql
        .exec<{ event_id: string }>(
          "SELECT event_id FROM project_sync_outbox WHERE sequence=?",
          received.sequence,
        )
        .toArray()[0];
      valid =
        !!row &&
        (await projectPayloadHash(this.payload(row.event_id))) ===
          received.hash;
    }
    this.fenced = !valid;
    return Response.json(
      valid ? { ready: true } : { error: "restore-fenced" },
      { status: valid ? 200 : 409 },
    );
  }

  acknowledge(epoch: unknown, sequence: unknown): Response {
    const meta = this.status();
    if (
      epoch !== meta.epoch ||
      !Number.isSafeInteger(sequence) ||
      Number(sequence) < 0 ||
      Number(sequence) > meta.sequence
    )
      return Response.json({ error: "restore-fenced" }, { status: 409 });
    this.sql.exec(
      "UPDATE project_sync_meta SET acknowledged=MAX(acknowledged, ?) WHERE singleton=1",
      sequence,
    );
    return Response.json({ acknowledged: sequence });
  }

  async events(after: number): Promise<Response> {
    if (!Number.isSafeInteger(after) || after < 0)
      return Response.json({ error: "invalid-cursor" }, { status: 400 });
    const meta = this.sql
      .exec<{ epoch: string; sequence: number; acknowledged: number }>(
        "SELECT * FROM project_sync_meta",
      )
      .one();
    if (after > meta.sequence)
      return Response.json(
        { error: "restore-fenced", highWater: meta.sequence },
        { status: 409 },
      );
    const rows = this.sql
      .exec<{ sequence: number; event_id: string }>(
        "SELECT * FROM project_sync_outbox WHERE sequence > ? ORDER BY sequence LIMIT 1",
        after,
      )
      .toArray();
    const events: ProjectEvent[] = await Promise.all(
      rows.map(async (row) => {
        const payload = this.payload(row.event_id);
        return {
          version: 1,
          origin: this.origin,
          epoch: meta.epoch,
          sequence: row.sequence,
          eventId: row.event_id,
          payload,
          payloadHash: await projectPayloadHash(payload),
        };
      }),
    );
    return Response.json({
      events,
      epoch: meta.epoch,
      highWater: meta.sequence,
      acknowledged: meta.acknowledged,
    });
  }
}
