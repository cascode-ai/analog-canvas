import { sha256Hex } from "@icm/derived";
import type { ReplicaState, ResourceRegion } from "./resource-replica";

export const OPEN_STREAM_SUFFIX = "-opens";
const MAX_ROWS = 500;
const MAX_BYTES = 512 * 1024;
type Count = { entry_id: string; day: string; opens: number; sequence: number };
type Event = {
  version: 1;
  stream: string;
  origin: ResourceRegion;
  epoch: string;
  after: number;
  sequence: number;
  rows: Count[];
};
const fail = (error: string, status = 409) =>
  Response.json({ error }, { status });

/** Each region owns a monotonically increasing component, never the combined total. */
export class RegionalOpenCounts {
  private readonly sql;
  constructor(
    private readonly state: ReplicaState,
    readonly region: ResourceRegion,
  ) {
    const sql = (this.sql = state.storage.sql);
    state.storage.transactionSync(() => {
      sql.exec(`CREATE TABLE IF NOT EXISTS regional_opens_meta (
        id INTEGER PRIMARY KEY, region TEXT NOT NULL, epoch TEXT NOT NULL,
        sequence INTEGER NOT NULL, importing INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS regional_open_counts (
        region TEXT NOT NULL, entry_id TEXT NOT NULL, day TEXT NOT NULL,
        opens INTEGER NOT NULL, sequence INTEGER NOT NULL,
        PRIMARY KEY(region,entry_id,day)) WITHOUT ROWID`);
      sql.exec(
        "CREATE INDEX IF NOT EXISTS regional_opens_sequence ON regional_open_counts(region,sequence)",
      );
      sql.exec(
        "CREATE INDEX IF NOT EXISTS regional_opens_entry_day ON regional_open_counts(entry_id,day)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS regional_opens_peer (id INTEGER PRIMARY KEY, epoch TEXT NOT NULL, sequence INTEGER NOT NULL)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS regional_opens_receipts (sequence INTEGER PRIMARY KEY, digest TEXT NOT NULL)",
      );
      if (
        !sql.exec("SELECT 1 FROM regional_opens_meta WHERE id=1").toArray()
          .length
      ) {
        // The pre-sync aggregate contains this region's own accepted opens only.
        // This happens once; a restart/rollback must never seed the merged total.
        sql.exec(
          "INSERT INTO regional_opens_meta VALUES (1,?,?,0,0)",
          region,
          crypto.randomUUID(),
        );
        sql.exec(
          `INSERT INTO regional_open_counts SELECT ?,entry_id,day,opens,
          ROW_NUMBER() OVER (ORDER BY entry_id,day) FROM gallery_entry_opens`,
          region,
        );
        sql.exec(
          "UPDATE regional_opens_meta SET sequence=(SELECT COUNT(*) FROM regional_open_counts) WHERE id=1",
        );
      }
      if (this.head().region !== region)
        throw new Error("Open counts cannot change region");
      // Keep the legacy aggregate write path working, including a code rollback.
      // Peer materialization suppresses these triggers; it is never a local open.
      for (const event of ["INSERT", "UPDATE"] as const) {
        const delta = event === "INSERT" ? "NEW.opens" : "NEW.opens-OLD.opens";
        sql.exec(`CREATE TRIGGER IF NOT EXISTS regional_opens_${event}
          AFTER ${event} ON gallery_entry_opens
          WHEN (SELECT importing FROM regional_opens_meta WHERE id=1)=0 AND (${delta})>0
          BEGIN
            UPDATE regional_opens_meta SET sequence=sequence+1 WHERE id=1;
            INSERT INTO regional_open_counts VALUES (
              (SELECT region FROM regional_opens_meta WHERE id=1),NEW.entry_id,NEW.day,${delta},
              (SELECT sequence FROM regional_opens_meta WHERE id=1))
            ON CONFLICT(region,entry_id,day) DO UPDATE SET
              opens=opens+excluded.opens,sequence=excluded.sequence;
          END`);
      }
    });
  }
  private head() {
    return this.sql
      .exec<{ region: ResourceRegion; epoch: string; sequence: number }>(
        "SELECT region,epoch,sequence FROM regional_opens_meta WHERE id=1",
      )
      .toArray()[0]!;
  }
  status() {
    return {
      ...this.head(),
      received:
        this.sql
          .exec<{ epoch: string; sequence: number }>(
            "SELECT epoch,sequence FROM regional_opens_peer WHERE id=1",
          )
          .toArray()[0] ?? null,
    };
  }
  handle(
    operation: string,
    body: { stream: string; after: number; envelope: unknown },
  ): Response {
    if (operation === "/resource-sync/status")
      return Response.json(this.status());
    if (operation === "/resource-sync/changes")
      return this.changes(body.stream, body.after);
    if (operation === "/resource-sync/receive")
      return this.receive(body.stream, body.envelope);
    return fail("not-found", 404);
  }
  private changes(stream: string, after: number): Response {
    if (!Number.isSafeInteger(after) || after < 0)
      return fail("invalid-cursor", 400);
    return this.state.storage.transactionSync(() => {
      const head = this.head();
      if (after > head.sequence)
        return fail("source-restore-reconciliation-required");
      const rows = this.sql
        .exec<Count>(
          `SELECT entry_id,day,opens,sequence FROM regional_open_counts
         WHERE region=? AND sequence>? ORDER BY sequence LIMIT ${MAX_ROWS}`,
          this.region,
          after,
        )
        .toArray();
      if (!rows.length) return Response.json({ event: null, ...head });
      const payload = JSON.stringify({
        version: 1,
        stream,
        origin: this.region,
        epoch: head.epoch,
        after,
        sequence: rows.at(-1)!.sequence,
        rows,
      } satisfies Event);
      if (new TextEncoder().encode(payload).length > MAX_BYTES)
        return fail("resource-too-large", 413);
      return Response.json({ payload, digest: sha256Hex(payload) });
    });
  }
  private receive(stream: string, input: unknown): Response {
    const envelope = input as { payload?: unknown; digest?: unknown } | null;
    if (
      !envelope ||
      typeof envelope.payload !== "string" ||
      typeof envelope.digest !== "string" ||
      new TextEncoder().encode(envelope.payload).length > MAX_BYTES ||
      sha256Hex(envelope.payload) !== envelope.digest
    )
      return fail("invalid-resource-envelope", 400);
    let event: Event;
    try {
      event = JSON.parse(envelope.payload);
    } catch {
      return fail("invalid-resource-envelope", 400);
    }
    const peer = this.region === "cn" ? "overseas" : "cn";
    if (
      !event ||
      event.version !== 1 ||
      event.stream !== stream ||
      event.origin !== peer ||
      typeof event.epoch !== "string" ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(event.epoch) ||
      !Number.isSafeInteger(event.after) ||
      event.after < 0 ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= event.after ||
      !Array.isArray(event.rows) ||
      !event.rows.length ||
      event.rows.length > MAX_ROWS
    )
      return fail("invalid-open-counts", 400);
    let sequence = event.after;
    const keys = new Set<string>();
    for (const row of event.rows) {
      if (
        !row ||
        typeof row.entry_id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(row.entry_id) ||
        typeof row.day !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.day) ||
        !Number.isSafeInteger(row.opens) ||
        row.opens < 0 ||
        !Number.isSafeInteger(row.sequence) ||
        row.sequence <= sequence ||
        keys.has(row.entry_id + ":" + row.day)
      )
        return fail("invalid-open-counts", 400);
      sequence = row.sequence;
      keys.add(row.entry_id + ":" + row.day);
    }
    if (sequence !== event.sequence) return fail("invalid-open-counts", 400);
    return this.state.storage.transactionSync(() => {
      const received = this.status().received;
      if (received && received.epoch !== event.epoch)
        return fail("peer-epoch-changed");
      if (received && event.sequence <= received.sequence) {
        const prior = this.sql
          .exec<{ digest: string }>(
            "SELECT digest FROM regional_opens_receipts WHERE sequence=?",
            event.sequence,
          )
          .toArray()[0];
        return prior?.digest === envelope.digest
          ? Response.json({ sequence: received.sequence, duplicate: true })
          : fail("resource-replay-mismatch");
      }
      if (event.after !== (received?.sequence ?? 0))
        return fail("resource-cursor-mismatch");
      // Validate the entire page before any mutation: returning a refusal does
      // not roll back transactionSync, so no earlier row may already be applied.
      for (const row of event.rows) {
        const counts = this.sql
          .exec<{ region: string; opens: number }>(
            "SELECT region,opens FROM regional_open_counts WHERE entry_id=? AND day=?",
            row.entry_id,
            row.day,
          )
          .toArray();
        if (counts.some((c) => c.region === peer && c.opens > row.opens))
          return fail("open-count-regression");
        const local = counts.find((c) => c.region === this.region)?.opens ?? 0;
        if (!Number.isSafeInteger(local + row.opens))
          return fail("open-count-overflow");
      }
      this.sql.exec("UPDATE regional_opens_meta SET importing=1 WHERE id=1");
      for (const row of event.rows) {
        this.sql.exec(
          `INSERT INTO regional_open_counts VALUES (?,?,?,?,?)
          ON CONFLICT(region,entry_id,day) DO UPDATE SET opens=excluded.opens,sequence=excluded.sequence`,
          peer,
          row.entry_id,
          row.day,
          row.opens,
          row.sequence,
        );
        this.sql.exec(
          `INSERT INTO gallery_entry_opens(entry_id,day,opens)
          SELECT ?,?,SUM(opens) FROM regional_open_counts WHERE entry_id=? AND day=?
          ON CONFLICT(entry_id,day) DO UPDATE SET opens=excluded.opens`,
          row.entry_id,
          row.day,
          row.entry_id,
          row.day,
        );
      }
      this.sql.exec(
        "INSERT INTO regional_opens_peer VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,sequence=excluded.sequence",
        event.epoch,
        event.sequence,
      );
      this.sql.exec(
        "INSERT INTO regional_opens_receipts VALUES (?,?)",
        event.sequence,
        envelope.digest,
      );
      this.sql.exec("UPDATE regional_opens_meta SET importing=0 WHERE id=1");
      return Response.json({ sequence: event.sequence });
    });
  }
}
