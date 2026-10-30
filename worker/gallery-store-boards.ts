// Selection boards (docs/specs/selection-boards.md): an ordered list of Gallery
// entries, kept in the Gallery's own store so one query reads each entry's name,
// author and preview revision beside the board's own facts. Every change is kept
// as an event: who, when, what. A board's id is its unguessable link; who may read
// or change one is decided by worker/boards.ts, never here.

import { type SqlStorage } from "./gallery-store";
import { preview } from "./gallery-store-entries";

export const BOARD_TITLE_MAX = 120;
export const BOARD_NOTE_MAX = 500;
export const BOARD_SLOTS_MAX = 500;
/** How many of a board's latest events a read returns. */
const BOARD_EVENTS_READ = 300;

export function installBoards(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slots INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      locked_at TEXT,
      revision INTEGER NOT NULL DEFAULT 0
    )`);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS board_items (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      entry_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      added_by TEXT NOT NULL,
      added_by_name TEXT NOT NULL,
      added_at TEXT NOT NULL,
      UNIQUE (board_id, entry_id)
    )`);
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_id, position)",
  );
  sql.exec(`
    CREATE TABLE IF NOT EXISTS board_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id TEXT NOT NULL,
      at TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      item_id TEXT,
      entry_id TEXT,
      previous_entry_id TEXT,
      detail TEXT NOT NULL DEFAULT ''
    )`);
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_board_events_board ON board_events(board_id, seq)",
  );
}

export interface BoardActor {
  id: string;
  name: string;
  admin: boolean;
}

export type BoardChange =
  | { kind: "add"; entryId: string; note?: string }
  | { kind: "replace"; itemId: string; entryId: string; note?: string }
  | { kind: "remove"; itemId: string }
  | { kind: "note"; itemId: string; note: string }
  | { kind: "move"; itemId: string; to: number }
  | { kind: "rename"; title: string }
  | { kind: "slots"; slots: number }
  | { kind: "lock" }
  | { kind: "unlock" };

interface BoardRow {
  id: string;
  title: string;
  slots: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  locked_at: string | null;
  revision: number;
}

interface ItemRow {
  id: string;
  position: number;
  entry_id: string;
  note: string;
  added_by_name: string;
  added_at: string;
  name: string | null;
  author: string | null;
  status: string | null;
  component_count: number | null;
  preview_revision: string | null;
  ai_generated: number | null;
}

interface EventRow {
  seq: number;
  at: string;
  actor_name: string;
  action: string;
  item_id: string | null;
  entry_id: string | null;
  previous_entry_id: string | null;
  detail: string;
}

class BoardError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    /** The entry the change named, when it is the entry that failed. */
    readonly entryId?: string,
  ) {
    super(code);
  }
}

const now = () => new Date().toISOString();
const itemId = () => `item-${crypto.randomUUID()}`;

function boardRow(sql: SqlStorage, id: string): BoardRow {
  const row = sql
    .exec<BoardRow>("SELECT * FROM boards WHERE id = ?", id)
    .toArray()[0];
  if (!row) throw new BoardError("board-not-found", 404);
  return row;
}

/** An entry a board may hold: one on the public wall. */
function publicEntry(sql: SqlStorage, entryId: string): void {
  const row = sql
    .exec<{
      status: string;
    }>("SELECT status FROM gallery_entries WHERE id = ?", entryId)
    .toArray()[0];
  if (!row || row.status !== "public")
    throw new BoardError("entry-not-public", 404, entryId);
}

function itemRow(sql: SqlStorage, boardId: string, id: string) {
  const row = sql
    .exec<{
      id: string;
      entry_id: string;
      note: string;
      position: number;
    }>(
      "SELECT id, entry_id, note, position FROM board_items WHERE board_id = ? AND id = ?",
      boardId,
      id,
    )
    .toArray()[0];
  if (!row) throw new BoardError("item-not-found", 404);
  return row;
}

function onBoard(sql: SqlStorage, boardId: string, entryId: string): boolean {
  return (
    sql
      .exec(
        "SELECT 1 FROM board_items WHERE board_id = ? AND entry_id = ?",
        boardId,
        entryId,
      )
      .toArray().length > 0
  );
}

function itemCount(sql: SqlStorage, boardId: string): number {
  return sql
    .exec<{
      count: number;
    }>("SELECT COUNT(*) AS count FROM board_items WHERE board_id = ?", boardId)
    .one().count;
}

/** Positions 0..n-1 in the current order, after an insert, a removal or a move. */
function renumber(sql: SqlStorage, boardId: string, order: string[]): void {
  order.forEach((id, position) =>
    sql.exec(
      "UPDATE board_items SET position = ? WHERE board_id = ? AND id = ?",
      position,
      boardId,
      id,
    ),
  );
}

function orderOf(sql: SqlStorage, boardId: string): string[] {
  return sql
    .exec<{
      id: string;
    }>(
      "SELECT id FROM board_items WHERE board_id = ? ORDER BY position, added_at, id",
      boardId,
    )
    .toArray()
    .map((row) => row.id);
}

function record(
  sql: SqlStorage,
  boardId: string,
  actor: BoardActor,
  action: string,
  fields: {
    itemId?: string | null;
    entryId?: string | null;
    previousEntryId?: string | null;
    detail?: string;
  } = {},
): void {
  sql.exec(
    `INSERT INTO board_events
       (board_id, at, actor_id, actor_name, action, item_id, entry_id,
        previous_entry_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    boardId,
    now(),
    actor.id,
    actor.name,
    action,
    fields.itemId ?? null,
    fields.entryId ?? null,
    fields.previousEntryId ?? null,
    fields.detail ?? "",
  );
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function addItem(
  sql: SqlStorage,
  board: BoardRow,
  actor: BoardActor,
  entryId: string,
  note: string,
): string {
  publicEntry(sql, entryId);
  if (onBoard(sql, board.id, entryId))
    throw new BoardError("entry-already-on-board", 409, entryId);
  if (itemCount(sql, board.id) >= board.slots)
    throw new BoardError("board-full", 409);
  const id = itemId();
  sql.exec(
    `INSERT INTO board_items
       (id, board_id, position, entry_id, note, added_by, added_by_name, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    board.id,
    itemCount(sql, board.id),
    entryId,
    note,
    actor.id,
    actor.name,
    now(),
  );
  record(sql, board.id, actor, "add", { itemId: id, entryId, detail: note });
  return id;
}

function apply(
  sql: SqlStorage,
  board: BoardRow,
  actor: BoardActor,
  change: BoardChange,
): void {
  if (board.locked_at && change.kind !== "unlock")
    throw new BoardError("board-locked", 409);
  switch (change.kind) {
    case "add":
      addItem(
        sql,
        board,
        actor,
        text(change.entryId, 200),
        text(change.note, BOARD_NOTE_MAX),
      );
      return;
    case "replace": {
      const item = itemRow(sql, board.id, change.itemId);
      const entryId = text(change.entryId, 200);
      if (entryId === item.entry_id) return;
      publicEntry(sql, entryId);
      if (onBoard(sql, board.id, entryId))
        throw new BoardError("entry-already-on-board", 409, entryId);
      const note =
        change.note === undefined
          ? item.note
          : text(change.note, BOARD_NOTE_MAX);
      sql.exec(
        `UPDATE board_items
           SET entry_id = ?, note = ?, added_by = ?, added_by_name = ?, added_at = ?
         WHERE id = ?`,
        entryId,
        note,
        actor.id,
        actor.name,
        now(),
        item.id,
      );
      record(sql, board.id, actor, "replace", {
        itemId: item.id,
        entryId,
        previousEntryId: item.entry_id,
        detail: note,
      });
      return;
    }
    case "remove": {
      const item = itemRow(sql, board.id, change.itemId);
      sql.exec("DELETE FROM board_items WHERE id = ?", item.id);
      renumber(sql, board.id, orderOf(sql, board.id));
      record(sql, board.id, actor, "remove", {
        itemId: item.id,
        previousEntryId: item.entry_id,
      });
      return;
    }
    case "note": {
      const item = itemRow(sql, board.id, change.itemId);
      const note = text(change.note, BOARD_NOTE_MAX);
      if (note === item.note) return;
      sql.exec("UPDATE board_items SET note = ? WHERE id = ?", note, item.id);
      record(sql, board.id, actor, "note", {
        itemId: item.id,
        entryId: item.entry_id,
        detail: note,
      });
      return;
    }
    case "move": {
      const item = itemRow(sql, board.id, change.itemId);
      if (!Number.isFinite(change.to))
        throw new BoardError("bad-position", 400);
      const order = orderOf(sql, board.id).filter((id) => id !== item.id);
      const to = Math.max(0, Math.min(order.length, Math.trunc(change.to)));
      order.splice(to, 0, item.id);
      renumber(sql, board.id, order);
      record(sql, board.id, actor, "move", {
        itemId: item.id,
        entryId: item.entry_id,
        detail: `${item.position + 1}→${to + 1}`,
      });
      return;
    }
    case "rename": {
      const title = text(change.title, BOARD_TITLE_MAX);
      if (!title) throw new BoardError("missing-title", 400);
      sql.exec("UPDATE boards SET title = ? WHERE id = ?", title, board.id);
      record(sql, board.id, actor, "rename", { detail: title });
      return;
    }
    case "slots": {
      const slots = Math.trunc(change.slots);
      if (!(slots >= 1 && slots <= BOARD_SLOTS_MAX))
        throw new BoardError("bad-slots", 400);
      if (slots < itemCount(sql, board.id))
        throw new BoardError("slots-below-items", 409);
      sql.exec("UPDATE boards SET slots = ? WHERE id = ?", slots, board.id);
      record(sql, board.id, actor, "slots", { detail: String(slots) });
      return;
    }
    case "lock":
      sql.exec("UPDATE boards SET locked_at = ? WHERE id = ?", now(), board.id);
      record(sql, board.id, actor, "lock");
      return;
    case "unlock":
      if (!board.locked_at) return;
      if (!actor.admin && actor.id !== board.created_by)
        throw new BoardError("not-allowed", 403);
      sql.exec("UPDATE boards SET locked_at = NULL WHERE id = ?", board.id);
      record(sql, board.id, actor, "unlock");
      return;
    default:
      throw new BoardError("bad-change", 400);
  }
}

function failure(error: unknown): Response {
  if (error instanceof BoardError)
    return Response.json(
      {
        error: error.code,
        ...(error.entryId ? { entryId: error.entryId } : {}),
      },
      { status: error.status },
    );
  throw error;
}

/** A board as its page shows it: its facts, its items in order, its latest events. */
export function boardRead(sql: SqlStorage, id: string): Response {
  try {
    const board = boardRow(sql, id);
    const items = sql
      .exec<ItemRow>(
        `SELECT i.id, i.position, i.entry_id, i.note, i.added_by_name, i.added_at,
                e.name, e.author, e.status, e.component_count,
                e.preview_revision, e.ai_generated
         FROM board_items i LEFT JOIN gallery_entries e ON e.id = i.entry_id
         WHERE i.board_id = ? ORDER BY i.position, i.added_at, i.id`,
        id,
      )
      .toArray()
      .map((row) => {
        const visible = row.status === "public";
        return {
          id: row.id,
          position: row.position,
          entryId: row.entry_id,
          note: row.note,
          addedBy: row.added_by_name,
          addedAt: row.added_at,
          entry: visible
            ? {
                name: row.name,
                author: row.author,
                components: row.component_count,
                previewRevision: row.preview_revision || "legacy",
                ai: row.ai_generated === 1,
              }
            : null,
        };
      });
    const events = sql
      .exec<EventRow>(
        `SELECT seq, at, actor_name, action, item_id, entry_id, previous_entry_id, detail
         FROM board_events WHERE board_id = ? ORDER BY seq DESC LIMIT ?`,
        id,
        BOARD_EVENTS_READ,
      )
      .toArray()
      .map((row) => ({
        seq: row.seq,
        at: row.at,
        actor: row.actor_name,
        action: row.action,
        itemId: row.item_id,
        entryId: row.entry_id,
        previousEntryId: row.previous_entry_id,
        detail: row.detail,
      }));
    const names = new Map<string, string>();
    for (const { entry_id: entryId, name } of sql
      .exec<{ entry_id: string; name: string }>(
        `SELECT DISTINCT ev.entry_id, e.name FROM (
           SELECT entry_id FROM board_events WHERE board_id = ?
           UNION SELECT previous_entry_id FROM board_events WHERE board_id = ?
         ) ev JOIN gallery_entries e ON e.id = ev.entry_id WHERE e.status = 'public'`,
        id,
        id,
      )
      .toArray())
      names.set(entryId, name);
    return Response.json({
      board: {
        id: board.id,
        title: board.title,
        slots: board.slots,
        createdBy: board.created_by_name,
        createdById: board.created_by,
        createdAt: board.created_at,
        lockedAt: board.locked_at,
        revision: board.revision,
      },
      items,
      events,
      entryNames: Object.fromEntries(names),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Make a board, with any entries it starts with, in one transaction. */
export function boardCreate(
  state: { storage: { sql: SqlStorage; transactionSync<T>(fn: () => T): T } },
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const actor = body.actor as BoardActor;
  const id = text(body.id, 64);
  const title = text(body.title, BOARD_TITLE_MAX);
  const slots = Math.trunc(Number(body.slots));
  if (!id || !title)
    return Response.json({ error: "missing-title" }, { status: 400 });
  if (!(slots >= 1 && slots <= BOARD_SLOTS_MAX))
    return Response.json({ error: "bad-slots" }, { status: 400 });
  const entries = Array.isArray(body.entries)
    ? body.entries.map((entry) => text(entry, 200)).filter(Boolean)
    : [];
  try {
    state.storage.transactionSync(() => {
      sql.exec(
        `INSERT INTO boards (id, title, slots, created_by, created_by_name, created_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        id,
        title,
        slots,
        actor.id,
        actor.name,
        now(),
      );
      record(sql, id, actor, "create", { detail: title });
      const board = boardRow(sql, id);
      for (const entryId of entries) addItem(sql, board, actor, entryId, "");
    });
  } catch (error) {
    return failure(error);
  }
  return boardRead(sql, id);
}

/** Apply a list of changes in order, all or none, as one revision. */
export function boardChange(
  state: { storage: { sql: SqlStorage; transactionSync<T>(fn: () => T): T } },
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const id = text(body.id, 64);
  const actor = body.actor as BoardActor;
  const changes = Array.isArray(body.changes)
    ? (body.changes as BoardChange[])
    : [];
  if (!changes.length)
    return Response.json({ error: "no-changes" }, { status: 400 });
  try {
    state.storage.transactionSync(() => {
      for (const change of changes)
        apply(sql, boardRow(sql, id), actor, change);
      sql.exec("UPDATE boards SET revision = revision + 1 WHERE id = ?", id);
    });
  } catch (error) {
    return failure(error);
  }
  return boardRead(sql, id);
}

/** An entry's preview, only while it is on the board and public. */
export function boardPreview(
  sql: SqlStorage,
  boardId: string,
  entryId: string,
): Response {
  if (!onBoard(sql, boardId, entryId))
    return Response.json({ error: "not-found" }, { status: 404 });
  return preview(sql, entryId);
}

/** A deleted account's name leaves every board it touched. */
export function forgetBoardAccount(sql: SqlStorage, userId: string): void {
  const gone = "(deleted account)";
  sql.exec(
    "UPDATE board_items SET added_by = '', added_by_name = ? WHERE added_by = ?",
    gone,
    userId,
  );
  sql.exec(
    "UPDATE board_events SET actor_id = '', actor_name = ? WHERE actor_id = ?",
    gone,
    userId,
  );
  sql.exec(
    "UPDATE boards SET created_by = '', created_by_name = ? WHERE created_by = ?",
    gone,
    userId,
  );
}
