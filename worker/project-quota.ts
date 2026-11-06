import type { GalleryEnv, SqlStorage } from "./gallery-store";
import { CLOUD_PROJECT_LIMIT } from "./gallery-store-cloud-projects";
import { decodeProjectEvent } from "./project-sync-protocol";
import { readSyncJson, peerOrigin } from "./project-sync-http";

/** The overseas Project store owns reservations; a reservation never expires into over-allocation. */
export class ProjectQuota {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS project_quota_reservations (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, token TEXT NOT NULL) WITHOUT ROWID",
    );
  }
  reserve(id: string, owner: string): Response {
    const current = this.sql
      .exec<{ user_id: string }>(
        "SELECT user_id FROM cloud_projects WHERE id=?",
        id,
      )
      .toArray()[0];
    if (current && current.user_id !== owner)
      return Response.json({ error: "resource-collision" }, { status: 409 });
    const existing = this.sql
      .exec<{ owner_id: string; token: string }>(
        "SELECT owner_id,token FROM project_quota_reservations WHERE id=?",
        id,
      )
      .toArray()[0];
    if (existing)
      return existing.owner_id === owner
        ? Response.json({ reservation: existing.token, id, ownerUserId: owner })
        : Response.json({ error: "resource-collision" }, { status: 409 });
    const count = this.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM (SELECT id FROM cloud_projects WHERE user_id=? UNION SELECT id FROM project_quota_reservations WHERE owner_id=?)",
        owner,
        owner,
      )
      .one().count;
    if (count >= CLOUD_PROJECT_LIMIT)
      return Response.json(
        { error: "project-limit", projects: [] },
        { status: 409 },
      );
    const token = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO project_quota_reservations VALUES (?,?,?)",
      id,
      owner,
      token,
    );
    return Response.json({ reservation: token, id, ownerUserId: owner });
  }
  release(id: string): void {
    this.sql.exec("DELETE FROM project_quota_reservations WHERE id=?", id);
  }
  token(id: string): string {
    return this.sql
      .exec<{ token: string }>(
        "SELECT token FROM project_quota_reservations WHERE id=?",
        id,
      )
      .one().token;
  }
  matches(id: string, owner: string, token: unknown): boolean {
    return (
      typeof token === "string" &&
      this.sql
        .exec(
          "SELECT id FROM project_quota_reservations WHERE id=? AND owner_id=? AND token=?",
          id,
          owner,
          token,
        )
        .toArray().length === 1
    );
  }
}

/** Creating a new resource coordinates quota; ordinary reads and updates remain local. */
export async function reserveRegionalProject(
  env: GalleryEnv,
  id: string,
  ownerUserId: string,
): Promise<{ reservation: string } | Response> {
  const response = await env
    .PROJECTS!.getByName(env.PROJECTS_STORE_NAME ?? "projects")
    .fetch("https://projects/cloud-project-region", {
      method: "POST",
      body: "{}",
    });
  const { region } = (await response.json()) as { region: string };
  if (region === "overseas") return { reservation: "local-authority" };
  if (
    region !== "cn" ||
    !env.PROJECT_SYNC_PEER_URL ||
    !env.PROJECT_SYNC_PEER_TOKEN
  )
    return Response.json(
      { error: "quota-authority-unavailable" },
      { status: 503 },
    );
  try {
    const origin = peerOrigin(env.PROJECT_SYNC_PEER_URL);
    const reserved = await fetch(new URL("/api/project-sync/quota", origin), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${env.PROJECT_SYNC_PEER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, ownerUserId }),
    });
    if (reserved.status === 409) {
      const reason = (await readSyncJson(reserved, 4096)) as { error?: string };
      return Response.json(
        {
          error:
            reason.error === "project-limit"
              ? "project-limit"
              : "quota-reservation-refused",
          projects: [],
        },
        { status: 409 },
      );
    }
    if (!reserved.ok) throw new Error("Reservation unavailable");
    const value = (await readSyncJson(reserved, 16384)) as {
      id: string;
      ownerUserId: string;
      reservation: string;
      event: unknown;
    };
    if (
      value.id !== id ||
      value.ownerUserId !== ownerUserId ||
      typeof value.reservation !== "string" ||
      !value.reservation
    )
      throw new Error("Invalid reservation");
    const grant = await decodeProjectEvent(value.event);
    if (
      !grant ||
      grant.change.kind !== "quota" ||
      grant.change.id !== id ||
      grant.change.ownerUserId !== ownerUserId ||
      grant.change.reservation !== value.reservation
    )
      throw new Error("Invalid reservation event");
    const applied = await env
      .PROJECTS!.getByName(env.PROJECTS_STORE_NAME ?? "projects")
      .fetch("https://projects/sync-receive", {
        method: "POST",
        body: JSON.stringify({ event: grant.event }),
      });
    if (!applied.ok)
      return Response.json(
        { error: "quota-catch-up-required" },
        { status: 503 },
      );
    return { reservation: value.reservation };
  } catch {
    return Response.json(
      { error: "quota-authority-unavailable" },
      { status: 503 },
    );
  }
}
