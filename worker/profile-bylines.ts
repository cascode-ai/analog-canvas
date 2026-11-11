import type { SqlStorage } from "./auth-do";
import type { GalleryNamespaceLike } from "./gallery-store";
import { answer } from "./regional-auth-contract";
import { validAccountId } from "./retired-accounts";

export const PROFILE_BYLINE_TICK = "/internal/profile-byline-tick";

export type ProfileByline = {
  sequence: number;
  ownerUserId: string;
  displayName: string;
  deleted: boolean;
};

/** The identity authority keeps each account's latest name, not a history of names. */
export class ProfileBylines {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS profile_byline_clock (
      id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL, seeded INTEGER NOT NULL
    )`);
    sql.exec("INSERT OR IGNORE INTO profile_byline_clock VALUES (1,0,0)");
    sql.exec(`CREATE TABLE IF NOT EXISTS profile_byline_local_cursor (
      id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL
    )`);
    sql.exec("INSERT OR IGNORE INTO profile_byline_local_cursor VALUES (1,0)");
    sql.exec(`CREATE TABLE IF NOT EXISTS profile_bylines (
      user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, sequence INTEGER NOT NULL UNIQUE
    ) WITHOUT ROWID`);
    sql.exec(`CREATE TRIGGER IF NOT EXISTS profile_bylines_forget
      AFTER DELETE ON users BEGIN
        UPDATE profile_bylines SET display_name='' WHERE user_id=OLD.id;
      END`);
    // A rollback runtime still writes users, so retain its effect in storage.
    sql.exec(`CREATE TRIGGER IF NOT EXISTS profile_bylines_changed
      AFTER UPDATE OF display_name ON users
      WHEN NEW.provider<>'ai' AND NEW.display_name IS NOT OLD.display_name
      BEGIN
        UPDATE profile_byline_clock SET sequence=sequence+1 WHERE id=1;
        INSERT INTO profile_bylines VALUES
          (NEW.id,NEW.display_name,(SELECT sequence FROM profile_byline_clock WHERE id=1))
        ON CONFLICT(user_id) DO UPDATE SET
          display_name=excluded.display_name,sequence=excluded.sequence;
      END`);
  }

  /** Called in the authority constructor's transaction, once for existing accounts. */
  seed() {
    if (
      this.sql
        .exec<{ seeded: number }>(
          "SELECT seeded FROM profile_byline_clock WHERE id=1",
        )
        .one().seeded
    )
      return;
    this.sql.exec(`INSERT INTO profile_bylines
      SELECT id, display_name, ROW_NUMBER() OVER (ORDER BY id)
      FROM users WHERE provider<>'ai' AND id NOT IN (SELECT user_id FROM account_deletions)`);
    this.sql.exec(
      "UPDATE profile_byline_clock SET seeded=1, sequence=(SELECT COUNT(*) FROM profile_bylines) WHERE id=1",
    );
  }

  /** The profile and this durable effect share the caller's transaction. */
  changed(userId: string, displayName: string) {
    const previous = this.current(userId);
    if (previous?.displayName === displayName && !previous.deleted) return;
    this.sql.exec(
      "UPDATE profile_byline_clock SET sequence=sequence+1 WHERE id=1",
    );
    this.sql.exec(
      `INSERT INTO profile_bylines VALUES (?,?,(SELECT sequence FROM profile_byline_clock WHERE id=1))
      ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, sequence=excluded.sequence`,
      userId,
      displayName,
    );
  }

  current(userId: string): ProfileByline | null {
    return this.rows("b.user_id=?", userId)[0] ?? null;
  }

  /** Retries the authority's own materialized names after a failed binding call. */
  async tick(gallery: GalleryNamespaceLike | undefined): Promise<Response> {
    const after = this.sql
      .exec<{ sequence: number }>(
        "SELECT sequence FROM profile_byline_local_cursor WHERE id=1",
      )
      .one().sequence;
    const page = this.feed({ after });
    if (!page.ok) return page;
    const { jobs, head } = (await page.json()) as {
      jobs: ProfileByline[];
      head: number;
    };
    let sent = 0;
    const progress = () => {
      const cursor = this.sql
        .exec<{ sequence: number }>(
          "SELECT sequence FROM profile_byline_local_cursor WHERE id=1",
        )
        .one().sequence;
      return { head, cursor, sent, caughtUp: cursor >= head };
    };
    for (const job of jobs) {
      if (!(await applyProfileByline(gallery, job)))
        return answer(
          { status: "byline-retry", ...progress(), caughtUp: false },
          503,
        );
      this.sql.exec(
        "UPDATE profile_byline_local_cursor SET sequence=MAX(sequence,?) WHERE id=1",
        job.sequence,
      );
      sent++;
    }
    return answer({
      status: jobs.length ? "sent" : "caught-up",
      ...progress(),
    });
  }

  feed(body: Record<string, unknown>): Response {
    if (!Number.isSafeInteger(body.after) || Number(body.after) < 0)
      return answer({ error: "invalid-byline-cursor" }, 400);
    const head = this.sql
      .exec<{ sequence: number }>(
        "SELECT sequence FROM profile_byline_clock WHERE id=1",
      )
      .one().sequence;
    if (Number(body.after) > head)
      return answer({ error: "byline-recovery-required" }, 409);
    return answer({
      version: 1,
      head,
      jobs: this.rows("b.sequence>?", Number(body.after)),
    });
  }

  private rows(where: string, value: string | number): ProfileByline[] {
    return this.sql
      .exec<{
        sequence: number;
        ownerUserId: string;
        displayName: string;
        deleted: number;
      }>(
        `SELECT b.sequence, b.user_id AS ownerUserId, b.display_name AS displayName,
        (u.id IS NULL OR EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=b.user_id)) AS deleted
       FROM profile_bylines b LEFT JOIN users u ON u.id=b.user_id
       WHERE ${where} ORDER BY b.sequence LIMIT 50`,
        value,
      )
      .toArray()
      .map((row) => ({
        ...row,
        displayName: row.deleted ? "" : row.displayName,
        deleted: row.deleted === 1,
      }));
  }
}

/** Only authenticated authority effects reach the region's trusted Gallery binding. */
export async function applyProfileByline(
  gallery: GalleryNamespaceLike | undefined,
  job: ProfileByline,
): Promise<boolean> {
  if (job.deleted || !gallery) return true;
  try {
    const result = await gallery
      .getByName("gallery")
      .fetch("https://gallery/rename-owner", {
        method: "POST",
        body: JSON.stringify({
          ownerUserId: job.ownerUserId,
          displayName: job.displayName,
          bylineRevision: job.sequence,
        }),
      });
    if (result.ok) return true;
    return (
      result.status === 403 && (await result.json()).error === "account-deleted"
    );
  } catch {
    return false;
  }
}

export function isProfileByline(value: unknown): value is ProfileByline {
  if (!value || typeof value !== "object") return false;
  const row = value as ProfileByline;
  return (
    Number.isSafeInteger(row.sequence) &&
    row.sequence > 0 &&
    validAccountId(row.ownerUserId) &&
    typeof row.displayName === "string" &&
    (row.deleted || row.displayName.trim().length > 0) &&
    row.displayName.length <= 100 &&
    typeof row.deleted === "boolean"
  );
}
