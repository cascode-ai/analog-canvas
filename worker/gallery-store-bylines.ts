import { locallyOwnedResources } from "./resource-replica";
// Bylines that follow an account: AI accounts' official names, GPT-6.1 Sol's
// circuits moved off GPT-6 Astra's seat, and profile renames.

import { AI_SEATS } from "./auth";
import {
  type DurableObjectStateLike,
  GALLERY_MAX_AUTHOR_LENGTH,
  type SqlStorage,
} from "./gallery-store";

export const SOL_FROM_ASTRA_MIGRATION =
  "2026-10-08-gpt-6-1-sol-from-gpt-6-astra";
/**
 * GPT-6 Astra drew its account's first 25 circuits, the last at 21:37 on
 * 2026-10-07; every one published after this through that account was
 * GPT-6.1 Sol's (the Owner, 2026-10-08). The next began at 22:05.
 */
const SOL_FROM_ASTRA_AFTER = "2026-10-07T21:50:00.000Z";

/**
 * An AI account's circuits (isAiSeatEntry) carry the name AI_SEATS gives
 * it, the model's official one, on every entry and saved version, and the
 * AI mark. Cheap when they already do, so it runs whenever the Gallery
 * starts and after a restore.
 */
/**
 * GPT-6.1 Sol's circuits published through GPT-6 Astra's seat until
 * `through` move to its own: owner, byline, the bylines of their saved
 * versions, the AI mark, and GPT-6 Astra's Cloud Projects published as
 * them (SOL_FROM_ASTRA_AFTER).
 */
export function moveSolFromAstra(sql: SqlStorage, through: string): void {
  const astra = AI_SEATS.find((seat) => seat.seat === "ai-designer-2")!;
  const sol = AI_SEATS.find((seat) => seat.seat === "ai-designer-3")!;
  const moved = `SELECT id FROM gallery_entries
     WHERE owner_user_id = ? AND created_at > ? AND created_at <= ? AND ${locallyOwnedResources(sql)}`;
  sql.exec(
    `UPDATE gallery_entry_versions SET author = ? WHERE entry_id IN (${moved})`,
    sol.displayName,
    astra.userId,
    SOL_FROM_ASTRA_AFTER,
    through,
  );
  sql.exec(
    `UPDATE gallery_entries SET owner_user_id = ?, author = ?, ai_generated = 1
     WHERE id IN (${moved})`,
    sol.userId,
    sol.displayName,
    astra.userId,
    SOL_FROM_ASTRA_AFTER,
    through,
  );
  sql.exec(
    `UPDATE cloud_projects SET user_id = ?
     WHERE user_id = ? AND gallery_entry_id IN (${moved})`,
    sol.userId,
    astra.userId,
    sol.userId,
    SOL_FROM_ASTRA_AFTER,
    through,
  );
}

/** A restored backup from before the move moves again, as far as it went. */
export function reapplySolFromAstra(state: DurableObjectStateLike): void {
  const sql = state.storage.sql;
  const applied = sql
    .exec<{ applied_at: string }>(
      "SELECT applied_at FROM data_migrations WHERE id = ?",
      SOL_FROM_ASTRA_MIGRATION,
    )
    .toArray()[0];
  if (applied)
    state.storage.transactionSync(() =>
      moveSolFromAstra(sql, applied.applied_at),
    );
}

export function syncAiSeatBylines(state: DurableObjectStateLike): void {
  const sql = state.storage.sql;
  state.storage.transactionSync(() => {
    for (const { userId, displayName, formerName } of AI_SEATS) {
      const former = formerName ?? displayName;
      // A version another AI account made before this one took the circuit
      // over (#1499) keeps that account's name.
      const others = AI_SEATS.filter((seat) => seat.userId !== userId).flatMap(
        (seat) => [seat.displayName, seat.formerName ?? seat.displayName],
      );
      sql.exec(
        `UPDATE gallery_entry_versions SET author = ?
         WHERE author <> ? AND author NOT IN (${others.map(() => "?").join(", ")})
           AND entry_id IN (
           SELECT id FROM gallery_entries
           WHERE owner_user_id = ? AND author IN (?, ?) AND ${locallyOwnedResources(sql)}
         )`,
        displayName,
        displayName,
        ...others,
        userId,
        displayName,
        former,
      );
      sql.exec(
        `UPDATE gallery_entries SET author = ?, ai_generated = 1
         WHERE owner_user_id = ? AND author IN (?, ?) AND ${locallyOwnedResources(sql)}
           AND (author <> ? OR ai_generated <> 1)`,
        displayName,
        userId,
        displayName,
        former,
        displayName,
      );
    }
  });
}

/**
 * A profile name is a current account label, not versioned circuit content.
 * Move every materialized byline for the stable owner identity together so
 * feeds, contributor counts and restorable history cannot disagree.
 */
export function renameOwner(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const ownerUserId =
    typeof body.ownerUserId === "string" ? body.ownerUserId.trim() : "";
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (
    ownerUserId.length === 0 ||
    displayName.length === 0 ||
    displayName.length > GALLERY_MAX_AUTHOR_LENGTH
  ) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }

  const revision = body.bylineRevision;
  if (
    revision !== undefined &&
    (!Number.isSafeInteger(revision) || Number(revision) < 1)
  )
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_byline_revisions (
    owner_user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, display_name TEXT NOT NULL
  ) WITHOUT ROWID`);

  let entries = 0;
  let versions = 0;
  state.storage.transactionSync(() => {
    if (revision !== undefined) {
      const previous =
        sql
          .exec<{ revision: number }>(
            "SELECT revision FROM gallery_byline_revisions WHERE owner_user_id=?",
            ownerUserId,
          )
          .toArray()[0]?.revision ?? 0;
      if (previous >= Number(revision)) return;
    }
    sql.exec(
      `INSERT INTO gallery_byline_revisions VALUES (?,?,?)
       ON CONFLICT(owner_user_id) DO UPDATE SET
         revision=COALESCE(?,gallery_byline_revisions.revision), display_name=excluded.display_name`,
      ownerUserId,
      revision ?? 0,
      displayName,
      revision ?? null,
    );
    entries = sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM gallery_entries
         WHERE owner_user_id = ? AND ${locallyOwnedResources(sql)}`,
        ownerUserId,
      )
      .one().count;
    versions = sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM gallery_entry_versions
         WHERE entry_id IN (
           SELECT id FROM gallery_entries WHERE owner_user_id = ? AND ${locallyOwnedResources(sql)}
         )`,
        ownerUserId,
      )
      .one().count;
    sql.exec(
      `UPDATE gallery_entry_versions SET author = ?
       WHERE entry_id IN (
         SELECT id FROM gallery_entries WHERE owner_user_id = ? AND ${locallyOwnedResources(sql)}
       )`,
      displayName,
      ownerUserId,
    );
    sql.exec(
      `UPDATE gallery_entries SET author = ? WHERE owner_user_id = ? AND ${locallyOwnedResources(sql)}`,
      displayName,
      ownerUserId,
    );
  });
  return Response.json({ ownerUserId, displayName, entries, versions });
}

/** An older regional session cannot republish a superseded profile name. */
export function currentProfileByline(
  sql: SqlStorage,
  ownerUserId: unknown,
  fallback: string,
): string {
  if (
    typeof ownerUserId !== "string" ||
    AI_SEATS.some((seat) => seat.userId === ownerUserId)
  )
    return fallback;
  if (
    !sql
      .exec(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='gallery_byline_revisions'",
      )
      .toArray().length
  )
    return fallback;
  return (
    sql
      .exec<{ display_name: string }>(
        "SELECT display_name FROM gallery_byline_revisions WHERE owner_user_id=?",
        ownerUserId,
      )
      .toArray()[0]?.display_name ?? fallback
  );
}

export function forgetProfileByline(sql: SqlStorage, ownerUserId: string) {
  if (
    sql
      .exec(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='gallery_byline_revisions'",
      )
      .toArray().length
  )
    sql.exec(
      "DELETE FROM gallery_byline_revisions WHERE owner_user_id=?",
      ownerUserId,
    );
}
