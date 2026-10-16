import { ComponentManagement } from "./component-management";
import type { SharedComponent } from "../apps/editor/src/features/user-components/component-library-contract";
import {
  publishedComponentPayload,
  parseSharedComponentPayload,
  summarizeSharedComponent,
} from "../apps/editor/src/features/user-components/component-library-contract";
import {
  componentPublicationContent,
  componentContentDigest,
} from "../apps/editor/src/features/user-components/component-publication-content";
import {
  ComponentPublicationIndex,
  type ComponentLibrarySql,
} from "./component-publication-index";
import {
  ComponentCatalog,
  type ComponentCatalogRow,
} from "./component-catalog";

export interface ComponentLibraryState {
  storage: {
    sql: ComponentLibrarySql;
    transactionSync<T>(callback: () => T): T;
  };
}
type Row = ComponentCatalogRow;
const entry = (row: Row): SharedComponent => {
  let stored;
  try {
    stored = JSON.parse(row.definition);
  } catch {
    stored = { rawSource: row.definition };
  }
  const payload =
    !stored || typeof stored !== "object" || stored.circuit === undefined
      ? { definition: stored }
      : stored;
  return {
    id: row.id,
    revision: row.revision,
    authorId: row.author_id,
    author: row.author,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...payload,
  };
};

/** Separate namespace: no Gallery, account or analytics tables are touched. */
export class ComponentLibraryDO {
  private readonly sql: ComponentLibrarySql;
  private readonly contentIndex: ComponentPublicationIndex;
  private readonly catalog: ComponentCatalog;
  private readonly management: ComponentManagement;
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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS component_write_receipts (
      user_id TEXT NOT NULL, request_key TEXT NOT NULL, component_id TEXT NOT NULL,
      request_digest TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, request_key)
    ) WITHOUT ROWID`);
    this.management = new ComponentManagement(this.sql);
    this.contentIndex = new ComponentPublicationIndex(this.sql);
    this.catalog = new ComponentCatalog(this.sql, (row) =>
      summarizeSharedComponent(this.entry(row)),
    );
  }
  private entry(row: Row): SharedComponent {
    const deletion = this.management.deletion(row);
    return { ...entry(row), ...(deletion ? { deletion } : {}) };
  }
  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname.slice(1);
    const body = (await request.json()) as Record<string, unknown>;
    const digest =
      operation === "save" && body.idempotencyKey
        ? [
            ...new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(
                  JSON.stringify({
                    id: body.id,
                    revision: body.revision,
                    definition: body.definition,
                    circuit: body.circuit,
                  }),
                ),
              ),
            ),
          ]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("")
        : null;
    if (operation === "list") {
      if (body.catalog) return this.catalog.read(body);
      const limit = Math.min(
        30,
        Math.max(1, Math.floor(Number(body.limit) || 20)),
      );
      const rows = this.sql
        .exec<Row>(
          `SELECT * FROM components WHERE ${body.deleted ? "status = 'deleted'" : "status != 'deleted'"}
         AND (? IS NULL OR author_id=?) AND id > ? AND instr(lower(name), lower(?)) > 0 ORDER BY id LIMIT ?`,
          body.ownerOnly ? String(body.userId) : null,
          body.ownerOnly ? String(body.userId) : null,
          String(body.cursor ?? ""),
          String(body.query ?? ""),
          limit + 1,
        )
        .toArray();
      return Response.json({
        entries: rows
          .slice(0, limit)
          .map((row) =>
            body.summary
              ? summarizeSharedComponent(this.entry(row))
              : this.entry(row),
          ),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      });
    }
    if (operation === "delete-author") {
      // Deleting an account takes the components its author shared.
      const authorId = String(body.userId);
      return this.state.storage.transactionSync(() => {
        const ids = this.sql
          .exec<{
            id: string;
          }>("SELECT id FROM components WHERE author_id = ?", authorId)
          .toArray();
        this.sql.exec(
          "DELETE FROM component_content_index WHERE component_id IN (SELECT id FROM components WHERE author_id = ?)",
          authorId,
        );
        this.sql.exec("DELETE FROM components WHERE author_id = ?", authorId);
        this.sql.exec(
          "DELETE FROM component_write_receipts WHERE user_id = ?",
          authorId,
        );
        return Response.json({ deleted: ids.length });
      });
    }
    const id = String(body.id);
    if (operation === "get") {
      const row = this.sql
        .exec<Row>("SELECT * FROM components WHERE id = ?", id)
        .toArray()[0];
      if (
        row &&
        (row.status !== "deleted" ||
          body.admin ||
          row.author_id === body.userId) &&
        (body.preview || body.identity)
      ) {
        if (row.revision !== body.revision)
          return Response.json(
            { error: "This component changed. Refresh before selecting it." },
            { status: 409 },
          );
        if (body.identity)
          return Response.json({
            id: row.id,
            revision: row.revision,
            status: row.status,
          });
        try {
          const { definition, circuit } = this.entry(row);
          const parsed = parseSharedComponentPayload({
            definition,
            ...(circuit ? { circuit } : {}),
          });
          return Response.json({
            id: row.id,
            revision: row.revision,
            symbol: parsed.definition.symbol,
          });
        } catch {
          return Response.json(
            { error: "This component needs repair." },
            { status: 422 },
          );
        }
      }
      return row &&
        (row.status !== "deleted" ||
          body.admin ||
          row.author_id === body.userId)
        ? Response.json({ entry: this.entry(row) })
        : Response.json({ error: "Component not found" }, { status: 404 });
    }
    const incomingContent =
      operation === "save"
        ? componentPublicationContent(
            parseSharedComponentPayload({
              definition: body.definition,
              ...(body.circuit === undefined ? {} : { circuit: body.circuit }),
            }),
          )
        : null;
    const incomingDigest =
      incomingContent === null
        ? null
        : await componentContentDigest(incomingContent);
    if (operation === "save") await this.contentIndex.ensureComplete();
    return this.state.storage.transactionSync(() => {
      const current = this.sql
        .exec<Row>("SELECT * FROM components WHERE id = ?", id)
        .toArray()[0];
      const admin = body.admin === true;
      const respond = (response: object, status = 200) => {
        if (operation === "save" && digest)
          this.sql.exec(
            "INSERT INTO component_write_receipts (user_id, request_key, component_id, request_digest, response_json, created_at) VALUES (?,?,?,?,?,?)",
            String(body.userId),
            String(body.idempotencyKey),
            id,
            digest,
            JSON.stringify({ status, body: response }),
            new Date().toISOString(),
          );
        return Response.json(response, { status });
      };
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
        if (digest) {
          this.sql.exec(
            "DELETE FROM component_write_receipts WHERE created_at < ?",
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          );
          const receipt = this.sql
            .exec<{
              component_id: string;
              request_digest: string;
              response_json: string;
            }>(
              "SELECT component_id, request_digest, response_json FROM component_write_receipts WHERE user_id = ? AND request_key = ?",
              String(body.userId),
              String(body.idempotencyKey),
            )
            .toArray()[0];
          if (receipt) {
            if (
              receipt.component_id !== id ||
              receipt.request_digest !== digest
            )
              return Response.json(
                {
                  error:
                    "This idempotency key belongs to a different component write.",
                },
                { status: 409 },
              );
            if (current?.status === "deleted")
              return Response.json(
                { error: "Restore the component before editing it" },
                { status: 409 },
              );
            const recovered = JSON.parse(receipt.response_json);
            return Response.json(recovered.body ?? recovered, {
              status: recovered.status ?? 200,
              headers: { "x-component-write-recovered": "true" },
            });
          }
        }
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
        if (!current) {
          const existing = this.contentIndex.duplicate(
            String(body.userId),
            incomingDigest!,
            incomingContent!,
          );
          if (existing)
            return respond(
              {
                error:
                  "Already published. Use the existing component or change this definition.",
                code: "COMPONENT_ALREADY_PUBLISHED",
                existing,
              },
              409,
            );
        } else if (this.contentIndex.matches(id, incomingContent!)) {
          return respond({ entry: this.entry(current), outcome: "unchanged" });
        }
        const revision = (current?.revision ?? 0) + 1;
        const payload = publishedComponentPayload(
          parseSharedComponentPayload({
            definition: body.definition,
            ...(body.circuit === undefined ? {} : { circuit: body.circuit }),
          }),
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
          payload.definition.symbol.name,
          JSON.stringify(payload.circuit ? payload : payload.definition),
        );
        this.contentIndex.put(id, revision, incomingDigest!, incomingContent!);
      } else if (operation === "status") {
        const result = this.management.apply(current, body);
        if (result instanceof Response) return result;
        if (result === "unchanged")
          return respond({ entry: this.entry(current!), outcome: "unchanged" });
      } else return Response.json({ error: "Not found" }, { status: 404 });
      const row = this.sql
        .exec<Row>("SELECT * FROM components WHERE id = ?", id)
        .toArray()[0]!;
      return respond({
        entry: this.entry(row),
        ...(operation === "save"
          ? { outcome: current ? "updated" : "created" }
          : {}),
      });
    });
  }
}
