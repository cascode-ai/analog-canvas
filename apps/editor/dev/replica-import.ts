/**
 * Local trial only: builds a private replica of the Gallery from the newest
 * private backup (`node scripts/gallery-private-snapshot.mjs`), stored the
 * way the real Worker stores it, so `pnpm dev:replica` can sign in as any
 * account and show its real circuits. Nothing here reaches the live site.
 *
 *   node apps/editor/dev/replica-import.ts [--backup <directory>]
 *
 * Submitters' emails are left out. The backup holds no accounts, so each
 * owner of an entry becomes an account named by its newest (public) byline,
 * and every account that reviewed an entry is an Owner: only the Owner
 * rejects. Each account keeps one local session across imports, which the
 * dev server's account switcher hands to the browser. The replica lives
 * beside the backups, private.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { unstable_dev } from "wrangler";

const support = join(
  homedir(),
  "Library",
  "Application Support",
  "Analog Canvas",
);
const replica = resolve(
  process.env.ICM_LOCAL_REPLICA_DIR ?? join(support, "local-replica"),
);
/** Must match ADMIN_EMAILS in replica-wrangler.json. */
const OWNER_EMAIL = "owner@replica.invalid";
const SESSION_DAYS = 365;
const TABLES = ["gallery_entries", "gallery_entry_versions", "gallery_likes"];
/** Personal data the replica leaves behind: nothing local needs it. */
const LEFT_OUT = new Set(["submitter_email"]);

export type ReplicaRole = "owner" | "moderator" | "user";

export interface ReplicaAccount {
  id: string;
  name: string;
  provider: string;
  role: ReplicaRole;
  published: number;
  withdrawn: number;
  rejected: number;
  token: string;
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Not a private directory: ${path}`);
  chmodSync(path, 0o700);
}

function backupDirectory(args: string[]): string {
  const index = args.indexOf("--backup");
  if (index >= 0) {
    const chosen = args[index + 1];
    if (!chosen) throw new Error("--backup needs a directory");
    return resolve(chosen);
  }
  const root = join(support, "gallery");
  const names = existsSync(root)
    ? readdirSync(root)
        .filter(
          (name) =>
            name.startsWith("gallery-") &&
            existsSync(join(root, name, "gallery.sqlite")),
        )
        .sort()
    : [];
  const newest = names.at(-1);
  if (!newest)
    throw new Error(
      "No private Gallery backup; run node scripts/gallery-private-snapshot.mjs",
    );
  return join(root, newest);
}

function findDatabase(directory: string, className: string): string {
  const walk = (path: string): string | null => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        const found = walk(child);
        if (found) return found;
      } else if (
        // Beside each object's database the runtime keeps its own metadata.
        child.includes(className) &&
        child.endsWith(".sqlite") &&
        entry.name !== "metadata.sqlite"
      ) {
        return child;
      }
    }
    return null;
  };
  const found = walk(directory);
  if (!found) throw new Error(`The local Worker made no ${className} database`);
  return found;
}

/** Let the real Worker create its own databases, schema and migrations. */
async function createDatabases(state: string): Promise<void> {
  const readToken = randomBytes(32).toString("hex");
  const worker = await unstable_dev(
    fileURLToPath(new URL("../../../worker/index.ts", import.meta.url)),
    {
      config: fileURLToPath(
        new URL("./replica-wrangler.json", import.meta.url),
      ),
      envFiles: [],
      local: true,
      ip: "127.0.0.1",
      port: 0,
      inspectorPort: 0,
      persist: true,
      persistTo: state,
      vars: { GALLERY_BACKUP_TOKEN: readToken },
      logLevel: "error",
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        showInteractiveDevSession: false,
        watch: false,
      },
    },
  );
  try {
    // Reads that wake the Gallery and Auth objects. The Gallery admits a
    // signed-out read only with its read credential, which exists for this
    // one run and is never stored.
    for (const [path, headers] of [
      ["/api/gallery?limit=1", { Authorization: `Bearer ${readToken}` }],
      ["/api/auth/me", {}],
    ] as const) {
      const response = await worker.fetch(path, { headers });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    }
  } finally {
    await worker.stop();
  }
}

function columns(database: DatabaseSync, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[]
  ).map((column) => column.name);
}

function copyGallery(galleryPath: string, backupPath: string): void {
  const gallery = new DatabaseSync(galleryPath);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    gallery.exec("BEGIN");
    for (const table of TABLES) {
      const wanted = columns(gallery, table);
      const present = new Set(columns(backup, table));
      const shared = wanted.filter(
        (name) => present.has(name) && !LEFT_OUT.has(name),
      );
      const list = shared.map((name) => `"${name}"`).join(", ");
      const insert = gallery.prepare(
        `INSERT INTO ${table} (${list}) VALUES (${shared.map(() => "?").join(", ")})`,
      );
      gallery.exec(`DELETE FROM ${table}`);
      for (const row of backup
        .prepare(`SELECT ${list} FROM ${table}`)
        .iterate() as Iterable<Record<string, unknown>>) {
        insert.run(...shared.map((name) => row[name] as never));
      }
    }
    gallery.exec("COMMIT");
  } catch (error) {
    gallery.exec("ROLLBACK");
    throw error;
  } finally {
    gallery.close();
    backup.close();
  }
}

function accountsFrom(backupPath: string): Omit<ReplicaAccount, "token">[] {
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const counts = new Map(
      (
        backup
          .prepare(
            `SELECT owner_user_id AS id,
               SUM(status = 'public') AS published,
               SUM(status = 'recycled') AS withdrawn,
               SUM(status = 'rejected') AS rejected,
               (SELECT author FROM gallery_entries AS newest
                 WHERE newest.owner_user_id = entries.owner_user_id
                 ORDER BY created_at DESC LIMIT 1) AS name,
               (SELECT submitter_provider FROM gallery_entries AS newest
                 WHERE newest.owner_user_id = entries.owner_user_id
                   AND submitter_provider IS NOT NULL
                 ORDER BY created_at DESC LIMIT 1) AS provider
             FROM gallery_entries AS entries
             WHERE owner_user_id IS NOT NULL
             GROUP BY owner_user_id`,
          )
          .all() as {
          id: string;
          published: number;
          withdrawn: number;
          rejected: number;
          name: string | null;
          provider: string | null;
        }[]
      ).map((row) => [row.id, row]),
    );
    const circuits = (id: string) => {
      const row = counts.get(id);
      return {
        published: Number(row?.published ?? 0),
        withdrawn: Number(row?.withdrawn ?? 0),
        rejected: Number(row?.rejected ?? 0),
      };
    };
    const reviewers = new Set(
      (
        backup
          .prepare(
            `SELECT DISTINCT reviewed_by AS id FROM gallery_entries
             WHERE reviewed_by IS NOT NULL`,
          )
          .all() as { id: string }[]
      ).map((row) => row.id),
    );
    const accounts: Omit<ReplicaAccount, "token">[] = [...counts.values()].map(
      (row) => ({
        id: row.id,
        name: (row.name ?? "").trim().slice(0, 40) || "Someone",
        provider: row.provider ?? "email",
        role: reviewers.has(row.id) ? "owner" : "user",
        ...circuits(row.id),
      }),
    );
    // A reviewer who never published still signs in, under a stand-in name.
    for (const id of reviewers) {
      if (accounts.some((account) => account.id === id)) continue;
      accounts.push({
        id,
        name: `Owner ${id.slice(0, 8)}`,
        provider: "github",
        role: "owner",
        ...circuits(id),
      });
    }
    const rank: Record<ReplicaRole, number> = {
      owner: 0,
      moderator: 1,
      user: 2,
    };
    const total = (account: Omit<ReplicaAccount, "token">) =>
      account.published + account.withdrawn + account.rejected;
    return accounts.sort(
      (left, right) =>
        rank[left.role] - rank[right.role] ||
        total(right) - total(left) ||
        left.name.localeCompare(right.name),
    );
  } finally {
    backup.close();
  }
}

function writeAccounts(
  authPath: string,
  accounts: Omit<ReplicaAccount, "token">[],
  earlierTokens: Map<string, string>,
): ReplicaAccount[] {
  const auth = new DatabaseSync(authPath);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  try {
    auth.exec("BEGIN");
    auth.exec("DELETE FROM sessions");
    auth.exec("DELETE FROM users");
    const user = auth.prepare(
      `INSERT INTO users(id, provider, provider_id, email, display_name, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const session = auth.prepare(
      `INSERT INTO sessions(token_hash, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    );
    const signed = accounts.map((account) => {
      // A browser signed in before a re-import stays signed in.
      const token =
        earlierTokens.get(account.id) ?? randomBytes(32).toString("hex");
      user.run(
        account.id,
        account.provider,
        `replica:${account.id}`,
        // The Owner is the account ADMIN_EMAILS names; moderators are a role.
        account.role === "owner" ? OWNER_EMAIL : null,
        account.name,
        account.role === "moderator" ? "moderator" : "user",
        now.toISOString(),
      );
      session.run(
        createHash("sha256").update(token).digest("hex"),
        account.id,
        now.toISOString(),
        expires.toISOString(),
      );
      return { ...account, token };
    });
    auth.exec("COMMIT");
    return signed;
  } catch (error) {
    auth.exec("ROLLBACK");
    throw error;
  } finally {
    auth.close();
  }
}

function earlierTokens(): Map<string, string> {
  try {
    const earlier = JSON.parse(
      readFileSync(join(replica, "accounts.json"), "utf8"),
    ) as ReplicaAccount[];
    return new Map(earlier.map((account) => [account.id, account.token]));
  } catch {
    return new Map();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source = backupDirectory(args);
  const backupPath = join(source, "gallery.sqlite");
  privateDirectory(replica);
  const tokens = earlierTokens();
  const state = join(replica, "state");
  rmSync(state, { recursive: true, force: true });
  privateDirectory(state);

  await createDatabases(state);
  copyGallery(findDatabase(state, "GalleryDO"), backupPath);
  const accounts = writeAccounts(
    findDatabase(state, "AuthDO"),
    accountsFrom(backupPath),
    tokens,
  );

  const file = (name: string, value: unknown) =>
    writeFileSync(join(replica, name), `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
  file("accounts.json", accounts);
  file("source.json", {
    backup: source.split("/").at(-1),
    importedAt: new Date().toISOString(),
  });

  const count = (key: "published" | "withdrawn" | "rejected") =>
    accounts.reduce((sum, account) => sum + account[key], 0);
  const roles = (role: ReplicaRole) =>
    accounts.filter((account) => account.role === role).length;
  console.log(
    `Local replica of ${source.split("/").at(-1)}: ${accounts.length} accounts ` +
      `(${roles("owner")} owner, ${roles("moderator")} moderator, ${roles("user")} users), ` +
      `${count("published")} published, ${count("withdrawn")} withdrawn, ` +
      `${count("rejected")} rejected circuits.`,
  );
}

await main();
