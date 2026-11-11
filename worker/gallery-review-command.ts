import { sha256Hex } from "@icm/derived";
import type { SessionUser } from "./auth";
import type { DurableObjectStateLike } from "./gallery-store";
import { ensureGalleryCommandReceipts } from "./gallery-lifecycle-command";
import { resolveReview } from "./gallery-store-reviews";

/** Owner authority, resolution and retry receipt share the review writer's transaction. */
export function reviewCommand(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
  apply: boolean,
): Response {
  const sql = state.storage.sql;
  const user = body.user as SessionUser | undefined;
  if (!user?.isOwner)
    return Response.json({ error: "owner-only" }, { status: 403 });
  ensureGalleryCommandReceipts(sql);
  return state.storage.transactionSync(() => {
    const read = () =>
      sql
        .exec<{ resolved_at: string | null; resolved_by: string | null }>(
          "SELECT resolved_at,resolved_by FROM entry_reviews WHERE id=? AND entry_id=? AND verdict='issue'",
          String(body.reviewId),
          String(body.entryId),
        )
        .toArray()[0];
    const row = read();
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    const signature = (value: typeof row) =>
      "review:" +
      sha256Hex(JSON.stringify([value.resolved_at, value.resolved_by]));
    if (!apply)
      return Response.json({
        state: signature(row),
        resolved: row.resolved_at !== null,
      });
    const previous = sql
      .exec<{ binding: string; status: string }>(
        "SELECT binding,status FROM gallery_lifecycle_commands WHERE user_id=? AND command_id=?",
        user.id,
        String(body.commandId),
      )
      .toArray()[0];
    if (previous && previous.binding !== body.binding)
      return Response.json({ error: "command-reused" }, { status: 409 });
    if (previous)
      return Response.json({
        state: signature(row),
        superseded: previous.status !== signature(row),
      });
    if (
      sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM gallery_lifecycle_commands WHERE user_id=?",
          user.id,
        )
        .toArray()[0]!.n >= 10000
    )
      return Response.json({ error: "command-receipts-full" }, { status: 503 });
    if (row.resolved_at === null) {
      const result = resolveReview(sql, {
        entryId: body.entryId,
        reviewId: body.reviewId,
        resolvedBy: user.displayName,
      });
      if (!result.ok) return result;
    }
    const receipt = signature(read()!);
    sql.exec(
      "INSERT INTO gallery_lifecycle_commands VALUES (?,?,?,?,?)",
      user.id,
      String(body.commandId),
      String(body.binding),
      String(body.entryId),
      receipt,
    );
    return Response.json({ state: receipt, superseded: false });
  });
}
