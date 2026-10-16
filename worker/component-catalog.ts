import {
  ComponentCatalogQuerySchema,
  ComponentCatalogCursorSchema as Cursor,
  type ComponentCatalogQuery,
  type ComponentLibrarySummary,
} from "@icm/agent-adapter/component-resource";
import type { ComponentLibrarySql } from "./component-publication-index";

export interface ComponentCatalogRow {
  id: string;
  revision: number;
  author_id: string;
  author: string;
  status: "shared" | "official" | "deleted";
  created_at: string;
  updated_at: string;
  name: string;
  definition: string;
}

/** Rebuildable summaries; published packages remain the only definition authority. */
export class ComponentCatalog {
  private filling: Promise<void> | undefined;
  constructor(
    private readonly sql: ComponentLibrarySql,
    private readonly summarize: (
      row: ComponentCatalogRow,
    ) => ComponentLibrarySummary,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS component_catalog (
      id TEXT PRIMARY KEY, rank INTEGER NOT NULL, capability TEXT NOT NULL,
      author_id TEXT NOT NULL, author TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, name TEXT NOT NULL, summary TEXT NOT NULL
    ) WITHOUT ROWID`);
    sql.exec(
      "CREATE INDEX IF NOT EXISTS component_catalog_order ON component_catalog(status, rank, created_at, id)",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS component_catalog_author ON component_catalog(author_id, created_at, id)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS component_catalog_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)",
    );
    sql.exec(
      "INSERT OR IGNORE INTO component_catalog_state (id,revision) VALUES (1,0)",
    );
    for (const [event, reference] of [
      ["INSERT", "NEW"],
      ["UPDATE", "NEW"],
      ["DELETE", "OLD"],
    ] as const)
      sql.exec(`CREATE TRIGGER IF NOT EXISTS component_catalog_${event.toLowerCase()}
        AFTER ${event} ON components BEGIN
          DELETE FROM component_catalog WHERE id = ${reference}.id;
          UPDATE component_catalog_state SET revision=revision+1 WHERE id=1;
        END`);
  }
  private async ensure() {
    if (!this.filling)
      this.filling = this.fill().finally(() => {
        this.filling = undefined;
      });
    await this.filling;
  }
  private async fill() {
    for (;;) {
      const rows = this.sql
        .exec<ComponentCatalogRow>(
          `SELECT c.* FROM components c
        LEFT JOIN component_catalog i ON i.id=c.id WHERE i.id IS NULL ORDER BY c.id LIMIT 50`,
        )
        .toArray();
      if (!rows.length) return;
      for (const row of rows) {
        const summary = this.summarize(row);
        const rank =
          summary.capability === "needs-repair"
            ? 2
            : summary.capability === "symbol-only"
              ? 1
              : 0;
        this.sql.exec(
          `INSERT OR REPLACE INTO component_catalog
          (id,rank,capability,author_id,author,status,created_at,name,summary) VALUES (?,?,?,?,?,?,?,?,?)`,
          row.id,
          rank,
          summary.capability,
          row.author_id,
          row.author,
          row.status,
          row.created_at,
          summary.name,
          JSON.stringify(summary),
        );
      }
      // Yield between bounded batches; another write invalidates its own projection.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  async read(body: Record<string, unknown>): Promise<Response> {
    const parsed = ComponentCatalogQuerySchema.safeParse(body.catalog);
    if (!parsed.success)
      return Response.json(
        {
          error: "Invalid component catalog query",
          code: "COMPONENT_CATALOG_QUERY",
        },
        { status: 400 },
      );
    const catalog: ComponentCatalogQuery = parsed.data;
    const search = String(body.query ?? "")
      .trim()
      .toLowerCase();
    const identity = JSON.stringify([
      search,
      catalog.type,
      catalog.authorId ?? null,
      catalog.order,
      !!body.deleted,
    ]);
    let cursor: ReturnType<typeof Cursor.parse> | undefined;
    if (body.cursor) {
      try {
        cursor = Cursor.parse(
          JSON.parse(decodeURIComponent(String(body.cursor))),
        );
      } catch {
        return Response.json(
          {
            error: "Invalid catalog cursor; restart this query.",
            code: "COMPONENT_CATALOG_CURSOR",
          },
          { status: 400 },
        );
      }
      if (cursor.query !== identity)
        return Response.json(
          {
            error: "The cursor belongs to another query.",
            code: "COMPONENT_CATALOG_CURSOR",
          },
          { status: 400 },
        );
    }
    await this.ensure();
    const revision = this.sql
      .exec<{ revision: number }>(
        "SELECT revision FROM component_catalog_state WHERE id=1",
      )
      .toArray()[0]!.revision;
    if (cursor && cursor.revision !== revision)
      return Response.json(
        {
          error: "The component catalog changed. Restart this query.",
          code: "COMPONENT_CATALOG_CHANGED",
        },
        { status: 409 },
      );
    if (!cursor && body.ifCatalogRevision === revision)
      return Response.json({
        entries: [],
        nextCursor: null,
        catalogRevision: revision,
        notModified: true,
      });
    const where = [
      body.deleted ? "status='deleted'" : "status!='deleted'",
      "instr(lower(name), ?) > 0",
    ];
    const bindings: (string | number | null)[] = [search];
    if (catalog.type === "with-circuit") where.push("rank=0");
    else if (catalog.type !== "all") {
      where.push("capability=?");
      bindings.push(catalog.type);
    }
    const authors = this.sql
      .exec<{ authorId: string; author: string; count: number }>(
        `SELECT author_id AS authorId,
      max(author) AS author, count(*) AS count FROM component_catalog WHERE ${where.join(" AND ")}
      GROUP BY author_id ORDER BY author COLLATE NOCASE, author_id`,
        ...bindings,
      )
      .toArray();
    if (catalog.authorId) {
      where.push("author_id=?");
      bindings.push(catalog.authorId);
    }
    const timeComparison = catalog.order === "oldest" ? ">" : "<";
    if (cursor) {
      const chronological = `(created_at ${timeComparison} ? OR (created_at=? AND id>?))`;
      if (catalog.order === "circuit-first") {
        where.push(`(rank>? OR (rank=? AND ${chronological}))`);
        bindings.push(cursor.rank, cursor.rank);
      } else where.push(chronological);
      bindings.push(cursor.time, cursor.time, cursor.id);
    }
    const limit = Math.min(
      128,
      Math.max(1, Math.floor(Number(body.limit) || 20)),
    );
    const order =
      (catalog.order === "circuit-first" ? "rank ASC, " : "") +
      `created_at ${catalog.order === "oldest" ? "ASC" : "DESC"}, id ASC`;
    const rows = this.sql
      .exec<{ id: string; rank: number; created_at: string; summary: string }>(
        `SELECT id,rank,created_at,summary FROM component_catalog WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`,
        ...bindings,
        limit + 1,
      )
      .toArray();
    // Keep ordinary summaries in one bounded read. Historical metadata is
    // never truncated; one oversized row travels alone so paging progresses.
    const page: typeof rows = [];
    const encoder = new TextEncoder();
    let bytes = 2;
    for (const row of rows.slice(0, limit)) {
      const size =
        encoder.encode(row.summary).byteLength + Number(page.length > 0);
      if (page.length && bytes + size > 256 * 1024) break;
      page.push(row);
      bytes += size;
    }
    const last = page.at(-1);
    return Response.json({
      entries: page.map((row) => JSON.parse(row.summary)),
      catalogRevision: revision,
      authors,
      nextCursor:
        rows.length > page.length && last
          ? encodeURIComponent(
              JSON.stringify({
                version: 1,
                revision,
                query: identity,
                rank: last.rank,
                time: last.created_at,
                id: last.id,
              }),
            )
          : null,
    });
  }
}
