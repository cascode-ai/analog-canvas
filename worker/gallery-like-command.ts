import { sha256Hex } from "@icm/derived";
import type { SessionUser } from "./auth";
import type { DurableObjectStateLike, SqlStorage } from "./gallery-store";
import { ensureGalleryCommandReceipts } from "./gallery-lifecycle-command";
import { toggleLike } from "./gallery-store-wall";

export type LikeCommand = {
  actorId: string;
  entryId: string;
  commandId: string;
  target: "cn" | "overseas";
  expected: string;
  take: boolean;
  owner: boolean;
};
const fail = (error: string, status: number) =>
  Response.json({ error }, { status });

function likeState(sql: SqlStorage, entryId: string, userId: string) {
  const row = sql
    .exec<{ hearts: number; liked_at: string }>(
      "SELECT hearts,liked_at FROM gallery_likes WHERE entry_id=? AND user_id=?",
      entryId,
      userId,
    )
    .toArray()[0];
  const key = sql
    .exec<{ origin: "cn" | "overseas"; generation: number }>(
      "SELECT origin,generation FROM interaction_replica_keys WHERE id=?",
      entryId + ":" + userId,
    )
    .toArray()[0];
  const likes = sql
    .exec<{ total: number }>(
      "SELECT COALESCE(SUM(hearts),0) AS total FROM gallery_likes WHERE entry_id=?",
      entryId,
    )
    .toArray()[0]!.total;
  return {
    state: sha256Hex(
      JSON.stringify([
        key?.origin ?? null,
        key?.generation ?? 0,
        row?.hearts ?? 0,
        row?.liked_at ?? null,
      ]),
    ),
    target: row ? key?.origin : undefined,
    likes,
    likedByViewer: !!row && row.hearts > 0,
  };
}

/** An entrance fixes an operation before transport; a retry never selects a new writer. */
export function prepareLikeCommand(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql,
    user = body.user as SessionUser;
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_like_intents (
    user_id TEXT NOT NULL, command_id TEXT NOT NULL, input TEXT NOT NULL, command TEXT NOT NULL,
    PRIMARY KEY(user_id,command_id)) WITHOUT ROWID`);
  return state.storage.transactionSync(() => {
    const input = JSON.stringify([
      body.entryId,
      body.take === true,
      user.isOwner === true,
    ]);
    const previous = sql
      .exec<{ input: string; command: string }>(
        "SELECT input,command FROM gallery_like_intents WHERE user_id=? AND command_id=?",
        user.id,
        String(body.commandId),
      )
      .toArray()[0];
    if (previous)
      return previous.input === input
        ? Response.json(JSON.parse(previous.command))
        : fail("command-reused", 409);
    if (
      sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM gallery_like_intents WHERE user_id=?",
          user.id,
        )
        .toArray()[0]!.n >= 10000
    )
      return fail("command-receipts-full", 503);
    const current = likeState(sql, String(body.entryId), user.id);
    const region = sql
      .exec<{ region: LikeCommand["target"] }>(
        "SELECT region FROM interaction_replica_meta WHERE id=1",
      )
      .toArray()[0]!.region;
    const command: LikeCommand = {
      actorId: user.id,
      entryId: String(body.entryId),
      commandId: String(body.commandId),
      target: current.target ?? region,
      expected: current.state,
      take: body.take === true,
      owner: user.isOwner === true,
    };
    sql.exec(
      "INSERT INTO gallery_like_intents VALUES (?,?,?,?)",
      user.id,
      command.commandId,
      input,
      JSON.stringify(command),
    );
    return Response.json(command);
  });
}

/** Receipt lookup precedes writer validation: a later claim cannot move an old command. */
export function applyLikeCommand(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
  apply: boolean,
): Response {
  const sql = state.storage.sql,
    user = body.user as SessionUser;
  const command = body as unknown as LikeCommand;
  if (command.actorId !== user.id) return fail("account-changed", 403);
  if (command.owner !== (user.isOwner === true))
    return fail("authority-changed", 403);
  ensureGalleryCommandReceipts(sql);
  return state.storage.transactionSync(() => {
    const current = () => likeState(sql, command.entryId, user.id);
    if (!apply) return Response.json(current());
    const previous = sql
      .exec<{ binding: string; status: string }>(
        "SELECT binding,status FROM gallery_lifecycle_commands WHERE user_id=? AND command_id=?",
        user.id,
        command.commandId,
      )
      .toArray()[0];
    if (previous) {
      if (previous.binding !== body.binding) return fail("command-reused", 409);
      const now = current();
      return Response.json({
        ...now,
        superseded: previous.status !== "like:" + now.state,
      });
    }
    if (
      sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM gallery_lifecycle_commands WHERE user_id=?",
          user.id,
        )
        .toArray()[0]!.n >= 10000
    )
      return fail("command-receipts-full", 503);
    const before = current();
    if (before.state !== command.expected) return fail("like-changed", 409);
    const region = sql
      .exec<{ region: string }>(
        "SELECT region FROM interaction_replica_meta WHERE id=1",
      )
      .toArray()[0]!.region;
    if (
      region !== command.target ||
      (before.target && before.target !== region)
    )
      return fail("wrong-writer", 409);
    const response = toggleLike(
      sql,
      command.entryId,
      user.id,
      new Date().toISOString(),
      { owner: command.owner, take: command.take },
    );
    if (!response.ok) return response;
    const after = current();
    sql.exec(
      "INSERT INTO gallery_lifecycle_commands VALUES (?,?,?,?,?)",
      user.id,
      command.commandId,
      String(body.binding),
      command.entryId,
      "like:" + after.state,
    );
    return Response.json({ ...after, superseded: false });
  });
}
