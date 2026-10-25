// Accounts blocked from the Gallery for collecting it in bulk: who, from
// where, when, and which trap circuit gave them away. A program is blocked
// at its first trap; a browser only once it has read the circuits of two
// different traps within a day, since a page left open across a deploy can
// show one (2026-10-22). A block holds by the account and by its email, so a
// new account on the same address stays blocked. Records outlive the
// account and an unblock: they are the Owner's evidence. The Owner and the
// member are both emailed
// (docs/specs/community-gallery.md#crawlers-ai-and-floods).

import type { SqlStorage } from "./gallery-store";

const ACCOUNT_BLOCKS_TABLE = `
  CREATE TABLE IF NOT EXISTS account_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    email TEXT,
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    blocked_at TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    path TEXT NOT NULL,
    ip TEXT,
    country TEXT,
    user_agent TEXT,
    notified_at TEXT,
    unblocked_at TEXT
  )
`;

/** Traps whose circuit a browser read, per account, for the day's count. */
const TRAP_READS_TABLE = `
  CREATE TABLE IF NOT EXISTS trap_reads (
    user_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (user_id, entry_id)
  ) WITHOUT ROWID
`;

/** How many different traps a browser reads within a day before a block. */
export const BROWSER_TRAP_READS = 2;
const TRAP_READ_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Why an account was blocked. */
export type BlockReason = "script" | "two-traps";

export function ensureAccountBlockTables(sql: SqlStorage): void {
  sql.exec(ACCOUNT_BLOCKS_TABLE);
  sql.exec(TRAP_READS_TABLE);
  // Additive upgrades: blocks recorded before reasons, apologies and member
  // notices existed. `member_notice` is "due" until the member is emailed,
  // then the time; NULL for blocks from before 2026-10-25, never emailed.
  for (const column of ["reason", "apologized_at", "member_notice"]) {
    try {
      sql.exec(`ALTER TABLE account_blocks ADD COLUMN ${column} TEXT`);
    } catch {
      // Column already present.
    }
  }
}

/**
 * The block a lifted mistake left, if the account has not yet been told:
 * its latest record, once unblocked and not yet apologised for.
 */
export function apologyOwed(
  sql: SqlStorage,
  userId: string,
): { id: number; email: string } | null {
  const row = sql
    .exec<{
      id: number;
      email: string | null;
      unblocked_at: string | null;
      apologized_at: string | null;
    }>(
      `SELECT id, email, unblocked_at, apologized_at FROM account_blocks
       WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      userId,
    )
    .toArray()[0];
  return row?.email && row.unblocked_at && !row.apologized_at
    ? { id: row.id, email: row.email }
    : null;
}

export function markApologized(sql: SqlStorage, id: number, at: string): void {
  sql.exec("UPDATE account_blocks SET apologized_at = ? WHERE id = ?", at, id);
}

/**
 * Notes that a browser read a trap's circuit and returns how many different
 * traps the account has read within the day.
 */
export function noteTrapRead(
  sql: SqlStorage,
  userId: string,
  entryId: string,
  at: Date,
): number {
  const since = new Date(at.getTime() - TRAP_READ_WINDOW_MS).toISOString();
  sql.exec("DELETE FROM trap_reads WHERE read_at < ?", since);
  sql.exec(
    `INSERT INTO trap_reads(user_id, entry_id, read_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id, entry_id) DO UPDATE SET read_at = excluded.read_at`,
    userId,
    entryId.slice(0, 64),
    at.toISOString(),
  );
  return sql
    .exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM trap_reads WHERE user_id = ?",
      userId,
    )
    .one().count;
}

export interface AccountBlockRow {
  id: number;
  user_id: string;
  email: string | null;
  display_name: string;
  provider: string;
  blocked_at: string;
  entry_id: string;
  path: string;
  ip: string | null;
  country: string | null;
  user_agent: string | null;
  notified_at: string | null;
  unblocked_at: string | null;
  reason: BlockReason | null;
  apologized_at: string | null;
  member_notice: string | null;
}

export interface BlockEvidence {
  entryId: string;
  path: string;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
}

export interface BlockedAccount {
  id: string;
  email: string | null;
  displayName: string;
  provider: string;
}

/** Whether an active block names this account or its email. */
export function isBlocked(
  sql: SqlStorage,
  userId: string,
  email: string | null,
): boolean {
  return (
    sql
      .exec(
        `SELECT 1 FROM account_blocks
         WHERE unblocked_at IS NULL
           AND (user_id = ? OR (? IS NOT NULL AND LOWER(email) = LOWER(?)))
         LIMIT 1`,
        userId,
        email,
        email,
      )
      .toArray().length > 0
  );
}

/** Records a block, unless one is already active for the account. */
export function recordBlock(
  sql: SqlStorage,
  account: BlockedAccount,
  evidence: BlockEvidence,
  reason: BlockReason,
  at: string,
): boolean {
  if (isBlocked(sql, account.id, account.email)) return false;
  sql.exec(
    `INSERT INTO account_blocks(user_id, email, display_name, provider,
       blocked_at, entry_id, path, ip, country, user_agent, reason,
       member_notice)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    account.id,
    account.email,
    account.displayName,
    account.provider,
    at,
    evidence.entryId.slice(0, 64),
    evidence.path.slice(0, 512),
    evidence.ip?.slice(0, 64) ?? null,
    evidence.country?.slice(0, 8) ?? null,
    evidence.userAgent?.slice(0, 512) ?? null,
    reason,
    account.email ? "due" : null,
  );
  return true;
}

export function unsentNotices(sql: SqlStorage): AccountBlockRow[] {
  return sql
    .exec<AccountBlockRow>(
      "SELECT * FROM account_blocks WHERE notified_at IS NULL ORDER BY id",
    )
    .toArray();
}

export function markNotified(sql: SqlStorage, id: number, at: string): void {
  sql.exec("UPDATE account_blocks SET notified_at = ? WHERE id = ?", at, id);
}

/** Active blocks whose member has not yet been emailed. */
export function unsentMemberNotices(sql: SqlStorage): AccountBlockRow[] {
  return sql
    .exec<AccountBlockRow>(
      `SELECT * FROM account_blocks
       WHERE member_notice = 'due' AND email IS NOT NULL
         AND unblocked_at IS NULL
       ORDER BY id`,
    )
    .toArray();
}

/**
 * Marks the account's active block, recorded before member notices and
 * never told, as due for its member's email; false when there is none.
 */
export function memberNoticeRequested(
  sql: SqlStorage,
  userId: string,
): boolean {
  const row = sql
    .exec<{ id: number }>(
      `SELECT id FROM account_blocks
       WHERE user_id = ? AND unblocked_at IS NULL AND member_notice IS NULL
         AND email IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      userId,
    )
    .toArray()[0];
  if (!row) return false;
  sql.exec(
    "UPDATE account_blocks SET member_notice = 'due' WHERE id = ?",
    row.id,
  );
  return true;
}

export function markMemberNotified(
  sql: SqlStorage,
  id: number,
  at: string,
): void {
  sql.exec("UPDATE account_blocks SET member_notice = ? WHERE id = ?", at, id);
}

/** Every block, newest first, for the Owner. */
export function listBlocks(sql: SqlStorage) {
  return sql
    .exec<AccountBlockRow>("SELECT * FROM account_blocks ORDER BY id DESC")
    .toArray()
    .map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      provider: row.provider,
      blockedAt: row.blocked_at,
      entryId: row.entry_id,
      path: row.path,
      ip: row.ip,
      country: row.country,
      userAgent: row.user_agent,
      notifiedAt: row.notified_at,
      memberNotifiedAt:
        row.member_notice === "due" ? null : (row.member_notice ?? null),
      unblockedAt: row.unblocked_at,
      reason: row.reason,
      apologizedAt: row.apologized_at,
    }));
}

/** Lifts an account's active block; its record stays. */
export function unblock(sql: SqlStorage, userId: string, at: string): boolean {
  const active = sql
    .exec(
      "SELECT id FROM account_blocks WHERE user_id = ? AND unblocked_at IS NULL",
      userId,
    )
    .toArray();
  if (active.length === 0) return false;
  sql.exec(
    "UPDATE account_blocks SET unblocked_at = ? WHERE user_id = ? AND unblocked_at IS NULL",
    at,
    userId,
  );
  return true;
}

/** The Owner's email about one block. */
export function blockNotice(row: AccountBlockRow): {
  subject: string;
  text: string;
} {
  const who = row.email ?? `(no email) ${row.display_name}`;
  return {
    subject: `[Analog Canvas] 已封号（批量采集 Gallery）：${who}`,
    text: [
      "一个账号读取了 Gallery 的蜜罐电路（界面上看不到，只有程序批量遍历列表才会读到），已被自动封禁 Gallery 访问。",
      "",
      `邮箱：${row.email ?? "（无）"}`,
      `显示名：${row.display_name}`,
      `登录方式：${row.provider}`,
      `账号 ID：${row.user_id}`,
      `时间（UTC）：${row.blocked_at}`,
      `触发方式：${
        row.reason === "two-traps"
          ? "浏览器在 24 小时内读取了 2 个不同蜜罐电路的内容"
          : "程序访问（User-Agent 不是浏览器）读到蜜罐"
      }`,
      `读取的蜜罐：${row.entry_id}（${row.path}）`,
      `IP：${row.ip ?? "（未知）"}${row.country ? `，国家/地区：${row.country}` : ""}`,
      `User-Agent：${row.user_agent ?? "（无）"}`,
      "",
      "记录永久保存，可在 Owner 账号下查看：GET /api/auth/blocked",
      '误封可解封：POST /api/auth/blocked/unblock {"userId": "…"}',
    ].join("\n"),
  };
}

/**
 * The member's email about their block: why, that a reply reaches the
 * Owner if it was a mistake, and that the check is still being tested.
 * Never how the check works.
 */
export function memberBlockNotice(row: AccountBlockRow): {
  subject: string;
  text: string;
} {
  return {
    subject: "Your Analog Canvas Gallery access is paused",
    text: [
      "Dear user,",
      "",
      `Your Analog Canvas account (${row.email}) was blocked from the Gallery at ${row.blocked_at.slice(0, 16).replace("T", " ")} UTC, because it read Gallery circuits the way a bulk-collection program does.`,
      "",
      "Occasional manual use of single circuits is welcome. Bulk collection, scraping, mirroring or AI training without permission is not allowed.",
      "",
      "If you think this is a mistake, please reply to this email and tell me briefly what you were doing. I will check and restore your access.",
      "",
      "This check is still being tested. If it blocked you by mistake, I am sorry.",
      "",
      "Your Cloud Projects and the editor are not affected.",
      "",
      "Token Zhang",
      "Analog Canvas",
    ].join("\n"),
  };
}
