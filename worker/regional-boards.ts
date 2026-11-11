import type { ReplicaState, ResourceRegion } from "./resource-replica";
import type { SqlStorage } from "./gallery-store";
import {
  boardRead,
  boardCreate,
  boardChange,
  forgetBoardAccount,
} from "./gallery-store-boards";
import type { SessionUser } from "./auth";
import { retiredAccount } from "./retired-accounts";

type Row = Record<string, string | number | null>;
const TABLES = {
  boards: [
    "id",
    "title",
    "slots",
    "created_by",
    "created_by_name",
    "created_at",
    "locked_at",
    "revision",
  ],
  board_items: [
    "id",
    "board_id",
    "position",
    "entry_id",
    "note",
    "added_by",
    "added_by_name",
    "added_at",
    "type",
  ],
  board_events: [
    "seq",
    "board_id",
    "at",
    "actor_id",
    "actor_name",
    "action",
    "item_id",
    "entry_id",
    "previous_entry_id",
    "detail",
  ],
} as const;
export type BoardSnapshot = {
  boards: Row[];
  board_items: Row[];
  board_events: Row[];
};
type Snapshot = BoardSnapshot;
const failure = (error: string, status = 409) =>
  Response.json({ error }, { status });
class ActivityLimit extends Error {}

/** Board writes remain at their creator region; readers keep a full local copy. */
export class RegionalBoards {
  private readonly sql: SqlStorage;
  constructor(
    private readonly state: ReplicaState,
    private readonly region: ResourceRegion,
  ) {
    this.sql = state.storage.sql as SqlStorage;
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(board_events)")
        .toArray()
        .some((r) => r.name === "source_seq")
    )
      this.sql.exec("ALTER TABLE board_events ADD COLUMN source_seq INTEGER");
    for (const [table, columns] of Object.entries(TABLES))
      for (const [event, ref] of [
        ["INSERT", "NEW"],
        ["UPDATE", "NEW"],
        ["DELETE", "OLD"],
      ] as const) {
        const id = `${ref}.${table === "boards" ? "id" : "board_id"}`;
        const changed =
          event === "UPDATE"
            ? ` AND NOT (${columns.map((c) => `OLD.${c} IS NEW.${c}`).join(" AND ")})`
            : "";
        const key = `'board:' || ${id}`;
        this.sql
          .exec(`CREATE TRIGGER IF NOT EXISTS regional_board_guard_${table}_${event} BEFORE ${event} ON ${table}
        WHEN (SELECT importing FROM regional_activity_meta WHERE id=1)=0${changed}
        BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM regional_activity_records WHERE key=${key} AND origin<>(SELECT region FROM regional_activity_meta WHERE id=1))
        THEN RAISE(ABORT,'RESOURCE_SOURCE_READ_ONLY') END; END`);
        this.sql
          .exec(`CREATE TRIGGER IF NOT EXISTS regional_board_change_${table}_${event} AFTER ${event} ON ${table}
        WHEN (SELECT importing FROM regional_activity_meta WHERE id=1)=0${changed}
        BEGIN
          UPDATE regional_activity_meta SET sequence=sequence+1 WHERE id=1;
          INSERT INTO regional_activity_records VALUES(${key},'board',(SELECT region FROM regional_activity_meta WHERE id=1),1,'{}')
          ON CONFLICT(key) DO UPDATE SET generation=generation+1;
          INSERT INTO regional_activity_changes SELECT key,(SELECT sequence FROM regional_activity_meta WHERE id=1),
            json_object('key',key,'kind',kind,'origin',origin,'generation',generation,'value',value)
            FROM regional_activity_records WHERE key=${key}
          ON CONFLICT(key) DO UPDATE SET sequence=excluded.sequence,record=excluded.record;
        END`);
      }
  }
  snapshot(id: string): Snapshot {
    return {
      boards: this.sql
        .exec<Row>(
          `SELECT ${TABLES.boards.join(",")} FROM boards WHERE id=?`,
          id,
        )
        .toArray(),
      board_items: this.sql
        .exec<Row>(
          `SELECT ${TABLES.board_items.join(",")} FROM board_items WHERE board_id=? ORDER BY position,id`,
          id,
        )
        .toArray(),
      board_events: this.sql
        .exec<Row>(
          `SELECT COALESCE(source_seq,seq) AS seq,${TABLES.board_events.slice(1).join(",")} FROM board_events WHERE board_id=? ORDER BY COALESCE(source_seq,seq)`,
          id,
        )
        .toArray(),
    };
  }
  valid(id: string, value: unknown): value is Snapshot {
    if (!/^[a-zA-Z0-9]{24}$/.test(id) || !value || typeof value !== "object")
      return false;
    const input = value as Snapshot;
    if (Object.keys(input).sort().join() !== Object.keys(TABLES).sort().join())
      return false;
    for (const [table, columns] of Object.entries(TABLES)) {
      const rows = input[table as keyof Snapshot];
      if (
        !Array.isArray(rows) ||
        rows.length >
          (table === "boards" ? 1 : table === "board_items" ? 500 : 100000)
      )
        return false;
      const ids = new Set();
      for (const row of rows) {
        if (
          !row ||
          Object.keys(row).sort().join() !== [...columns].sort().join() ||
          Object.values(row).some(
            (v) =>
              v !== null &&
              typeof v !== "string" &&
              !(typeof v === "number" && Number.isSafeInteger(v)),
          )
        )
          return false;
        if (
          row[table === "boards" ? "id" : "board_id"] !== id ||
          ids.has(row[table === "board_events" ? "seq" : "id"])
        )
          return false;
        ids.add(row[table === "board_events" ? "seq" : "id"]);
        if (
          table === "board_events" &&
          !(typeof row.seq === "number" && row.seq > 0)
        )
          return false;
      }
    }
    return (
      input.boards.length === 1 ||
      (!input.board_items.length && !input.board_events.length)
    );
  }
  accountIds(snapshot: Snapshot) {
    return [
      ...new Set(
        [
          ...snapshot.boards.map((r) => String(r.created_by)),
          ...snapshot.board_items.map((r) => String(r.added_by)),
          ...snapshot.board_events.map((r) => String(r.actor_id)),
        ].filter(Boolean),
      ),
    ];
  }
  materialize(id: string, snapshot: Snapshot) {
    // Received events retain their original sequence at the API without colliding
    // with unrelated Boards' local AUTOINCREMENT event identities.
    for (const table of ["board_items", "board_events", "boards"] as const)
      this.sql.exec(
        `DELETE FROM ${table} WHERE ${table === "boards" ? "id" : "board_id"}=?`,
        id,
      );
    for (const [table, columns] of Object.entries(TABLES))
      for (const incoming of snapshot[table as keyof Snapshot]) {
        const row = { ...incoming };
        const actor =
          table === "boards"
            ? "created_by"
            : table === "board_items"
              ? "added_by"
              : "actor_id";
        if (retiredAccount(this.sql, row[actor])) {
          row[actor] = "";
          row[
            table === "boards"
              ? "created_by_name"
              : table === "board_items"
                ? "added_by_name"
                : "actor_name"
          ] = "(deleted account)";
        }
        const names = columns.map((c) =>
          table === "board_events" && c === "seq" ? "source_seq" : c,
        );
        this.sql.exec(
          `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
          ...columns.map((c) => row[c]),
        );
      }
  }
  origin(id: string) {
    const row = this.sql
      .exec<{ origin: ResourceRegion }>(
        "SELECT origin FROM regional_activity_records WHERE key=?",
        "board:" + id,
      )
      .toArray()[0];
    return row?.origin ?? null;
  }
  referencesPresent(ids: unknown): Response {
    if (
      !Array.isArray(ids) ||
      ids.length > 500 ||
      ids.some((id) => typeof id !== "string")
    )
      return failure("invalid-entries", 400);
    return Response.json({
      present: ids.every(
        (id) =>
          this.sql
            .exec(
              "SELECT 1 FROM gallery_entries WHERE id=? AND status='public'",
              id,
            )
            .toArray().length > 0,
      ),
    });
  }
  command(body: Record<string, unknown>): Response {
    const id = String(body.id),
      user = body.user as SessionUser | undefined;
    if (!user || retiredAccount(this.sql, user.id))
      return failure("account-deleted", 403);
    if (body.operation === "create" && !user.isAdmin)
      return failure("admin-only", 403);
    if (body.operation !== "create" && this.origin(id) !== this.region)
      return failure("wrong-writer");
    try {
      return this.state.storage.transactionSync(() => {
        const previous = this.sql
          .exec<{ binding: string; version: string | null }>(
            "SELECT binding,version FROM regional_activity_commands WHERE user_id=? AND command_id=?",
            user.id,
            String(body.commandId),
          )
          .toArray()[0];
        const revision = () =>
          this.sql
            .exec<{ revision: number }>(
              "SELECT revision FROM boards WHERE id=?",
              id,
            )
            .toArray()[0]?.revision ?? null;
        if (previous) {
          if (previous.binding !== body.binding)
            return failure("command-reused");
          return previous.version === String(revision())
            ? boardRead(this.sql, id)
            : failure("action-superseded");
        }
        if (body.operation === "create" && revision() !== null)
          return failure("board-id-collision");
        if (
          body.operation !== "create" &&
          body.expectedRevision !== undefined &&
          body.expectedRevision !== revision()
        )
          return failure("board-changed");
        if (
          this.sql
            .exec<{ n: number }>(
              "SELECT COUNT(*) AS n FROM regional_activity_commands WHERE user_id=?",
              user.id,
            )
            .toArray()[0]!.n >= 10000
        )
          return failure("command-receipts-full", 503);
        const input = {
          ...(body.input as Record<string, unknown>),
          id,
          actor: { id: user.id, name: user.displayName, admin: user.isAdmin },
        };
        const result =
          body.operation === "create"
            ? boardCreate(
                {
                  storage: {
                    sql: this.sql,
                    transactionSync: this.state.storage.transactionSync.bind(
                      this.state.storage,
                    ),
                  },
                },
                input,
              )
            : boardChange(
                {
                  storage: {
                    sql: this.sql,
                    transactionSync: this.state.storage.transactionSync.bind(
                      this.state.storage,
                    ),
                  },
                },
                input,
              );
        if (result.ok) {
          const snapshot = this.snapshot(id);
          // Reserve room for the envelope and its escaped JSON value. Never
          // acknowledge a mutation that the bounded replication path cannot carry.
          if (
            !this.valid(id, snapshot) ||
            new TextEncoder().encode(JSON.stringify(JSON.stringify(snapshot)))
              .length >
              23 * 1024 * 1024
          )
            throw new ActivityLimit();
          this.sql.exec(
            "INSERT INTO regional_activity_commands VALUES(?,?,?,?)",
            user.id,
            String(body.commandId),
            String(body.binding),
            String(revision()),
          );
        }
        return result;
      });
    } catch (error) {
      if (error instanceof ActivityLimit)
        return failure("activity-too-large", 413);
      throw error;
    }
  }
  retire(userId: string, touch: (id: string) => void) {
    this.state.storage.transactionSync(() => {
      const ids = this.sql
        .exec<{ id: string }>(
          `SELECT id FROM boards WHERE created_by=? UNION SELECT board_id AS id FROM board_items WHERE added_by=? UNION SELECT board_id AS id FROM board_events WHERE actor_id=?`,
          userId,
          userId,
          userId,
        )
        .toArray()
        .map((r) => r.id);
      this.sql.exec("UPDATE regional_activity_meta SET importing=1 WHERE id=1");
      forgetBoardAccount(this.sql, userId);
      this.sql.exec("UPDATE regional_activity_meta SET importing=0 WHERE id=1");
      for (const id of ids) if (this.origin(id) === this.region) touch(id);
    });
  }
}
