// One entry: publishing, updating and importing it, reading it and its
// preview, the daily publish quota and the daily allowance of opens.

import { formulaPreviewNeedsRefresh } from "./gallery-preview";
import { sha256Hex } from "@icm/derived";
import { NETLIST_MARK_RULE_VERSION } from "@icm/netlist";
import { AI_SEATS } from "./auth";
import {
  type DurableObjectStateLike,
  type EntryRow,
  GALLERY_DAILY_OPEN_LIMIT,
  GALLERY_DAILY_SUBMISSION_LIMIT,
  type SqlStorage,
  advanceCurationRevision,
  countedParts,
  isAiSeatEntry,
  shortId,
  summaryOf,
  svgPreviewDimensions,
} from "./gallery-store";
import { snapshotEntry } from "./gallery-store-versions";
import { sweepRecycledRows } from "./gallery-store-moderation";

interface PreviewAccessRow {
  status: string;
  owner_user_id: string | null;
  preview_revision: string;
}

interface PreviewRow extends PreviewAccessRow {
  author: string;
  svg_text: string;
}

/** A free id, redrawn on the vanishing chance the first one is taken. */
function freeEntryId(sql: SqlStorage): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = shortId();
    const taken = sql
      .exec<{ id: string }>(
        "SELECT id FROM gallery_entries WHERE id = ?",
        candidate,
      )
      .toArray();
    if (taken.length === 0) return candidate;
  }
  // Eight collisions in a row is not chance; fall back to something that
  // cannot collide rather than looping or overwriting an entry.
  return crypto.randomUUID();
}

/** Private publication metadata; never infer a link from names or circuit bytes. */
function publicationBindingError(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response | null {
  if (body.cloudProjectId === undefined) return null;
  const cloud = sql
    .exec<{ gallery_entry_id: string | null }>(
      "SELECT gallery_entry_id FROM cloud_projects WHERE id = ? AND user_id = ?",
      String(body.cloudProjectId),
      String(body.userId),
    )
    .toArray()[0];
  if (!cloud)
    return Response.json({ error: "cloud-project-not-found" }, { status: 404 });
  if (cloud.gallery_entry_id !== body.expectedGalleryEntryId) {
    return Response.json(
      { error: "publication-link-conflict" },
      { status: 409 },
    );
  }
  return null;
}

function bindPublication(
  sql: SqlStorage,
  body: Record<string, unknown>,
  entryId: string,
): void {
  if (body.cloudProjectId === undefined) return;
  // Changing the source retires only this account's previous draft binding.
  // Private drawings remain intact, and stale tabs fail the expected-link check.
  sql.exec(
    "UPDATE cloud_projects SET gallery_entry_id = NULL WHERE user_id = ? AND gallery_entry_id = ? AND id <> ?",
    String(body.userId),
    entryId,
    String(body.cloudProjectId),
  );
  sql.exec(
    "UPDATE cloud_projects SET gallery_entry_id = ? WHERE id = ? AND user_id = ?",
    entryId,
    String(body.cloudProjectId),
    String(body.userId),
  );
}

export function submit(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const bindingError = publicationBindingError(sql, body);
  if (bindingError) return bindingError;
  const entry = body.entry as EntryRow;
  const previewRevision = sha256Hex(entry.svg_text);
  const previewDimensions = svgPreviewDimensions(entry.svg_text);
  const day = String(body.day);
  // The daily quota is anti-garbage protection for ordinary submitters;
  // admin and moderator sessions are exempt (they curate).
  //
  // It counts the account's own entries for the day rather than a separate
  // tally, so taking work down gives the allowance back. That is
  // deliberate: the quota exists to bound how much a stranger can dump on
  // the wall at once, not to ration how many times someone may change
  // their mind.
  //
  // Withdrawing to the recycle bin therefore counts as taking it down, the
  // same as deleting. The entry has left the wall; making the author wait
  // for a curator to empty the bin would ration the second thought rather
  // than the dumping. Restoring it publishes it again, and the slot is
  // spent again with it.
  //
  // 'recycled' is the whole exemption, and 'rejected' is deliberately not
  // in it: a rejection is the wall's owner turning work away, not the
  // author changing their mind. Refunding it would mean the harder a
  // curator works the more that account may publish, which points the
  // quota away from the submitter it exists to bound.
  const enforceLimit = body.enforceLimit !== false;
  const outcome = state.storage.transactionSync(() => {
    if (enforceLimit) {
      const used = submissionsOn(sql, entry.owner_user_id ?? "", day);
      const limit =
        typeof body.limit === "number"
          ? body.limit
          : GALLERY_DAILY_SUBMISSION_LIMIT;
      if (used >= limit) {
        return { status: "rate-limited" as const };
      }
    }
    entry.id = freeEntryId(sql);
    sql.exec(
      `INSERT INTO gallery_entries(
        id, name, author, description, created_at, schema_version,
        status, recycled_at, owner_user_id, submitter_email,
        submitter_provider, tags, project_text, svg_text, netlistable,
        netlistable_version, component_count, component_count_version,
        preview_revision, preview_width, preview_height, ai_generated
      ) VALUES (?, ?, ?, ?, ?, ?, 'public', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.name,
      entry.author,
      entry.description,
      entry.created_at,
      entry.schema_version,
      entry.owner_user_id ?? null,
      entry.submitter_email ?? null,
      entry.submitter_provider ?? null,
      entry.tags ?? "",
      entry.project_text,
      entry.svg_text,
      entry.netlistable ?? 0,
      NETLIST_MARK_RULE_VERSION,
      ...countedParts(entry.component_count),
      previewRevision,
      previewDimensions?.width ?? null,
      previewDimensions?.height ?? null,
      entry.ai_generated === 1 ? 1 : 0,
    );
    bindPublication(sql, body, entry.id);
    sweepRecycledRows(sql, entry.owner_user_id ?? "");
    return { status: "stored" as const };
  });
  if (outcome.status === "rate-limited") {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }
  return Response.json({ id: entry.id, previewRevision });
}

/** Minimum row needed to decide whether an immutable preview cache hit is valid. */
export function previewAccess(sql: SqlStorage, id: string): Response {
  const row = sql
    .exec<PreviewAccessRow>(
      `SELECT status, owner_user_id, preview_revision
       FROM gallery_entries WHERE id = ?`,
      id,
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({
    status: row.status,
    ownerUserId: row.owner_user_id,
    previewRevision: row.preview_revision || "legacy",
  });
}

/** Preview bytes without the unrelated canonical Project payload. */
export function preview(sql: SqlStorage, id: string): Response {
  const row = sql
    .exec<PreviewRow>(
      `SELECT status, owner_user_id, author, preview_revision, svg_text
       FROM gallery_entries WHERE id = ?`,
      id,
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({
    status: row.status,
    ownerUserId: row.owner_user_id,
    author: row.author,
    previewRevision: row.preview_revision || "legacy",
    svgText: row.svg_text,
    ...(formulaPreviewNeedsRefresh(row.svg_text)
      ? {
          projectText: sql
            .exec<{ project_text: string }>(
              "SELECT project_text FROM gallery_entries WHERE id = ?",
              id,
            )
            .one().project_text,
        }
      : {}),
  });
}

/** Drop every record of opens before `day`; only that day's are needed. */
export function forgetOpens(sql: SqlStorage, day: string): Response {
  sql.exec("DELETE FROM gallery_daily_opens WHERE day < ?", day);
  return Response.json({ forgotten: true });
}

/**
 * Spend one of the account's daily opens on `entryId`, unless it already
 * opened that circuit today. `allowed: false` once the day's allowance is
 * used up; the caller decides who is counted at all.
 */
export function countOpen(
  state: DurableObjectStateLike,
  userId: string,
  entryId: string,
  day: string,
): Response {
  const sql = state.storage.sql;
  return state.storage.transactionSync(() => {
    forgetOpens(sql, day);
    const seen =
      sql
        .exec(
          "SELECT 1 FROM gallery_daily_opens WHERE day = ? AND user_id = ? AND entry_id = ?",
          day,
          userId,
          entryId,
        )
        .toArray().length > 0;
    const used = sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM gallery_daily_opens WHERE day = ? AND user_id = ?",
        day,
        userId,
      )
      .one().n;
    if (seen) return Response.json({ allowed: true, used });
    if (used >= GALLERY_DAILY_OPEN_LIMIT)
      return Response.json({ allowed: false, used });
    sql.exec(
      "INSERT INTO gallery_daily_opens (day, user_id, entry_id) VALUES (?, ?, ?)",
      day,
      userId,
      entryId,
    );
    return Response.json({ allowed: true, used: used + 1 });
  });
}

/**
 * One entry. `submitterEmail`/`submitterProvider` ride along for the
 * caller to gate: `routeGalleryRequest` only forwards them to a curator.
 */
export function entry(
  sql: SqlStorage,
  id: string,
  requiredStatus: string | null,
): Response {
  const row = sql
    .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
    .toArray()[0];
  if (!row || (requiredStatus !== null && row.status !== requiredStatus)) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  return Response.json({
    entry: summaryOf(row, true),
    status: row.status,
    ownerUserId: row.owner_user_id,
    submitterEmail: row.submitter_email,
    submitterProvider: row.submitter_provider,
    rejectReason: row.reject_reason,
    projectText: row.project_text,
    svgText: row.svg_text,
  });
}

/**
 * One circuit of a reference dataset (#1510), under the id its importer
 * names: inserted, or replaced in place with the version it had saved. A
 * dataset's entry belongs to no account and stays public.
 */
export function importEntry(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const id = String(body.id);
  const svgText = String(body.svgText);
  const previewRevision = sha256Hex(svgText);
  const previewDimensions = svgPreviewDimensions(svgText);
  const at = String(body.at);
  const row = sql
    .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
    .toArray()[0];
  const fields = [
    String(body.name),
    String(body.author),
    String(body.description),
    Number(body.schemaVersion),
    typeof body.tags === "string" ? body.tags : "",
    String(body.projectText),
    svgText,
    Number(body.netlistable) === 1 ? 1 : 0,
    NETLIST_MARK_RULE_VERSION,
    ...countedParts(body.componentCount),
    previewRevision,
    previewDimensions?.width ?? null,
    previewDimensions?.height ?? null,
  ];
  state.storage.transactionSync(() => {
    if (row) {
      snapshotEntry(sql, row, at);
      sql.exec(
        `UPDATE gallery_entries
         SET name = ?, author = ?, description = ?, schema_version = ?,
             tags = ?, project_text = ?, svg_text = ?, netlistable = ?,
             netlistable_version = ?, component_count = ?,
             component_count_version = ?, preview_revision = ?,
             preview_width = ?, preview_height = ?, status = 'public'
         WHERE id = ?`,
        ...fields,
        id,
      );
    } else
      sql.exec(
        `INSERT INTO gallery_entries(
          name, author, description, schema_version, tags, project_text,
          svg_text, netlistable, netlistable_version, component_count,
          component_count_version, preview_revision, preview_width,
          preview_height, id, created_at, status, owner_user_id, ai_generated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', NULL, 0)`,
        ...fields,
        id,
        typeof body.createdAt === "string" ? body.createdAt : at,
      );
  });
  return Response.json({
    id,
    created: !row,
    previewRevision,
  });
}

export function replaceEntry(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const bindingError = publicationBindingError(sql, body);
  if (bindingError) return bindingError;
  const row = sql
    .exec<EntryRow>(
      "SELECT * FROM gallery_entries WHERE id = ?",
      String(body.id),
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  const svgText = String(body.svgText);
  const previewRevision = sha256Hex(svgText);
  const previewDimensions = svgPreviewDimensions(svgText);
  state.storage.transactionSync(() => {
    bindPublication(sql, body, row.id);
    snapshotEntry(sql, row, String(body.at ?? row.created_at));
    // A take-over (#1499): the entry becomes the new AI account's, and a
    // Shelf draft of the former one no longer publishes as it.
    if (typeof body.ownerUserId === "string") {
      sql.exec(
        "UPDATE gallery_entries SET owner_user_id = ? WHERE id = ?",
        body.ownerUserId,
        row.id,
      );
      sql.exec(
        `UPDATE cloud_projects SET gallery_entry_id = NULL
         WHERE gallery_entry_id = ? AND user_id <> ?`,
        row.id,
        body.ownerUserId,
      );
    }
    sql.exec(
      `UPDATE gallery_entries
       SET name = ?, author = ?, description = ?, project_text = ?,
           svg_text = ?, schema_version = ?, status = ?, tags = ?,
           netlistable = ?, netlistable_version = ?, component_count = ?,
           component_count_version = ?, preview_revision = ?,
           preview_width = ?, preview_height = ?, curation_json = ?,
           ai_generated = COALESCE(?, ai_generated)
       WHERE id = ?`,
      String(body.name),
      String(body.author),
      String(body.description),
      String(body.projectText),
      svgText,
      Number(body.schemaVersion),
      String(body.status),
      typeof body.tags === "string" ? body.tags : "",
      Number(body.netlistable) === 1 ? 1 : 0,
      NETLIST_MARK_RULE_VERSION,
      ...countedParts(body.componentCount),
      previewRevision,
      previewDimensions?.width ?? null,
      previewDimensions?.height ?? null,
      advanceCurationRevision(row, String(body.at ?? row.created_at)),
      typeof body.aiGenerated === "boolean" ? Number(body.aiGenerated) : null,
      row.id,
    );
  });
  return Response.json({
    id: row.id,
    status: String(body.status),
    previewRevision,
  });
}

/** The day's allowance, counted as a submission counts it. */
export function quota(
  sql: SqlStorage,
  ownerUserId: string,
  day: string,
): Response {
  return Response.json({ used: submissionsOn(sql, ownerUserId, day) });
}

/** An account's entries created on a UTC day, the bin's excepted. */
function submissionsOn(
  sql: SqlStorage,
  ownerUserId: string,
  day: string,
): number {
  return Number(
    sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM gallery_entries
         WHERE owner_user_id = ? AND substr(created_at, 1, 10) = ?
           AND status <> 'recycled'`,
        ownerUserId,
        day,
      )
      .one().count,
  );
}

/** Entries as their owner sees them: hidden ones too, and why. */
function ownedEntries(rows: readonly EntryRow[]): Response {
  return Response.json({
    entries: rows.map((row) => ({
      ...summaryOf(row),
      status: row.status,
      rejectReason: row.reject_reason,
      // When it was withdrawn. Not a deadline: nothing expires by time.
      recycledAt: row.recycled_at,
    })),
  });
}

export function mine(sql: SqlStorage, ownerUserId: string): Response {
  return ownedEntries(
    sql
      .exec<EntryRow>(
        `SELECT * FROM gallery_entries WHERE owner_user_id = ?
         ORDER BY created_at DESC, id DESC`,
        ownerUserId,
      )
      .toArray(),
  );
}

/**
 * Every AI account's entries (isAiSeatEntry), as `mine` lists one account's:
 * where an AI account finds another's rejected work to redo (#1540).
 */
export function aiSeatEntries(sql: SqlStorage): Response {
  const ids = AI_SEATS.map((seat) => seat.userId);
  return ownedEntries(
    sql
      .exec<EntryRow>(
        `SELECT * FROM gallery_entries
         WHERE owner_user_id IN (${ids.map(() => "?").join(", ")})
         ORDER BY created_at DESC, id DESC`,
        ...ids,
      )
      .toArray()
      .filter((row) => isAiSeatEntry(row.owner_user_id, row.author)),
  );
}

export function updateEntry(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const row = sql
    .exec<EntryRow>(
      "SELECT * FROM gallery_entries WHERE id = ?",
      String(body.id),
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  const svgText = String(body.svgText);
  const previewRevision = sha256Hex(svgText);
  const previewDimensions = svgPreviewDimensions(svgText);
  sql.exec(
    `UPDATE gallery_entries
     SET project_text = ?, schema_version = ?, svg_text = ?,
         preview_revision = ?, preview_width = ?, preview_height = ?, curation_json = ?
     WHERE id = ?`,
    String(body.projectText),
    Number(body.schemaVersion),
    svgText,
    previewRevision,
    previewDimensions?.width ?? null,
    previewDimensions?.height ?? null,
    advanceCurationRevision(row, String(body.at ?? row.created_at)),
    String(body.id),
  );
  return Response.json({ id: row.id, previewRevision });
}
