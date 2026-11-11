import {
  type DurableObjectStateLike,
  type EntryRow,
  type SqlStorage,
  withdrawnByCurator,
  summaryOf,
} from "./gallery-store";
import { curate, deleteEntry, setStatus } from "./gallery-store-moderation";
import { validCurationRequest } from "./gallery-curation";
import { sha256Hex } from "@icm/derived";
import { galleryDetails } from "./gallery-details-request";
import { updateEntryDetails } from "./gallery-store-entries";
import type { SessionUser } from "./auth";

/** Trusted route command: authorization, state transition and receipt commit together. */
export function lifecycleCommand(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  ensureGalleryCommandReceipts(sql);
  const user = body.user as SessionUser;
  const id = String(body.id),
    action = String(body.action);
  return state.storage.transactionSync(() => {
    if (!user?.id)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const row = sql
      .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id=?", id)
      .toArray()[0];
    const previous = sql
      .exec<{ binding: string; entry_id: string; status: string }>(
        "SELECT * FROM gallery_lifecycle_commands WHERE user_id=? AND command_id=?",
        user.id,
        String(body.commandId),
      )
      .toArray()[0];
    if (previous && previous.binding !== body.binding)
      return Response.json({ error: "command-reused" }, { status: 409 });
    // A completed deletion has no row left to authorize against. Only its
    // authenticated actor, exact command and retained receipt can reconcile it.
    if (previous?.status === "deleted")
      return Response.json({ id, status: "deleted", superseded: !!row });
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    if (
      !user.isAdmin &&
      !(action === "details" && user.role === "moderator") &&
      row.owner_user_id !== user.id
    )
      return action === "curation" || action === "details"
        ? Response.json({ error: "forbidden" }, { status: 403 })
        : Response.json({ error: "unauthorized" }, { status: 401 });
    if (previous && action === "details") {
      return Response.json({
        id,
        status: row.status,
        details: { name: row.name, description: row.description },
        superseded: previous.status !== detailsReceipt(row),
      });
    }
    if (previous && action === "curation") {
      const entry = summaryOf(row, true);
      return Response.json({
        id,
        status: row.status,
        entry,
        superseded: previous.status !== curationReceipt(entry),
      });
    }
    if (previous)
      return Response.json({
        id: previous.entry_id,
        status: row.status,
        superseded: row.status !== previous.status,
      });
    if (
      !["recycle", "restore", "delete", "curation", "details"].includes(action)
    )
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
      action !== "delete" &&
      action !== "curation" &&
      action !== "details" &&
      !user.isAdmin &&
      !(action === "recycle"
        ? row.status === "public"
        : row.status === "recycled" &&
          row.reject_reason === null &&
          !withdrawnByCurator(row))
    )
      return Response.json({ error: "invalid-status" }, { status: 409 });
    if (action === "details") {
      const details = galleryDetails(body.input);
      if (!details)
        return Response.json({ error: "invalid-fields" }, { status: 400 });
      const response = updateEntryDetails(state, {
        ...details,
        id,
        at: new Date().toISOString(),
      });
      if (!response.ok) return response;
      const current = sql
        .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id=?", id)
        .toArray()[0]!;
      sql.exec(
        "INSERT INTO gallery_lifecycle_commands VALUES (?,?,?,?,?)",
        user.id,
        String(body.commandId),
        String(body.binding),
        id,
        detailsReceipt(current),
      );
      return Response.json({ id, status: current.status, details });
    }
    if (action === "curation") {
      if (!validCurationRequest(body.input))
        return Response.json({ error: "invalid-curation" }, { status: 400 });
      const response = curate(state, {
        ...body.input,
        id,
        userId: user.id,
        at: new Date().toISOString(),
      });
      if (!response.ok) return response;
      const current = sql
        .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id=?", id)
        .toArray()[0]!;
      const entry = summaryOf(current, true);
      sql.exec(
        "INSERT INTO gallery_lifecycle_commands VALUES (?,?,?,?,?)",
        user.id,
        String(body.commandId),
        String(body.binding),
        id,
        curationReceipt(entry),
      );
      return Response.json({ id, status: current.status, entry });
    }
    const status =
      action === "delete"
        ? "deleted"
        : action === "recycle"
          ? "recycled"
          : "public";
    const result =
      action === "delete"
        ? deleteEntry(state, id, user.isAdmin)
        : setStatus(
            state,
            id,
            status,
            new Date().toISOString(),
            action === "recycle" &&
              user.isAdmin &&
              row.owner_user_id !== user.id
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
    return Response.json({ id, status });
  });
}

export function ensureGalleryCommandReceipts(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_lifecycle_commands (
    user_id TEXT NOT NULL, command_id TEXT NOT NULL, binding TEXT NOT NULL,
    entry_id TEXT NOT NULL, status TEXT NOT NULL,
    PRIMARY KEY(user_id,command_id)) WITHOUT ROWID`);
}

function curationReceipt(entry: ReturnType<typeof summaryOf>): string {
  return JSON.stringify([
    "curation",
    entry.curationRevision,
    entry.previewRevision,
  ]);
}

function detailsReceipt(row: EntryRow): string {
  return (
    "details:" +
    sha256Hex(JSON.stringify([row.name, row.description, row.preview_revision]))
  );
}
