import type { ComponentLibrarySql } from "./component-publication-index";

/**
 * A component's retained definitions, kept below one replication snapshot
 * (24 MiB) together with the current row; a save past it is refused.
 */
export const COMPONENT_HISTORY_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Append-only earlier definitions; `components` stays the current authority.
 * `source_id` is the record a definition was saved on: the component itself,
 * or a record folded into it.
 */
export function installComponentVersions(sql: ComponentLibrarySql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS component_versions (
    component_id TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL,
    name TEXT NOT NULL, definition TEXT NOT NULL, saved_at TEXT NOT NULL,
    PRIMARY KEY (component_id, source_id, revision)
  ) WITHOUT ROWID`);
  sql.exec(`CREATE TRIGGER IF NOT EXISTS component_versions_cleanup
    AFTER DELETE ON components BEGIN
      DELETE FROM component_versions WHERE component_id=OLD.id;
    END`);
}

/** Bytes a component's retained definitions hold. */
export function historyBytes(sql: ComponentLibrarySql, id: string): number {
  return (
    sql
      .exec<{ bytes: number | null }>(
        "SELECT SUM(length(CAST(definition AS BLOB))) AS bytes FROM component_versions WHERE component_id=?",
        id,
      )
      .toArray()[0]?.bytes ?? 0
  );
}

export const definitionBytes = (definition: string) =>
  new TextEncoder().encode(definition).byteLength;

/** Retain one definition of `source` under `componentId`. */
export function keepVersion(
  sql: ComponentLibrarySql,
  componentId: string,
  source: {
    id: string;
    revision: number;
    name: string;
    definition: string;
    updated_at: string;
  },
) {
  sql.exec(
    `INSERT OR IGNORE INTO component_versions
    (component_id,source_id,revision,name,definition,saved_at) VALUES (?,?,?,?,?,?)`,
    componentId,
    source.id,
    source.revision,
    source.name,
    source.definition,
    source.updated_at,
  );
}

/** Version metadata only; definitions are never served from history. */
export function listVersions(sql: ComponentLibrarySql, id: string) {
  return sql
    .exec<{
      revision: number;
      source_id: string;
      name: string;
      saved_at: string;
    }>(
      `SELECT revision, source_id, name, saved_at FROM component_versions
      WHERE component_id=? ORDER BY saved_at DESC, source_id, revision DESC LIMIT 200`,
      id,
    )
    .toArray()
    .map((version) => ({
      revision: version.revision,
      sourceId: version.source_id,
      name: version.name,
      savedAt: version.saved_at,
    }));
}
