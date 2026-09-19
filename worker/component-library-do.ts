import type {
  SharedComponent,
  ComponentLibraryStatus,
} from "../apps/editor/src/features/user-components/component-library-contract";
import {
  publishedDefinition,
  parseSharedDefinition,
} from "../apps/editor/src/features/user-components/component-library-contract";

type Sql = {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): T[] };
};
export interface ComponentLibraryState {
  storage: { sql: Sql; transactionSync<T>(callback: () => T): T };
}
interface Row {
  id: string;
  revision: number;
  author_id: string;
  author: string;
  status: ComponentLibraryStatus;
  created_at: string;
  updated_at: string;
  definition: string;
}
const entry = (row: Row): SharedComponent => ({
  id: row.id,
  revision: row.revision,
  authorId: row.author_id,
  author: row.author,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  definition: JSON.parse(row.definition),
});

/** Separate namespace: no Gallery, account or analytics tables are touched. */
export class ComponentLibraryDO {
  private readonly sql: Sql;
  constructor(private readonly state: ComponentLibraryState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, author_id TEXT NOT NULL,
      author TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, name TEXT NOT NULL, definition TEXT NOT NULL
    ) WITHOUT ROWID`);
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS components_status_id ON components(status, id)",
    );
  }
  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname.slice(1);
    const body = (await request.json()) as Record<string, unknown>;
    if (operation === "list") {
      const limit = Math.min(
        30,
        Math.max(1, Math.floor(Number(body.limit) || 20)),
      );
      const rows = this.sql
        .exec<Row>(
          `SELECT * FROM components WHERE ${body.deleted ? "status = 'deleted'" : "status != 'deleted'"}
         AND id > ? AND instr(lower(name), lower(?)) > 0 ORDER BY id LIMIT ?`,
          String(body.cursor ?? ""),
          String(body.query ?? ""),
          limit + 1,
        )
        .toArray();
      return Response.json({
        entries: rows.slice(0, limit).map(entry),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      });
    }
    const id = String(body.id);
    if (operation === "get") {
      const row = this.sql
        .exec<Row>("SELECT * FROM components WHERE id = ?", id)
        .toArray()[0];
      return row && (row.status !== "deleted" || body.admin)
        ? Response.json({ entry: entry(row) })
        : Response.json({ error: "Component not found" }, { status: 404 });
    }
    return this.state.storage.transactionSync(() => {
      const current = this.sql
        .exec<Row>("SELECT * FROM components WHERE id = ?", id)
        .toArray()[0];
      const admin = body.admin === true;
      if (operation === "save") {
        if (
          current &&
          !admin &&
          (current.author_id !== body.userId || current.status !== "shared")
        )
          return Response.json(
            {
              error:
                "Only the author or an administrator can update this component",
            },
            { status: 403 },
          );
        if ((current?.revision ?? 0) !== body.revision)
          return Response.json(
            { error: "This component changed. Reload before saving." },
            { status: 409 },
          );
        if (current?.status === "deleted")
          return Response.json(
            { error: "Restore the component before editing it" },
            { status: 409 },
          );
        const revision = (current?.revision ?? 0) + 1;
        const definition = publishedDefinition(
          parseSharedDefinition(body.definition),
          id,
          revision,
        );
        const at = new Date().toISOString();
        const author = current?.author ?? String(body.author);
        const authorId = current?.author_id ?? String(body.userId);
        const status = current?.status ?? "shared";
        this.sql.exec(
          `INSERT INTO components (id,revision,author_id,author,status,created_at,updated_at,name,definition)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          revision=excluded.revision, updated_at=excluded.updated_at, name=excluded.name, definition=excluded.definition`,
          id,
          revision,
          authorId,
          author,
          status,
          current?.created_at ?? at,
          at,
          definition.symbol.name,
          JSON.stringify(definition),
        );
      } else if (operation === "status") {
        if (!admin)
          return Response.json(
            { error: "Administrator access required" },
            { status: 403 },
          );
        if (!current)
          return Response.json(
            { error: "Component not found" },
            { status: 404 },
          );
        if (current.revision !== body.revision)
          return Response.json(
            { error: "This component changed. Reload before managing it." },
            { status: 409 },
          );
        this.sql.exec(
          "UPDATE components SET status = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
          String(body.status),
          new Date().toISOString(),
          id,
        );
      } else return Response.json({ error: "Not found" }, { status: 404 });
      const row = this.sql
        .exec<Row>("SELECT * FROM components WHERE id = ?", id)
        .toArray()[0]!;
      return Response.json({ entry: entry(row) });
    });
  }
}
