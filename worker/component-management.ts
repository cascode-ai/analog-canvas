import type { ComponentLibrarySql } from "./component-publication-index";
import type { ComponentCatalogRow } from "./component-catalog";

type History = {
  deleted_by: "author" | "admin";
  previous_status: "shared" | "official";
  actor: string;
  action: string;
  from_revision: number;
  to_revision: number;
};

/** Lifecycle authority; works without parsing the published circuit. */
export class ComponentManagement {
  constructor(private readonly sql: ComponentLibrarySql) {
    sql.exec(`CREATE TABLE IF NOT EXISTS component_lifecycle (
      component_id TEXT PRIMARY KEY, deleted_by TEXT NOT NULL,
      previous_status TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
      from_revision INTEGER NOT NULL, to_revision INTEGER NOT NULL
    ) WITHOUT ROWID`);
    sql.exec(`CREATE TRIGGER IF NOT EXISTS component_lifecycle_cleanup
      AFTER DELETE ON components BEGIN
        DELETE FROM component_lifecycle WHERE component_id=OLD.id;
      END`);
  }
  private history(id: string) {
    return this.sql
      .exec<History>(
        "SELECT * FROM component_lifecycle WHERE component_id=?",
        id,
      )
      .toArray()[0];
  }
  deletion(row: ComponentCatalogRow) {
    if (row.status !== "deleted") return undefined;
    const history = this.history(row.id);
    return {
      by: history?.deleted_by ?? "admin",
      previousStatus: history?.previous_status ?? "shared",
    } as const;
  }
  /** Called inside the owner's storage transaction. */
  apply(
    row: ComponentCatalogRow | undefined,
    body: Record<string, unknown>,
  ): Response | "unchanged" | "changed" {
    const refuse = (status: number, error: string, code: string) =>
      Response.json({ error, code }, { status });
    if (!row) return refuse(404, "Component not found", "COMPONENT_NOT_FOUND");
    const history = this.history(row.id);
    const action =
      body.action === "restore"
        ? "restore"
        : body.action === "delete" || body.status === "deleted"
          ? "delete"
          : String(body.status);
    const admin = body.admin === true;
    if (
      !admin &&
      (row.author_id !== body.userId || !["delete", "restore"].includes(action))
    )
      return refuse(
        403,
        "Only the author or an administrator can manage this component",
        "COMPONENT_FORBIDDEN",
      );
    if (
      !admin &&
      action === "restore" &&
      row.status === "deleted" &&
      history?.deleted_by !== "author"
    )
      return refuse(
        403,
        "Only an administrator can restore this removed component",
        "COMPONENT_RESTORE_FORBIDDEN",
      );
    if (
      history &&
      history.actor === body.userId &&
      history.action === action &&
      history.from_revision === body.revision &&
      history.to_revision === row.revision
    )
      return "unchanged";
    if (row.revision !== body.revision)
      return refuse(
        409,
        "This component changed. Refresh before managing it.",
        "COMPONENT_REVISION_CONFLICT",
      );
    if (
      (action === "delete" && row.status === "deleted") ||
      (action === "restore" && row.status !== "deleted")
    )
      return "unchanged";
    const status =
      action === "delete"
        ? "deleted"
        : action === "restore"
          ? (history?.previous_status ?? "shared")
          : action;
    if (!["deleted", "official", "shared"].includes(status))
      return refuse(
        400,
        "Invalid component status",
        "COMPONENT_STATUS_INVALID",
      );
    const previous =
      row.status === "deleted"
        ? (history?.previous_status ?? "shared")
        : row.status;
    this.sql.exec(
      `INSERT OR REPLACE INTO component_lifecycle
      (component_id,deleted_by,previous_status,actor,action,from_revision,to_revision) VALUES (?,?,?,?,?,?,?)`,
      row.id,
      action === "delete"
        ? admin
          ? "admin"
          : "author"
        : (history?.deleted_by ?? "admin"),
      previous,
      String(body.userId),
      action,
      row.revision,
      row.revision + 1,
    );
    this.sql.exec(
      "UPDATE components SET status=?, revision=revision+1, updated_at=? WHERE id=?",
      status,
      new Date().toISOString(),
      row.id,
    );
    this.sql.exec(
      "UPDATE component_content_index SET revision=revision+1 WHERE component_id=?",
      row.id,
    );
    return "changed";
  }
}
