import {
  COMPONENT_CONTENT_VERSION,
  componentPublicationContent,
  componentContentDigest,
} from "../apps/editor/src/features/user-components/component-publication-content";
import { parseSharedComponentPayload } from "../apps/editor/src/features/user-components/component-library-contract";

export type ComponentLibrarySql = {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): T[] };
};

/** Derived index only. Resumable bounded batches never rewrite historical records. */
export class ComponentPublicationIndex {
  private filling: Promise<void> | undefined;
  constructor(private readonly sql: ComponentLibrarySql) {
    sql.exec(`CREATE TABLE IF NOT EXISTS component_content_index (
      component_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, version INTEGER NOT NULL,
      digest TEXT, content TEXT, diagnostic TEXT
    ) WITHOUT ROWID`);
    sql.exec(
      "CREATE INDEX IF NOT EXISTS component_content_digest ON component_content_index(version, digest)",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS components_author_id ON components(author_id, id)",
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS component_content_progress (version INTEGER PRIMARY KEY, complete INTEGER NOT NULL, processed INTEGER NOT NULL) WITHOUT ROWID`,
    );
  }
  ensureComplete(): Promise<void> {
    if (
      this.sql
        .exec<{ complete: number }>(
          "SELECT complete FROM component_content_progress WHERE version = ?",
          COMPONENT_CONTENT_VERSION,
        )
        .toArray()[0]?.complete === 1
    )
      return Promise.resolve();
    if (!this.filling)
      this.filling = this.fill().finally(() => {
        this.filling = undefined;
      });
    return this.filling;
  }
  private async fill() {
    for (;;) {
      const rows = this.sql
        .exec<{ id: string; revision: number; definition: string }>(
          `SELECT c.id, c.revision, c.definition FROM components c LEFT JOIN component_content_index i
        ON i.component_id = c.id WHERE i.component_id IS NULL OR i.revision != c.revision OR i.version != ?
        ORDER BY c.id LIMIT 50`,
          COMPONENT_CONTENT_VERSION,
        )
        .toArray();
      if (!rows.length) {
        this.sql.exec(
          "INSERT INTO component_content_progress (version,complete,processed) VALUES (?,1,0) ON CONFLICT(version) DO UPDATE SET complete=1",
          COMPONENT_CONTENT_VERSION,
        );
        return;
      }
      for (const row of rows) {
        let content: string | null = null;
        let digest: string | null = null;
        let diagnostic: string | null = null;
        try {
          const stored = JSON.parse(row.definition);
          content = componentPublicationContent(
            parseSharedComponentPayload(
              stored?.circuit === undefined ? { definition: stored } : stored,
            ),
          );
          digest = await componentContentDigest(content);
        } catch {
          diagnostic = "Historical definition needs repair.";
        }
        this.sql.exec(
          `INSERT INTO component_content_index (component_id,revision,version,digest,content,diagnostic)
          SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM components WHERE id = ? AND revision = ?)
          ON CONFLICT(component_id) DO UPDATE SET revision=excluded.revision, version=excluded.version,
          digest=excluded.digest, content=excluded.content, diagnostic=excluded.diagnostic`,
          row.id,
          row.revision,
          COMPONENT_CONTENT_VERSION,
          digest,
          content,
          diagnostic,
          row.id,
          row.revision,
        );
      }
      this.sql.exec(
        "INSERT INTO component_content_progress (version,complete,processed) VALUES (?,0,?) ON CONFLICT(version) DO UPDATE SET processed=processed+excluded.processed",
        COMPONENT_CONTENT_VERSION,
        rows.length,
      );
    }
  }
  put(id: string, revision: number, digest: string, content: string) {
    this.sql.exec(
      `INSERT INTO component_content_index (component_id,revision,version,digest,content,diagnostic)
      VALUES (?,?,?,?,?,NULL) ON CONFLICT(component_id) DO UPDATE SET revision=excluded.revision,
      version=excluded.version, digest=excluded.digest, content=excluded.content, diagnostic=NULL`,
      id,
      revision,
      COMPONENT_CONTENT_VERSION,
      digest,
      content,
    );
  }
  matches(id: string, content: string): boolean {
    return (
      this.sql
        .exec<{ content: string }>(
          "SELECT content FROM component_content_index WHERE component_id = ? AND version = ?",
          id,
          COMPONENT_CONTENT_VERSION,
        )
        .toArray()[0]?.content === content
    );
  }
  duplicate(
    authorId: string,
    digest: string,
    content: string,
  ): { id: string; revision: number } | undefined {
    return this.sql
      .exec<{ id: string; revision: number }>(
        `SELECT c.id,c.revision FROM components c JOIN component_content_index i ON c.id=i.component_id
      WHERE c.author_id=? AND c.status!='deleted' AND i.version=? AND i.digest=? AND i.content=?
      ORDER BY c.created_at,c.id LIMIT 1`,
        authorId,
        COMPONENT_CONTENT_VERSION,
        digest,
        content,
      )
      .toArray()[0];
  }
}
