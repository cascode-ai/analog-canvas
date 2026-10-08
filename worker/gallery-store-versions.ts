// An entry's version history: the snapshot each write keeps, its retention,
// and reading and restoring a version.

import { galleryComponentCount } from "./gallery-components";
import { readGalleryCuration, type GalleryCuration } from "./gallery-curation";
import { sha256Hex } from "@icm/derived";
import { designExtractsNetlist, NETLIST_MARK_RULE_VERSION } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { type CircuitProject } from "@icm/model";
import {
  type DurableObjectStateLike,
  type EntryRow,
  type SqlStorage,
  countedParts,
  shortId,
  svgPreviewDimensions,
  unwrapTags,
} from "./gallery-store";

/** How many previous states each Gallery entry retains. */
const GALLERY_MAX_VERSIONS_PER_ENTRY = 3;

/** Enforce retention by count, even for imported rows with sparse versions. */
export function pruneGalleryEntryVersions(
  sql: SqlStorage,
  entryId?: string,
): void {
  const entryFilter = entryId === undefined ? "" : "WHERE entry_id = ?";
  sql.exec(
    `DELETE FROM gallery_entry_versions
     WHERE id IN (
       SELECT id FROM (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY entry_id
                  ORDER BY version_no DESC, id DESC
                ) AS retention_rank
         FROM gallery_entry_versions
         ${entryFilter}
       )
       WHERE retention_rank > ?
     )`,
    ...(entryId === undefined ? [] : [entryId]),
    GALLERY_MAX_VERSIONS_PER_ENTRY,
  );
}

export function deleteOrphanGalleryData(sql: SqlStorage): void {
  sql.exec(
    `DELETE FROM gallery_entry_versions
     WHERE entry_id NOT IN (SELECT id FROM gallery_entries)`,
  );
  sql.exec(
    `DELETE FROM gallery_likes
     WHERE entry_id NOT IN (SELECT id FROM gallery_entries)`,
  );
}

/** Owner/reviewer edit (phase G3): new content, possibly new status. */
/** Version-history snapshot of the entry's current state (pre-write). */
export function snapshotEntry(
  sql: SqlStorage,
  row: EntryRow,
  at: string,
): void {
  const lastVersion =
    sql
      .exec<{ v: number | null }>(
        "SELECT MAX(version_no) AS v FROM gallery_entry_versions WHERE entry_id = ?",
        row.id,
      )
      .toArray()[0]?.v ?? 0;
  sql.exec(
    `INSERT INTO gallery_entry_versions(
      id, entry_id, version_no, name, author, description, tags,
      schema_version, project_text, svg_text, created_at, curation_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    shortId(),
    row.id,
    lastVersion + 1,
    row.name,
    row.author,
    row.description,
    row.tags ?? "",
    row.schema_version,
    row.project_text,
    row.svg_text,
    at,
    row.curation_json ?? "",
  );
  pruneGalleryEntryVersions(sql, row.id);
}

export function versions(sql: SqlStorage, entryId: string): Response {
  const rows = sql
    .exec<{
      id: string;
      version_no: number;
      name: string;
      author: string;
      tags: string | null;
      created_at: string;
    }>(
      `SELECT id, version_no, name, author, tags, created_at
       FROM gallery_entry_versions WHERE entry_id = ?
       ORDER BY version_no DESC`,
      entryId,
    )
    .toArray();
  return Response.json({
    versions: rows.map((row) => ({
      versionId: row.id,
      versionNo: row.version_no,
      name: row.name,
      author: row.author,
      tags: unwrapTags(row.tags),
      createdAt: row.created_at,
    })),
  });
}

export function version(
  sql: SqlStorage,
  entryId: string,
  versionId: string,
): Response {
  const row = sql
    .exec<{
      id: string;
      name: string;
      author: string;
      description: string;
      tags: string | null;
      schema_version: number;
      project_text: string;
      svg_text: string;
    }>(
      `SELECT * FROM gallery_entry_versions
       WHERE entry_id = ? AND id = ?`,
      entryId,
      versionId,
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({
    name: row.name,
    author: row.author,
    description: row.description,
    tags: unwrapTags(row.tags),
    schemaVersion: row.schema_version,
    projectText: row.project_text,
    svgText: row.svg_text,
  });
}

/** Restore = snapshot the current state, then adopt the version. */
export function restoreVersion(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const entry = sql
    .exec<EntryRow>(
      "SELECT * FROM gallery_entries WHERE id = ?",
      String(body.entryId),
    )
    .toArray()[0];
  const version = sql
    .exec<{
      name: string;
      author: string;
      description: string;
      tags: string | null;
      curation_json: string;
      schema_version: number;
      project_text: string;
      svg_text: string;
    }>(
      "SELECT * FROM gallery_entry_versions WHERE entry_id = ? AND id = ?",
      String(body.entryId),
      String(body.versionId),
    )
    .toArray()[0];
  if (!entry || !version) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  let restoredProject: CircuitProject;
  try {
    restoredProject = parseProject(version.project_text);
  } catch (error) {
    return Response.json(
      {
        error: "invalid-version-project",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 409 },
    );
  }
  const restoredProjectText = serializeProject(restoredProject);
  const netlistable = designExtractsNetlist(restoredProject) ? 1 : 0;
  const previewRevision = sha256Hex(version.svg_text);
  const previewDimensions = svgPreviewDimensions(version.svg_text);
  const restoredCuration = readGalleryCuration(version.curation_json);
  const restoredReview: GalleryCuration = {
    attention: restoredCuration?.attention ?? null,
    revision: (readGalleryCuration(entry.curation_json)?.revision ?? 0) + 1,
    assessedPreviewRevision:
      restoredCuration?.assessedPreviewRevision ?? previewRevision,
    updatedAt: String(body.at),
    updatedBy: String(body.reviewerId ?? ""),
    source: "manual",
  };
  state.storage.transactionSync(() => {
    snapshotEntry(sql, entry, String(body.at));
    sql.exec(
      `UPDATE gallery_entries
       SET name = ?, author = ?, description = ?, project_text = ?,
           svg_text = ?, schema_version = ?, tags = ?, netlistable = ?,
           netlistable_version = ?, component_count = ?,
           component_count_version = ?, preview_revision = ?,
           preview_width = ?, preview_height = ?, curation_json = ?
       WHERE id = ?`,
      version.name,
      entry.author,
      version.description,
      restoredProjectText,
      version.svg_text,
      restoredProject.schemaVersion,
      version.tags ?? "",
      netlistable,
      NETLIST_MARK_RULE_VERSION,
      ...countedParts(galleryComponentCount(restoredProject)),
      previewRevision,
      previewDimensions?.width ?? null,
      previewDimensions?.height ?? null,
      JSON.stringify(restoredReview),
      entry.id,
    );
  });
  return Response.json({ id: entry.id, restored: true, previewRevision });
}
