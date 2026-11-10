import {
  arenaAccount,
  unlinkArenaVoter,
  type ArenaService,
} from "./arena-account";
import type { SessionUser } from "./auth-do";
import { purgeTrustedDevices } from "./agent-device-trust";
import type { AgentSessionNamespaceLike } from "./agent-session-runtime";
import { GALLERY_SOURCES, galleryStoreName } from "./gallery-sources";
import type { GalleryNamespaceLike, SqlStorage } from "./gallery-store";
import { answer, digest } from "./regional-auth-contract";

export const ACCOUNT_DELETE_PATH = "/api/auth/account/delete";
export const ACCOUNT_DELETION_TICK = "/internal/account-deletion-tick";

export type AccountResourceBindings = {
  GALLERY?: GalleryNamespaceLike;
  COMPONENT_LIBRARY?: GalleryNamespaceLike;
  PROJECTS?: GalleryNamespaceLike;
  PROJECTS_STORE_NAME?: "projects" | "gallery";
  PROJECT_REGION_USERS?: string;
  PROJECT_SYNC_EXPANSION?: string;
  /** Agent sessions, which hold each site's trusted-device directories. */
  AGENT_SESSION?: AgentSessionNamespaceLike;
};

type Job = {
  sequence: number;
  user_id: string;
  arena_account: string | null;
  overseas_done: number;
  cn_done: number;
};

export function deletionRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  );
}

/** Durable authority record. Only the digest of the browser's receipt is stored. */
export class AccountDeletions {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS account_deletions (
      sequence INTEGER PRIMARY KEY, user_id TEXT UNIQUE NOT NULL,
      receipt_hash TEXT UNIQUE NOT NULL, arena_account TEXT,
      overseas_done INTEGER NOT NULL DEFAULT 0, cn_done INTEGER NOT NULL DEFAULT 0
    )`);
  }

  has(userId: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM account_deletions WHERE user_id=?", userId)
        .toArray().length > 0
    );
  }

  private job(receiptHash: string): Job | undefined {
    return this.sql
      .exec<Job>(
        "SELECT * FROM account_deletions WHERE receipt_hash=?",
        receiptHash,
      )
      .toArray()[0];
  }

  async status(requestId: unknown): Promise<Response | null> {
    if (!deletionRequestId(requestId)) return null;
    return this.statusForHash(requestId, await digest(requestId));
  }

  statusForHash(requestId: string, hash: string): Response | null {
    const row = this.job(hash);
    return row ? this.progress(row, requestId) : null;
  }

  start(
    user: SessionUser,
    requestId: string,
    receiptHash: string,
    retainArenaAccount: boolean,
  ) {
    this.sql.exec(
      "INSERT INTO account_deletions (user_id, receipt_hash, arena_account) VALUES (?,?,?)",
      user.id,
      receiptHash,
      retainArenaAccount ? arenaAccount(user) : null,
    );
    return this.progress(this.job(receiptHash)!, requestId);
  }

  private progress(job: Job, requestId: string): Response {
    const deletion = {
      requestId,
      overseas: job.overseas_done ? "complete" : "pending",
      cn: job.cn_done ? "complete" : "pending",
    };
    return answer({ deletion }, job.overseas_done && job.cn_done ? 200 : 202);
  }

  /** The private region can replay the feed from any earlier stored cursor. */
  feed(body: Record<string, unknown>): Response {
    if (body.acknowledge !== undefined) {
      if (
        !Number.isSafeInteger(body.acknowledge) ||
        Number(body.acknowledge) < 1
      )
        return answer({ error: "invalid-deletion-cursor" }, 400);
      const changed = this.sql
        .exec(
          "UPDATE account_deletions SET cn_done=1 WHERE sequence=? RETURNING sequence",
          body.acknowledge,
        )
        .toArray();
      return changed.length
        ? answer({ acknowledged: body.acknowledge })
        : answer({ error: "unknown-deletion" }, 409);
    }
    if (!Number.isSafeInteger(body.after) || Number(body.after) < 0)
      return answer({ error: "invalid-deletion-cursor" }, 400);
    const latest = this.sql
      .exec<{ sequence: number }>(
        "SELECT COALESCE(MAX(sequence),0) AS sequence FROM account_deletions",
      )
      .one().sequence;
    if (Number(body.after) > latest)
      return answer({ error: "deletion-recovery-required" }, 409);
    const job =
      this.sql
        .exec<{ sequence: number; userId: string }>(
          "SELECT sequence, user_id AS userId FROM account_deletions WHERE sequence>? ORDER BY sequence LIMIT 1",
          body.after,
        )
        .toArray()[0] ?? null;
    return answer({ version: 1, job });
  }

  async tick(
    env: AccountResourceBindings & { ARENA?: ArenaService },
    origin: string,
  ): Promise<Response> {
    const job = this.sql
      .exec<Job>(
        "SELECT * FROM account_deletions WHERE overseas_done=0 ORDER BY sequence LIMIT 1",
      )
      .toArray()[0];
    if (!job) return answer({ status: "caught-up" });
    const cleaned = await purgeAccountResources(env, job.user_id, {
      site: origin,
    });
    if (
      !cleaned ||
      (job.arena_account &&
        !(await unlinkArenaVoter(env.ARENA, job.arena_account, origin)))
    )
      return answer({ status: "retry" }, 503);
    this.sql.exec(
      "UPDATE account_deletions SET overseas_done=1, arena_account=NULL WHERE sequence=?",
      job.sequence,
    );
    return answer({ status: "sent" });
  }
}

/**
 * These targets are bindings, so the browser cannot supply a store or owner.
 * A site's own deletion also forgets the devices the account trusted there.
 */
export async function purgeAccountResources(
  env: AccountResourceBindings,
  userId: string,
  { replay = false, site }: { replay?: boolean; site?: string } = {},
): Promise<boolean> {
  const gallery = ["gallery", ...GALLERY_SOURCES.map(galleryStoreName)].map(
    (name) => env.GALLERY?.getByName(name),
  );
  const targets = [
    ...gallery,
    env.COMPONENT_LIBRARY?.getByName("components"),
    ...(env.PROJECTS && env.PROJECTS_STORE_NAME !== "gallery"
      ? [env.PROJECTS.getByName(env.PROJECTS_STORE_NAME ?? "projects")]
      : []),
  ];
  // There are more stores than the runtime's simultaneous connection limit.
  const clean = async (target: (typeof targets)[number]) => {
    if (!target) return true;
    try {
      const result = await target.fetch("https://resources/retire-account", {
        method: "POST",
        body: JSON.stringify({ userId, ...(replay ? { replay } : {}) }),
      });
      return result.ok;
    } catch {
      return false;
    }
  };
  const first = await Promise.all(targets.slice(0, 4).map(clean));
  const rest = await Promise.all(targets.slice(4).map(clean));
  const devices =
    site === undefined ||
    (await purgeTrustedDevices(env.AGENT_SESSION, site, userId));
  return first.every(Boolean) && rest.every(Boolean) && devices;
}
