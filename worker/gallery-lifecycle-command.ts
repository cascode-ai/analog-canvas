import {
  type DurableObjectStateLike,
  type EntryRow,
  withdrawnByCurator,
} from "./gallery-store";
import { setStatus } from "./gallery-store-moderation";
import type { SessionUser } from "./auth";

/** Trusted route command: authorization, state transition and receipt commit together. */
export function lifecycleCommand(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_lifecycle_commands (
    user_id TEXT NOT NULL, command_id TEXT NOT NULL, binding TEXT NOT NULL,
    entry_id TEXT NOT NULL, status TEXT NOT NULL,
    PRIMARY KEY(user_id,command_id)) WITHOUT ROWID`);
  const user = body.user as SessionUser;
  const id = String(body.id),
    action = String(body.action);
  return state.storage.transactionSync(() => {
    const row = sql
      .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id=?", id)
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    if (!user?.id || (!user.isAdmin && row.owner_user_id !== user.id))
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const previous = sql
      .exec<{ binding: string; entry_id: string; status: string }>(
        "SELECT * FROM gallery_lifecycle_commands WHERE user_id=? AND command_id=?",
        user.id,
        String(body.commandId),
      )
      .toArray()[0];
    if (previous)
      return previous.binding === body.binding
        ? Response.json({
            id: previous.entry_id,
            status: row.status,
            superseded: row.status !== previous.status,
          })
        : Response.json({ error: "command-reused" }, { status: 409 });
    if (action !== "recycle" && action !== "restore")
      return Response.json({ error: "invalid-action" }, { status: 400 });
    if (
      sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM gallery_lifecycle_commands WHERE user_id=?",
          user.id,
        )
        .toArray()[0]!.n >= 10000
    )
      return Response.json({ error: "command-receipts-full" }, { status: 503 });
    if (
      !user.isAdmin &&
      !(action === "recycle"
        ? row.status === "public"
        : row.status === "recycled" &&
          row.reject_reason === null &&
          !withdrawnByCurator(row))
    )
      return Response.json({ error: "invalid-status" }, { status: 409 });
    const status = action === "recycle" ? "recycled" : "public";
    const result = setStatus(
      state,
      id,
      status,
      new Date().toISOString(),
      action === "recycle" && user.isAdmin && row.owner_user_id !== user.id
        ? user.id
        : null,
    );
    if (!result.ok) return result;
    sql.exec(
      "INSERT INTO gallery_lifecycle_commands VALUES (?,?,?,?,?)",
      user.id,
      String(body.commandId),
      String(body.binding),
      id,
      status,
    );
    return result;
  });
}
