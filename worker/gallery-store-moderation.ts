// Moderation: curation, duplicate cleanup, rejection, the recycle bin, and
// deleting an entry or a whole account's data.

import {
  readGalleryCuration,
  type GalleryAttention,
  type GalleryCuration,
} from "./gallery-curation";
import { compareElectricalGraphs, projectElectricalGraph } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import {
  type DurableObjectStateLike,
  type EntryRow,
  type SqlStorage,
  isRecord,
  sanitizeGalleryTags,
  summaryOf,
  wrapTags,
} from "./gallery-store";
import { snapshotEntry } from "./gallery-store-versions";

/**
 * Recycle-bin retention. The quota deliberately refunds a withdrawal
 * (recycling counts as taking work down), which leaves publish->recycle
 * cycling bounded only by request rate while every cycle stores a full
 * project_text/svg_text row. The per-account cap closes that
 * write-amplification channel without touching the quota semantics: from
 * entry 26 onward net storage growth is zero regardless of cycling rate,
 * and the rule is one an author can state — the bin holds their 25 most
 * recent withdrawals. Deliberately no age expiry: a clock destroys work on
 * a schedule the author cannot reason about, and against the burst threat
 * it was the weaker half anyway. An author always held the stronger right
 * of deleting their own entry outright in one step.
 */
const GALLERY_RECYCLED_KEEP_PER_ACCOUNT = 25;

export function curate(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const row = sql
    .exec<EntryRow>(
      "SELECT * FROM gallery_entries WHERE id = ?",
      String(body.id),
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  const previous = readGalleryCuration(row.curation_json);
  if (
    body.expectedPreviewRevision !== (row.preview_revision || "legacy") ||
    body.expectedCurationRevision !== (previous?.revision ?? 0)
  ) {
    return Response.json(
      {
        error: "stale-curation",
        message: "The circuit or its review changed. Reload before saving.",
      },
      { status: 409 },
    );
  }
  const curation: GalleryCuration = {
    attention: body.attention as GalleryAttention | null,
    revision: (previous?.revision ?? 0) + 1,
    assessedPreviewRevision: String(body.expectedPreviewRevision),
    updatedAt: String(body.at),
    updatedBy: String(body.userId),
    source: body.source === "visual-audit" ? "visual-audit" : "manual",
  };
  state.storage.transactionSync(() => {
    snapshotEntry(sql, row, String(body.at));
    sql.exec(
      "UPDATE gallery_entries SET tags = ?, curation_json = ? WHERE id = ?",
      wrapTags(sanitizeGalleryTags(body.tags)),
      JSON.stringify(curation),
      row.id,
    );
  });
  return Response.json({
    entry: summaryOf(
      {
        ...row,
        tags: wrapTags(sanitizeGalleryTags(body.tags)),
        curation_json: JSON.stringify(curation),
      },
      true,
    ),
  });
}

/** Recheck current projects and retain a public survivor in the same write. */
export function recycleDuplicates(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const isReference = (
    value: unknown,
  ): value is { id: string; previewRevision: string } =>
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 100 &&
    typeof value.previewRevision === "string" &&
    value.previewRevision.length <= 100;
  if (
    !isReference(body.keep) ||
    !Array.isArray(body.remove) ||
    body.remove.length < 1 ||
    body.remove.length > 49 ||
    !body.remove.every(isReference)
  ) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  const references = [body.keep, ...body.remove];
  if (new Set(references.map((entry) => entry.id)).size !== references.length) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  return state.storage.transactionSync(() => {
    const conflict = (error: string) =>
      Response.json({ error }, { status: 409 });
    // Finish every check before the first write: a failed group changes nothing.
    const rows: EntryRow[] = [];
    for (const reference of references) {
      const row = sql
        .exec<EntryRow>(
          "SELECT * FROM gallery_entries WHERE id = ?",
          reference.id,
        )
        .toArray()[0];
      if (
        !row ||
        row.status !== "public" ||
        (row.preview_revision || "legacy") !== reference.previewRevision
      ) {
        return conflict("duplicate-group-changed");
      }
      rows.push(row);
    }
    try {
      const survivor = projectElectricalGraph(
        parseProject(rows[0]!.project_text),
      );
      if (survivor.status !== "ready")
        return conflict("duplicate-group-uncheckable");
      for (const row of rows.slice(1)) {
        // The preview revision covers drawing changes only. Never use it as
        // evidence of electrical equality: hidden parameters can change too.
        const candidate = projectElectricalGraph(
          parseProject(row.project_text),
        );
        if (candidate.status !== "ready")
          return conflict("duplicate-group-uncheckable");
        const comparison = compareElectricalGraphs(
          survivor.graph,
          candidate.graph,
        );
        if (comparison !== "equal") {
          return conflict(
            comparison === "unknown"
              ? "duplicate-group-uncheckable"
              : "not-duplicates",
          );
        }
      }
    } catch {
      return conflict("duplicate-group-uncheckable");
    }
    for (const row of rows.slice(1)) {
      sql.exec(
        `UPDATE gallery_entries SET status = 'recycled', recycled_at = ?,
           reviewed_at = ?, reviewed_by = ? WHERE id = ?`,
        String(body.at),
        String(body.at),
        String(body.reviewerId),
        row.id,
      );
    }
    return Response.json({
      kept: rows[0]!.id,
      recycled: rows.slice(1).map((row) => row.id),
    });
  });
}

/**
 * Put an entry on the wall or withdraw it. A curator withdrawing someone
 * else's entry names itself as `reviewerId`, recorded at the withdrawal
 * (withdrawnByCurator), so that its owner cannot put it back (#1540).
 */
export function setStatus(
  state: DurableObjectStateLike,
  id: string,
  status: string,
  at: string,
  reviewerId: string | null,
): Response {
  const sql = state.storage.sql;
  const row = sql
    .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  if (status === "public") {
    sql.exec(
      `UPDATE gallery_entries
       SET status = 'public', recycled_at = NULL, reject_reason = NULL,
           reviewed_at = NULL, reviewed_by = NULL
       WHERE id = ?`,
      id,
    );
  } else {
    state.storage.transactionSync(() => {
      sql.exec(
        "UPDATE gallery_entries SET status = ?, recycled_at = ? WHERE id = ?",
        status,
        status === "recycled" ? at : null,
        id,
      );
      if (reviewerId !== null) {
        sql.exec(
          "UPDATE gallery_entries SET reviewed_at = ?, reviewed_by = ? WHERE id = ?",
          at,
          reviewerId,
          id,
        );
      }
      if (status === "recycled") {
        sweepRecycledRows(sql, row.owner_user_id ?? "");
      }
    });
  }
  return Response.json({ id, status });
}

export function reject(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const id = String(body.id);
  const row = sql
    .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  if (row.status !== "public") {
    return Response.json({ error: "not-public" }, { status: 409 });
  }
  sql.exec(
    `UPDATE gallery_entries
     SET status = 'rejected', recycled_at = NULL, reject_reason = ?,
         reviewed_at = ?, reviewed_by = ?
     WHERE id = ?`,
    String(body.reason),
    String(body.at),
    String(body.reviewerId),
    id,
  );
  return Response.json({ id, status: "rejected" });
}

/**
 * Remove an entry and everything hanging off it.
 *
 * A curator deletes out of the recycle bin, so the two-step stands for
 * them. An author deleting their own work has already decided, and asking
 * them to withdraw first would only be ceremony, so that path passes
 * `requireRecycled: false`.
 */
export function deleteEntry(
  state: DurableObjectStateLike,
  id: string,
  requireRecycled: boolean,
): Response {
  const sql = state.storage.sql;
  const row = sql
    .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  if (requireRecycled && row.status !== "recycled") {
    return Response.json({ error: "not-recycled" }, { status: 409 });
  }
  state.storage.transactionSync(() => {
    hardDeleteEntryRows(sql, id);
  });
  return Response.json({ id, deleted: true });
}

/**
 * Deleting an account takes everything the Gallery keeps for it: the
 * circuits it published, in any state, with their history and likes; its
 * likes on other circuits; its Cloud Projects with their revisions; and the
 * circuits it opened today.
 */
export function deleteAccount(
  state: DurableObjectStateLike,
  userId: string,
): Response {
  const sql = state.storage.sql;
  if (!userId) return Response.json({ error: "missing-user" }, { status: 400 });
  return state.storage.transactionSync(() => {
    sql.exec("DELETE FROM gallery_daily_opens WHERE user_id = ?", userId);
    const entries = sql
      .exec<{
        id: string;
      }>("SELECT id FROM gallery_entries WHERE owner_user_id = ?", userId)
      .toArray();
    for (const { id } of entries) hardDeleteEntryRows(sql, id);
    const likes = sql
      .exec<{
        id: string;
      }>("SELECT entry_id AS id FROM gallery_likes WHERE user_id = ?", userId)
      .toArray();
    sql.exec("DELETE FROM gallery_likes WHERE user_id = ?", userId);
    const projects = sql
      .exec<{
        id: string;
      }>("SELECT id FROM cloud_projects WHERE user_id = ?", userId)
      .toArray();
    for (const { id } of projects)
      sql.exec("DELETE FROM cloud_project_versions WHERE project_id = ?", id);
    sql.exec("DELETE FROM cloud_projects WHERE user_id = ?", userId);
    return Response.json({
      entries: entries.length,
      likes: likes.length,
      projects: projects.length,
    });
  });
}

/** Remove one entry and everything hanging off it. Callers own the transaction. */
function hardDeleteEntryRows(sql: SqlStorage, id: string): void {
  sql.exec("DELETE FROM gallery_entry_versions WHERE entry_id = ?", id);
  sql.exec("DELETE FROM gallery_likes WHERE entry_id = ?", id);
  sql.exec("DELETE FROM gallery_entries WHERE id = ?", id);
}

/**
 * Lazy retention sweep, run inside the submission and recycle write
 * transactions — no alarms, no scheduled work. Keeps the newest
 * {@link GALLERY_RECYCLED_KEEP_PER_ACCOUNT} recycled rows for the writing
 * account; anonymous/legacy rows share one unowned bucket and are exempt
 * from the cap. Administrator-reviewed rows are also exempt so duplicate
 * cleanup remains reversible even after later author withdrawals.
 * Nothing expires by time.
 */
export function sweepRecycledRows(sql: SqlStorage, ownerUserId: string): void {
  if (ownerUserId === "") return;
  const overflow = sql
    .exec<{ id: string }>(
      `SELECT id FROM gallery_entries
       WHERE status = 'recycled' AND owner_user_id = ? AND reviewed_by IS NULL
       ORDER BY recycled_at DESC, id DESC
       LIMIT -1 OFFSET ?`,
      ownerUserId,
      GALLERY_RECYCLED_KEEP_PER_ACCOUNT,
    )
    .toArray();
  for (const row of overflow) hardDeleteEntryRows(sql, row.id);
}

export function recycled(sql: SqlStorage): Response {
  const rows = sql
    .exec<EntryRow>(
      `SELECT * FROM gallery_entries WHERE status = 'recycled'
       ORDER BY recycled_at DESC, id DESC`,
    )
    .toArray();
  return Response.json({
    entries: rows.map((row) => ({
      ...summaryOf(row),
      recycledAt: row.recycled_at,
    })),
  });
}

export function rejected(sql: SqlStorage): Response {
  const rows = sql
    .exec<EntryRow>(
      `SELECT * FROM gallery_entries WHERE status = 'rejected'
       ORDER BY reviewed_at DESC, created_at DESC, id DESC`,
    )
    .toArray();
  return Response.json({
    entries: rows.map((row) => ({
      ...summaryOf(row),
      rejectReason: row.reject_reason,
      reviewedAt: row.reviewed_at,
    })),
  });
}
