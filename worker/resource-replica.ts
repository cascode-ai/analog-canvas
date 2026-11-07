import { sha256Hex } from "@icm/derived";

type Sql = { exec<T>(sql: string, ...args: any[]): { toArray(): T[] } };
export type ReplicaState = {
  storage: { sql: Sql; transactionSync<T>(fn: () => T): T };
};
export type ResourceRegion = "cn" | "overseas";
export type ReplicaConfig = {
  RESOURCE_REGION?: ResourceRegion;
  RESOURCE_WRITES_ENABLED?: string;
};
type Row = Record<string, string | number | null>;
type Table = { name: string; key: string; columns: string[] };

/** Migrations may append the same named columns in a different physical order. */
function sameSchema(input: unknown, expected: Table[]): boolean {
  if (!Array.isArray(input) || input.length !== expected.length) return false;
  return expected.every((schema, i) => {
    const table = input[i];
    if (!table || !Array.isArray(table.columns)) return false;
    return (
      JSON.stringify({ ...table, columns: [...table.columns].sort() }) ===
      JSON.stringify({
        ...schema,
        columns: [...schema.columns].sort(),
      })
    );
  });
}
export const RESOURCE_MAX_BYTES = 24 * 1024 * 1024;
const tables = {
  components: [
    ["components", "id"],
    ["component_lifecycle", "component_id"],
  ],
  gallery: [
    ["gallery_entries", "id"],
    ["gallery_entry_versions", "entry_id"],
    ["gallery_likes", "entry_id"],
    ["dataset_comparisons", "id"],
    ["entry_references", "entry_id"],
    ["entry_reviews", "entry_id"],
    ["entry_fixes", "entry_id"],
  ],
} as const;
export type ResourceKind = keyof typeof tables;

const fail = (error: string, status = 409) =>
  Response.json({ error }, { status });

/** Aggregate maintenance must select authoritative rows before applying limits. */
export function locallyOwnedResources(sql: Sql, key = "id"): string {
  if (!/^[a-z_.]+$/.test(key)) throw new Error("Invalid resource key column");
  const enabled = sql
    .exec(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='resource_replica_meta'",
    )
    .toArray().length;
  return enabled
    ? `${key} NOT IN (SELECT id FROM resource_replica_keys WHERE origin<>(SELECT region FROM resource_replica_meta WHERE id=1))`
    : "1=1";
}

/** Origin-owned publications. Changes are coalesced current snapshots, not replayable commands. */
export class ResourceReplica {
  private readonly sql: Sql;
  private readonly tables: Table[];
  constructor(
    private readonly state: ReplicaState,
    readonly region: ResourceRegion,
    kind: ResourceKind,
    writable: boolean,
  ) {
    this.sql = state.storage.sql;
    this.tables = tables[kind].map(([name, key]) => ({
      name,
      key,
      columns: this.sql
        .exec<{ name: string }>(`PRAGMA table_info(${name})`)
        .toArray()
        .map((c) => c.name),
    }));
    if (
      this.tables.some(
        (t) =>
          !t.columns.includes(t.key) ||
          t.columns.some((c) => !/^[a-z_][a-z0-9_]*$/.test(c)),
      )
    )
      throw new Error("Resource schema unavailable");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_meta (id INTEGER PRIMARY KEY, region TEXT NOT NULL, epoch TEXT NOT NULL, sequence INTEGER NOT NULL, importing INTEGER NOT NULL, writable INTEGER NOT NULL)",
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO resource_replica_meta VALUES (1,?,?,0,0,0)",
      region,
      crypto.randomUUID(),
    );
    if (this.meta().region !== region)
      throw new Error("Resource state cannot change region");
    this.sql.exec(
      "UPDATE resource_replica_meta SET writable=? WHERE id=1",
      writable ? 1 : 0,
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_keys (id TEXT PRIMARY KEY, origin TEXT NOT NULL) WITHOUT ROWID",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_changes (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE) WITHOUT ROWID",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_peer (id INTEGER PRIMARY KEY, epoch TEXT NOT NULL, sequence INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_receipts (sequence INTEGER PRIMARY KEY, digest TEXT NOT NULL)",
    );
    for (const table of this.tables) this.install(table);
  }
  private meta() {
    return this.sql
      .exec<{ region: ResourceRegion; epoch: string; sequence: number }>(
        "SELECT region,epoch,sequence FROM resource_replica_meta WHERE id=1",
      )
      .toArray()[0]!;
  }
  private install(table: Table) {
    for (const [event, ref] of [
      ["INSERT", "NEW"],
      ["UPDATE", "NEW"],
      ["DELETE", "OLD"],
    ]) {
      const id = `${ref}.${table.key}`;
      const unchanged =
        event === "UPDATE"
          ? ` AND NOT (${table.columns.map((c) => `NEW.${c} IS OLD.${c}`).join(" AND ")})`
          : "";
      this.sql
        .exec(`CREATE TRIGGER IF NOT EXISTS replica_guard_${table.name}_${event}
        BEFORE ${event} ON ${table.name}
        WHEN (SELECT importing FROM resource_replica_meta WHERE id=1)=0${unchanged}
        BEGIN
          SELECT CASE WHEN (SELECT writable FROM resource_replica_meta WHERE id=1)=0
            THEN RAISE(ABORT,'RESOURCE_WRITES_DISABLED') END;
          SELECT CASE WHEN EXISTS(SELECT 1 FROM resource_replica_keys WHERE id=${id}
            AND origin<>(SELECT region FROM resource_replica_meta WHERE id=1))
            THEN RAISE(ABORT,'RESOURCE_SOURCE_READ_ONLY') END;
        END`);
      this.sql
        .exec(`CREATE TRIGGER IF NOT EXISTS replica_change_${table.name}_${event}
        AFTER ${event} ON ${table.name}
        WHEN (SELECT importing FROM resource_replica_meta WHERE id=1)=0${unchanged}
        BEGIN
          INSERT OR IGNORE INTO resource_replica_keys VALUES (${id},(SELECT region FROM resource_replica_meta WHERE id=1));
          UPDATE resource_replica_meta SET sequence=sequence+1 WHERE id=1;
          INSERT INTO resource_replica_changes VALUES (${id},(SELECT sequence FROM resource_replica_meta WHERE id=1))
            ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence;
        END`);
    }
  }
  status() {
    return {
      ...this.meta(),
      received:
        this.sql
          .exec<{ epoch: string; sequence: number }>(
            "SELECT epoch,sequence FROM resource_replica_peer WHERE id=1",
          )
          .toArray()[0] ?? null,
    };
  }
  seed() {
    return this.state.storage.transactionSync(() => {
      // Figures may precede a drawing; review/fix history may outlive it.
      // Keep queries below the Workers compound-SELECT limit. Insert keys
      // between tables so shared identities consume only one batch slot.
      let seeded = 0;
      for (const table of this.tables) {
        const rows = this.sql
          .exec<{ id: string }>(
            `SELECT DISTINCT ${table.key} AS id FROM ${table.name}
             WHERE ${table.key} NOT IN (SELECT id FROM resource_replica_keys)
             ORDER BY ${table.key} LIMIT ?`,
            50 - seeded,
          )
          .toArray();
        for (const { id } of rows) {
          this.sql.exec(
            "INSERT INTO resource_replica_keys VALUES (?,?)",
            id,
            this.region,
          );
          this.sql.exec(
            "UPDATE resource_replica_meta SET sequence=sequence+1 WHERE id=1",
          );
          this.sql.exec(
            "INSERT INTO resource_replica_changes VALUES (?,?)",
            id,
            this.meta().sequence,
          );
        }
        seeded += rows.length;
        if (seeded === 50) break;
      }
      return Response.json({ seeded, more: seeded === 50 });
    });
  }
  async changes(stream: string, after: number) {
    if (!Number.isSafeInteger(after) || after < 0)
      return fail("invalid-cursor", 400);
    const snapshot = this.state.storage.transactionSync(() => {
      const meta = this.meta();
      if (after > meta.sequence) return null;
      const next = this.sql
        .exec<{ id: string; sequence: number }>(
          "SELECT id,sequence FROM resource_replica_changes WHERE sequence>? ORDER BY sequence LIMIT 1",
          after,
        )
        .toArray()[0];
      if (!next) return { event: null, ...meta };
      const rows = this.tables.map((t) =>
        this.sql
          .exec<Row>(
            `SELECT * FROM ${t.name} WHERE ${t.key}=? ORDER BY ${t.columns.join(",")}`,
            next.id,
          )
          .toArray(),
      );
      return {
        event: {
          version: 1,
          stream,
          origin: this.region,
          epoch: meta.epoch,
          after,
          sequence: next.sequence,
          id: next.id,
          schema: this.tables,
          rows,
        },
      };
    });
    if (!snapshot) return fail("source-restore-reconciliation-required");
    if (!snapshot.event) return Response.json(snapshot);
    const payload = JSON.stringify(snapshot.event);
    if (new TextEncoder().encode(payload).length > RESOURCE_MAX_BYTES)
      return fail("resource-too-large", 413);
    return Response.json({ payload, digest: sha256Hex(payload) });
  }
  async receive(stream: string, input: unknown) {
    const envelope = input as { payload?: unknown; digest?: unknown } | null;
    if (
      !envelope ||
      typeof envelope.payload !== "string" ||
      typeof envelope.digest !== "string" ||
      new TextEncoder().encode(envelope.payload).length > RESOURCE_MAX_BYTES ||
      sha256Hex(envelope.payload) !== envelope.digest
    )
      return fail("invalid-resource-envelope", 400);
    let event: any;
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
      typeof event.id !== "string" ||
      !/^[a-zA-Z0-9:_-]{1,160}$/.test(event.id) ||
      !Number.isSafeInteger(event.sequence) ||
      !Number.isSafeInteger(event.after) ||
      event.after < 0 ||
      event.sequence <= event.after ||
      !sameSchema(event.schema, this.tables) ||
      !Array.isArray(event.rows) ||
      event.rows.length !== this.tables.length
    )
      return fail("invalid-resource-event", 400);
    for (const [i, table] of this.tables.entries()) {
      const rows = event.rows[i];
      if (
        !Array.isArray(rows) ||
        rows.length > 10000 ||
        (i === 0 && rows.length > 1) ||
        rows.some(
          (r: any) =>
            !r ||
            typeof r !== "object" ||
            Object.keys(r).length !== table.columns.length ||
            table.columns.some(
              (c) =>
                !Object.hasOwn(r, c) ||
                !(
                  r[c] === null ||
                  typeof r[c] === "string" ||
                  (typeof r[c] === "number" && Number.isFinite(r[c]))
                ),
            ) ||
            r[table.key] !== event.id,
        )
      )
        return fail("invalid-resource-rows", 400);
    }
    if (
      !event.rows[0].length &&
      this.tables.some(
        (t, i) =>
          ![
            "dataset_comparisons",
            "entry_references",
            "entry_reviews",
            "entry_fixes",
          ].includes(t.name) && event.rows[i].length,
      )
    )
      return fail("orphan-resource-rows", 400);
    return this.state.storage.transactionSync(() => {
      const received = this.status().received;
      if (received && received.epoch !== event.epoch)
        return fail("peer-epoch-changed");
      if (received && event.sequence <= received.sequence) {
        const prior = this.sql
          .exec<{ digest: string }>(
            "SELECT digest FROM resource_replica_receipts WHERE sequence=?",
            event.sequence,
          )
          .toArray()[0];
        return prior?.digest === envelope.digest
          ? Response.json({ sequence: received.sequence, duplicate: true })
          : fail("resource-replay-mismatch");
      }
      if (event.after !== (received?.sequence ?? 0))
        return fail("resource-cursor-mismatch");
      const owner = this.sql
        .exec<{ origin: string }>(
          "SELECT origin FROM resource_replica_keys WHERE id=?",
          event.id,
        )
        .toArray()[0];
      const main = this.tables[0]!;
      if (
        (owner && owner.origin !== peer) ||
        (!owner &&
          this.tables.some(
            (t) =>
              this.sql
                .exec(
                  `SELECT ${t.key} FROM ${t.name} WHERE ${t.key}=? LIMIT 1`,
                  event.id,
                )
                .toArray().length,
          ))
      )
        return fail("resource-origin-collision");
      this.sql.exec("UPDATE resource_replica_meta SET importing=1 WHERE id=1");
      this.sql.exec(
        "INSERT OR IGNORE INTO resource_replica_keys VALUES (?,?)",
        event.id,
        peer,
      );
      // Replace one resource and its retained children, never a whole store.
      for (const table of [...this.tables].reverse())
        this.sql.exec(
          `DELETE FROM ${table.name} WHERE ${table.key}=?`,
          event.id,
        );
      for (const [i, table] of this.tables.entries())
        for (const row of event.rows[i])
          this.sql.exec(
            `INSERT INTO ${table.name} (${table.columns.join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`,
            ...table.columns.map((c) => row[c]),
          );
      if (main.name === "components") {
        this.sql.exec(
          "DELETE FROM component_content_index WHERE component_id=?",
          event.id,
        );
        this.sql.exec("UPDATE component_content_progress SET complete=0");
      } else {
        this.sql.exec(
          "DELETE FROM gallery_entry_transistors WHERE entry_id=?",
          event.id,
        );
        this.sql.exec(
          "DELETE FROM gallery_entry_devices WHERE entry_id=?",
          event.id,
        );
        this.sql.exec("DELETE FROM gallery_stats_snapshot");
      }
      this.sql.exec(
        "INSERT OR REPLACE INTO resource_replica_peer VALUES (1,?,?)",
        event.epoch,
        event.sequence,
      );
      this.sql.exec(
        "INSERT INTO resource_replica_receipts VALUES (?,?)",
        event.sequence,
        envelope.digest,
      );
      this.sql.exec("UPDATE resource_replica_meta SET importing=0 WHERE id=1");
      return Response.json({ sequence: event.sequence });
    });
  }
}

export function withResourceReplication<
  Store extends new (...args: any[]) => {
    fetch(request: Request): Promise<Response>;
  },
>(Base: Store, kind: ResourceKind) {
  return class extends Base {
    readonly resourceReplica?: ResourceReplica;
    constructor(...args: any[]) {
      super(...args);
      const config = args[1] as ReplicaConfig | undefined;
      if (config?.RESOURCE_REGION)
        this.resourceReplica = new ResourceReplica(
          args[0],
          config.RESOURCE_REGION,
          kind,
          config.RESOURCE_WRITES_ENABLED === "true",
        );
    }
    override async fetch(request: Request): Promise<Response> {
      try {
        const replica = this.resourceReplica;
        const operation = new URL(request.url).pathname;
        if (operation.startsWith("/resource-sync/")) {
          if (!replica) return fail("resource-sync-disabled", 404);
          const body = (await request.json()) as {
            stream: string;
            after: number;
            envelope: unknown;
          };
          switch (operation) {
            case "/resource-sync/status":
              return Response.json(replica.status());
            case "/resource-sync/seed":
              return replica.seed();
            case "/resource-sync/changes":
              return replica.changes(body.stream, body.after);
            case "/resource-sync/receive":
              return replica.receive(body.stream, body.envelope);
          }
          return fail("not-found", 404);
        }
        return await super.fetch(request);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("RESOURCE_WRITES_DISABLED")
        )
          return Response.json(
            {
              code: "RESOURCE_WRITES_DISABLED",
              error: "Regional publication writes are closed.",
            },
            { status: 503 },
          );
        if (
          error instanceof Error &&
          error.message.includes("RESOURCE_SOURCE_READ_ONLY")
        )
          return Response.json(
            {
              code: "RESOURCE_SOURCE_READ_ONLY",
              error: "Edit this resource at its publishing region.",
            },
            { status: 409 },
          );
        throw error;
      }
    }
  };
}
