import { sha256Hex } from "@icm/derived";
import { OPEN_STREAM_SUFFIX, RegionalOpenCounts } from "./regional-open-counts";
import { ACTIVITY_STREAM_SUFFIX, RegionalActivity } from "./regional-activity";
import {
  lookupAccounts,
  type AccountLookup,
  type IdentityEnv,
} from "./sync-identity";
import {
  retireAccount,
  retiredAccount,
  validAccountId,
} from "./retired-accounts";

type Sql = { exec<T>(sql: string, ...args: any[]): { toArray(): T[] } };
export type ReplicaState = {
  storage: { sql: Sql; transactionSync<T>(fn: () => T): T };
};
export type ResourceRegion = "cn" | "overseas";
export type ReplicaConfig = {
  RESOURCE_REGION?: ResourceRegion;
  RESOURCE_WRITES_ENABLED?: string;
};
/** The number of accounts the authority reports missing, or a refusal (409/503). */
export type AccountCheck = (ids: string[]) => Promise<AccountLookup | Response>;
type Row = Record<string, string | number | null>;
/**
 * `key` names the identity columns, joined by ':' in a change ID; only the
 * last may contain ':'. `columns` are all local columns (guarded and
 * change-detected); `shared` excludes the private ones.
 */
type Table = { name: string; key: string; columns: string[]; shared: string[] };

export const RESOURCE_MAX_BYTES = 24 * 1024 * 1024;
/** Receivers refuse every other snapshot version; versions never mix. */
const SNAPSHOT_VERSION = 2;
/** Changing trigger bodies bumps this so installed triggers are recreated. */
const TRIGGER_VERSION = 4;
/** Writer-owned likes and reviews of a Gallery store travel in their own stream. */
export const INTERACTION_STREAM_SUFFIX = "-interactions";
/** Concurrent writes of one interaction generation keep this region's record. */
const INTERACTION_TIE_WINNER: ResourceRegion = "overseas";
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const kinds = {
  components: {
    prefix: "replica",
    tables: [
      ["components", "id"],
      ["component_lifecycle", "component_id"],
    ],
  },
  gallery: {
    prefix: "replica",
    tables: [
      ["gallery_entries", "id"],
      ["gallery_entry_versions", "entry_id"],
      ["dataset_comparisons", "id"],
      ["entry_references", "entry_id"],
      ["entry_fixes", "entry_id"],
    ],
  },
  interactions: {
    prefix: "interaction",
    tables: [
      ["gallery_likes", "entry_id:user_id"],
      ["entry_reviews", "id"],
    ],
  },
} as const;
export type ResourceKind = keyof typeof kinds;
/** Figures may precede a drawing; review and fix history may outlive it. */
const ROOTLESS = ["dataset_comparisons", "entry_references", "entry_fixes"];
/** Columns that never leave their region; copies hold the column default. */
const PRIVATE_COLUMNS: Record<string, readonly string[]> = {
  gallery_entries: ["submitter_email", "submitter_provider"],
};
/** Account columns a receiver looks up at the identity authority before import. */
const ACCOUNT_COLUMNS: Record<string, readonly string[]> = {
  gallery_entries: ["owner_user_id"],
  components: ["author_id"],
  gallery_likes: ["user_id"],
  entry_reviews: ["reviewer_id"],
};

const fail = (error: string, status = 409) =>
  Response.json({ error }, { status });
const metaTable = (prefix: string) =>
  prefix === "replica" ? "resource_replica" : `${prefix}_replica`;
const identity = (key: string, ref = "") =>
  key
    .split(":")
    .map((c) => ref + c)
    .join("||':'||");
/** Identity columns as a WHERE clause; bind with `keyParts`. */
const keyMatch = (key: string) =>
  key
    .split(":")
    .map((c) => `${c}=?`)
    .join(" AND ");
function keyParts(key: string, id: string): string[] {
  const count = key.split(":").length;
  const parts = id.split(":");
  return [...parts.slice(0, count - 1), parts.slice(count - 1).join(":")];
}

/** Aggregate maintenance must select authoritative rows before applying limits. */
export function locallyOwnedResources(
  sql: Sql,
  key = "id",
  scope: "resources" | "interactions" = "resources",
): string {
  if (!/^[a-z_.:]+$/.test(key)) throw new Error("Invalid resource key column");
  const meta =
    scope === "resources" ? "resource_replica" : "interaction_replica";
  const enabled = sql
    .exec(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${meta}_meta'`,
    )
    .toArray().length;
  return enabled
    ? `(${identity(key)}) NOT IN (SELECT id FROM ${meta}_keys WHERE origin<>(SELECT region FROM ${meta}_meta WHERE id=1))`
    : "1=1";
}

/**
 * Publications are origin-owned; likes and reviews are owned by the region
 * that last claimed them. Changes are coalesced current snapshots, not
 * replayable commands.
 *
 * The previous release's constructor must keep running against this state
 * (rollback): `*_meta`, `*_keys`, `*_peer`, `*_receipts` and `*_changes` of
 * `resource_replica` keep their columns; new local state lives in `*_local`.
 */
export class ResourceReplica {
  private readonly sql: Sql;
  private readonly tables: Table[];
  private readonly meta: string;
  private readonly writerOwned: boolean;
  constructor(
    private readonly state: ReplicaState,
    readonly region: ResourceRegion,
    private readonly kind: ResourceKind,
    writable: boolean,
    private readonly checkAccounts: AccountCheck,
  ) {
    this.sql = state.storage.sql;
    this.writerOwned = kind === "interactions";
    const prefix = kinds[kind].prefix;
    const meta = (this.meta = metaTable(prefix));
    if (kind !== "components")
      this.sql.exec(
        "CREATE TABLE IF NOT EXISTS retired_gallery_entries (id TEXT PRIMARY KEY) WITHOUT ROWID",
      );
    this.tables = kinds[kind].tables.map(([name, key]) => {
      const columns = this.sql
        .exec<{ name: string }>(`PRAGMA table_info(${name})`)
        .toArray()
        .map((c) => c.name);
      const hidden = PRIVATE_COLUMNS[name] ?? [];
      return {
        name,
        key,
        columns,
        shared: columns.filter((c) => !hidden.includes(c)),
      };
    });
    if (
      this.tables.some(
        (t) =>
          t.key.split(":").some((k) => !t.columns.includes(k)) ||
          t.columns.some((c) => !IDENTIFIER.test(c)),
      )
    )
      throw new Error("Resource schema unavailable");
    // CREATE TRIGGER IF NOT EXISTS freezes the column list it compared, so a
    // migrated column set (or table set) recreates both trigger families.
    const signature = sha256Hex(
      JSON.stringify({
        version: TRIGGER_VERSION,
        tables: this.tables.map((t) => [t.name, t.key, [...t.columns].sort()]),
      }),
    );
    state.storage.transactionSync(() => {
      const fresh = !this.sql
        .exec(
          `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${meta}_meta'`,
        )
        .toArray().length;
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${meta}_meta (id INTEGER PRIMARY KEY, region TEXT NOT NULL, epoch TEXT NOT NULL, sequence INTEGER NOT NULL, importing INTEGER NOT NULL, writable INTEGER NOT NULL)`,
      );
      this.sql.exec(
        `INSERT OR IGNORE INTO ${meta}_meta VALUES (1,?,?,0,0,0)`,
        region,
        crypto.randomUUID(),
      );
      // An interaction key's generation counts its claims by either region.
      this.sql.exec(
        this.writerOwned
          ? `CREATE TABLE IF NOT EXISTS ${meta}_keys (id TEXT PRIMARY KEY, origin TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 1) WITHOUT ROWID`
          : `CREATE TABLE IF NOT EXISTS ${meta}_keys (id TEXT PRIMARY KEY, origin TEXT NOT NULL) WITHOUT ROWID`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${meta}_changes (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE) WITHOUT ROWID`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${meta}_peer (id INTEGER PRIMARY KEY, epoch TEXT NOT NULL, sequence INTEGER NOT NULL)`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${meta}_receipts (sequence INTEGER PRIMARY KEY, digest TEXT NOT NULL)`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${meta}_local (id INTEGER PRIMARY KEY, signature TEXT NOT NULL, missing_accounts INTEGER NOT NULL)`,
      );
      this.sql.exec(`INSERT OR IGNORE INTO ${meta}_local VALUES (1,'',0)`);
      if (this.head().region !== region)
        throw new Error("Resource state cannot change region");
      this.sql.exec(
        `UPDATE ${meta}_meta SET writable=? WHERE id=1`,
        writable ? 1 : 0,
      );
      // Likes and reviews written before their stream existed are this
      // region's: index them now, so no release step is needed to send them.
      if (fresh && this.writerOwned) {
        for (const table of this.tables)
          this.sql.exec(
            `INSERT OR IGNORE INTO ${meta}_keys (id,origin) SELECT DISTINCT ${identity(table.key)}, ? FROM ${table.name}`,
            region,
          );
        this.sql.exec(
          `INSERT INTO ${meta}_changes SELECT id, ROW_NUMBER() OVER (ORDER BY id) FROM ${meta}_keys`,
        );
        this.sql.exec(
          `UPDATE ${meta}_meta SET sequence=(SELECT COUNT(*) FROM ${meta}_changes) WHERE id=1`,
        );
      }
      const installed = this.sql
        .exec<{ signature: string }>(
          `SELECT signature FROM ${meta}_local WHERE id=1`,
        )
        .toArray()[0]!.signature;
      // A rolled-back release may have recreated triggers of its own tables.
      const present = this.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type='trigger' AND (name GLOB '${prefix}_guard_*' OR name GLOB '${prefix}_change_*') ORDER BY name`,
        )
        .toArray()
        .map((t) => t.name);
      const expected = this.tables
        .flatMap((t) =>
          ["INSERT", "UPDATE", "DELETE"].flatMap((e) => [
            `${prefix}_change_${t.name}_${e}`,
            `${prefix}_guard_${t.name}_${e}`,
          ]),
        )
        .sort();
      if (
        installed === signature &&
        JSON.stringify(present) === JSON.stringify(expected)
      )
        return;
      for (const name of present)
        this.sql.exec(`DROP TRIGGER IF EXISTS ${name}`);
      for (const table of this.tables) this.install(prefix, table);
      this.sql.exec(
        `UPDATE ${meta}_local SET signature=? WHERE id=1`,
        signature,
      );
    });
  }
  private install(prefix: string, table: Table) {
    const meta = this.meta;
    const region = `(SELECT region FROM ${meta}_meta WHERE id=1)`;
    for (const [event, ref] of [
      ["INSERT", "NEW"],
      ["UPDATE", "NEW"],
      ["DELETE", "OLD"],
    ]) {
      const id = identity(table.key, `${ref}.`);
      const unchanged =
        event === "UPDATE"
          ? ` AND NOT (${table.columns.map((c) => `NEW.${c} IS OLD.${c}`).join(" AND ")})`
          : "";
      // A new like or review needs no origin check: an absent row is either
      // unknown or a tombstone, which the writing region claims.
      const foreign =
        this.writerOwned && event === "INSERT"
          ? ""
          : `SELECT CASE WHEN EXISTS(SELECT 1 FROM ${meta}_keys WHERE id=${id}
            AND origin<>${region})
            THEN RAISE(ABORT,'RESOURCE_SOURCE_READ_ONLY') END;`;
      this.sql.exec(`CREATE TRIGGER ${prefix}_guard_${table.name}_${event}
        BEFORE ${event} ON ${table.name}
        WHEN (SELECT importing FROM ${meta}_meta WHERE id=1)=0${unchanged}
        BEGIN
          SELECT CASE WHEN (SELECT writable FROM ${meta}_meta WHERE id=1)=0
            THEN RAISE(ABORT,'RESOURCE_WRITES_DISABLED') END;
          ${foreign}
        END`);
      const claim = this.writerOwned
        ? `INSERT INTO ${meta}_keys (id,origin) VALUES (${id},${region})
            ON CONFLICT(id) DO UPDATE SET generation=generation+(origin<>excluded.origin), origin=excluded.origin;`
        : `INSERT INTO ${meta}_keys VALUES (${id},${region}) ON CONFLICT(id) DO NOTHING;`;
      this.sql.exec(`CREATE TRIGGER ${prefix}_change_${table.name}_${event}
        AFTER ${event} ON ${table.name}
        WHEN (SELECT importing FROM ${meta}_meta WHERE id=1)=0${unchanged}
        BEGIN
          ${claim}
          UPDATE ${meta}_meta SET sequence=sequence+1 WHERE id=1;
          INSERT INTO ${meta}_changes VALUES (${id},(SELECT sequence FROM ${meta}_meta WHERE id=1))
            ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence;
        END`);
    }
  }
  private rowsOf(table: Table, id: string, columns = table.columns) {
    return this.sql
      .exec<Row>(
        `SELECT ${columns.join(",")} FROM ${table.name} WHERE ${keyMatch(table.key)} ORDER BY ${columns.join(",")}`,
        ...keyParts(table.key, id),
      )
      .toArray();
  }
  private head() {
    return this.sql
      .exec<{ region: ResourceRegion; epoch: string; sequence: number }>(
        `SELECT region,epoch,sequence FROM ${this.meta}_meta WHERE id=1`,
      )
      .toArray()[0]!;
  }
  private key(id: string) {
    return this.sql
      .exec<{ origin: string; generation?: number }>(
        `SELECT * FROM ${this.meta}_keys WHERE id=?`,
        id,
      )
      .toArray()[0];
  }
  originOf(id: string) {
    return this.key(id)?.origin ?? this.region;
  }
  locationOf(id: string) {
    const key = this.key(id);
    // Ownership keys survive row deletion; legacy unseeded rows also belong
    // to this region. Absence is distinct from originOf's legacy fallback.
    const known =
      Boolean(key) ||
      this.tables.some(
        (table) =>
          this.sql
            .exec(
              `SELECT 1 FROM ${table.name} WHERE ${identity(table.key)}=? LIMIT 1`,
              id,
            )
            .toArray().length > 0,
      );
    return { origin: key?.origin ?? this.region, known };
  }

  status() {
    return {
      ...this.head(),
      received:
        this.sql
          .exec<{ epoch: string; sequence: number }>(
            `SELECT epoch,sequence FROM ${this.meta}_peer WHERE id=1`,
          )
          .toArray()[0] ?? null,
      // Imported rows naming accounts the authority no longer has.
      missingAccounts: this.sql
        .exec<{ missing_accounts: number }>(
          `SELECT missing_accounts FROM ${this.meta}_local WHERE id=1`,
        )
        .toArray()[0]!.missing_accounts,
    };
  }
  seed() {
    const meta = this.meta;
    return this.state.storage.transactionSync(() => {
      // Keep queries below the Workers compound-SELECT limit. Insert keys
      // between tables so shared identities consume only one batch slot.
      let seeded = 0;
      for (const table of this.tables) {
        const id = identity(table.key);
        const rows = this.sql
          .exec<{ id: string }>(
            `SELECT DISTINCT ${id} AS id FROM ${table.name}
             WHERE ${id} NOT IN (SELECT id FROM ${meta}_keys)
             ORDER BY 1 LIMIT ?`,
            50 - seeded,
          )
          .toArray();
        for (const { id } of rows) {
          this.sql.exec(
            `INSERT INTO ${meta}_keys (id,origin) VALUES (?,?)`,
            id,
            this.region,
          );
          this.sql.exec(
            `UPDATE ${meta}_meta SET sequence=sequence+1 WHERE id=1`,
          );
          this.sql.exec(
            `INSERT INTO ${meta}_changes VALUES (?,?)`,
            id,
            this.head().sequence,
          );
        }
        seeded += rows.length;
        if (seeded === 50) break;
      }
      return Response.json({ seeded, more: seeded === 50 });
    });
  }
  /** Delete both authoritative rows and local copies without claiming foreign keys. */
  retireOwner(userId: string, replay: boolean) {
    this.state.storage.transactionSync(() => {
      retireAccount(this.sql, userId);
      const meta = this.meta;
      const writable =
        this.sql
          .exec<{ writable: number }>(
            `SELECT writable FROM ${meta}_meta WHERE id=1`,
          )
          .toArray()[0]?.writable ?? 0;
      const ownerTables = this.writerOwned
        ? this.tables
        : this.tables.slice(0, 1);
      const keys = new Set<string>();
      for (const table of ownerTables) {
        const column = ACCOUNT_COLUMNS[table.name]?.[0];
        if (!column) continue;
        const rows = this.sql
          .exec<{ id: string }>(
            `SELECT ${identity(table.key)} AS id FROM ${table.name}
             WHERE ${column}=?`,
            userId,
          )
          .toArray();
        for (const { id } of rows) keys.add(id);
      }
      // An authenticated deletion is allowed during publication write freezes.
      this.sql.exec(`UPDATE ${meta}_meta SET writable=1 WHERE id=1`);
      for (const id of keys) {
        const key = this.key(id);
        const local = !key || key.origin === this.region;
        const importing = replay || !local ? 1 : 0;
        this.sql.exec(
          `UPDATE ${meta}_meta SET importing=? WHERE id=1`,
          importing,
        );
        if (this.kind === "gallery" && local)
          this.retirePublication(id, replay);
        this.clearRows(id, this.kind === "gallery");
        this.invalidate(id);
      }
      this.sql.exec(
        `UPDATE ${meta}_meta SET writable=?, importing=0 WHERE id=1`,
        writable,
      );
    });
  }

  /** A publication origin names actual deletions. A stale former-owner snapshot
   * can be suppressed without deleting likes on a later takeover. */
  private retirePublication(id: string, suppressWrites: boolean) {
    this.sql.exec(
      "INSERT OR IGNORE INTO retired_gallery_entries VALUES (?)",
      id,
    );
    const writable =
      this.sql
        .exec<{ writable: number }>(
          "SELECT writable FROM interaction_replica_meta WHERE id=1",
        )
        .toArray()[0]?.writable ?? 0;
    if (!suppressWrites) {
      this.sql.exec(
        "UPDATE interaction_replica_meta SET writable=1 WHERE id=1",
      );
      this.sql.exec(
        `DELETE FROM gallery_likes WHERE entry_id=? AND
        ${locallyOwnedResources(this.sql, "entry_id:user_id", "interactions")}`,
        id,
      );
    }
    // Foreign copies do not become newly authored tombstones on this peer.
    this.sql.exec("UPDATE interaction_replica_meta SET importing=1 WHERE id=1");
    this.sql.exec("DELETE FROM gallery_likes WHERE entry_id=?", id);
    this.sql.exec(
      "UPDATE interaction_replica_meta SET importing=0,writable=? WHERE id=1",
      writable,
    );
  }

  private clearRows(id: string, keepAudit = false) {
    const tables = keepAudit
      ? this.tables.filter((t) => !ROOTLESS.includes(t.name))
      : this.tables;
    for (const table of [...tables].reverse())
      this.sql.exec(
        `DELETE FROM ${table.name} WHERE ${keyMatch(table.key)}`,
        ...keyParts(table.key, id),
      );
  }

  private invalidate(id: string) {
    if (this.kind === "components") {
      this.sql.exec(
        "DELETE FROM component_content_index WHERE component_id=?",
        id,
      );
      this.sql.exec("UPDATE component_content_progress SET complete=0");
      return;
    }
    if (this.kind === "gallery") {
      this.sql.exec(
        "DELETE FROM gallery_entry_transistors WHERE entry_id=?",
        id,
      );
      this.sql.exec("DELETE FROM gallery_entry_devices WHERE entry_id=?", id);
    }
    this.sql.exec("DELETE FROM gallery_stats_snapshot");
  }

  private retiredPublication(id: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM retired_gallery_entries WHERE id=?", id)
        .toArray().length > 0
    );
  }

  async changes(stream: string, after: number) {
    if (!Number.isSafeInteger(after) || after < 0)
      return fail("invalid-cursor", 400);
    const snapshot = this.state.storage.transactionSync(() => {
      const meta = this.head();
      if (after > meta.sequence) return null;
      const next = this.sql
        .exec<{ id: string; sequence: number }>(
          `SELECT id,sequence FROM ${this.meta}_changes WHERE sequence>? ORDER BY sequence LIMIT 1`,
          after,
        )
        .toArray()[0];
      if (!next) return { event: null, ...meta };
      const key = this.key(next.id);
      // An interaction the other region has since claimed keeps its place in
      // the sequence as a no-op, so the receiver's cursor reaches the tail.
      const noop = this.writerOwned && key?.origin !== this.region;
      return {
        event: {
          version: SNAPSHOT_VERSION,
          stream,
          origin: this.region,
          epoch: meta.epoch,
          after,
          sequence: next.sequence,
          id: next.id,
          ...(this.kind === "gallery" && this.retiredPublication(next.id)
            ? { retiredPublication: true }
            : {}),
          ...(this.writerOwned
            ? { generation: key?.generation ?? 1, noop }
            : {}),
          schema: this.tables.map((t) => ({
            name: t.name,
            key: t.key,
            columns: t.shared,
          })),
          rows: this.tables.map((t) =>
            noop ? [] : this.rowsOf(t, next.id, t.shared),
          ),
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
  /** Duplicate, replayed, out-of-order or changed-epoch receipts; null when next. */
  private sequenceRefusal(event: any, digest: string): Response | null {
    const received = this.status().received;
    if (received && received.epoch !== event.epoch)
      return fail("peer-epoch-changed");
    if (received && event.sequence <= received.sequence) {
      const prior = this.sql
        .exec<{ digest: string }>(
          `SELECT digest FROM ${this.meta}_receipts WHERE sequence=?`,
          event.sequence,
        )
        .toArray()[0];
      return prior?.digest === digest
        ? Response.json({ sequence: received.sequence, duplicate: true })
        : fail("resource-replay-mismatch");
    }
    if (event.after !== (received?.sequence ?? 0))
      return fail("resource-cursor-mismatch");
    return null;
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
    const digest = envelope.digest;
    let event: any;
    try {
      event = JSON.parse(envelope.payload);
    } catch {
      return fail("invalid-resource-envelope", 400);
    }
    if (
      event &&
      Number.isSafeInteger(event.version) &&
      event.version !== SNAPSHOT_VERSION
    )
      return fail("resource-version-unsupported");
    const peer = this.region === "cn" ? "overseas" : "cn";
    const schema: { columns: string[] }[] = event?.schema;
    if (
      !event ||
      event.version !== SNAPSHOT_VERSION ||
      event.stream !== stream ||
      event.origin !== peer ||
      typeof event.epoch !== "string" ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(event.epoch) ||
      typeof event.id !== "string" ||
      !/^[a-zA-Z0-9:_.@-]{1,320}$/.test(event.id) ||
      !Number.isSafeInteger(event.sequence) ||
      !Number.isSafeInteger(event.after) ||
      event.after < 0 ||
      event.sequence <= event.after ||
      (this.writerOwned
        ? !Number.isSafeInteger(event.generation) ||
          event.generation < 1 ||
          typeof event.noop !== "boolean"
        : event.generation !== undefined || event.noop !== undefined) ||
      !Array.isArray(schema) ||
      schema.length !== this.tables.length ||
      this.tables.some((t, i) => {
        const s = schema[i] as any;
        return (
          !s ||
          typeof s !== "object" ||
          Object.keys(s).length !== 3 ||
          s.name !== t.name ||
          s.key !== t.key ||
          !Array.isArray(s.columns) ||
          s.columns.some(
            (c: unknown) =>
              typeof c !== "string" ||
              !IDENTIFIER.test(c) ||
              (PRIVATE_COLUMNS[t.name] ?? []).includes(c),
          ) ||
          new Set(s.columns).size !== s.columns.length ||
          t.key.split(":").some((k) => !s.columns.includes(k))
        );
      }) ||
      !Array.isArray(event.rows) ||
      event.rows.length !== this.tables.length
    )
      return fail("invalid-resource-event", 400);
    // One release of skew: an older sender's absent columns take the local
    // default; a newer sender's extra column waits for this receiver's upgrade.
    if (
      this.tables.some((t, i) =>
        schema[i]!.columns.some((c) => !t.shared.includes(c)),
      )
    )
      return fail("resource-schema-newer");
    for (const [i, table] of this.tables.entries()) {
      const rows = event.rows[i];
      const columns = schema[i]!.columns;
      const parts = table.key.split(":");
      if (
        !Array.isArray(rows) ||
        rows.length > 10000 ||
        ((this.writerOwned || i === 0) && rows.length > 1) ||
        (event.noop && rows.length) ||
        rows.some(
          (r: any) =>
            !r ||
            typeof r !== "object" ||
            Object.keys(r).length !== columns.length ||
            columns.some(
              (c) =>
                !Object.hasOwn(r, c) ||
                !(
                  r[c] === null ||
                  typeof r[c] === "string" ||
                  (typeof r[c] === "number" && Number.isFinite(r[c]))
                ),
            ) ||
            parts.slice(0, -1).some((k) => String(r[k]).includes(":")) ||
            parts.map((k) => r[k]).join(":") !== event.id,
        )
      )
        return fail("invalid-resource-rows", 400);
    }
    if (
      !this.writerOwned &&
      !event.rows[0].length &&
      this.tables.some(
        (t, i) => !ROOTLESS.includes(t.name) && event.rows[i].length,
      )
    )
      return fail("orphan-resource-rows", 400);
    if (
      event.retiredPublication !== undefined &&
      (event.retiredPublication !== true ||
        this.kind !== "gallery" ||
        event.rows[0].length)
    )
      return fail("invalid-retirement", 400);
    // A redelivered receipt answers before any identity lookup.
    const early = this.sequenceRefusal(event, digest);
    if (early) return early;
    // Unknown legacy bylines are distinct from an explicit authority deletion.
    const ids = new Set<string>();
    this.tables.forEach((t, i) => {
      for (const row of event.rows[i])
        for (const column of ACCOUNT_COLUMNS[t.name] ?? [])
          if (
            row[column] !== null &&
            row[column] !== undefined &&
            row[column] !== ""
          )
            ids.add(String(row[column]));
    });
    const accounts = await this.checkAccounts([...ids]);
    if (accounts instanceof Response) return accounts;
    const meta = this.meta;
    return this.state.storage.transactionSync(() => {
      const late = this.sequenceRefusal(event, digest);
      if (late) return late;
      const accept = () => {
        this.sql.exec(
          `INSERT OR REPLACE INTO ${meta}_peer VALUES (1,?,?)`,
          event.epoch,
          event.sequence,
        );
        this.sql.exec(
          `INSERT INTO ${meta}_receipts VALUES (?,?)`,
          event.sequence,
          digest,
        );
      };
      if (event.noop) {
        accept();
        return Response.json({ sequence: event.sequence, noop: true });
      }
      const key = this.key(event.id);
      const local = key
        ? key.origin !== peer
        : this.tables.some((t) => this.rowsOf(t, event.id).length);
      if (local && !this.writerOwned) return fail("resource-origin-collision");
      if (this.writerOwned && (key || local)) {
        // A later claim (higher generation) wins; equal generations were
        // written concurrently and keep the tie winner's record in both.
        const generation = key?.generation ?? 1;
        const adopt = local
          ? event.generation > generation ||
            (event.generation === generation && peer === INTERACTION_TIE_WINNER)
          : event.generation >= generation;
        if (!adopt) {
          accept();
          return Response.json({ sequence: event.sequence, superseded: true });
        }
      }
      this.sql.exec(`UPDATE ${meta}_meta SET importing=1 WHERE id=1`);
      if (this.writerOwned)
        this.sql.exec(
          `INSERT INTO ${meta}_keys VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin, generation=excluded.generation`,
          event.id,
          peer,
          event.generation,
        );
      else
        this.sql.exec(
          `INSERT INTO ${meta}_keys VALUES (?,?) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin`,
          event.id,
          peer,
        );
      // Replace one resource and its retained children, never a whole store.
      this.clearRows(event.id);
      const erased =
        accounts.deleted.length > 0 ||
        [...ids].some((id) => retiredAccount(this.sql, id));
      const like = this.writerOwned ? event.rows[0][0] : undefined;
      const retiredLike = like && this.retiredPublication(like.entry_id);
      if (event.retiredPublication === true)
        this.retirePublication(event.id, true);
      for (const [i, table] of this.tables.entries()) {
        if (retiredLike || (erased && !ROOTLESS.includes(table.name))) continue;
        const columns = schema[i]?.columns ?? [];
        for (const row of event.rows[i])
          this.sql.exec(
            `INSERT INTO ${table.name} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            ...columns.map((c) => row[c]),
          );
      }
      this.invalidate(event.id);
      this.sql.exec(
        `UPDATE ${meta}_local SET missing_accounts=missing_accounts+? WHERE id=1`,
        accounts.missing,
      );
      accept();
      this.sql.exec(`UPDATE ${meta}_meta SET importing=0 WHERE id=1`);
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
    readonly interactionReplica?: ResourceReplica;
    readonly openCounts?: RegionalOpenCounts;
    readonly activity?: RegionalActivity;
    constructor(...args: any[]) {
      super(...args);
      const config = args[1] as (ReplicaConfig & IdentityEnv) | undefined;
      if (!config?.RESOURCE_REGION) return;
      const region = config.RESOURCE_REGION;
      const writable = config.RESOURCE_WRITES_ENABLED === "true";
      const check: AccountCheck = (ids) =>
        lookupAccounts(config, ids, region === "overseas");
      this.resourceReplica = new ResourceReplica(
        args[0],
        region,
        kind,
        writable,
        check,
      );
      if (kind === "gallery") {
        this.interactionReplica = new ResourceReplica(
          args[0],
          region,
          "interactions",
          writable,
          check,
        );
        this.openCounts = new RegionalOpenCounts(args[0], region);
        this.activity = new RegionalActivity(args[0], region, check);
      }
    }
    override async fetch(request: Request): Promise<Response> {
      try {
        const operation = new URL(request.url).pathname;
        if (this.activity && request.method === "POST") {
          if (operation === "/toggle-bookmark")
            return this.activity.bookmark(await request.json());
          if (operation === "/activity-board-location")
            return this.activity.boardLocation(
              String((await request.json()).id),
            );
          if (operation === "/activity-board-command")
            return this.activity.boards.command(await request.json());
          if (operation === "/activity-board-references")
            return this.activity.boards.referencesPresent(
              (await request.json()).ids,
            );
          if (operation === "/bookmarks")
            return this.activity.bookmarks(
              String((await request.json()).userId),
            );
        }
        if (operation === "/retire-account" && request.method === "POST") {
          const { userId, replay } = (await request.clone().json()) as {
            userId?: unknown;
            replay?: unknown;
          };
          if (!validAccountId(userId)) return fail("invalid-user", 400);
          this.activity?.retire(userId);
          this.resourceReplica?.retireOwner(userId, replay === true);
          this.interactionReplica?.retireOwner(userId, replay === true);
        }
        if (operation.startsWith("/resource-sync/")) {
          const body = (await request.json()) as {
            stream: string;
            after: number;
            envelope: unknown;
            id: string;
          };
          if (String(body.stream).endsWith(ACTIVITY_STREAM_SUFFIX))
            return (
              this.activity?.handle(operation, body) ??
              fail("resource-sync-disabled", 404)
            );
          if (String(body.stream).endsWith(OPEN_STREAM_SUFFIX))
            return (
              this.openCounts?.handle(operation, body) ??
              fail("resource-sync-disabled", 404)
            );
          const replica = String(body.stream).endsWith(
            INTERACTION_STREAM_SUFFIX,
          )
            ? this.interactionReplica
            : this.resourceReplica;
          if (!replica) return fail("resource-sync-disabled", 404);
          switch (operation) {
            case "/resource-sync/location":
              return Response.json(replica.locationOf(body.id));
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
              error: "Edit this resource in the region that wrote it.",
            },
            { status: 409 },
          );
        throw error;
      }
    }
  };
}
