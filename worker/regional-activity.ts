import { sha256Hex } from "@icm/derived";
import { RegionalBoards } from "./regional-boards";
import type {
  AccountCheck,
  ReplicaState,
  ResourceRegion,
} from "./resource-replica";
import {
  retiredAccount,
  retireAccount,
  validAccountId,
} from "./retired-accounts";

export const ACTIVITY_STREAM_SUFFIX = "-activity";
const MAX_BYTES = 24 * 1024 * 1024;
type Bookmark = { userId: string; entryId: string; saved: boolean; at: string };
type RecordRow = {
  key: string;
  kind: string;
  origin: ResourceRegion;
  generation: number;
  value: string;
};
type Event = {
  version: 1;
  stream: string;
  origin: ResourceRegion;
  epoch: string;
  after: number;
  sequence: number;
  record: RecordRow;
};
const fail = (error: string, status = 409) =>
  Response.json({ error }, { status });
const versionOf = (row: RecordRow | undefined) =>
  row ? `${row.generation}:${row.origin}` : null;
function validBookmark(value: unknown, key: string): value is Bookmark {
  if (!value || typeof value !== "object") return false;
  const item = value as Bookmark;
  return (
    validAccountId(item.userId) &&
    typeof item.entryId === "string" &&
    /^[A-Za-z0-9_-]{3,64}$/.test(item.entryId) &&
    typeof item.saved === "boolean" &&
    typeof item.at === "string" &&
    key === JSON.stringify([item.userId, item.entryId])
  );
}

/** Private activity has its own cursor; it never joins public publication exports. */
export class RegionalActivity {
  private readonly sql;
  readonly boards: RegionalBoards;
  constructor(
    private readonly state: ReplicaState,
    readonly region: ResourceRegion,
    private readonly checkAccounts: AccountCheck,
  ) {
    this.sql = state.storage.sql;
    const sql = this.sql;
    state.storage.transactionSync(() => {
      sql.exec(
        `CREATE TABLE IF NOT EXISTS regional_activity_meta (id INTEGER PRIMARY KEY, region TEXT NOT NULL, epoch TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, importing INTEGER NOT NULL DEFAULT 0)`,
      );
      sql.exec(
        "INSERT OR IGNORE INTO regional_activity_meta(id,region,epoch) VALUES(1,?,?)",
        region,
        crypto.randomUUID(),
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS regional_activity_records (key TEXT PRIMARY KEY, kind TEXT NOT NULL, origin TEXT NOT NULL, generation INTEGER NOT NULL, value TEXT NOT NULL) WITHOUT ROWID`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS regional_activity_changes (key TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, record TEXT NOT NULL) WITHOUT ROWID`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS regional_activity_peer (id INTEGER PRIMARY KEY, epoch TEXT NOT NULL, sequence INTEGER NOT NULL)`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS regional_activity_receipts (sequence INTEGER PRIMARY KEY, digest TEXT NOT NULL)`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS regional_activity_commands (user_id TEXT NOT NULL, command_id TEXT NOT NULL, binding TEXT NOT NULL, version TEXT, PRIMARY KEY(user_id,command_id)) WITHOUT ROWID`,
      );
      if (this.head().region !== region)
        throw new Error("Activity region cannot change");
      for (const [event, ref, saved] of [
        ["INSERT", "NEW", 1],
        ["DELETE", "OLD", 0],
      ] as const) {
        const key = `json_array(${ref}.user_id,${ref}.entry_id)`;
        sql.exec(`CREATE TRIGGER IF NOT EXISTS regional_bookmark_${event} AFTER ${event} ON entry_bookmarks
          WHEN (SELECT importing FROM regional_activity_meta WHERE id=1)=0
          BEGIN
            UPDATE regional_activity_meta SET sequence=sequence+1 WHERE id=1;
            INSERT INTO regional_activity_records VALUES(${key},'bookmark',
              (SELECT region FROM regional_activity_meta WHERE id=1),1,
              json_object('userId',${ref}.user_id,'entryId',${ref}.entry_id,'saved',json('${saved ? "true" : "false"}'),'at',${ref}.created_at))
            ON CONFLICT(key) DO UPDATE SET origin=excluded.origin,generation=generation+1,value=excluded.value;
            INSERT INTO regional_activity_changes SELECT key,(SELECT sequence FROM regional_activity_meta WHERE id=1),
              json_object('key',key,'kind',kind,'origin',origin,'generation',generation,'value',value)
              FROM regional_activity_records WHERE key=${key}
            ON CONFLICT(key) DO UPDATE SET sequence=excluded.sequence,record=excluded.record;
          END`);
      }
    });
    this.boards = new RegionalBoards(state, region);
  }
  private head() {
    return this.sql
      .exec<{ region: ResourceRegion; epoch: string; sequence: number }>(
        "SELECT region,epoch,sequence FROM regional_activity_meta WHERE id=1",
      )
      .toArray()[0]!;
  }
  private row(key: string) {
    return this.sql
      .exec<RecordRow>(
        "SELECT * FROM regional_activity_records WHERE key=?",
        key,
      )
      .toArray()[0];
  }
  private record(row: RecordRow) {
    this.sql.exec(
      "INSERT INTO regional_activity_records VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET origin=excluded.origin,generation=excluded.generation,value=excluded.value",
      row.key,
      row.kind,
      row.origin,
      row.generation,
      row.value,
    );
    this.sql.exec(
      "UPDATE regional_activity_meta SET sequence=sequence+1 WHERE id=1",
    );
    this.sql.exec(
      "INSERT INTO regional_activity_changes VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET sequence=excluded.sequence,record=excluded.record",
      row.key,
      this.head().sequence,
      JSON.stringify(row),
    );
  }
  /** One bounded seed batch; concurrent new writes already have records via SQL triggers. */
  private seed() {
    this.state.storage.transactionSync(() => {
      for (const row of this.sql
        .exec<{ id: string }>(
          "SELECT id FROM boards WHERE NOT EXISTS(SELECT 1 FROM regional_activity_records WHERE key='board:'||boards.id) ORDER BY id LIMIT 100",
        )
        .toArray())
        this.touchBoard(row.id);
      for (const row of this.sql
        .exec<{ user_id: string; entry_id: string; created_at: string }>(
          `SELECT b.* FROM entry_bookmarks b WHERE NOT EXISTS
        (SELECT 1 FROM regional_activity_records r WHERE r.key=json_array(b.user_id,b.entry_id)) ORDER BY user_id,entry_id LIMIT 100`,
        )
        .toArray()) {
        this.record({
          key: JSON.stringify([row.user_id, row.entry_id]),
          kind: "bookmark",
          origin: this.region,
          generation: 1,
          value: JSON.stringify({
            userId: row.user_id,
            entryId: row.entry_id,
            saved: true,
            at: row.created_at,
          } satisfies Bookmark),
        });
      }
    });
  }
  private touchBoard(id: string) {
    const previous = this.row("board:" + id);
    this.record({
      key: "board:" + id,
      kind: "board",
      origin: this.region,
      generation: (previous?.generation ?? 0) + 1,
      value: "{}",
    });
  }
  private seedBookmark(userId: string, entryId: string) {
    const key = JSON.stringify([userId, entryId]);
    if (this.row(key)) return;
    const existing = this.sql
      .exec<{ created_at: string }>(
        "SELECT created_at FROM entry_bookmarks WHERE user_id=? AND entry_id=?",
        userId,
        entryId,
      )
      .toArray()[0];
    if (existing)
      this.record({
        key,
        kind: "bookmark",
        origin: this.region,
        generation: 1,
        value: JSON.stringify({
          userId,
          entryId,
          saved: true,
          at: existing.created_at,
        } satisfies Bookmark),
      });
  }
  boardLocation(id: string) {
    if (
      !this.row("board:" + id) &&
      this.sql.exec("SELECT 1 FROM boards WHERE id=?", id).toArray().length
    )
      this.state.storage.transactionSync(() => this.touchBoard(id));
    return Response.json({ origin: this.boards.origin(id) });
  }
  retire(userId: string) {
    this.state.storage.transactionSync(() => {
      this.boards.retire(userId, (id) => this.touchBoard(id));
      // Normal delete triggers retain removal tombstones in this region's
      // activity stream, even if no later incoming synchronization occurs.
      this.sql.exec("DELETE FROM entry_bookmarks WHERE user_id=?", userId);
      this.sql.exec(
        "DELETE FROM regional_activity_commands WHERE user_id=?",
        userId,
      );
    });
  }
  status() {
    this.seed();
    return {
      ...this.head(),
      received:
        this.sql
          .exec<{ epoch: string; sequence: number }>(
            "SELECT epoch,sequence FROM regional_activity_peer WHERE id=1",
          )
          .toArray()[0] ?? null,
    };
  }
  async handle(
    operation: string,
    body: { stream: string; after: number; envelope: unknown },
  ): Promise<Response> {
    if (operation === "/resource-sync/status")
      return Response.json(this.status());
    if (operation === "/resource-sync/changes")
      return this.changes(body.stream, body.after);
    if (operation === "/resource-sync/receive")
      return this.receive(body.stream, body.envelope);
    return fail("not-found", 404);
  }
  private changes(stream: string, after: number) {
    if (!Number.isSafeInteger(after) || after < 0)
      return fail("invalid-cursor", 400);
    this.seed();
    const head = this.head();
    if (after > head.sequence)
      return fail("source-restore-reconciliation-required");
    const row = this.sql
      .exec<{ sequence: number; record: string }>(
        "SELECT sequence,record FROM regional_activity_changes WHERE sequence>? ORDER BY sequence LIMIT 1",
        after,
      )
      .toArray()[0];
    if (!row) return Response.json({ event: null, ...head });
    const record = JSON.parse(row.record) as RecordRow;
    if (record.kind === "board")
      record.value = JSON.stringify(this.boards.snapshot(record.key.slice(6)));
    const payload = JSON.stringify({
      version: 1,
      stream,
      origin: this.region,
      epoch: head.epoch,
      after,
      sequence: row.sequence,
      record,
    } satisfies Event);
    if (new TextEncoder().encode(payload).length > MAX_BYTES)
      return fail("activity-too-large", 413);
    return Response.json({ payload, digest: sha256Hex(payload) });
  }
  private async receive(stream: string, input: unknown): Promise<Response> {
    const envelope = input as { payload?: unknown; digest?: unknown } | null;
    if (
      !envelope ||
      typeof envelope.payload !== "string" ||
      typeof envelope.digest !== "string" ||
      new TextEncoder().encode(envelope.payload).length > MAX_BYTES ||
      sha256Hex(envelope.payload) !== envelope.digest
    )
      return fail("invalid-resource-envelope", 400);
    let event: Event, value: unknown;
    try {
      event = JSON.parse(envelope.payload);
      value = JSON.parse(event.record.value);
    } catch {
      return fail("invalid-activity", 400);
    }
    const peer = this.region === "cn" ? "overseas" : "cn",
      row = event.record;
    if (
      event.version !== 1 ||
      event.stream !== stream ||
      event.origin !== peer ||
      typeof event.epoch !== "string" ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(event.epoch) ||
      !Number.isSafeInteger(event.after) ||
      event.after < 0 ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= event.after ||
      row.origin !== peer ||
      !Number.isSafeInteger(row.generation) ||
      row.generation < 1 ||
      typeof row.key !== "string"
    )
      return fail("invalid-activity", 400);
    const board =
      row.kind === "board" &&
      row.key.startsWith("board:") &&
      this.boards.valid(row.key.slice(6), value)
        ? value
        : null;
    const bookmark =
      row.kind === "bookmark" && validBookmark(value, row.key) ? value : null;
    if (!board && !bookmark) return fail("invalid-activity", 400);
    const accounts = await this.checkAccounts(
      board ? this.boards.accountIds(board) : [bookmark!.userId],
    );
    if (accounts instanceof Response) return accounts;
    return this.state.storage.transactionSync(() => {
      const received = this.status().received;
      if (received && received.epoch !== event.epoch)
        return fail("peer-epoch-changed");
      if (received && event.sequence <= received.sequence) {
        const receipt = this.sql
          .exec<{ digest: string }>(
            "SELECT digest FROM regional_activity_receipts WHERE sequence=?",
            event.sequence,
          )
          .toArray()[0];
        return receipt?.digest === envelope.digest
          ? Response.json({ sequence: received.sequence, duplicate: true })
          : fail("resource-replay-mismatch");
      }
      if (event.after !== (received?.sequence ?? 0))
        return fail("resource-cursor-mismatch");
      if (bookmark) this.seedBookmark(bookmark.userId, bookmark.entryId);
      const prior = this.row(row.key);
      if (
        board &&
        ((prior && prior.origin !== peer) ||
          (!prior &&
            this.sql
              .exec("SELECT 1 FROM boards WHERE id=?", row.key.slice(6))
              .toArray().length))
      )
        return fail("activity-id-collision");
      if (board && prior && row.generation < prior.generation)
        return fail("activity-regression");
      if (
        prior &&
        prior.generation === row.generation &&
        prior.origin === row.origin &&
        prior.value !== row.value
      )
        return fail("activity-generation-mismatch");
      for (const id of accounts.deleted) {
        retireAccount(this.sql, id);
        this.retire(id);
      }
      if (
        !prior ||
        row.generation > prior.generation ||
        (row.generation === prior.generation && row.origin > prior.origin)
      ) {
        this.sql.exec(
          "UPDATE regional_activity_meta SET importing=1 WHERE id=1",
        );
        this.sql.exec(
          "INSERT INTO regional_activity_records VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET origin=excluded.origin,generation=excluded.generation,value=excluded.value",
          row.key,
          row.kind,
          row.origin,
          row.generation,
          row.value,
        );
        if (board) this.boards.materialize(row.key.slice(6), board);
        else if (bookmark) {
          this.sql.exec(
            "DELETE FROM entry_bookmarks WHERE user_id=? AND entry_id=?",
            bookmark.userId,
            bookmark.entryId,
          );
          if (bookmark.saved && !retiredAccount(this.sql, bookmark.userId))
            this.sql.exec(
              "INSERT INTO entry_bookmarks VALUES(?,?,?)",
              bookmark.userId,
              bookmark.entryId,
              bookmark.at,
            );
        }
        this.sql.exec(
          "UPDATE regional_activity_meta SET importing=0 WHERE id=1",
        );
      }
      this.sql.exec(
        "INSERT INTO regional_activity_peer VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,sequence=excluded.sequence",
        event.epoch,
        event.sequence,
      );
      this.sql.exec(
        "INSERT INTO regional_activity_receipts VALUES(?,?)",
        event.sequence,
        envelope.digest,
      );
      return Response.json({ sequence: event.sequence });
    });
  }
  bookmarks(userId: string): Response {
    this.seed();
    const versions: Record<string, string> = {};
    for (const row of this.sql
      .exec<RecordRow>(
        "SELECT * FROM regional_activity_records WHERE kind='bookmark' AND json_extract(value,'$.userId')=?",
        userId,
      )
      .toArray())
      versions[(JSON.parse(row.value) as Bookmark).entryId] = versionOf(row)!;
    const ids = this.sql
      .exec<{ entry_id: string }>(
        "SELECT entry_id FROM entry_bookmarks WHERE user_id=? ORDER BY created_at DESC",
        userId,
      )
      .toArray()
      .map((r) => r.entry_id);
    // Legacy rows beyond the bounded background seed have the deterministic
    // initial version; the mutation seeds that exact row before comparing it.
    for (const id of ids) versions[id] ??= `1:${this.region}`;
    return Response.json({ ids, versions });
  }
  bookmark(body: Record<string, unknown>): Response {
    const userId = String(body.userId),
      entryId = String(body.id),
      key = JSON.stringify([userId, entryId]);
    if (retiredAccount(this.sql, userId)) return fail("account-deleted", 403);
    if (body.saved !== undefined && typeof body.saved !== "boolean")
      return fail("invalid-command", 400);
    this.seed();
    return this.state.storage.transactionSync(() => {
      this.seedBookmark(userId, entryId);
      const row = this.row(key),
        value = row ? (JSON.parse(row.value) as Bookmark) : null;
      const intended =
        typeof body.saved === "boolean" ? body.saved : !value?.saved;
      const expected =
        body.expectedVersion === undefined
          ? versionOf(row)
          : body.expectedVersion;
      const commandId =
        typeof body.commandId === "string"
          ? body.commandId
          : crypto.randomUUID();
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(commandId) ||
        !(expected === null || typeof expected === "string")
      )
        return fail("invalid-command", 400);
      const binding = sha256Hex(
        JSON.stringify({ key, saved: intended, expected }),
      );
      const previous = this.sql
        .exec<{ binding: string; version: string | null }>(
          "SELECT binding,version FROM regional_activity_commands WHERE user_id=? AND command_id=?",
          userId,
          commandId,
        )
        .toArray()[0];
      if (previous) {
        if (previous.binding !== binding) return fail("command-reused");
        return previous.version === versionOf(row)
          ? Response.json({
              saved: value?.saved ?? false,
              version: versionOf(row),
            })
          : fail("action-superseded");
      }
      if (expected !== versionOf(row)) return fail("bookmark-changed");
      if (
        !this.sql
          .exec(
            "SELECT 1 FROM gallery_entries WHERE id=? AND status='public'",
            entryId,
          )
          .toArray().length
      )
        return fail("not-found", 404);
      if (
        this.sql
          .exec<{ n: number }>(
            "SELECT COUNT(*) AS n FROM regional_activity_commands WHERE user_id=?",
            userId,
          )
          .toArray()[0]!.n >= 10000
      )
        return fail("command-receipts-full", 503);
      if (intended !== Boolean(value?.saved)) {
        if (intended)
          this.sql.exec(
            "INSERT INTO entry_bookmarks VALUES(?,?,?)",
            userId,
            entryId,
            new Date().toISOString(),
          );
        else
          this.sql.exec(
            "DELETE FROM entry_bookmarks WHERE user_id=? AND entry_id=?",
            userId,
            entryId,
          );
      }
      const current = this.row(key);
      this.sql.exec(
        "INSERT INTO regional_activity_commands VALUES(?,?,?,?)",
        userId,
        commandId,
        binding,
        versionOf(current),
      );
      return Response.json({ saved: intended, version: versionOf(current) });
    });
  }
}
