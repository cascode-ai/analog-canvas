import { ComponentManagement } from "./component-management";
import {
  ComponentMaintenance,
  readConsolidationRequest,
} from "./component-maintenance";
import { locallyOwnedResources } from "./resource-ownership";
import {
  COMPONENT_HISTORY_MAX_BYTES,
  definitionBytes,
  historyBytes,
  installComponentVersions,
  keepVersion,
  listVersions,
} from "./component-versions";
import {
  installRetiredAccounts,
  retireAccount,
  retiredAccount,
  validAccountId,
} from "./retired-accounts";
import type { SharedComponent } from "../apps/editor/src/features/user-components/component-library-contract";
import {
  HIDDEN_COMPONENT_STATUSES,
  componentNameKey,
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
    ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...payload,
  };
};
/** Statuses a public catalog or legacy list shows. */
const PUBLIC_STATUSES = "status IN ('shared','official')";

/** Separate namespace: no Gallery, account or analytics tables are touched. */
export class ComponentLibraryDO {
  private readonly sql: ComponentLibrarySql;
  private readonly contentIndex: ComponentPublicationIndex;
  private readonly catalog: ComponentCatalog;
  private readonly management: ComponentManagement;
  private readonly maintenance: ComponentMaintenance;
  constructor(
    private readonly state: ComponentLibraryState,
    _env?: unknown,
  ) {
    this.sql = state.storage.sql;
    installRetiredAccounts(this.sql);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, author_id TEXT NOT NULL,
      author TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, name TEXT NOT NULL, definition TEXT NOT NULL
    ) WITHOUT ROWID`);
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS components_status_id ON components(status, id)",
    );
    // Additive: the record a superseded record was folded into.
    try {
      this.sql.exec("ALTER TABLE components ADD COLUMN superseded_by TEXT");
    } catch {
      // Present already.
    }
    installComponentVersions(this.sql);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS component_write_receipts (
      user_id TEXT NOT NULL, request_key TEXT NOT NULL, component_id TEXT NOT NULL,
      request_digest TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, request_key)
    ) WITHOUT ROWID`);
    // Regional receipts keep only the committed revision, never another copy of a definition.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS component_regional_receipts (
      user_id TEXT NOT NULL, command_id TEXT NOT NULL, binding TEXT NOT NULL,
      component_id TEXT NOT NULL, revision INTEGER NOT NULL, outcome TEXT,
      PRIMARY KEY(user_id,command_id)
    ) WITHOUT ROWID`);
    this.management = new ComponentManagement(this.sql);
    this.maintenance = new ComponentMaintenance(
      this.sql,
      (fn) => state.storage.transactionSync(fn),
      this.management,
      () =>
        new Set(
          this.sql
            .exec<{
              id: string;
            }>(
              `SELECT id FROM components WHERE NOT (${locallyOwnedResources(this.sql)})`,
            )
            .toArray()
            .map((row) => row.id),
        ),
    );
    this.contentIndex = new ComponentPublicationIndex(this.sql);
    this.catalog = new ComponentCatalog(this.sql, (row) =>
      summarizeSharedComponent(this.entry(row)),
    );
  }
  private entry(row: Row): SharedComponent {
    const deletion = this.management.deletion(row);
    return { ...entry(row), ...(deletion ? { deletion } : {}) };
  }
  /** Private, superseded and deleted records are visible only to their author and administrators. */
  private visible(row: Row, reader: Record<string, unknown>): boolean {
    return (
      !HIDDEN_COMPONENT_STATUSES.includes(row.status) ||
      reader.admin === true ||
      row.author_id === reader.userId
    );
  }
  /** One revision-bound preview symbol, or why it cannot be shown. */
  private preview(
    id: string,
    revision: number,
    reader: Record<string, unknown>,
  ) {
    const row = this.sql
      .exec<Row>("SELECT * FROM components WHERE id = ?", id)
      .toArray()[0];
    if (!row || !this.visible(row, reader))
      return { id, revision, error: "Component not found", status: 404 };
    if (row.revision !== revision)
      return {
        id,
        revision,
        error: "This component changed. Refresh before selecting it.",
        status: 409,
      };
    try {
      const { definition, circuit } = this.entry(row);
      const parsed = parseSharedComponentPayload({
        definition,
        ...(circuit ? { circuit } : {}),
      });
      return { id, revision, symbol: parsed.definition.symbol };
    } catch {
      return {
        id,
        revision,
        error: "This component needs repair.",
        status: 422,
      };
    }
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
                    // Absent for older writers, whose digests stay the same.
                    ...(body.visibility ? { visibility: body.visibility } : {}),
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
          `SELECT * FROM components WHERE ${body.deleted ? "status = 'deleted'" : PUBLIC_STATUSES}
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
    if (operation === "delete-author" || operation === "retire-account") {
      // Deleting an account takes the components its author shared.
      const authorId = String(body.userId);
      if (operation === "retire-account" && !validAccountId(body.userId))
        return Response.json({ error: "invalid-user" }, { status: 400 });
      return this.state.storage.transactionSync(() => {
        if (operation === "retire-account") {
          retireAccount(this.sql, authorId);
          this.sql.exec(
            `DELETE FROM component_lifecycle WHERE component_id IN
            (SELECT id FROM components WHERE author_id=?)`,
            authorId,
          );
        }
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
        this.sql.exec(
          "DELETE FROM component_regional_receipts WHERE user_id = ?",
          authorId,
        );
        return Response.json({ deleted: ids.length });
      });
    }
    if (retiredAccount(this.sql, body.userId))
      return Response.json({ error: "account-deleted" }, { status: 403 });
    if (operation === "previews")
      return Response.json({
        previews: (body.items as { id: string; revision: number }[]).map(
          ({ id, revision }) => this.preview(id, revision, body),
        ),
      });
    if (operation === "same-name") {
      // The signed-in author's own editable records of one component name.
      if (typeof body.userId !== "string")
        return Response.json(
          { error: "Sign in to find your components" },
          { status: 401 },
        );
      const key = componentNameKey(String(body.name ?? ""));
      return Response.json({
        entries: this.sql
          .exec<
            Pick<Row, "id" | "revision" | "status" | "name" | "updated_at">
          >(
            `SELECT id,revision,status,name,updated_at FROM components
            WHERE author_id=? AND status IN ('shared','private') ORDER BY updated_at DESC, id`,
            body.userId,
          )
          .toArray()
          .filter((row) => key && componentNameKey(row.name) === key)
          .map((row) => ({
            id: row.id,
            revision: row.revision,
            status: row.status,
            name: row.name,
            updatedAt: row.updated_at,
          })),
      });
    }
    if (operation === "consolidate") {
      if (body.admin !== true)
        return Response.json(
          { error: "Only an administrator can consolidate components" },
          { status: 403 },
        );
      const parsed = readConsolidationRequest(body);
      if (typeof parsed === "string")
        return Response.json({ error: parsed }, { status: 400 });
      const result = this.maintenance.run(parsed, String(body.userId));
      return Response.json(result, { status: "code" in result ? 409 : 200 });
    }
    const id = String(body.id);
    if (operation === "get") {
      if (body.versions) {
        const row = this.sql
          .exec<Row>("SELECT * FROM components WHERE id = ?", id)
          .toArray()[0];
        if (!row || !this.visible(row, body))
          return Response.json(
            { error: "Component not found" },
            { status: 404 },
          );
        return Response.json({
          id: row.id,
          revision: row.revision,
          versions: listVersions(this.sql, id),
        });
      }
      if (body.preview) {
        const preview = this.preview(id, Number(body.revision), body);
        return "symbol" in preview
          ? Response.json(preview)
          : Response.json({ error: preview.error }, { status: preview.status });
      }
      const row = this.sql
        .exec<Row>("SELECT * FROM components WHERE id = ?", id)
        .toArray()[0];
      if (row && this.visible(row, body) && body.identity) {
        if (row.revision !== body.revision)
          return Response.json(
            { error: "This component changed. Refresh before selecting it." },
            { status: 409 },
          );
        return Response.json({
          id: row.id,
          revision: row.revision,
          status: row.status,
        });
      }
      return row && this.visible(row, body)
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
      const command = body.regionalCommand as
        { id: string; binding: string } | undefined;
      if (command) {
        if (current && !admin && current.author_id !== body.userId)
          return Response.json(
            {
              error:
                "Only the author or an administrator can manage this component",
            },
            { status: 403 },
          );
        const previous = this.sql
          .exec<{
            binding: string;
            component_id: string;
            revision: number;
            outcome: string | null;
          }>(
            "SELECT * FROM component_regional_receipts WHERE user_id=? AND command_id=?",
            String(body.userId),
            command.id,
          )
          .toArray()[0];
        if (previous) {
          if (
            previous.binding !== command.binding ||
            previous.component_id !== id
          )
            return Response.json({ error: "command-reused" }, { status: 409 });
          if (!current)
            return Response.json(
              { error: "Component not found" },
              { status: 404 },
            );
          return Response.json(
            {
              entry: this.entry(current),
              ...(previous.outcome ? { outcome: previous.outcome } : {}),
            },
            {
              headers: {
                "x-regional-command-superseded": String(
                  current.revision !== previous.revision,
                ),
              },
            },
          );
        }
        if (
          this.sql
            .exec<{ n: number }>(
              "SELECT COUNT(*) AS n FROM component_regional_receipts WHERE user_id=?",
              String(body.userId),
            )
            .toArray()[0]!.n >= 10000
        )
          return Response.json(
            { error: "command-receipts-full" },
            { status: 503 },
          );
      }
      const respond = (response: object, status = 200) => {
        if (command && status >= 200 && status < 300) {
          const result = response as {
            entry: { revision: number };
            outcome?: string;
          };
          this.sql.exec(
            "INSERT INTO component_regional_receipts VALUES (?,?,?,?,?,?)",
            String(body.userId),
            command.id,
            command.binding,
            id,
            result.entry.revision,
            result.outcome ?? null,
          );
        }
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
          current?.status === "superseded" &&
          (admin || current.author_id === body.userId)
        )
          return Response.json(
            {
              error:
                "This component was merged into another record. Edit that record instead.",
              code: "COMPONENT_SUPERSEDED",
              supersededBy: current.superseded_by,
            },
            { status: 409 },
          );
        if (
          current &&
          !admin &&
          (current.author_id !== body.userId ||
            (current.status !== "shared" && current.status !== "private"))
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
        }
        // Without visibility a save keeps its record where it is, and a new
        // record is public, as for older writers. Official stays official.
        const status =
          current?.status === "official"
            ? "official"
            : body.visibility === "private"
              ? "private"
              : body.visibility === "public"
                ? "shared"
                : (current?.status ?? "shared");
        const contentChanged =
          !current || !this.contentIndex.matches(id, incomingContent!);
        if (current && !contentChanged && status === current.status)
          return respond({ entry: this.entry(current), outcome: "unchanged" });
        if (current && contentChanged) {
          if (
            historyBytes(this.sql, id) + definitionBytes(current.definition) >
            COMPONENT_HISTORY_MAX_BYTES
          )
            return Response.json(
              {
                error:
                  "This component's version history is full. Save as a new component instead.",
                code: "COMPONENT_HISTORY_FULL",
              },
              { status: 409 },
            );
          // The replaced definition stays a version; captures name its revision.
          keepVersion(this.sql, id, current);
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
        this.sql.exec(
          `INSERT INTO components (id,revision,author_id,author,status,created_at,updated_at,name,definition)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          revision=excluded.revision, status=excluded.status, updated_at=excluded.updated_at,
          name=excluded.name, definition=excluded.definition`,
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
