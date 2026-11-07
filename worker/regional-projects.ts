import type { DurableObjectStateLike, SqlStorage } from "./gallery-store";
import { sha256Hex } from "@icm/derived";
import {
  ProjectSyncJournal,
  ProjectSyncCapacityError,
  ProjectSyncFenceError,
} from "./project-sync-journal";
import { decodeProjectEvent } from "./project-sync-protocol";
import { ProjectQuota } from "./project-quota";
import {
  projectRegionUsers,
  protectedProjectIds,
} from "./project-region-scope";
import { submit, replaceEntry } from "./gallery-store-entries";
import {
  cloudProjectCreate,
  cloudProjectDelete,
  cloudProjectFavorite,
  cloudProjectList,
  cloudProjectOpen,
  cloudProjectSavedSummary,
  cloudProjectPreview,
  cloudProjectPreviewStore,
  cloudProjectUpdate,
  cloudProjectVersions,
} from "./gallery-store-cloud-projects";

export interface ProjectRegionConfig {
  PROJECT_REGION: "cn" | "overseas";
  PROJECT_REGION_USERS?: string;
  PROJECT_PROTECTED_IDS?: string;
  PROJECT_SYNC_MAX_BYTES?: number | string;
}

class ProjectCreationRefused extends Error {
  constructor(readonly response: Response) {
    super("Project creation was definitely refused");
  }
}

/** The source alerts when the private region has not pulled for this long. */
export const WATCHDOG_STALE_MS = 10 * 60_000;
const WATCHDOG_REPEAT_MS = 60 * 60_000;

/** Separate formal storage; shares existing save/history semantics, not trial state. */
export class RegionalProjectDO {
  private readonly sql: SqlStorage;
  private readonly journal: ProjectSyncJournal;
  private readonly quota: ProjectQuota;
  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: ProjectRegionConfig,
  ) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cloud_projects (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
      schema_version INTEGER NOT NULL, project_text TEXT NOT NULL,
      preview_svg TEXT NOT NULL DEFAULT '', gallery_entry_id TEXT, favorite INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID`);
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_cloud_projects_user ON cloud_projects(user_id, updated_at)`,
    );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cloud_project_versions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
      name TEXT NOT NULL, saved_at TEXT NOT NULL, schema_version INTEGER NOT NULL,
      project_text TEXT NOT NULL, preview_svg TEXT NOT NULL DEFAULT ''
    ) WITHOUT ROWID`);
    this.sql.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_project_versions ON cloud_project_versions(project_id, revision)`,
    );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS regional_project_heads (
      id TEXT PRIMARY KEY, head TEXT NOT NULL
    ) WITHOUT ROWID`);
    // The source's view of the private region's pulls, for its own alerting.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS project_sync_watchdog (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      last_pull_at INTEGER NOT NULL, stale INTEGER NOT NULL DEFAULT 0,
      alerted_at INTEGER NOT NULL DEFAULT 0
    )`);
    this.journal = new ProjectSyncJournal(
      this.sql,
      env.PROJECT_REGION,
      env.PROJECT_SYNC_MAX_BYTES === undefined
        ? undefined
        : Number(env.PROJECT_SYNC_MAX_BYTES),
    );
    this.quota = new ProjectQuota(this.sql);
  }

  private head(id: string): string | undefined {
    return this.sql
      .exec<{ head: string }>(
        "SELECT head FROM regional_project_heads WHERE id = ?",
        id,
      )
      .toArray()[0]?.head;
  }

  private captureExisting(id: string, userId?: string): void {
    if (this.head(id)) return;
    const row = this.sql
      .exec<{ user_id: string }>(
        "SELECT user_id FROM cloud_projects WHERE id=?",
        id,
      )
      .toArray()[0];
    if (!row || (userId !== undefined && row.user_id !== userId)) return;
    const head = this.journal.record(
      id,
      row.user_id,
      undefined,
      this.journal.snapshot(id),
    );
    this.sql.exec("INSERT INTO regional_project_heads VALUES (?,?)", id, head);
  }

  /**
   * Decide one watchdog step at the source: alert once the private region has
   * not pulled for WATCHDOG_STALE_MS, repeat hourly, and report recovery once.
   * A region that never pulled is not monitored. An unsent alert is retried.
   */
  watchdog(
    now: number,
    unsent = false,
  ): { action: "alert" | "recover" | null; lastPullAt: number | null } {
    const row = this.sql
      .exec<{ last_pull_at: number; stale: number; alerted_at: number }>(
        "SELECT last_pull_at, stale, alerted_at FROM project_sync_watchdog",
      )
      .toArray()[0];
    if (!row) return { action: null, lastPullAt: null };
    if (unsent) {
      this.sql.exec("UPDATE project_sync_watchdog SET alerted_at = 0");
      return { action: null, lastPullAt: row.last_pull_at };
    }
    const stale = now - row.last_pull_at > WATCHDOG_STALE_MS;
    let action: "alert" | "recover" | null = null;
    if (stale && now - row.alerted_at >= WATCHDOG_REPEAT_MS) action = "alert";
    else if (!stale && row.stale) action = "recover";
    this.sql.exec(
      "UPDATE project_sync_watchdog SET stale = ?, alerted_at = ?",
      stale ? 1 : 0,
      action === "alert" ? now : stale ? row.alerted_at : 0,
    );
    return { action, lastPullAt: row.last_pull_at };
  }

  async fetch(request: Request): Promise<Response> {
    return this.handle(
      new URL(request.url).pathname.slice(1),
      (await request.json()) as Record<string, unknown>,
    );
  }

  /** The colocated Gallery store delegates already-decoded operations here. */
  async handle(
    operation: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    try {
      return await this.dispatch(operation, body);
    } catch (error) {
      if (error instanceof ProjectCreationRefused) return error.response;
      if (error instanceof ProjectSyncCapacityError)
        return Response.json(
          { error: "replication-capacity" },
          { status: 507 },
        );
      if (error instanceof ProjectSyncFenceError)
        return Response.json({ error: "restore-fenced" }, { status: 503 });
      throw error;
    }
  }

  private async dispatch(
    operation: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    if (
      this.env.PROJECT_REGION !== "cn" &&
      this.env.PROJECT_REGION !== "overseas"
    )
      return Response.json({ error: "region-not-configured" }, { status: 503 });
    let users: string[] | null;
    let protectedIds: string[];
    try {
      users = projectRegionUsers(this.env.PROJECT_REGION_USERS);
      protectedIds = protectedProjectIds(this.env.PROJECT_PROTECTED_IDS);
    } catch {
      return Response.json({ error: "region-not-configured" }, { status: 503 });
    }
    if (operation === "submit" || operation === "replace-entry")
      return this.publish(operation, body, users, protectedIds);
    if (operation === "cloud-project-region")
      return Response.json({ region: this.env.PROJECT_REGION });
    if (operation === "sync-seed")
      return this.state.storage.transactionSync(() => {
        const scope =
          users === null
            ? ""
            : ` AND user_id IN (${users.map(() => "?").join(",")})`;
        const rows = this.sql
          .exec<{ id: string }>(
            `SELECT id FROM cloud_projects WHERE id NOT IN (SELECT id FROM regional_project_heads)${scope} ORDER BY id LIMIT 1`,
            ...(users ?? []),
          )
          .toArray();
        for (const row of rows) this.captureExisting(row.id);
        return Response.json({
          seeded: rows.length,
          remaining: this.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count FROM cloud_projects WHERE id NOT IN (SELECT id FROM regional_project_heads)${scope}`,
              ...(users ?? []),
            )
            .one().count,
        });
      });
    if (operation === "sync-quota") {
      if (this.env.PROJECT_REGION !== "overseas")
        return Response.json({ error: "not-quota-authority" }, { status: 409 });
      const id = String(body.id),
        owner = String(body.ownerUserId);
      if (users !== null && !users.includes(owner))
        return Response.json({ error: "owner-not-admitted" }, { status: 403 });
      if (this.journal.deleted(id))
        return Response.json({ error: "resource-deleted" }, { status: 409 });
      const reserved = this.state.storage.transactionSync(() => {
        const response = this.quota.reserve(id, owner);
        if (!response.ok) return response;
        const token = this.quota.token(id);
        return { token, sequence: this.journal.reserve(id, owner, token) };
      });
      if (reserved instanceof Response) return reserved;
      const exported = (await (
        await this.journal.events(reserved.sequence - 1)
      ).json()) as { events: unknown[] };
      return Response.json({
        id,
        ownerUserId: owner,
        reservation: reserved.token,
        event: exported.events[0],
      });
    }
    if (operation === "sync-events")
      return this.journal.events(Number(body.after));
    if (operation === "sync-pull") {
      this.sql.exec(
        "INSERT INTO project_sync_watchdog (singleton, last_pull_at) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET last_pull_at = excluded.last_pull_at",
        Date.now(),
      );
      const peer =
        body.status as import("./project-sync-journal").ProjectSyncStatus;
      const reconciled = await this.journal.reconcile(peer);
      if (!reconciled.ok) return reconciled;
      const after = peer.received?.sequence ?? 0;
      const acknowledged = this.journal.acknowledge(
        this.journal.status().epoch,
        after,
      );
      if (!acknowledged.ok) return acknowledged;
      const exported = await this.journal.events(after);
      if (!exported.ok) return exported;
      const { events } = (await exported.json()) as { events: unknown[] };
      return Response.json({ peer: this.journal.status(), events });
    }
    if (operation === "sync-status")
      return Response.json(this.journal.status());
    if (operation === "sync-watchdog")
      return Response.json(this.watchdog(Number(body.now), body.unsent === true));
    if (operation === "sync-delivery")
      return this.journal.delivery(body.status);
    if (operation === "sync-reconcile")
      return this.journal.reconcile(
        body.peer as import("./project-sync-journal").ProjectSyncStatus,
      );
    if (operation === "sync-ack")
      return this.journal.acknowledge(body.epoch, body.sequence);
    if (operation === "sync-receive") {
      const decoded = await decodeProjectEvent(body.event);
      if (!decoded)
        return Response.json({ error: "invalid-event" }, { status: 400 });
      if (users !== null && !users.includes(decoded.change.ownerUserId))
        return Response.json({ error: "owner-not-admitted" }, { status: 403 });
      if (
        this.env.PROJECT_REGION === "overseas" &&
        protectedIds.includes(decoded.change.id)
      )
        return Response.json({ error: "protected-project" }, { status: 403 });
      return this.state.storage.transactionSync(() => {
        const result = this.journal.receive(decoded.event, decoded.change);
        if (result.ok && this.journal.deleted(decoded.change.id))
          this.quota.release(decoded.change.id);
        return result;
      });
    }
    const id = String(body.id ?? "");
    const userId = String(body.userId ?? "");
    if (
      this.env.PROJECT_REGION === "cn" &&
      protectedIds.includes(id) &&
      [
        "cloud-project-create",
        "cloud-project-update",
        "cloud-project-check-update",
        "cloud-project-delete",
        "cloud-project-favorite",
        "cloud-project-preview-store",
      ].includes(operation)
    ) {
      const owned =
        this.sql
          .exec(
            "SELECT id FROM cloud_projects WHERE id=? AND user_id=?",
            id,
            userId,
          )
          .toArray().length > 0;
      return owned
        ? Response.json(
            {
              error: "protected-project",
              message:
                "This historical Project is read-only during regional acceptance. Save a new copy to edit it.",
            },
            { status: 403 },
          )
        : Response.json({ error: "not-found" }, { status: 404 });
    }
    const captured = this.state.storage.transactionSync(() => {
      this.captureExisting(id, userId);
      if (operation === "cloud-project-list") {
        for (const row of this.sql
          .exec<{ id: string }>(
            "SELECT id FROM cloud_projects WHERE user_id=?",
            userId,
          )
          .toArray())
          this.captureExisting(row.id, userId);
      }
      const before = this.journal.snapshot(id);
      const result = this.execute(operation, body, userId, id);
      if (
        result.ok &&
        [
          "cloud-project-create",
          "cloud-project-update",
          "cloud-project-favorite",
          "cloud-project-delete",
        ].includes(operation)
      ) {
        const after = this.journal.snapshot(id);
        if (after !== before || this.journal.heads(id).length > 1) {
          const head = this.journal.record(id, userId, this.head(id), after);
          this.sql.exec(
            "INSERT OR REPLACE INTO regional_project_heads (id, head) VALUES (?, ?)",
            id,
            head,
          );
        }
      }
      const metadata = new Map<
        string,
        { saveToken?: string; conflicted?: boolean }
      >();
      for (const row of this.sql
        .exec<{ id: string }>(
          "SELECT id FROM cloud_projects WHERE user_id=?",
          userId,
        )
        .toArray()) {
        const head = this.head(row.id);
        metadata.set(row.id, {
          ...(head ? { saveToken: head } : {}),
          ...(this.journal.conflicted(row.id) ? { conflicted: true } : {}),
        });
      }
      return { response: result, currentHead: this.head(id), metadata };
    });
    const { response, currentHead, metadata } = captured;
    const payload = (await response.json()) as {
      saveToken?: string;
      project?: { id: string; saveToken?: string; conflicted?: boolean };
      projects?: { id: string; saveToken?: string; conflicted?: boolean }[];
    };
    if (response.ok && operation === "cloud-project-versions" && currentHead)
      payload.saveToken = currentHead;
    for (const project of [payload.project, ...(payload.projects ?? [])]) {
      if (!project) continue;
      Object.assign(project, metadata.get(project.id));
    }
    return Response.json(payload, { status: response.status });
  }

  /** Gallery and its affected private bindings commit with their journal entries. */
  private publish(
    operation: "submit" | "replace-entry",
    body: Record<string, unknown>,
    users: string[] | null,
    protectedIds: string[],
  ): Response {
    return this.state.storage.transactionSync(() => {
      const affected = this.sql
        .exec<{ id: string; user_id: string }>(
          `SELECT id, user_id FROM cloud_projects WHERE
            (id = ? AND user_id = ?) OR
            (gallery_entry_id = ? AND
              ((? IS NOT NULL AND user_id = ?) OR
               (? IS NOT NULL AND user_id <> ?)))`,
          typeof body.cloudProjectId === "string" ? body.cloudProjectId : null,
          String(body.userId),
          operation === "replace-entry" ? String(body.id) : null,
          typeof body.cloudProjectId === "string" ? body.cloudProjectId : null,
          String(body.userId),
          typeof body.ownerUserId === "string" ? body.ownerUserId : null,
          typeof body.ownerUserId === "string" ? body.ownerUserId : null,
        )
        .toArray()
        .filter((row) => users === null || users.includes(row.user_id));
      if (
        this.env.PROJECT_REGION === "cn" &&
        affected.some((row) => protectedIds.includes(row.id))
      )
        return Response.json({ error: "protected-project" }, { status: 403 });
      if (affected.some((row) => this.journal.conflicted(row.id)))
        return Response.json({ error: "revision-conflict" }, { status: 409 });
      const before = new Map<string, string>();
      for (const row of affected) {
        this.captureExisting(row.id, row.user_id);
        before.set(row.id, this.journal.snapshot(row.id));
      }
      const result =
        operation === "submit"
          ? submit(this.state, body)
          : replaceEntry(this.state, body);
      if (result.ok) {
        for (const row of affected) {
          const after = this.journal.snapshot(row.id);
          if (after === before.get(row.id)) continue;
          const head = this.journal.record(
            row.id,
            row.user_id,
            this.head(row.id),
            after,
          );
          this.sql.exec(
            "INSERT OR REPLACE INTO regional_project_heads (id, head) VALUES (?, ?)",
            row.id,
            head,
          );
        }
      }
      return result;
    });
  }

  private execute(
    operation: string,
    body: Record<string, unknown>,
    userId: string,
    id: string,
  ): Response {
    const heads = this.journal.heads(id);
    if (heads.length && heads[0]!.ownerUserId !== userId)
      return Response.json({ error: "not-found" }, { status: 404 });
    if (heads.length && this.journal.deleted(id))
      return Response.json({ error: "not-found" }, { status: 404 });
    const resolving =
      Array.isArray(body.resolveHeads) &&
      body.resolveHeads.length === heads.length &&
      JSON.stringify([...body.resolveHeads].sort()) ===
        JSON.stringify(heads.map((node) => node.head).sort());
    const updating =
      operation === "cloud-project-update" ||
      operation === "cloud-project-check-update";
    if (
      heads.length > 1 &&
      operation !== "cloud-project-delete" &&
      !(updating && resolving)
    )
      return Response.json(
        {
          error: "revision-conflict",
          conflicts: heads.map((node) => ({
            head: node.head,
            origin: node.origin,
            updatedAt: node.project!.updated_at,
            name: node.project!.name,
            projectText: node.project!.project_text,
          })),
        },
        { status: 409 },
      );
    if (
      operation === "cloud-project-update" ||
      operation === "cloud-project-check-update"
    ) {
      if (
        heads.length === 1 &&
        heads[0]!.project?.name === body.name &&
        heads[0]!.project?.project_text === body.projectText &&
        this.journal.knownHead(id, userId, body.saveToken)
      )
        return Response.json({
          project: cloudProjectSavedSummary(this.sql, userId, id),
        });
      if (
        !body.saveToken ||
        !heads.some((node) => node.head === body.saveToken)
      )
        return Response.json(
          {
            error: "revision-conflict",
            message:
              "This Project changed elsewhere. Reopen it from My shelf before saving.",
          },
          { status: 409 },
        );
      body.expectedRevision = this.sql
        .exec<{ revision: number }>(
          "SELECT revision FROM cloud_projects WHERE id=?",
          id,
        )
        .one().revision;
      if (
        resolving &&
        heads.length > 1 &&
        operation === "cloud-project-check-update"
      )
        return Response.json({ status: "update-needed" }, { status: 202 });
    }
    switch (operation) {
      case "cloud-project-create": {
        const intent = sha256Hex(
          JSON.stringify([
            body.name,
            body.projectText,
            body.galleryEntryId ?? null,
          ]),
        );
        if (heads.length) {
          const existing = heads[0]!.project!;
          const originalIntent = this.journal.creationIntent(id);
          const identical =
            originalIntent === undefined
              ? existing.name === body.name &&
                existing.project_text === body.projectText &&
                existing.gallery_entry_id === (body.galleryEntryId ?? null)
              : originalIntent === intent;
          return identical
            ? Response.json({
                project: cloudProjectSavedSummary(this.sql, userId, id),
              })
            : Response.json({ error: "create-key-reused" }, { status: 409 });
        }
        if (this.env.PROJECT_REGION === "overseas") {
          const reserved = this.quota.reserve(id, userId);
          if (!reserved.ok) return reserved;
        } else if (!this.quota.matches(id, userId, body.reservation))
          return Response.json(
            { error: "quota-reservation-required" },
            { status: 503 },
          );
        {
          const created = cloudProjectCreate(this.sql, body);
          if (!created.ok) throw new ProjectCreationRefused(created);
          this.journal.rememberCreation(id, intent);
          return created;
        }
      }
      case "cloud-project-update":
        return cloudProjectUpdate(this.state, body);
      case "cloud-project-check-update":
        return cloudProjectUpdate(this.state, body, true);
      case "cloud-project-favorite":
        return cloudProjectFavorite(this.sql, body);
      case "cloud-project-delete": {
        const deleted = cloudProjectDelete(this.state, userId, id);
        if (deleted.ok) this.quota.release(id);
        return deleted;
      }
      case "cloud-project-list":
        return cloudProjectList(this.sql, userId);
      case "cloud-project-open":
        return cloudProjectOpen(this.sql, userId, id);
      case "cloud-project-versions":
        return cloudProjectVersions(this.sql, userId, id, body.versionId);
      case "cloud-project-preview":
        return cloudProjectPreview(this.sql, userId, id);
      case "cloud-project-preview-store":
        return cloudProjectPreviewStore(
          this.sql,
          userId,
          id,
          Number(body.revision),
          String(body.previewSvg),
        );
      default:
        return Response.json({ error: "not-found" }, { status: 404 });
    }
  }
}
