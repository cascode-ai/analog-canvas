import type { SqlStorage } from "./gallery-store";

/** Track only edits to a copied Project that still uses the legacy save path. */
export function installProjectBaseline(
  sql: SqlStorage,
  copyUsers: string[] | null,
): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS project_baseline_cohort (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), users TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS project_baseline_dirty (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL
  ) WITHOUT ROWID`);
  for (const [event, row] of [
    [
      "UPDATE OF user_id,name,updated_at,revision,schema_version,project_text,gallery_entry_id,favorite",
      "NEW",
    ],
    ["DELETE", "OLD"],
  ] as const) {
    sql.exec(`CREATE TRIGGER IF NOT EXISTS project_baseline_${event.split(" ")[0]!.toLowerCase()}
      AFTER ${event} ON cloud_projects
      WHEN EXISTS (SELECT 1 FROM regional_project_heads WHERE id = ${row}.id)
        AND EXISTS (
          SELECT 1 FROM project_baseline_cohort
          WHERE NOT EXISTS (SELECT 1 FROM json_each(users) WHERE value = ${row}.user_id)
        )
      BEGIN
        INSERT INTO project_baseline_dirty VALUES (${row}.id, ${row}.user_id)
        ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id;
      END`);
  }
  if (copyUsers === null) {
    sql.exec("DELETE FROM project_baseline_cohort");
  } else {
    sql.exec(
      "INSERT OR REPLACE INTO project_baseline_cohort VALUES (1, ?)",
      JSON.stringify(copyUsers),
    );
  }
}
