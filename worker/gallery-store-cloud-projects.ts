// Private Cloud Projects: an account's stable Projects, their save history
// and their shelf thumbnails.

import { type DurableObjectStateLike, type SqlStorage } from "./gallery-store";

/** How many distinct private Cloud Projects one account may own. */
export const CLOUD_PROJECT_LIMIT = 20;

export interface CloudProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
  galleryEntryId: string | null;
  favorite: boolean;
}

interface CloudProjectRow {
  id: string;
  name: string;
  updated_at: string;
  revision: number;
  schema_version: number;
  gallery_entry_id: string | null;
  favorite: number;
}

function cloudGalleryTargetError(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response | null {
  if (body.galleryEntryId === undefined) return null;
  const entry = sql
    .exec<{ owner_user_id: string | null }>(
      "SELECT owner_user_id FROM gallery_entries WHERE id = ?",
      String(body.galleryEntryId),
    )
    .toArray()[0];
  if (
    !entry ||
    (body.mayEditGallery !== true && entry.owner_user_id !== body.userId)
  ) {
    return Response.json({ error: "gallery-link-forbidden" }, { status: 403 });
  }
  return null;
}

export function cloudProjectCreate(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const linkError = cloudGalleryTargetError(sql, body);
  if (linkError) return linkError;
  const userId = String(body.userId);
  const id = String(body.id);
  const galleryEntryId =
    typeof body.galleryEntryId === "string" &&
    !sql
      .exec<{ id: string }>(
        "SELECT id FROM cloud_projects WHERE user_id = ? AND gallery_entry_id = ? LIMIT 1",
        userId,
        body.galleryEntryId,
      )
      .toArray().length
      ? body.galleryEntryId
      : null;
  const count = sql
    .exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM cloud_projects WHERE user_id = ?",
      userId,
    )
    .one().count;
  if (count >= CLOUD_PROJECT_LIMIT) {
    return Response.json(
      { error: "project-limit", projects: cloudProjectRows(sql, userId) },
      { status: 409 },
    );
  }
  sql.exec(
    `INSERT INTO cloud_projects
       (id, user_id, name, created_at, updated_at, revision,
        schema_version, project_text, preview_svg, gallery_entry_id)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    id,
    userId,
    String(body.name),
    String(body.updatedAt),
    String(body.updatedAt),
    Number(body.schemaVersion),
    String(body.projectText),
    String(body.previewSvg ?? ""),
    galleryEntryId,
  );
  return Response.json(
    { project: cloudProjectSavedSummary(sql, userId, id) },
    { status: 201 },
  );
}

export function cloudProjectFavorite(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const id = String(body.id);
  const userId = String(body.userId);
  if (
    !sql
      .exec<{ id: string }>(
        "SELECT id FROM cloud_projects WHERE id = ? AND user_id = ?",
        id,
        userId,
      )
      .toArray().length
  )
    return Response.json({ error: "not-found" }, { status: 404 });
  sql.exec(
    "UPDATE cloud_projects SET favorite = ? WHERE id = ? AND user_id = ?",
    body.favorite === true ? 1 : 0,
    id,
    userId,
  );
  return Response.json({ project: cloudProjectOpenPayload(sql, userId, id) });
}

export function cloudProjectUpdate(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
  checkOnly = false,
): Response {
  const sql = state.storage.sql;
  const userId = String(body.userId);
  const id = String(body.id);
  const expectedRevision = Number(body.expectedRevision);
  const current = sql
    .exec<CloudProjectRow & { project_text: string }>(
      `SELECT id, name, updated_at, revision, schema_version, project_text, gallery_entry_id, favorite
       FROM cloud_projects WHERE id = ? AND user_id = ?`,
      id,
      userId,
    )
    .toArray()[0];
  if (!current) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  // A retried PUT whose acknowledgement was lost is already complete. This
  // gives Save idempotency without persisting browser Session records.
  if (
    current.name === String(body.name) &&
    current.schema_version === Number(body.schemaVersion) &&
    current.project_text === String(body.projectText)
  ) {
    return Response.json({
      project: cloudProjectSummary(current),
    });
  }
  if (current.revision !== expectedRevision) {
    return Response.json(
      {
        error: "revision-conflict",
        project: cloudProjectSummary(current),
      },
      { status: 409 },
    );
  }
  if (checkOnly)
    return Response.json({ status: "update-needed" }, { status: 202 });
  const nextRevision = current.revision + 1;
  state.storage.transactionSync(() => {
    sql.exec(
      `INSERT INTO cloud_project_versions
      (id, project_id, revision, name, saved_at, schema_version, project_text, preview_svg)
      SELECT id || ':' || revision, id, revision, name, updated_at, schema_version, project_text, preview_svg
      FROM cloud_projects WHERE id = ? AND user_id = ?`,
      id,
      userId,
    );
    sql.exec(
      `UPDATE cloud_projects
     SET name = ?, updated_at = ?, revision = ?, schema_version = ?,
         project_text = ?, preview_svg = ?
     WHERE id = ? AND user_id = ? AND revision = ?`,
      String(body.name),
      String(body.updatedAt),
      nextRevision,
      Number(body.schemaVersion),
      String(body.projectText),
      String(body.previewSvg ?? ""),
      id,
      userId,
      expectedRevision,
    );
    pruneCloudProjectVersions(sql, id);
  });
  return Response.json({
    project: cloudProjectSummary({
      ...current,
      name: String(body.name),
      updated_at: String(body.updatedAt),
      revision: nextRevision,
      schema_version: Number(body.schemaVersion),
    }),
  });
}

export function pruneCloudProjectVersions(
  sql: SqlStorage,
  projectId?: string,
): void {
  if (projectId !== undefined) {
    sql.exec(
      `DELETE FROM cloud_project_versions WHERE project_id = ? AND id NOT IN
      (SELECT id FROM cloud_project_versions WHERE project_id = ? ORDER BY revision DESC LIMIT 3)`,
      projectId,
      projectId,
    );
    return;
  }
  sql.exec(`DELETE FROM cloud_project_versions
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY revision DESC) AS rank
        FROM cloud_project_versions
      ) WHERE rank <= 3
    ) OR project_id NOT IN (SELECT id FROM cloud_projects)`);
}

export function cloudProjectVersions(
  sql: SqlStorage,
  userId: string,
  id: string,
  versionId: unknown,
): Response {
  const current = cloudProjectOpenPayload(sql, userId, id);
  if (!current) return Response.json({ error: "not-found" }, { status: 404 });
  if (typeof versionId === "string") {
    const version = sql
      .exec<{
        project_text: string;
        preview_svg: string;
        name: string;
        schema_version: number;
      }>(
        "SELECT * FROM cloud_project_versions WHERE project_id = ? AND id = ?",
        id,
        versionId,
      )
      .toArray()[0];
    return version
      ? Response.json({ version, currentRevision: current.revision })
      : Response.json({ error: "not-found" }, { status: 404 });
  }
  const versions = sql
    .exec<{
      id: string;
      revision: number;
      name: string;
      saved_at: string;
    }>(
      `SELECT id, revision, name, saved_at FROM cloud_project_versions
      WHERE project_id = ? ORDER BY revision DESC`,
      id,
    )
    .toArray()
    .map((row) => ({
      versionId: row.id,
      versionNo: row.revision,
      name: row.name,
      createdAt: row.saved_at,
      author: "",
      tags: [],
    }));
  return Response.json({ versions, revision: current.revision });
}

function cloudProjectSummary(row: CloudProjectRow): CloudProjectSummary {
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    revision: row.revision,
    schemaVersion: row.schema_version,
    galleryEntryId: row.gallery_entry_id ?? null,
    favorite: row.favorite === 1,
  };
}

function cloudProjectRows(
  sql: SqlStorage,
  userId: string,
): CloudProjectSummary[] {
  return sql
    .exec<CloudProjectRow>(
      `SELECT id, name, updated_at, revision, schema_version, gallery_entry_id, favorite
       FROM cloud_projects
       WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
      userId,
      CLOUD_PROJECT_LIMIT,
    )
    .toArray()
    .map((row) => cloudProjectSummary(row));
}

export function cloudProjectList(sql: SqlStorage, userId: string): Response {
  return Response.json({ projects: cloudProjectRows(sql, userId) });
}

/**
 * One shelf thumbnail. Scoped by account like every other Cloud Project
 * read: a Project id is never a capability. An empty string means the row
 * predates stored previews, and the shelf draws a placeholder instead.
 */
export function cloudProjectPreview(
  sql: SqlStorage,
  userId: string,
  id: string,
): Response {
  const row = sql
    .exec<{ preview_svg: string; revision: number }>(
      `SELECT preview_svg, revision
       FROM cloud_projects WHERE id = ? AND user_id = ?`,
      id,
      userId,
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({
    previewSvg: row.preview_svg,
    revision: row.revision,
  });
}

/**
 * Lazy backfill for shelves saved before previews existed: store the
 * rendered thumbnail only while the row still has none at the same
 * revision, so a save racing this write always wins.
 */
export function cloudProjectPreviewStore(
  sql: SqlStorage,
  userId: string,
  id: string,
  revision: number,
  previewSvg: string,
): Response {
  if (!previewSvg || !Number.isInteger(revision)) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  sql.exec(
    `UPDATE cloud_projects SET preview_svg = ?
      WHERE user_id = ? AND id = ? AND revision = ? AND preview_svg = ''`,
    previewSvg,
    userId,
    id,
    revision,
  );
  return Response.json({ ok: true });
}

function cloudProjectOpenPayload(sql: SqlStorage, userId: string, id: string) {
  const row = sql
    .exec<CloudProjectRow & { project_text: string }>(
      "SELECT * FROM cloud_projects WHERE id = ? AND user_id = ?",
      id,
      userId,
    )
    .toArray()[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    revision: row.revision,
    schemaVersion: row.schema_version,
    galleryEntryId: row.gallery_entry_id ?? null,
    favorite: row.favorite === 1,
    projectText: row.project_text,
  };
}

export function cloudProjectOpen(
  sql: SqlStorage,
  userId: string,
  id: string,
): Response {
  // Scoped by account as well as id: a Project id is never a capability.
  const project = cloudProjectOpenPayload(sql, userId, id);
  if (!project) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ project });
}

export function cloudProjectDelete(
  state: DurableObjectStateLike,
  userId: string,
  id: string,
): Response {
  const sql = state.storage.sql;
  const existing = cloudProjectOpenPayload(sql, userId, id);
  if (!existing) return Response.json({ error: "not-found" }, { status: 404 });
  state.storage.transactionSync(() => {
    sql.exec("DELETE FROM cloud_project_versions WHERE project_id = ?", id);
    sql.exec(
      "DELETE FROM cloud_projects WHERE id = ? AND user_id = ?",
      id,
      userId,
    );
  });
  return Response.json({
    deleted: id,
    projects: cloudProjectRows(sql, userId),
  });
}

function cloudProjectSavedSummary(sql: SqlStorage, userId: string, id: string) {
  const row = sql
    .exec<CloudProjectRow>(
      "SELECT id, name, updated_at, revision, schema_version, gallery_entry_id, favorite FROM cloud_projects WHERE id = ? AND user_id = ?",
      id,
      userId,
    )
    .toArray()[0];
  return row ? cloudProjectSummary(row) : null;
}
